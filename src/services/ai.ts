// AI Service - Multi-Phase Validation Pipeline with Batching Support
// All AI operations use Groq with optimal model selection

import { GroqService, PipelineResult, ExtractionResult, ValidationResult } from './groq';
import { logAIAudit } from './supabase';

export interface AIResult<T> {
    data: T;
    model: string;
}

export interface AIResultWithMetadata extends AIResult<string> {
    extraction?: ExtractionResult;
    validations?: ValidationResult[];
    corrections_applied?: number;
    remaining_errors?: { type: string; field: string; reason: string }[]; // Unresolved errors for UI warning
    active_memory_used?: boolean;
}

export class AIService {
    private groq: GroqService;

    constructor(groqApiKey: string) {
        this.groq = new GroqService(groqApiKey);
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
    async extractOnly(transcription: string): Promise<ExtractionResult> {
        console.log('[AIService] Running extraction-only (Phase 1)...');
        const result = await this.groq.extractMedicalData(transcription);
        console.log('[AIService] Extraction complete.');
        return result.data;
    }

    // ════════════════════════════════════════════════════════════════
    // NEW: Generate from pre-merged extractions
    // ════════════════════════════════════════════════════════════════
    async generateFromMergedExtractions(
        extractionParts: ExtractionResult[],
        fullTranscription: string,
        patientName: string
    ): Promise<AIResultWithMetadata> {
        const startTime = Date.now();
        console.log(`[AIService] Merging ${extractionParts.length} extraction parts...`);

        // Phase 4: Merge all extractions into one
        const mergedExtraction = await this.groq.mergeMultipleExtractions(extractionParts);
        console.log('[AIService] Merge complete. Starting generation...');

        // Phase 2 & 3: Generate and validate (with correction loop)
        // OPTIMIZED: Reduced to 1 correction for speed; remaining errors shown in UI
        const MAX_CORRECTIONS = 1;
        let correctionsApplied = 0;
        const versions: PipelineResult['versions'] = [];
        let generatedHistory = '';
        let generationModel = '';
        let activeMemoryUsed = false;
        let allValidations: ValidationResult[] = [];
        let previousErrors: any[] = [];

        for (let attempt = 0; attempt <= MAX_CORRECTIONS; attempt++) {
            console.log(`[AIService] Generation attempt ${attempt + 1}...`);

            const genResult = await this.groq.generateFromExtraction(
                mergedExtraction,
                patientName,
                previousErrors.length > 0 ? previousErrors : undefined
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
                fullTranscription
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
        logAIAudit({
            patient_name: patientName,
            pipeline_version: 'merged-4-phase-v2-optimized',
            models_used: {
                extraction: 'merged-multi-part',
                generation: generationModel,
                validation_a: allValidations[0]?.validator || 'unknown',
                validation_b: allValidations[1]?.validator || 'unknown'
            },
            extraction_data: mergedExtraction,
            generation_versions: versions,
            validation_logs: allValidations,
            corrections_applied: correctionsApplied,
            successful: true,
            duration_ms: durationMs
        });

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

        return {
            data: generatedHistory,
            model: generationModel,
            extraction: mergedExtraction,
            validations: allValidations,
            corrections_applied: correctionsApplied,
            remaining_errors: finalErrors.length > 0 ? finalErrors : undefined,
            active_memory_used: activeMemoryUsed
        };
    }

    // ════════════════════════════════════════════════════════════════
    // Original single-pass method (for consultations < 35 min)
    // ════════════════════════════════════════════════════════════════
    async generateMedicalHistory(transcription: string, patientName: string = ""): Promise<AIResultWithMetadata> {
        console.log('[AIService] Starting multi-phase validated pipeline...');

        try {
            const pipelineResult: PipelineResult = await this.groq.generateMedicalHistoryValidated(transcription, patientName);

            console.log('[AIService] Pipeline complete!');
            console.log(`[AIService] - Corrections applied: ${pipelineResult.corrections_applied}`);
            console.log(`[AIService] - Duration: ${pipelineResult.duration_ms}ms`);

            // Async Audit Logging
            logAIAudit({
                patient_name: patientName,
                pipeline_version: '4-phase-v2-gpt120b',
                models_used: {
                    extraction: pipelineResult.model,
                    generation: pipelineResult.model,
                    validation_a: pipelineResult.validations[0]?.validator || 'unknown',
                    validation_b: pipelineResult.validations[1]?.validator || 'unknown'
                },
                extraction_data: pipelineResult.extraction,
                generation_versions: pipelineResult.versions,
                validation_logs: pipelineResult.validations,
                corrections_applied: pipelineResult.corrections_applied,
                successful: true,
                duration_ms: pipelineResult.duration_ms
            });

            return {
                data: pipelineResult.text,
                model: pipelineResult.model,
                extraction: pipelineResult.extraction,
                validations: pipelineResult.validations,
                corrections_applied: pipelineResult.corrections_applied,
                active_memory_used: pipelineResult.active_memory_used
            };
        } catch (error) {
            console.error('[AIService] Pipeline failed:', error);
            logAIAudit({
                patient_name: patientName,
                pipeline_version: '4-phase-v2-gpt120b',
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
