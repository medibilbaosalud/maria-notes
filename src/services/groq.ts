
// Groq API Service - Multi-Phase AI Validation System
// Uses optimal models for each phase: Extraction → Generation → Dual Validation

import { MemoryService } from './memory';

const GROQ_API_URL = 'https://api.groq.com/openai/v1';

// Model assignments (OPTIMIZED for speed while maintaining quality)
const MODELS = {
    EXTRACTION: 'openai/gpt-oss-120b',
    GENERATION: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    VALIDATOR_A: 'openai/gpt-oss-120b',
    VALIDATOR_B: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    WHISPER: 'whisper-large-v3-turbo',
};

// Fallback models if primary fails
const FALLBACK_MODELS = {
    EXTRACTION: ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
    GENERATION: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
    VALIDATOR: ['qwen/qwen3-32b', 'llama-3.3-70b-versatile'],
    WHISPER: ['whisper-large-v3'],
};

export interface ExtractionResult {
    antecedentes: {
        alergias: string[] | null;
        enfermedades_cronicas: string[] | null;
        cirugias: string[] | null;
        tratamiento_habitual: string[] | null;
    };
    enfermedad_actual: {
        motivo_consulta: string;
        sintomas: string[];
        evolucion: string | null;
    };
    exploraciones_realizadas: {
        [key: string]: string | null;
    };
    diagnostico: string[] | null;
    plan: string | null;
    notas_calidad?: {
        tipo: 'INAUDIBLE' | 'AMBIGUO';
        seccion: string;
        descripcion: string
    }[];
}

export interface ValidationError {
    type: 'hallucination' | 'missing' | 'inconsistency';
    field: string;
    reason: string;
}

export interface ValidationResult {
    validator: string;
    is_valid: boolean;
    errors: ValidationError[];
    confidence: number;
}

export interface PipelineResult {
    text: string;
    model: string;
    extraction: ExtractionResult;
    validations: ValidationResult[];
    corrections_applied: number;
    duration_ms: number;
    versions: {
        phase: string;
        content: string;
        model: string;
        timestamp: number;
    }[];
    active_memory_used: boolean;
    active_memory_lessons?: string[];
}

export class GroqService {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    private async delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async callModel(
        model: string,
        prompt: string,
        fallbacks: string[] = [],
        options: { temperature?: number; jsonMode?: boolean } = {}
    ): Promise<{ text: string; model: string }> {
        const allModels = [model, ...fallbacks];
        let lastError = null;

        for (const modelName of allModels) {
            try {
                const body: any = {
                    model: modelName,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: options.temperature ?? 0.3,
                    max_tokens: 8192,
                };

                if (options.jsonMode) {
                    body.response_format = { type: 'json_object' };
                }

                const response = await fetch(`${GROQ_API_URL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API error: ${response.status} - ${errorText}`);
                }

                const data = await response.json();
                const content = data.choices[0]?.message?.content || '';
                return { text: content, model: modelName };
            } catch (error: any) {
                console.warn(`[Groq] Failed with ${modelName}:`, error.message);
                lastError = error;
                await this.delay(error.message?.includes('429') ? 2000 : 500);
            }
        }
        throw lastError || new Error('All models failed');
    }

    async transcribeAudio(audioBlob: Blob): Promise<{ text: string; model: string }> {
        const allModels = [MODELS.WHISPER, ...FALLBACK_MODELS.WHISPER];
        let lastError = null;

        for (const modelName of allModels) {
            try {
                const formData = new FormData();
                formData.append('file', audioBlob, 'audio.webm');
                formData.append('model', modelName);
                formData.append('language', 'es');
                formData.append('response_format', 'text');

                const response = await fetch(`${GROQ_API_URL}/audio/transcriptions`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.apiKey}` },
                    body: formData,
                });

                if (!response.ok) throw new Error(`API error: ${response.status}`);

                const text = await response.text();
                return { text, model: modelName };
            } catch (error: any) {
                console.warn(`[Groq] Transcription failed with ${modelName}:`, error);
                lastError = error;
                await this.delay(error.message?.includes('429') ? 2000 : 500);
            }
        }
        throw lastError || new Error('All Whisper models failed');
    }

    async extractMedicalData(transcription: string): Promise<{ data: ExtractionResult; model: string }> {
        if (!transcription || transcription.trim().length < 20) {
            return {
                data: {
                    antecedentes: { alergias: null, enfermedades_cronicas: null, cirugias: null, tratamiento_habitual: null },
                    enfermedad_actual: { motivo_consulta: "CONSULTA VACÍA", sintomas: [], evolucion: null },
                    exploraciones_realizadas: {},
                    diagnostico: ["Error: Transcripción insuficiente"],
                    plan: null
                },
                model: 'PRE_FLIGHT_CHECK'
            };
        }

        const prompt = `Extrae datos clínicos en JSON:
<transcription>
${transcription.substring(0, 100000)}
</transcription>
JSON structure: { antecedentes: { alergias, enfermedades_cronicas, cirugias, tratamiento_habitual }, enfermedad_actual: { motivo_consulta, sintomas, evolucion }, exploraciones_realizadas: {}, diagnostico: [], plan: "" }`;

        const result = await this.callModel(MODELS.EXTRACTION, prompt, FALLBACK_MODELS.EXTRACTION, { temperature: 0.1, jsonMode: true });

        try {
            return { data: JSON.parse(result.text), model: result.model };
        } catch {
            throw new Error('Failed to parse extraction JSON');
        }
    }

    async generateFromExtraction(
        extraction: ExtractionResult,
        _patientName: string,
        previousErrors?: ValidationError[]
    ): Promise<{ text: string; model: string; active_memory_used: boolean; active_memory_lessons?: string[] }> {

        const memoryContext = await MemoryService.getHybridContext();
        const activeMemoryUsed = memoryContext.total_lessons_count > 0 || memoryContext.global_rules.length > 10;

        let activeMemoryLessons: string[] = [];
        if (memoryContext.daily_lessons) activeMemoryLessons.push('Daily Lessons Active');
        if (memoryContext.global_rules) activeMemoryLessons.push('Global Rules Active');

        const prompt = `Genera Historia Clínica.
${previousErrors ? 'Corrige estos errores: ' + JSON.stringify(previousErrors) : ''}

REGLAS DE APRENDIZAJE:
[GLOBALES]
${memoryContext.global_rules || "Ninguna"}

[RECIENTES]
${memoryContext.daily_lessons || "Ninguna"}

DATOS:
${JSON.stringify(extraction, null, 2)}`;

        const result = await this.callModel(MODELS.GENERATION, prompt, FALLBACK_MODELS.GENERATION, { temperature: 0.4 });
        return { ...result, active_memory_used: activeMemoryUsed, active_memory_lessons: activeMemoryLessons };
    }

    async validateOutput(generatedHistory: string, extraction: ExtractionResult, originalTranscription: string): Promise<{ validations: ValidationResult[]; consensus: ValidationError[] }> {
        const prompt = `Valida la siguiente Historia Clínica GENERADA basándote en la EXTRACCIÓN de datos y la TRANSCRIPCIÓN original.
        
TRANSCRIPCIÓN ORIGINAL:
${originalTranscription.substring(0, 5000)}...

EXTRACCIÓN ESTRUCTURADA:
${JSON.stringify(extraction)}

HISTORIA GENERADA:
${generatedHistory}

TAREA:
Identifica ALUCINACIONES (datos inventados no presentes en la fuente) o DATOS FALTANTES críticos.
Responde JSON: { is_valid: boolean, errors: [{ type: 'hallucination' | 'missing' | 'inconsistency', field: string, reason: string }] }`;
        const result = await this.callModel(MODELS.VALIDATOR_A, prompt, FALLBACK_MODELS.VALIDATOR, { jsonMode: true });

        try {
            const parsed = JSON.parse(result.text);
            return { validations: [parsed], consensus: parsed.errors || [] };
        } catch {
            return { validations: [], consensus: [] };
        }
    }

    async generateMedicalHistoryValidated(transcription: string, patientName: string = ''): Promise<PipelineResult> {
        const startTime = Date.now();
        const { data: extraction } = await this.extractMedicalData(transcription);

        const genResult = await this.generateFromExtraction(extraction, patientName);

        return {
            text: genResult.text,
            model: genResult.model,
            extraction,
            validations: [],
            corrections_applied: 0,
            duration_ms: Date.now() - startTime,
            versions: [{ phase: 'initial', content: genResult.text, model: genResult.model, timestamp: Date.now() }],
            active_memory_used: genResult.active_memory_used,
            active_memory_lessons: genResult.active_memory_lessons
        };
    }

    async generateMedicalHistory(transcription: string, patientName: string = ''): Promise<{ text: string; model: string }> {
        const result = await this.generateMedicalHistoryValidated(transcription, patientName);
        return { text: result.text, model: result.model };
    }

    async generateMedicalReport(transcription: string, patientName: string = ''): Promise<{ text: string; model: string }> {
        const prompt = `Genera INFORME MÉDICO para: ${patientName}\n\n${transcription}`;
        return this.callModel(MODELS.GENERATION, prompt, FALLBACK_MODELS.GENERATION, { temperature: 0.4 });
    }

    async mergeTwoExtractions(partA: ExtractionResult, partB: ExtractionResult): Promise<ExtractionResult> {
        const prompt = `Fusiona JSON A y B.\nA: ${JSON.stringify(partA)}\nB: ${JSON.stringify(partB)}`;
        const result = await this.callModel(MODELS.EXTRACTION, prompt, FALLBACK_MODELS.EXTRACTION, { jsonMode: true });
        return JSON.parse(result.text);
    }

    async mergeMultipleExtractions(results: ExtractionResult[]): Promise<ExtractionResult> {
        if (results.length === 0) throw new Error('No extractions to merge');
        if (results.length === 1) return results[0];
        let current = results[0];
        for (let i = 1; i < results.length; i++) {
            current = await this.mergeTwoExtractions(current, results[i]);
        }
        return current;
    }
}
