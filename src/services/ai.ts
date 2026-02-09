// AI Service - Multi-Phase Validation Pipeline with Batching Support
// All AI operations use Groq with optimal model selection

import {
    GroqService,
    PipelineResult,
    ExtractionResult,
    ValidationResult,
    ValidationError,
    ExtractionMeta,
    ConsultationClassification,
    ModelInvocationRecord,
    UncertaintyFlag,
    QualityTriageResult
} from './groq';
import { enqueueAuditEvent } from './audit-worker';
import { BudgetExceededError } from './reliability/budget-manager';

export interface AIResult<T> {
    data: T;
    model: string;
}

export interface AIResultWithMetadata extends AIResult<string> {
    extraction?: ExtractionResult;
    extraction_meta?: ExtractionMeta[];
    classification?: ConsultationClassification;
    validations?: ValidationResult[];
    corrections_applied?: number;
    remaining_errors?: { type: string; field: string; reason: string }[];
    active_memory_used?: boolean;
    uncertainty_flags?: UncertaintyFlag[];
    audit_id?: string;
    pipeline_status?: 'completed' | 'degraded';
    result_status?: 'completed' | 'provisional' | 'failed_recoverable' | 'failed_final';
    retry_after_ms?: number;
    session_id?: string;
    rule_pack_version?: number;
    rule_ids_used?: string[];
    learning_applied?: boolean;
    quality_score?: number;
    critical_gaps?: QualityTriageResult['critical_gaps'];
    doctor_next_actions?: string[];
    quality_triage_model?: string;
    correction_rounds_executed?: number;
    early_stop_reason?: 'clean_consensus' | 'low_risk_remaining' | 'max_rounds_reached';
    risk_level?: 'low' | 'medium' | 'high';
    phase_timings_ms?: {
        extract: number;
        generate: number;
        validate: number;
        corrections: number;
        total: number;
    };
    logical_calls_used?: number;
    physical_calls_used?: number;
    call_budget_mode?: 'two_call_adaptive' | 'standard';
    provisional_reason?: string;
    fallback_hops?: number;
}

const FAST_PATH_ADAPTIVE_VALIDATION = String(import.meta.env.VITE_FAST_PATH_ADAPTIVE_VALIDATION || 'true').toLowerCase() === 'true';
const FAST_PATH_ASYNC_TRIAGE = String(import.meta.env.VITE_FAST_PATH_ASYNC_TRIAGE || 'true').toLowerCase() === 'true';
const TWO_CALL_ADAPTIVE_MODE = String(import.meta.env.VITE_TWO_CALL_ADAPTIVE_MODE || 'true').toLowerCase() === 'true';

export class AIService {
    private groq: GroqService;

    constructor(groqApiKey: string | string[]) {
        this.groq = new GroqService(groqApiKey);
    }

    resetInvocationCounters(sessionId?: string): void {
        this.groq.resetInvocationCounters(sessionId);
    }

    getInvocationCounters(sessionId?: string): {
        total_invocations: number;
        fallback_hops: number;
        by_task: Record<string, number>;
    } {
        return this.groq.getInvocationCounters(sessionId);
    }

    private estimateTokens(text: string): number {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }

    private buildAuditId(): string {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
            return crypto.randomUUID();
        }
        return `audit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }

    private isBudgetError(error: unknown): error is BudgetExceededError {
        if (error instanceof BudgetExceededError) return true;
        const message = ((error as Error)?.message || '').toLowerCase();
        return message.includes('budget_limit') || message.includes('awaiting_budget');
    }

    private sanitizeClinicalHistory(rawHistory: string): string {
        if (!rawHistory) return rawHistory;
        const allowedSections = new Set([
            'MOTIVO DE CONSULTA',
            'ANTECEDENTES',
            'ENFERMEDAD ACTUAL',
            'EXPLORACION / PRUEBAS',
            'DIAGNOSTICO',
            'PLAN'
        ]);
        const sectionRegex = /^##\s+(.+)$/gm;
        const matches = Array.from(rawHistory.matchAll(sectionRegex));
        if (matches.length === 0) return rawHistory.trim();

        const chunks: string[] = [];
        for (let i = 0; i < matches.length; i++) {
            const current = matches[i];
            const title = (current[1] || '').trim();
            const normalizedTitle = title
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toUpperCase();
            if (!allowedSections.has(normalizedTitle)) continue;
            const start = (current.index || 0) + current[0].length;
            const end = i + 1 < matches.length ? (matches[i + 1].index || rawHistory.length) : rawHistory.length;
            const body = rawHistory.slice(start, end).trim();
            chunks.push(`## ${title}\n${body || 'No consta'}`);
        }

        return chunks.length > 0 ? chunks.join('\n\n').trim() : rawHistory.trim();
    }

    private summarizeInvocations(records: ModelInvocationRecord[]): Record<string, {
        winner: string;
        attempts_count: number;
        fallback_count: number;
    }> {
        const grouped = new Map<string, ModelInvocationRecord[]>();
        for (const record of records) {
            const task = record.task || 'unknown';
            const list = grouped.get(task) || [];
            list.push(record);
            grouped.set(task, list);
        }

        const summary: Record<string, { winner: string; attempts_count: number; fallback_count: number }> = {};
        for (const [task, attempts] of grouped.entries()) {
            const winner = attempts.find((item) => item.success);
            summary[task] = {
                winner: winner ? `${winner.provider}:${winner.model}` : 'none',
                attempts_count: attempts.length,
                fallback_count: attempts.filter((item) => item.is_fallback).length
            };
        }
        return summary;
    }

    private severityWeight(severity?: string): number {
        if (severity === 'critical') return 3;
        if (severity === 'major') return 2;
        return 1;
    }

    private computeRiskLevel(errors: Array<{ type?: string; severity?: string }>): 'low' | 'medium' | 'high' {
        if (!errors || errors.length === 0) return 'low';
        const hasHighType = errors.some((error) =>
            (error.type === 'hallucination' || error.type === 'inconsistency') && this.severityWeight(error.severity) >= 2
        );
        if (hasHighType) return 'high';
        const totalWeight = errors.reduce((acc, error) => acc + this.severityWeight(error.severity), 0);
        return totalWeight >= 4 ? 'medium' : 'low';
    }

    private runDeterministicClinicalGuard(
        generatedHistory: string,
        mergedExtraction: ExtractionResult
    ): {
        validations: ValidationResult[];
        consensus: ValidationError[];
    } {
        const issues: ValidationError[] = [];
        const text = generatedHistory || '';
        // Strip accents/tildes to avoid false positives (e.g. EXPLORACIÓN vs EXPLORACION)
        const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const normalized = stripAccents(text.toUpperCase());
        const requiredSections = [
            '## MOTIVO DE CONSULTA',
            '## ANTECEDENTES',
            '## ENFERMEDAD ACTUAL',
            '## EXPLORACION / PRUEBAS',
            '## DIAGNOSTICO',
            '## PLAN'
        ];

        for (const section of requiredSections) {
            if (!normalized.includes(stripAccents(section))) {
                issues.push({
                    type: 'missing',
                    field: section.replace('## ', '').toLowerCase(),
                    reason: `Falta seccion obligatoria: ${section}`,
                    severity: section.includes('DIAGNOSTICO') || section.includes('PLAN') ? 'critical' : 'major'
                });
            }
        }

        if (/\{[^}]+\}/.test(text)) {
            issues.push({
                type: 'inconsistency',
                field: 'template',
                reason: 'Hay placeholders sin resolver en la historia final',
                severity: 'critical'
            });
        }

        const bannedInternalBlocks = [
            '## INCERTIDUMBRES / REVISAR',
            'CLASIFICACION (CONTEXTO',
            'RULEPACK:',
            'REGLAS DE APRENDIZAJE:'
        ];
        for (const marker of bannedInternalBlocks) {
            if (normalized.includes(stripAccents(marker))) {
                issues.push({
                    type: 'hallucination',
                    field: 'history_format',
                    reason: `Bloque interno no permitido en historia final: ${marker}`,
                    severity: 'critical'
                });
            }
        }

        const qualityNotes = mergedExtraction.notas_calidad || [];
        for (const note of qualityNotes) {
            if (note.tipo === 'INAUDIBLE' || note.tipo === 'AMBIGUO') {
                issues.push({
                    type: 'missing',
                    field: note.seccion || 'transcripcion',
                    reason: `[${note.tipo}] ${note.descripcion}`,
                    severity: note.tipo === 'INAUDIBLE' ? 'major' : 'minor'
                });
            }
        }

        const risk = this.computeRiskLevel(issues);
        const validation: ValidationResult = {
            validator: 'deterministic_guard',
            is_valid: issues.length === 0,
            errors: issues,
            confidence: issues.length === 0 ? 0.94 : Math.max(0.25, 0.86 - issues.length * 0.08),
            risk_level: risk
        };
        return {
            validations: [validation],
            consensus: issues
        };
    }

    private shouldEscalateCorrections(
        attempt: number,
        transcriptTokens: number,
        currentErrors: Array<{ type?: string; severity?: string }>
    ): number {
        if (!FAST_PATH_ADAPTIVE_VALIDATION) return transcriptTokens > 8000 ? 3 : 2;
        const hardMax = transcriptTokens > 8000 ? 3 : 2;
        if (attempt === 0) {
            const hasMajorOrCritical = currentErrors.some((error) => this.severityWeight(error.severity) >= 2);
            if (!hasMajorOrCritical) return 1;
            const hasCritical = currentErrors.some((error) => error.severity === 'critical');
            if (hasCritical && transcriptTokens > 8000) return Math.min(3, hardMax);
            return Math.min(2, hardMax);
        }
        if (attempt === 1) {
            const hasCritical = currentErrors.some((error) => error.severity === 'critical');
            if (hasCritical && transcriptTokens > 8000) return Math.min(3, hardMax);
            return Math.min(2, hardMax);
        }
        return hardMax;
    }

    private buildProvisionalHistory(reason: string): string {
        return `## MOTIVO DE CONSULTA
No consta (procesamiento aplazado)

## ANTECEDENTES
- Alergias: No consta
- Enfermedades crónicas: No consta
- Cirugías: No consta
- Tratamiento habitual: No consta

## ENFERMEDAD ACTUAL
- Síntomas: No consta
- Evolución: No consta

## EXPLORACIÓN / PRUEBAS
No consta

## DIAGNÓSTICO
No consta

## PLAN
Reintentar procesamiento automatico. Motivo tecnico: ${reason}`;
    }

    async transcribeAudio(
        audioInput: Blob | string,
        mimeType?: string,
        legacyAudioBlob?: Blob
    ): Promise<AIResult<string>> {
        let audioBlob: Blob | null = null;

        if (audioInput instanceof Blob) {
            audioBlob = audioInput;
        } else if (legacyAudioBlob) {
            audioBlob = legacyAudioBlob;
        } else {
            if (!mimeType) {
                throw new Error('mimeType is required when transcribing from base64');
            }
            const binaryString = atob(audioInput);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            audioBlob = new Blob([bytes], { type: mimeType });
        }

        const result = await this.groq.transcribeAudio(audioBlob);
        return { data: result.text, model: result.model };
    }

    async extractOnly(transcription: string): Promise<{ data: ExtractionResult; meta: ExtractionMeta[]; classification: ConsultationClassification }> {
        const result = await this.groq.extractMedicalData(transcription);
        return { data: result.data, meta: result.meta, classification: result.classification };
    }

    async generateFromMergedExtractions(
        extractionParts: ExtractionResult[],
        fullTranscription: string,
        patientName: string,
        extractionMetaParts: ExtractionMeta[] = [],
        classification?: ConsultationClassification,
        sessionId?: string
    ): Promise<AIResultWithMetadata> {
        const startTime = Date.now();
        const auditId = this.buildAuditId();

        try {
            const extractStartedAt = Date.now();
            const mergedExtraction = await this.groq.mergeMultipleExtractions(extractionParts, fullTranscription);
            const extractDurationMs = Date.now() - extractStartedAt;

            const transcriptTokens = this.estimateTokens(fullTranscription);
            const hardMaxCorrections = transcriptTokens > 8000 ? 3 : 2;
            let maxCorrections = TWO_CALL_ADAPTIVE_MODE ? 0 : (FAST_PATH_ADAPTIVE_VALIDATION ? 1 : hardMaxCorrections);
            let correctionsApplied = 0;
            const versions: PipelineResult['versions'] = [];
            let generatedHistory = '';
            let generationModel = '';
            let activeMemoryUsed = false;
            let rulePackVersion: number | undefined;
            const ruleIdsUsed = new Set<string>();
            let learningApplied = false;
            let allValidations: ValidationResult[] = [];
            let previousErrors: { type: string; field: string; reason: string; field_value?: string }[] = [];
            let generationDurationMs = 0;
            let validationDurationMs = 0;
            let correctionRoundsExecuted = 0;
            let earlyStopReason: 'clean_consensus' | 'low_risk_remaining' | 'max_rounds_reached' = 'max_rounds_reached';
            let aggregateRiskLevel: 'low' | 'medium' | 'high' = 'low';

            for (let attempt = 0; attempt <= maxCorrections; attempt++) {
                const generationStartedAt = Date.now();
                const genResult = await this.groq.generateFromExtraction(
                    mergedExtraction,
                    patientName,
                    (previousErrors.length > 0 ? previousErrors : undefined) as ValidationError[] | undefined,
                    classification
                );
                generationDurationMs += Date.now() - generationStartedAt;
                correctionRoundsExecuted = attempt + 1;

                generatedHistory = genResult.text;
                generationModel = genResult.model;
                if (genResult.active_memory_used) activeMemoryUsed = true;
                if (typeof genResult.rule_pack_version === 'number') rulePackVersion = genResult.rule_pack_version;
                if (Array.isArray(genResult.rule_ids_used)) {
                    genResult.rule_ids_used.forEach((id) => {
                        if (id) ruleIdsUsed.add(id);
                    });
                }
                if (genResult.learning_applied) learningApplied = true;

                versions.push({
                    phase: attempt === 0 ? 'generation_merged' : `correction_${attempt}`,
                    content: generatedHistory,
                    model: generationModel,
                    timestamp: Date.now()
                });

                const validationStartedAt = Date.now();
                const { validations, consensus } = TWO_CALL_ADAPTIVE_MODE
                    ? this.runDeterministicClinicalGuard(generatedHistory, mergedExtraction)
                    : await this.groq.validateOutput(
                        generatedHistory,
                        mergedExtraction,
                        fullTranscription,
                        extractionMetaParts
                    );
                validationDurationMs += Date.now() - validationStartedAt;
                allValidations.push(...validations);
                aggregateRiskLevel = this.computeRiskLevel(consensus);

                if (consensus.length === 0) {
                    previousErrors = [];
                    earlyStopReason = 'clean_consensus';
                    break;
                }

                previousErrors = consensus;
                if (TWO_CALL_ADAPTIVE_MODE) {
                    earlyStopReason = 'max_rounds_reached';
                    break;
                }
                maxCorrections = this.shouldEscalateCorrections(attempt, transcriptTokens, consensus);

                const hasHighRiskError = consensus.some((error) =>
                    (error.type === 'hallucination' || error.type === 'inconsistency') &&
                    this.severityWeight(error.severity) >= 2
                );
                if (!hasHighRiskError && FAST_PATH_ADAPTIVE_VALIDATION && attempt >= 1) {
                    earlyStopReason = 'low_risk_remaining';
                    break;
                }

                if (attempt < maxCorrections) {
                    correctionsApplied += 1;
                    continue;
                }
            }

            const durationMs = Date.now() - startTime;
            const correctionDurationMs = Math.max(0, generationDurationMs + validationDurationMs);
            const semanticChecks = this.groq.drainSemanticChecks();
            const modelInvocations = this.groq.drainModelInvocations();
            const invocationSummary = this.summarizeInvocations(modelInvocations);
            const stageSessionId = sessionId || auditId;
            const nowIso = new Date().toISOString();
            void enqueueAuditEvent('pipeline_attempt', {
                session_id: stageSessionId,
                stage: 'extract',
                attempt_index: 0,
                status: 'completed',
                started_at: nowIso,
                finished_at: nowIso,
                duration_ms: extractDurationMs,
                metadata: { source: 'ai_service' }
            });
            void enqueueAuditEvent('pipeline_attempt', {
                session_id: stageSessionId,
                stage: 'generation',
                attempt_index: Math.max(0, correctionRoundsExecuted - 1),
                status: 'completed',
                started_at: nowIso,
                finished_at: nowIso,
                duration_ms: generationDurationMs,
                metadata: { source: 'ai_service', rounds_executed: correctionRoundsExecuted }
            });
            void enqueueAuditEvent('pipeline_attempt', {
                session_id: stageSessionId,
                stage: 'validation',
                attempt_index: Math.max(0, correctionRoundsExecuted - 1),
                status: 'completed',
                started_at: nowIso,
                finished_at: nowIso,
                duration_ms: validationDurationMs,
                metadata: { source: 'ai_service', risk_level: aggregateRiskLevel }
            });
            const errorCounts = (previousErrors || []).reduce(
                (acc, err) => {
                    acc[err.type] = (acc[err.type] || 0) + 1;
                    return acc;
                },
                {} as Record<string, number>
            );
            const qualityPayload: {
                corrections_applied: number;
                error_counts: Record<string, number>;
                uncertainty_flags: number;
                duration_ms: number;
                transcript_tokens: number;
                quality_score?: number;
                critical_gaps?: number;
                t_extract_ms?: number;
                t_generate_ms?: number;
                t_validate_ms?: number;
                t_corrections_ms?: number;
                t_total_ms?: number;
                rounds_executed?: number;
                early_stop_reason?: string;
                risk_level?: 'low' | 'medium' | 'high';
                fallback_hops?: number;
                logical_calls_used?: number;
                physical_calls_used?: number;
                provisional_reason?: string;
            } = {
                corrections_applied: correctionsApplied,
                error_counts: errorCounts,
                uncertainty_flags: (previousErrors || []).length,
                duration_ms: durationMs,
                transcript_tokens: this.estimateTokens(fullTranscription),
                t_extract_ms: extractDurationMs,
                t_generate_ms: generationDurationMs,
                t_validate_ms: validationDurationMs,
                t_corrections_ms: correctionDurationMs,
                t_total_ms: durationMs,
                rounds_executed: correctionRoundsExecuted,
                early_stop_reason: earlyStopReason,
                risk_level: aggregateRiskLevel,
                fallback_hops: modelInvocations.filter((item) => item.is_fallback).length,
                logical_calls_used: 2,
                physical_calls_used: modelInvocations.length
            };

            const qualityErrors = (mergedExtraction.notas_calidad || [])
                .filter((note) => note.tipo === 'INAUDIBLE')
                .map(note => ({
                    type: 'warning',
                    field: note.seccion,
                    reason: `[${note.tipo}] ${note.descripcion}`
                })) || [];

            const finalErrors = [...(previousErrors || []), ...qualityErrors];
            const uncertaintyFlags: UncertaintyFlag[] = [
                ...(previousErrors || []).map(err => ({
                    field_path: err.field,
                    reason: err.reason,
                    severity: (err.type === 'hallucination' ? 'high' : err.type === 'missing' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
                    value: err.field_value
                })),
                ...qualityErrors.map(note => ({
                    field_path: note.field,
                    reason: note.reason,
                    severity: 'low' as 'high' | 'medium' | 'low',
                    value: undefined
                }))
            ];

            const hasHighRiskError = finalErrors.some((error) =>
                (error.type === 'hallucination' || error.type === 'inconsistency') &&
                this.severityWeight((error as ValidationError).severity) >= 2
            );
            // Only mark provisional for genuine high-risk issues (hallucination/inconsistency with severity major+)
            // Minor quality notes and missing-data flags should NOT block finalization to avoid alert fatigue
            const provisionalReason = hasHighRiskError
                ? 'high_risk_detected_requires_manual_review'
                : undefined;
            const pipelineStatus: 'completed' | 'degraded' = finalErrors.length > 0 ? 'degraded' : 'completed';
            const resultStatus: 'completed' | 'provisional' = provisionalReason ? 'provisional' : 'completed';
            const historyOutput = this.sanitizeClinicalHistory(generatedHistory);
            const deterministicTriage: QualityTriageResult = {
                quality_score: Math.max(25, 100 - (finalErrors.length * 10)),
                critical_gaps: finalErrors
                    .filter((error) => this.severityWeight((error as ValidationError).severity) >= 2)
                    .slice(0, 5)
                    .map((error) => ({
                        field: error.field || 'unknown',
                        reason: error.reason || 'Sin detalle',
                        severity: (((error as ValidationError).severity || ((error.type === 'hallucination' || error.type === 'inconsistency') ? 'critical' : 'major')) as 'critical' | 'major' | 'minor')
                    })),
                doctor_next_actions: [
                    'Revisar primero los gaps criticos detectados',
                    'Confirmar campos con incertidumbre antes de finalizar',
                    'Finalizar solo cuando no queden dudas clinicas'
                ],
                model: 'quality_triage_deterministic'
            };

            const triagePromise = FAST_PATH_ASYNC_TRIAGE
                ? Promise.resolve(deterministicTriage)
                : this.groq.generateQualityTriage({
                    generatedHistory: historyOutput,
                    remainingErrors: finalErrors as ValidationError[],
                    classification
                }).catch(() => deterministicTriage);

            let triageResult = deterministicTriage;
            if (!FAST_PATH_ASYNC_TRIAGE) {
                triageResult = await triagePromise;
            } else {
                void triagePromise.then((resolved) => {
                    void enqueueAuditEvent('pipeline_run_update', {
                        session_id: sessionId || auditId,
                        patient_name: patientName,
                        status: pipelineStatus,
                        metadata: {
                            quality_score: resolved.quality_score,
                            critical_gaps: resolved.critical_gaps.length,
                            quality_triage_model: resolved.model
                        }
                    });
                }).catch(() => {
                    // Best effort async triage update.
                });
            }

            qualityPayload.quality_score = triageResult.quality_score;
            qualityPayload.critical_gaps = triageResult.critical_gaps.length;
            qualityPayload.provisional_reason = provisionalReason;

            void enqueueAuditEvent('pipeline_audit_bundle', {
                audit_id: auditId,
                audit_data: {
                    patient_name: patientName,
                    pipeline_version: 'merged-4-phase-v3-strict',
                    models_used: {
                        extraction: 'merged-multi-part',
                        generation: generationModel,
                        validation_a: allValidations[0]?.validator || 'unknown',
                        validation_b: allValidations[1]?.validator || 'unknown',
                        invocation_summary: invocationSummary,
                        rule_pack_version: rulePackVersion || null,
                        rule_count: ruleIdsUsed.size
                    },
                    extraction_data: {
                        extraction: mergedExtraction,
                        extraction_meta: extractionMetaParts,
                        classification: classification || null
                    },
                    metadata: {
                        learning_applied: learningApplied,
                        rule_ids_used: Array.from(ruleIdsUsed),
                        call_budget_mode: TWO_CALL_ADAPTIVE_MODE ? 'two_call_adaptive' : 'standard',
                        logical_calls_used: 1 + (generatedHistory ? 1 : 0),
                        physical_calls_used: modelInvocations.length,
                        provisional_reason: provisionalReason || null,
                        phase_timings_ms: {
                            extract: extractDurationMs,
                            generate: generationDurationMs,
                            validate: validationDurationMs,
                            corrections: correctionDurationMs,
                            total: durationMs
                        },
                        rounds_executed: correctionRoundsExecuted,
                        early_stop_reason: earlyStopReason,
                        risk_level: aggregateRiskLevel
                    },
                    generation_versions: versions,
                    validation_logs: allValidations,
                    corrections_applied: correctionsApplied,
                    successful: true,
                    duration_ms: durationMs,
                    created_at: new Date().toISOString()
                },
                extraction_meta: extractionMetaParts,
                semantic_checks: semanticChecks,
                model_invocations: modelInvocations,
                quality_event: {
                    record_id: auditId,
                    event_type: 'pipeline_completed',
                    payload: qualityPayload
                }
            }).catch((error) => {
                console.error('[AIService] Failed to enqueue async audit event:', error);
            });

            return {
                data: historyOutput,
                model: generationModel,
                extraction: mergedExtraction,
                extraction_meta: extractionMetaParts,
                classification,
                validations: allValidations,
                corrections_applied: correctionsApplied,
                remaining_errors: finalErrors.length > 0 ? finalErrors : undefined,
                active_memory_used: activeMemoryUsed,
                uncertainty_flags: uncertaintyFlags.length > 0 ? uncertaintyFlags : undefined,
                audit_id: auditId,
                pipeline_status: pipelineStatus,
                result_status: resultStatus,
                session_id: sessionId,
                rule_pack_version: rulePackVersion,
                rule_ids_used: Array.from(ruleIdsUsed),
                learning_applied: learningApplied,
                quality_score: triageResult.quality_score,
                critical_gaps: triageResult.critical_gaps,
                doctor_next_actions: triageResult.doctor_next_actions,
                quality_triage_model: triageResult.model,
                correction_rounds_executed: correctionRoundsExecuted,
                early_stop_reason: earlyStopReason,
                risk_level: aggregateRiskLevel,
                call_budget_mode: TWO_CALL_ADAPTIVE_MODE ? 'two_call_adaptive' : 'standard',
                logical_calls_used: 1 + (generatedHistory ? 1 : 0),
                physical_calls_used: modelInvocations.length,
                provisional_reason: provisionalReason,
                fallback_hops: modelInvocations.filter((item) => item.is_fallback).length,
                phase_timings_ms: {
                    extract: extractDurationMs,
                    generate: generationDurationMs,
                    validate: validationDurationMs,
                    corrections: correctionDurationMs,
                    total: durationMs
                }
            };
        } catch (error) {
            this.groq.drainModelInvocations();
            if (!this.isBudgetError(error)) throw error;
            const retryAfterMs = Math.max(1_000, Number((error as BudgetExceededError).retryAfterMs || 60_000));
            const reason = (error as Error)?.message || 'awaiting_budget';
            return {
                data: this.buildProvisionalHistory(reason),
                model: 'pipeline_provisional',
                remaining_errors: [{ type: 'budget', field: 'pipeline', reason }],
                pipeline_status: 'degraded',
                result_status: 'provisional',
                retry_after_ms: retryAfterMs,
                session_id: sessionId,
                quality_score: 25,
                critical_gaps: [{ field: 'pipeline', reason, severity: 'critical' }],
                doctor_next_actions: [
                    'Reintentar cuando haya cuota disponible',
                    'Revisar los datos criticos manualmente',
                    'No finalizar sin validar el contenido'
                ],
                quality_triage_model: 'quality_triage_fallback',
                correction_rounds_executed: 0,
                early_stop_reason: 'max_rounds_reached',
                risk_level: 'high',
                call_budget_mode: 'two_call_adaptive',
                logical_calls_used: 2,
                physical_calls_used: 0,
                provisional_reason: reason,
                fallback_hops: 0,
                phase_timings_ms: {
                    extract: 0,
                    generate: 0,
                    validate: 0,
                    corrections: 0,
                    total: 0
                }
            };
        }
    }

    async generateMedicalHistory(transcription: string, patientName: string = ""): Promise<AIResultWithMetadata> {
        try {
            this.groq.resetInvocationCounters();
            const extractionResult = await this.extractOnly(transcription);
            const pipelineResult = await this.generateFromMergedExtractions(
                [extractionResult.data],
                transcription,
                patientName,
                extractionResult.meta,
                extractionResult.classification
            );
            return pipelineResult;
        } catch (error) {
            this.groq.drainModelInvocations();
            const failureAuditId = this.buildAuditId();
            const reason = (error as Error)?.message || 'pipeline_error';
            console.error('[AIService] Pipeline failed:', reason);
            void enqueueAuditEvent('pipeline_audit_bundle', {
                audit_id: failureAuditId,
                audit_data: {
                    patient_name: patientName,
                    pipeline_version: 'merged-4-phase-v3-strict',
                    models_used: {},
                    extraction_data: null,
                    generation_versions: [],
                    validation_logs: [],
                    corrections_applied: 0,
                    successful: false,
                    duration_ms: 0,
                    created_at: new Date().toISOString()
                },
                extraction_meta: [],
                semantic_checks: [],
                quality_event: {
                    record_id: failureAuditId,
                    event_type: 'pipeline_completed',
                    payload: {
                        corrections_applied: 0,
                        error_counts: { pipeline_error: 1 },
                        uncertainty_flags: 1,
                        duration_ms: 0,
                        transcript_tokens: this.estimateTokens(transcription)
                    }
                }
            }).catch((enqueueError) => {
                console.error('[AIService] Failed to enqueue failure audit:', enqueueError);
            });
            // Return provisional history instead of crashing — the doctor
            // always sees a structured template they can fill in manually.
            return {
                data: this.buildProvisionalHistory(reason),
                model: 'pipeline_failed',
                remaining_errors: [{ type: 'error', field: 'pipeline', reason }],
                pipeline_status: 'degraded',
                result_status: 'failed_recoverable',
                quality_score: 0,
                critical_gaps: [{ field: 'pipeline', reason, severity: 'critical' as const }],
                doctor_next_actions: [
                    'Reintentar el procesamiento',
                    'Verificar conexion a internet',
                    'Revisar la transcripcion manualmente'
                ],
                quality_triage_model: 'quality_triage_fallback',
                correction_rounds_executed: 0,
                early_stop_reason: 'max_rounds_reached',
                risk_level: 'high',
                call_budget_mode: 'two_call_adaptive',
                logical_calls_used: 2,
                physical_calls_used: 0,
                provisional_reason: reason,
                fallback_hops: 0,
                phase_timings_ms: { extract: 0, generate: 0, validate: 0, corrections: 0, total: 0 }
            };
        }
    }

    async generateMedicalReport(transcription: string, patientName: string = ""): Promise<AIResult<string>> {
        const result = await this.groq.generateMedicalReport(transcription, patientName);
        return { data: result.text, model: result.model };
    }

    async regenerateHistorySection(
        transcription: string,
        currentHistory: string,
        sectionTitle: string,
        patientName: string = ""
    ): Promise<AIResult<string>> {
        const prompt = `Eres un asistente medico ENT. Reescribe SOLO la seccion solicitada de una historia clinica.
Paciente: ${patientName || 'Paciente'}
Seccion objetivo: ${sectionTitle}
Reglas:
- Devuelve solo el contenido de la seccion objetivo (sin encabezado).
- Mantener estilo medico claro y conciso.
- Usar SOLO informacion de la transcripcion.
- Si falta dato, indicar "No consta".

TRANSCRIPCION:
${transcription}

HISTORIA ACTUAL:
${currentHistory}`;

        const text = await this.groq.chat(prompt, '', {
            task: 'generation',
            temperature: 0.1,
            maxTokens: 900
        });
        return { data: text.trim(), model: 'task:generation' };
    }
}
