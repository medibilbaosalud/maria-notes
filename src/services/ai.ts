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
}

export class AIService {
    private groq: GroqService;

    constructor(groqApiKey: string | string[]) {
        this.groq = new GroqService(groqApiKey);
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

    private appendUncertaintySection(generatedHistory: string, issues: { field: string; reason: string }[]): string {
        if (!issues || issues.length === 0) return generatedHistory;
        const hasSection = /##\s+INCERTIDUMBRES\s*\/\s*REVISAR/i.test(generatedHistory);
        const lines = issues.slice(0, 12).map((issue) => `- ${issue.field}: ${issue.reason}`);
        if (hasSection) {
            return `${generatedHistory}\n${lines.join('\n')}`;
        }
        return `${generatedHistory}\n\n## INCERTIDUMBRES / REVISAR (si aplica)\n${lines.join('\n')}`;
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
Reintentar procesamiento automático.

## INCERTIDUMBRES / REVISAR (si aplica)
- pipeline: ${reason}`;
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
            const mergedExtraction = await this.groq.mergeMultipleExtractions(extractionParts, fullTranscription);

            const transcriptTokens = this.estimateTokens(fullTranscription);
            const maxCorrections = transcriptTokens > 8000 ? 3 : 2;
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

            for (let attempt = 0; attempt <= maxCorrections; attempt++) {
                const genResult = await this.groq.generateFromExtraction(
                    mergedExtraction,
                    patientName,
                    (previousErrors.length > 0 ? previousErrors : undefined) as ValidationError[] | undefined,
                    classification
                );

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

                const { validations, consensus } = await this.groq.validateOutput(
                    generatedHistory,
                    mergedExtraction,
                    fullTranscription,
                    extractionMetaParts
                );
                allValidations.push(...validations);

                if (consensus.length === 0) {
                    previousErrors = [];
                    break;
                }

                if (attempt < maxCorrections) {
                    previousErrors = consensus;
                    correctionsApplied++;
                } else {
                    previousErrors = consensus;
                }
            }

            const durationMs = Date.now() - startTime;
            const semanticChecks = this.groq.drainSemanticChecks();
            const modelInvocations = this.groq.drainModelInvocations();
            const invocationSummary = this.summarizeInvocations(modelInvocations);
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
            } = {
                corrections_applied: correctionsApplied,
                error_counts: errorCounts,
                uncertainty_flags: (previousErrors || []).length,
                duration_ms: durationMs,
                transcript_tokens: this.estimateTokens(fullTranscription)
            };

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
                        rule_ids_used: Array.from(ruleIdsUsed)
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

            const qualityErrors = mergedExtraction.notas_calidad?.map(note => ({
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

            const pipelineStatus: 'completed' | 'degraded' = finalErrors.length > 0 ? 'degraded' : 'completed';
            const historyOutput = pipelineStatus === 'degraded'
                ? this.appendUncertaintySection(generatedHistory, finalErrors.map((err) => ({ field: err.field, reason: err.reason })))
                : generatedHistory;
            const qualityTriage = await this.groq.generateQualityTriage({
                generatedHistory: historyOutput,
                remainingErrors: finalErrors as ValidationError[],
                classification
            });

            qualityPayload.quality_score = qualityTriage.quality_score;
            qualityPayload.critical_gaps = qualityTriage.critical_gaps.length;

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
                result_status: pipelineStatus === 'completed' ? 'completed' : 'provisional',
                session_id: sessionId,
                rule_pack_version: rulePackVersion,
                rule_ids_used: Array.from(ruleIdsUsed),
                learning_applied: learningApplied,
                quality_score: qualityTriage.quality_score,
                critical_gaps: qualityTriage.critical_gaps,
                doctor_next_actions: qualityTriage.doctor_next_actions,
                quality_triage_model: qualityTriage.model
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
                quality_triage_model: 'quality_triage_fallback'
            };
        }
    }

    async generateMedicalHistory(transcription: string, patientName: string = ""): Promise<AIResultWithMetadata> {
        try {
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
                        error_counts: { inconsistency: 1 },
                        uncertainty_flags: 1,
                        duration_ms: 0,
                        transcript_tokens: this.estimateTokens(transcription)
                    }
                }
            }).catch((enqueueError) => {
                console.error('[AIService] Failed to enqueue failure audit:', enqueueError);
            });
            throw error;
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
