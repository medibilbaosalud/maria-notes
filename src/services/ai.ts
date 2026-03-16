import type {
    ConsultationClassification,
    ExtractionMeta,
    ExtractionResult,
    ModelInvocationRecord,
    ModelInvocationEvent,
    UncertaintyFlag,
    ValidationResult
} from './groq';
import type { ClinicalSpecialtyId } from '../clinical/specialties';
import { MemoryService } from './memory';
import type { LearningArtifactType } from './learning/types';
import { upload as uploadToBlob } from '@vercel/blob/client';

export interface AIResult<T> {
    data: T;
    model: string;
}

export interface AIResultWithMetadata extends AIResult<string> {
    extraction?: ExtractionResult;
    extraction_meta?: ExtractionMeta[];
    classification?: ConsultationClassification;
    quality_notes?: Array<{ type: string; field: string; reason: string; severity: 'low' | 'medium' | 'high' }>;
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
    audit_trace?: {
        thought_summary?: string;
        thought_signature?: string;
    };
}

type TranscriptionOptions = {
    whisperStrict?: boolean;
    signal?: AbortSignal;
    specialty?: ClinicalSpecialtyId;
    clinicianName?: string;
};

type InvocationCounters = {
    total_invocations: number;
    fallback_hops: number;
    by_task: Record<string, number>;
};

const SERVER_TEXT_MODEL = 'gemini:gemini-3-flash-preview';
const SERVER_TRANSCRIPTION_MODEL = 'groq:whisper-large-v3-turbo';
const AUDIO_BLOB_UPLOAD_ENABLED = String(import.meta.env.VITE_AUDIO_BLOB_UPLOAD_ENABLED || 'true').toLowerCase() === 'true';

const getAudioExtensionFromMimeType = (mimeType: string): string => {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('wav')) return 'wav';
    if (normalized.includes('webm')) return 'webm';
    if (normalized.includes('ogg')) return 'ogg';
    if (normalized.includes('flac')) return 'flac';
    if (normalized.includes('m4a')) return 'm4a';
    if (normalized.includes('mp4')) return 'mp4';
    if (normalized.includes('mpeg') || normalized.includes('mp3') || normalized.includes('mpga')) return 'mp3';
    return 'wav';
};

const buildAudioBlobPathname = (mimeType: string): string => {
    const extension = getAudioExtensionFromMimeType(mimeType);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `audio_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return `clinical-audio/${stamp}/${randomId}.${extension}`;
};

const maybeUploadAudioToBlob = async (
    blob: Blob,
    signal?: AbortSignal
): Promise<{ audioUrl: string; mimeType: string } | null> => {
    if (!AUDIO_BLOB_UPLOAD_ENABLED || blob.size <= 0) return null;
    const resolvedMimeType = blob.type || 'audio/wav';
    try {
        const uploaded = await uploadToBlob(buildAudioBlobPathname(resolvedMimeType), blob, {
            access: 'private',
            contentType: resolvedMimeType,
            handleUploadUrl: '/api/blob/upload',
            multipart: blob.size >= 5 * 1024 * 1024,
            abortSignal: signal
        });
        return {
            audioUrl: uploaded.url,
            mimeType: resolvedMimeType
        };
    } catch (error) {
        console.warn('[AIService] Blob audio upload failed, falling back to inline payload:', error);
        return null;
    }
};

const buildLearningPayload = async (
    specialty: ClinicalSpecialtyId,
    artifactType: LearningArtifactType,
    section: string
): Promise<Record<string, unknown> | undefined> => {
    const rulePackContext = await MemoryService.getRulePackContext({
        specialty,
        artifactType,
        section,
        tokenBudget: artifactType === 'medical_report' ? 650 : 900
    });
    if (!rulePackContext.applied_rules.length) return undefined;
    return {
        promptContext: rulePackContext.prompt_context,
        rulePackVersion: rulePackContext.pack.version,
        ruleIdsUsed: rulePackContext.applied_rules.map((rule) => rule.id),
        specialty,
        artifactType,
        section
    };
};

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
        if (response.status === 413) {
            throw new Error('function_payload_too_large');
        }
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
    private modelInvocations: ModelInvocationRecord[] = [];

    private invocationCounters: InvocationCounters = {
        total_invocations: 0,
        fallback_hops: 0,
        by_task: {}
    };

    constructor(_providerKey?: string | string[]) {
        void _providerKey;
    }

    resetInvocationCounters(_sessionId?: string): void {
        this.modelInvocations = [];
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

    drainModelInvocations(): ModelInvocationRecord[] {
        const records = [...this.modelInvocations];
        this.modelInvocations = [];
        return records;
    }

    private estimateTokens(text?: string): number {
        if (!text) return 0;
        return Math.ceil(String(text).length / 4);
    }

    private emitInvocation(
        task: string,
        phase: string,
        status: 'start' | 'success' | 'error',
        model: string,
        error?: unknown,
        metadata?: Partial<ModelInvocationEvent>
    ) {
        const provider = model.startsWith('gemini:') ? 'gemini' : 'groq';
        const normalizedModel = model.includes(':') ? model.split(':').slice(1).join(':') : model;
        const createdAt = new Date().toISOString();
        this.invocationCounters.total_invocations += status === 'start' ? 0 : 1;
        if (status === 'success') {
            this.invocationCounters.by_task[task] = (this.invocationCounters.by_task[task] || 0) + 1;
        }
        if (status !== 'start') {
            this.modelInvocations.push({
                task,
                phase,
                provider,
                model: normalizedModel,
                route_key: metadata?.route_key || model,
                attempt_index: metadata?.attempt_index ?? 0,
                is_fallback: Boolean(metadata?.is_fallback),
                success: status === 'success',
                error_type: status === 'error' ? (metadata?.error_type || ((error as Error)?.message || 'request_failed')) : metadata?.error_type,
                error_code: metadata?.error_code,
                latency_ms: Number.isFinite(Number(metadata?.latency_ms)) ? Number(metadata?.latency_ms) : 0,
                estimated_tokens: Number.isFinite(Number(metadata?.estimated_tokens))
                    ? Number(metadata?.estimated_tokens)
                    : this.estimateTokens(metadata?.response_preview),
                specialty: metadata?.specialty,
                artifact_type: metadata?.artifact_type,
                result_status: metadata?.result_status,
                pipeline_status: metadata?.pipeline_status,
                thought_summary: metadata?.thought_summary,
                thought_signature: metadata?.thought_signature,
                response_preview: metadata?.response_preview,
                session_id: metadata?.session_id,
                created_at: createdAt
            });
        }
        this.modelInvocationListener?.({
            provider,
            model: normalizedModel,
            task,
            phase,
            status,
            route_key: metadata?.route_key || model,
            attempt_index: metadata?.attempt_index ?? 0,
            created_at: createdAt,
            is_fallback: Boolean(metadata?.is_fallback),
            latency_ms: metadata?.latency_ms,
            error_type: status === 'error' ? (metadata?.error_type || ((error as Error)?.message || 'request_failed')) : metadata?.error_type,
            error_code: metadata?.error_code,
            estimated_tokens: metadata?.estimated_tokens,
            specialty: metadata?.specialty,
            artifact_type: metadata?.artifact_type,
            result_status: metadata?.result_status,
            pipeline_status: metadata?.pipeline_status,
            thought_summary: metadata?.thought_summary,
            thought_signature: metadata?.thought_signature,
            response_preview: metadata?.response_preview,
            session_id: metadata?.session_id
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
            const uploadedAudio = await maybeUploadAudioToBlob(blob, options?.signal);
            const result = await postJson<{ text: string; model: string }>('/api/ai/transcribe', {
                audioBase64: uploadedAudio ? undefined : await blobToBase64(blob),
                audioUrl: uploadedAudio?.audioUrl,
                mimeType: uploadedAudio?.mimeType || blob.type || mimeType || 'audio/wav',
                whisperStrict: Boolean(options?.whisperStrict),
                consultationType: options?.specialty,
                clinicianName: options?.clinicianName
            }, options?.signal);
            this.emitInvocation('transcription', 'transcription', 'success', result.model, undefined, {
                artifact_type: 'transcription',
                response_preview: result.text.slice(0, 240),
                estimated_tokens: this.estimateTokens(result.text)
            });
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
            const learningContext = await buildLearningPayload(specialty, 'medical_history', 'extraction');
            const result = await postJson<{
                data: ExtractionResult;
                meta: ExtractionMeta[];
                classification: ConsultationClassification;
                model: string;
                audit_trace?: {
                    thought_summary?: string;
                    thought_signature?: string;
                };
            }>('/api/ai/extract', {
                transcription,
                consultationType: specialty,
                learningContext
            });
            this.emitInvocation('extract', 'extract', 'success', result.model, undefined, {
                specialty,
                artifact_type: 'medical_history',
                thought_summary: result.audit_trace?.thought_summary,
                thought_signature: result.audit_trace?.thought_signature,
                response_preview: JSON.stringify(result.classification || {}).slice(0, 240)
            });
            return {
                data: result.data,
                meta: result.meta || [],
                classification: result.classification
            };
        } catch (error) {
            this.emitInvocation('extract', 'extract', 'error', SERVER_TEXT_MODEL, error, {
                specialty,
                artifact_type: 'medical_history'
            });
            throw error;
        }
    }

    async generateMedicalHistory(
        transcription: string,
        patientName: string = '',
        specialty: ClinicalSpecialtyId = 'otorrino',
        clinicianName?: string
    ): Promise<AIResultWithMetadata> {
        this.emitInvocation('single_shot_history', 'single_shot_history_generation', 'start', SERVER_TEXT_MODEL);
        try {
            const learningContext = await buildLearningPayload(specialty, 'medical_history', 'generation');
            const result = await postJson<AIResultWithMetadata>('/api/ai/generate-history', {
                transcription,
                patientName,
                consultationType: specialty,
                learningContext,
                clinicianName
            });
            this.emitInvocation('single_shot_history', 'single_shot_history_generation', 'success', result.model, undefined, {
                specialty,
                artifact_type: 'medical_history',
                result_status: result.result_status,
                pipeline_status: result.pipeline_status,
                thought_summary: result.audit_trace?.thought_summary,
                thought_signature: result.audit_trace?.thought_signature,
                response_preview: result.data.slice(0, 240),
                estimated_tokens: this.estimateTokens(result.data)
            });
            return result;
        } catch (error) {
            this.emitInvocation('single_shot_history', 'single_shot_history_generation', 'error', SERVER_TEXT_MODEL, error, {
                specialty,
                artifact_type: 'medical_history'
            });
            throw error;
        }
    }

    async generateMedicalReport(
        transcription: string,
        patientName: string = '',
        specialty: ClinicalSpecialtyId = 'otorrino',
        clinicianName?: string
    ): Promise<AIResult<string>> {
        this.emitInvocation('report', 'report_generation', 'start', SERVER_TEXT_MODEL);
        try {
            const learningContext = await buildLearningPayload(specialty, 'medical_report', 'generation');
            const result = await postJson<{
                text: string;
                model: string;
                audit_trace?: {
                    thought_summary?: string;
                    thought_signature?: string;
                };
            }>('/api/ai/generate-report', {
                transcription,
                patientName,
                consultationType: specialty,
                learningContext,
                clinicianName
            });
            this.emitInvocation('report', 'report_generation', 'success', result.model, undefined, {
                specialty,
                artifact_type: 'medical_report',
                thought_summary: result.audit_trace?.thought_summary,
                thought_signature: result.audit_trace?.thought_signature,
                response_preview: result.text.slice(0, 240),
                estimated_tokens: this.estimateTokens(result.text)
            });
            return { data: result.text, model: result.model };
        } catch (error) {
            this.emitInvocation('report', 'report_generation', 'error', SERVER_TEXT_MODEL, error, {
                specialty,
                artifact_type: 'medical_report'
            });
            throw error;
        }
    }

    async regenerateHistorySection(
        transcription: string,
        currentHistory: string,
        sectionTitle: string,
        patientName: string = '',
        specialty: ClinicalSpecialtyId = 'otorrino',
        clinicianName?: string
    ): Promise<AIResult<string>> {
        this.emitInvocation('generation', 'section_regeneration', 'start', SERVER_TEXT_MODEL);
        try {
            const learningContext = await buildLearningPayload(specialty, 'medical_history', sectionTitle || 'generation');
            const result = await postJson<{
                text: string;
                model: string;
                audit_trace?: {
                    thought_summary?: string;
                    thought_signature?: string;
                };
            }>('/api/ai/regenerate-section', {
                transcription,
                currentHistory,
                sectionTitle,
                patientName,
                consultationType: specialty,
                learningContext,
                clinicianName
            });
            this.emitInvocation('generation', 'section_regeneration', 'success', result.model, undefined, {
                specialty,
                artifact_type: 'medical_history',
                thought_summary: result.audit_trace?.thought_summary,
                thought_signature: result.audit_trace?.thought_signature,
                response_preview: result.text.slice(0, 240),
                estimated_tokens: this.estimateTokens(result.text)
            });
            return {
                data: result.text,
                model: result.model
            };
        } catch (error) {
            this.emitInvocation('generation', 'section_regeneration', 'error', SERVER_TEXT_MODEL, error, {
                specialty,
                artifact_type: 'medical_history'
            });
            throw error;
        }
    }
}
