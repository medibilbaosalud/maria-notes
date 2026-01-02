// AI Service - Multi-Phase Validation Pipeline with Batching Support
// All AI operations use Groq with optimal model selection

import { GroqService, PipelineResult, ExtractionResult, ValidationResult, ValidationError, ExtractionMeta, ConsultationClassification, UncertaintyFlag } from './groq';
import { logAIAudit, logFieldLineage, logSemanticChecks, logQualityEvent } from './supabase';

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
    remaining_errors?: { type: string; field: string; reason: string }[]; // Unresolved errors for UI warning
    active_memory_used?: boolean;
    uncertainty_flags?: UncertaintyFlag[];
    audit_id?: string;
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

    async transcribeAudio(audioBase64: string, mimeType: string, audioBlob?: Blob): Promise<AIResult<string>> {
        // Convert base64 to blob if not provided
        if (!audioBlob) {
            const binaryString = atob(audioBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            audioBlob = new Blob([bytes], { type: mimeType });
        }

        console.log('[AIService] Transcribing with Groq (whisper-large-v3)...');
        const result = await this.groq.transcribeAudio(audioBlob);
        return { data: result.text, model: result.model };
    }

    // ════════════════════════════════════════════════════════════════
    // NEW: Extraction-only method for batch processing
    // ════════════════════════════════════════════════════════════════
    async extractOnly(transcription: string): Promise<{ data: ExtractionResult; meta: ExtractionMeta[]; classification: ConsultationClassification }> {
        console.log('[AIService] Running extraction-only (Phase 1)...');
        const result = await this.groq.extractMedicalData(transcription);
        console.log('[AIService] Extraction complete.');
        return { data: result.data, meta: result.meta, classification: result.classification };
    }

    // ════════════════════════════════════════════════════════════════
    // NEW: Generate from pre-merged extractions
    // ════════════════════════════════════════════════════════════════
    async generateFromMergedExtractions(
        extractionParts: ExtractionResult[],
        fullTranscription: string,
        patientName: string,
        extractionMetaParts: ExtractionMeta[] = [],
        classification?: ConsultationClassification
    ): Promise<AIResultWithMetadata> {
        const startTime = Date.now();
        console.log(`[AIService] Merging ${extractionParts.length} extraction parts...`);

        // Phase 4: Merge all extractions into one
        const mergedExtraction = await this.groq.mergeMultipleExtractions(extractionParts, fullTranscription);
        console.log('[AIService] Merge complete. Starting generation...');

        // Phase 2 & 3: Generate and validate (with correction loop)
        // Adaptive corrections based on transcript length for quality
        const transcriptTokens = this.estimateTokens(fullTranscription);
        const MAX_CORRECTIONS = transcriptTokens > 8000 ? 3 : 2;
        let correctionsApplied = 0;
        const versions: PipelineResult['versions'] = [];
        let generatedHistory = '';
        let generationModel = '';
        let activeMemoryUsed = false;
        let allValidations: ValidationResult[] = [];
        let previousErrors: { type: string; field: string; reason: string; field_value?: string }[] = [];

        for (let attempt = 0; attempt <= MAX_CORRECTIONS; attempt++) {
            console.log(`[AIService] Generation attempt ${attempt + 1}...`);

            const genResult = await this.groq.generateFromExtraction(
                mergedExtraction,
                patientName,
                (previousErrors.length > 0 ? previousErrors : undefined) as ValidationError[] | undefined,
                classification
            );

            generatedHistory = genResult.text;
            generationModel = genResult.model;
            if (genResult.active_memory_used) activeMemoryUsed = true;

            versions.push({
                phase: attempt === 0 ? 'generation_merged' : `correction_${attempt}`,
                content: generatedHistory,
                model: generationModel,
                timestamp: Date.now()
            });

            // Validation
            const { validations, consensus } = await this.groq.validateOutput(
                generatedHistory,
                mergedExtraction,
                fullTranscription,
                extractionMetaParts
            );
            allValidations.push(...validations);

            if (consensus.length === 0) {
                console.log('[AIService] ✓ Validation passed!');
                previousErrors = []; // Clear - no remaining errors
                break;
            }

            if (attempt < MAX_CORRECTIONS) {
                console.log(`[AIService] ✗ Found ${consensus.length} errors, correcting...`);
                previousErrors = consensus;
                correctionsApplied++;
            } else {
                // Max corrections reached, these are remaining errors
                console.log(`[AIService] ⚠ ${consensus.length} errors remain after max corrections`);
                previousErrors = consensus;
            }
        }

        const endTime = Date.now();
        const durationMs = endTime - startTime;

        // Audit logging
        const auditId = await logAIAudit({
            patient_name: patientName,
            pipeline_version: 'merged-4-phase-v3-strict',
            models_used: {
                extraction: 'merged-multi-part',
                generation: generationModel,
                validation_a: allValidations[0]?.validator || 'unknown',
                validation_b: allValidations[1]?.validator || 'unknown'
            },
            extraction_data: {
                extraction: mergedExtraction,
                extraction_meta: extractionMetaParts,
                classification: classification || null
            },
            generation_versions: versions,
            validation_logs: allValidations,
            corrections_applied: correctionsApplied,
            successful: true,
            duration_ms: durationMs
        });

        const semanticChecks = this.groq.drainSemanticChecks();
        if (auditId) {
            await logFieldLineage(auditId, extractionMetaParts);
            await logSemanticChecks(auditId, semanticChecks);
            const errorCounts = (previousErrors || []).reduce(
                (acc, err) => {
                    acc[err.type] = (acc[err.type] || 0) + 1;
                    return acc;
                },
                {} as Record<string, number>
            );
            await logQualityEvent({
                record_id: auditId,
                event_type: 'pipeline_completed',
                payload: {
                    corrections_applied: correctionsApplied,
                    error_counts: errorCounts,
                    uncertainty_flags: (previousErrors || []).length,
                    duration_ms: durationMs,
                    transcript_tokens: this.estimateTokens(fullTranscription)
                }
            });
        }

        console.log(`[AIService] Merged pipeline complete in ${durationMs}ms`);

        // Map quality notes to errors for UI
        const qualityErrors = mergedExtraction.notas_calidad?.map(note => ({
            type: 'warning',
            field: note.seccion,
            reason: `[${note.tipo}] ${note.descripcion}`
        })) || [];

        const finalErrors = [
            ...(previousErrors || []),
            ...qualityErrors
        ];

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

        return {
            data: generatedHistory,
            model: generationModel,
            extraction: mergedExtraction,
            extraction_meta: extractionMetaParts,
            classification,
            validations: allValidations,
            corrections_applied: correctionsApplied,
            remaining_errors: finalErrors.length > 0 ? finalErrors : undefined,
            active_memory_used: activeMemoryUsed,
            uncertainty_flags: uncertaintyFlags.length > 0 ? uncertaintyFlags : undefined,
            audit_id: auditId || undefined
        };
    }

    // ════════════════════════════════════════════════════════════════
    // Original single-pass method (for consultations < 35 min)
    // ════════════════════════════════════════════════════════════════
    async generateMedicalHistory(transcription: string, patientName: string = ""): Promise<AIResultWithMetadata> {
        console.log('[AIService] Starting multi-phase validated pipeline...');

        try {
            const extractionResult = await this.extractOnly(transcription);
            const pipelineResult = await this.generateFromMergedExtractions(
                [extractionResult.data],
                transcription,
                patientName,
                extractionResult.meta,
                extractionResult.classification
            );

            console.log('[AIService] Pipeline complete!');
            console.log(`[AIService] - Corrections applied: ${pipelineResult.corrections_applied || 0}`);

            return pipelineResult;
        } catch (error) {
            console.error('[AIService] Pipeline failed:', error);
            await logAIAudit({
                patient_name: patientName,
                pipeline_version: 'merged-4-phase-v3-strict',
                models_used: {},
                extraction_data: null,
                generation_versions: [],
                validation_logs: [],
                corrections_applied: 0,
                successful: false,
                duration_ms: 0
            });
            throw error;
        }
    }

    async generateMedicalReport(transcription: string, patientName: string = ""): Promise<AIResult<string>> {
        console.log('[AIService] Generating medical report...');
        const result = await this.groq.generateMedicalReport(transcription, patientName);
        return { data: result.text, model: result.model };
    }
}
