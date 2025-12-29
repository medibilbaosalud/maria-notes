// AI Service - Multi-Phase Validation Pipeline
// All AI operations use Groq with optimal model selection

import { GroqService, PipelineResult, ExtractionResult, ValidationResult } from './groq';

export interface AIResult<T> {
    data: T;
    model: string;
}

import { logAIAudit } from './supabase';

export interface AIResultWithMetadata extends AIResult<string> {
    extraction?: ExtractionResult;
    validations?: ValidationResult[];
    corrections_applied?: number;
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
                    extraction: pipelineResult.model, // Primary generation model
                    // Note: Detailed per-phase models are inside 'versions' and 'validations' arrays
                    // We map the primary ones here for queryability
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
            };
        } catch (error) {
            console.error('[AIService] Pipeline failed:', error);
            // Log failure
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
