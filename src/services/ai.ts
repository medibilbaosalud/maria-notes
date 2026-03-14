import type {
    ConsultationClassification,
    ExtractionMeta,
    ExtractionResult,
    ModelInvocationEvent,
    UncertaintyFlag,
    ValidationResult
} from './groq';
import type { ClinicalSpecialtyId } from '../clinical/specialties';

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
    critical_gaps?: Array<{ field: string; reason: string; severity: 'critical' | 'major' | 'minor' }>;
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
    call_budget_mode?: 'two_call_adaptive' | 'standard' | 'single_shot';
    provisional_reason?: string;
    fallback_hops?: number;
    sanitization_applied?: boolean;
    errors_raw_count?: number;
    errors_final_count?: number;
    resolved_by_sanitization?: string[];
    still_blocking_after_sanitization?: string[];
    reconciliation?: {
        pre_sanitize_issues: Array<{
            fingerprint: string;
            type: string;
            field: string;
            reason: string;
            severity: 'critical' | 'major' | 'minor';
            phase: 'raw_guard' | 'final_guard';
            blocking: boolean;
        }>;
        post_sanitize_issues: Array<{
            fingerprint: string;
            type: string;
            field: string;
            reason: string;
            severity: 'critical' | 'major' | 'minor';
            phase: 'raw_guard' | 'final_guard';
            blocking: boolean;
        }>;
        neutralized_issues: Array<{
            fingerprint: string;
            type: string;
            field: string;
            reason: string;
            severity: 'critical' | 'major' | 'minor';
            phase: 'raw_guard' | 'final_guard';
            blocking: boolean;
        }>;
    };
    followup_status?: 'pending' | 'completed' | 'degraded' | 'failed';
    output_tier?: 'draft' | 'final';
    supersedes_record_id?: string;
    promotion_candidate?: boolean;
    hardening_job_id?: string;
    gemini_calls_used?: number;
    one_call_policy_applied?: boolean;
    degraded_reason_code?: string;
}

type TranscriptionOptions = {
    whisperStrict?: boolean;
    signal?: AbortSignal;
};

type InvocationCounters = {
    total_invocations: number;
    fallback_hops: number;
    by_task: Record<string, number>;
};

const SERVER_TEXT_MODEL = 'gemini:gemini-3-flash-preview';
const SERVER_TRANSCRIPTION_MODEL = 'gemini:gemini-3-flash-preview';

const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = typeof body?.error === 'string'
            ? body.error
            : (typeof body?.message === 'string' ? body.message : `request_failed_${response.status}`);
        throw new Error(message);
    }
    return body as T;
};

const postJson = async <T>(path: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal
    });
    return parseJsonResponse<T>(response);
};

export class AIService {
    private modelInvocationListener?: (event: ModelInvocationEvent) => void;

    private invocationCounters: InvocationCounters = {
        total_invocations: 0,
        fallback_hops: 0,
        by_task: {}
    };

    constructor(_providerKey?: string | string[]) {
        void _providerKey;
    }

    resetInvocationCounters(_sessionId?: string): void {
        this.invocationCounters = {
            total_invocations: 0,
            fallback_hops: 0,
            by_task: {}
        };
    }

    getInvocationCounters(_sessionId?: string): InvocationCounters {
        return {
            total_invocations: this.invocationCounters.total_invocations,
            fallback_hops: this.invocationCounters.fallback_hops,
            by_task: { ...this.invocationCounters.by_task }
        };
    }

    setModelInvocationListener(listener?: (event: ModelInvocationEvent) => void): void {
        this.modelInvocationListener = listener;
    }

    private emitInvocation(task: string, phase: string, status: 'start' | 'success' | 'error', model: string, error?: unknown) {
        this.invocationCounters.total_invocations += status === 'start' ? 0 : 1;
        if (status === 'success') {
            this.invocationCounters.by_task[task] = (this.invocationCounters.by_task[task] || 0) + 1;
        }
        this.modelInvocationListener?.({
            provider: model.startsWith('gemini:') ? 'gemini' : 'groq',
            model: model.includes(':') ? model.split(':').slice(1).join(':') : model,
            task,
            phase,
            status,
            route_key: model,
            attempt_index: 0,
            created_at: new Date().toISOString(),
            is_fallback: false,
            error_type: status === 'error' ? ((error as Error)?.message || 'request_failed') : undefined
        });
    }

    async transcribeAudio(
        audioInput: Blob | string,
        mimeType?: string,
        legacyAudioBlob?: Blob,
        options?: TranscriptionOptions
    ): Promise<AIResult<string>> {
        const blob = audioInput instanceof Blob
            ? audioInput
            : (legacyAudioBlob || new Blob([Uint8Array.from(atob(audioInput), (char) => char.charCodeAt(0))], { type: mimeType || 'audio/wav' }));

        this.emitInvocation('transcription', 'transcription', 'start', SERVER_TRANSCRIPTION_MODEL);
        try {
            const result = await postJson<{ text: string; model: string }>('/api/ai/transcribe', {
                audioBase64: await blobToBase64(blob),
                mimeType: blob.type || mimeType || 'audio/wav',
                whisperStrict: Boolean(options?.whisperStrict)
            }, options?.signal);
            this.emitInvocation('transcription', 'transcription', 'success', result.model);
            return {
                data: result.text,
                model: result.model
            };
        } catch (error) {
            this.emitInvocation('transcription', 'transcription', 'error', SERVER_TRANSCRIPTION_MODEL, error);
            throw error;
        }
    }

    async extractOnly(transcription: string, specialty: ClinicalSpecialtyId = 'otorrino'): Promise<{
        data: ExtractionResult;
        meta: ExtractionMeta[];
        classification: ConsultationClassification;
    }> {
        this.emitInvocation('extract', 'extract', 'start', SERVER_TEXT_MODEL);
        try {
            const result = await postJson<{
                data: ExtractionResult;
                meta: ExtractionMeta[];
                classification: ConsultationClassification;
                model: string;
            }>('/api/ai/extract', {
                transcription,
                consultationType: specialty
            });
            this.emitInvocation('extract', 'extract', 'success', result.model);
            return {
                data: result.data,
                meta: result.meta || [],
                classification: result.classification
            };
        } catch (error) {
            this.emitInvocation('extract', 'extract', 'error', SERVER_TEXT_MODEL, error);
            throw error;
        }
    }

    async generateMedicalHistory(
        transcription: string,
        patientName: string = '',
        specialty: ClinicalSpecialtyId = 'otorrino'
    ): Promise<AIResultWithMetadata> {
        this.emitInvocation('single_shot_history', 'single_shot_history_generation', 'start', SERVER_TEXT_MODEL);
        try {
            const result = await postJson<AIResultWithMetadata>('/api/ai/generate-history', {
                transcription,
                patientName,
                consultationType: specialty
            });
            this.emitInvocation('single_shot_history', 'single_shot_history_generation', 'success', result.model);
            return result;
        } catch (error) {
            this.emitInvocation('single_shot_history', 'single_shot_history_generation', 'error', SERVER_TEXT_MODEL, error);
            throw error;
        }
    }

    async generateMedicalReport(
        transcription: string,
        patientName: string = '',
        specialty: ClinicalSpecialtyId = 'otorrino'
    ): Promise<AIResult<string>> {
        this.emitInvocation('report', 'report_generation', 'start', SERVER_TEXT_MODEL);
        try {
            const result = await postJson<{ text: string; model: string }>('/api/ai/generate-report', {
                transcription,
                patientName,
                consultationType: specialty
            });
            this.emitInvocation('report', 'report_generation', 'success', result.model);
            return { data: result.text, model: result.model };
        } catch (error) {
            this.emitInvocation('report', 'report_generation', 'error', SERVER_TEXT_MODEL, error);
            throw error;
        }
    }

    async regenerateHistorySection(
        transcription: string,
        currentHistory: string,
        sectionTitle: string,
        patientName: string = '',
        specialty: ClinicalSpecialtyId = 'otorrino'
    ): Promise<AIResult<string>> {
        this.emitInvocation('generation', 'section_regeneration', 'start', SERVER_TEXT_MODEL);
        try {
            const result = await postJson<{ text: string; model: string }>('/api/ai/regenerate-section', {
                transcription,
                currentHistory,
                sectionTitle,
                patientName,
                consultationType: specialty
            });
            this.emitInvocation('generation', 'section_regeneration', 'success', result.model);
            return {
                data: result.text,
                model: result.model
            };
        } catch (error) {
            this.emitInvocation('generation', 'section_regeneration', 'error', SERVER_TEXT_MODEL, error);
            throw error;
        }
    }
}
