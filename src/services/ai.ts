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
    debug_trace?: TranscriptionDebugTrace;
}

export interface ClinicalStyleReferencePayload {
    referenceStory: string;
    generatedTemplate: string;
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

type BriefingTimelineItem = {
    id: string;
    source: 'current' | 'legacy';
    patientName: string;
    specialty: string;
    clinicianProfile?: string;
    clinicianName?: string;
    consultationAt: string;
    medicalHistory: string;
};

type TranscriptionDebugStep = {
    name: string;
    started_at: string;
    ended_at?: string;
    duration_ms?: number;
    status: 'started' | 'passed' | 'failed';
    detail?: string;
};

export type TranscriptionDebugTrace = {
    trace_id: string;
    transport: 'blob' | 'inline';
    started_at: string;
    completed_at?: string;
    total_duration_ms?: number;
    upload_url?: string;
    steps: TranscriptionDebugStep[];
};

type InvocationCounters = {
    total_invocations: number;
    fallback_hops: number;
    by_task: Record<string, number>;
};

const SERVER_TEXT_MODEL = 'gemini:gemini-3-flash-preview';
const SERVER_GROQ_TEXT_MODEL = 'groq:chat';
const SERVER_GROQ_BRIEFING_MODEL = 'groq:briefing';
const SERVER_TRANSCRIPTION_MODEL = 'groq:whisper-large-v3-turbo';
const AUDIO_BLOB_UPLOAD_ENABLED = String(import.meta.env.VITE_AUDIO_BLOB_UPLOAD_ENABLED || 'true').toLowerCase() === 'true';
const BLOB_UPLOAD_TIMEOUT_MS = 45_000;
const TRANSCRIBE_REQUEST_TIMEOUT_MS = 120_000;
const TRANSCRIBE_PREFLIGHT_TIMEOUT_MS = 10_000;

let transcribeReadinessCache:
    | { checkedAt: number; promise: Promise<void> }
    | null = null;

const buildTraceId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, errorFactory: () => Error): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(errorFactory()), timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

const recordTraceStart = (trace: TranscriptionDebugTrace, name: string, detail?: string): number => {
    const index = trace.steps.push({
        name,
        started_at: new Date().toISOString(),
        status: 'started',
        detail
    }) - 1;
    return index;
};

const recordTraceEnd = (
    trace: TranscriptionDebugTrace,
    index: number,
    status: 'passed' | 'failed',
    detail?: string
) => {
    const step = trace.steps[index];
    if (!step) return;
    const endedAt = new Date();
    step.ended_at = endedAt.toISOString();
    step.duration_ms = Math.max(0, endedAt.getTime() - new Date(step.started_at).getTime());
    step.status = status;
    if (detail) step.detail = detail;
};

const finalizeTrace = (trace: TranscriptionDebugTrace) => {
    const endedAt = new Date();
    trace.completed_at = endedAt.toISOString();
    trace.total_duration_ms = Math.max(0, endedAt.getTime() - new Date(trace.started_at).getTime());
};

const persistClientTrace = (trace: TranscriptionDebugTrace) => {
    try {
        sessionStorage.setItem('maria_notes_last_transcription_trace', JSON.stringify(trace));
    } catch {
        // Ignore quota/privacy errors; console output remains available.
    }
    console.info('[AIService] transcription trace', trace);
};

const ensureServerTranscriptionReady = async (signal?: AbortSignal): Promise<void> => {
    const now = Date.now();
    if (transcribeReadinessCache && (now - transcribeReadinessCache.checkedAt) < 30_000) {
        return transcribeReadinessCache.promise;
    }

    const readinessPromise = withTimeout(
        fetch('/api/ai/transcribe-ready', {
            method: 'GET',
            signal
        }).then(async (response) => {
            const body = await response.json().catch(() => ({}));
            if (!response.ok || !body?.ready) {
                throw new Error(
                    typeof body?.error === 'string'
                        ? body.error
                        : 'server_transcription_provider_unconfigured:missing_groq_api_key,missing_gemini_api_key'
                );
            }
        }),
        TRANSCRIBE_PREFLIGHT_TIMEOUT_MS,
        () => new Error(`transcribe_preflight_timeout:${TRANSCRIBE_PREFLIGHT_TIMEOUT_MS}`)
    );

    transcribeReadinessCache = {
        checkedAt: now,
        promise: readinessPromise.catch((error) => {
            transcribeReadinessCache = null;
            throw error;
        })
    };

    return transcribeReadinessCache.promise;
};

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
    signal?: AbortSignal,
    trace?: TranscriptionDebugTrace
): Promise<{ audioUrl: string; mimeType: string } | null> => {
    if (!AUDIO_BLOB_UPLOAD_ENABLED || blob.size <= 0) return null;
    const resolvedMimeType = blob.type || 'audio/wav';
    const stepIndex = trace ? recordTraceStart(trace, 'blob_upload', `bytes=${blob.size}`) : -1;
    try {
        const uploaded = await withTimeout(
            uploadToBlob(buildAudioBlobPathname(resolvedMimeType), blob, {
                access: 'private',
                contentType: resolvedMimeType,
                handleUploadUrl: '/api/blob/upload',
                multipart: blob.size >= 5 * 1024 * 1024,
                abortSignal: signal
            }),
            BLOB_UPLOAD_TIMEOUT_MS,
            () => new Error(`blob_upload_timeout:${BLOB_UPLOAD_TIMEOUT_MS}`)
        );
        if (trace) {
            trace.transport = 'blob';
            trace.upload_url = uploaded.url;
            recordTraceEnd(trace, stepIndex, 'passed');
        }
        return {
            audioUrl: uploaded.url,
            mimeType: resolvedMimeType
        };
    } catch (error) {
        if (trace) {
            recordTraceEnd(trace, stepIndex, 'failed', error instanceof Error ? error.message : 'blob_upload_failed');
        }
        console.warn('[AIService] Blob audio upload failed, falling back to inline payload:', error);
        return null;
    }
};

const buildLearningPayload = async (
    specialty: ClinicalSpecialtyId,
    artifactType: LearningArtifactType,
    section: string,
    clinicianProfile?: string
): Promise<Record<string, unknown> | undefined> => {
    const rulePackContext = await MemoryService.getRulePackContext({
        specialty,
        artifactType,
        section,
        clinicianProfile,
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
        const debugTrace: TranscriptionDebugTrace = {
            trace_id: buildTraceId(),
            transport: 'inline',
            started_at: new Date().toISOString(),
            steps: []
        };

        this.emitInvocation('transcription', 'transcription', 'start', SERVER_TRANSCRIPTION_MODEL);
        try {
            const preflightStepIndex = recordTraceStart(debugTrace, 'transcribe_preflight');
            await ensureServerTranscriptionReady(options?.signal);
            recordTraceEnd(debugTrace, preflightStepIndex, 'passed');

            const uploadedAudio = await maybeUploadAudioToBlob(blob, options?.signal, debugTrace);
            const encodeStepIndex = !uploadedAudio ? recordTraceStart(debugTrace, 'inline_encode', `bytes=${blob.size}`) : -1;
            const encodedAudio = uploadedAudio ? undefined : await blobToBase64(blob);
            if (!uploadedAudio) {
                recordTraceEnd(debugTrace, encodeStepIndex, 'passed');
            }

            const requestStepIndex = recordTraceStart(debugTrace, 'transcribe_request', uploadedAudio ? 'mode=blob' : 'mode=inline');
            const result = await withTimeout(
                postJson<{ text: string; model: string; debug_trace?: TranscriptionDebugTrace }>('/api/ai/transcribe', {
                    audioBase64: encodedAudio,
                    audioUrl: uploadedAudio?.audioUrl,
                    mimeType: uploadedAudio?.mimeType || blob.type || mimeType || 'audio/wav',
                    whisperStrict: Boolean(options?.whisperStrict),
                    consultationType: options?.specialty,
                    clinicianName: options?.clinicianName,
                    clientTrace: debugTrace
                }, options?.signal),
                TRANSCRIBE_REQUEST_TIMEOUT_MS,
                () => new Error(`transcribe_request_timeout:${TRANSCRIBE_REQUEST_TIMEOUT_MS}`)
            );
            recordTraceEnd(debugTrace, requestStepIndex, 'passed', result.model);
            finalizeTrace(debugTrace);
            persistClientTrace(result.debug_trace || debugTrace);
            this.emitInvocation('transcription', 'transcription', 'success', result.model, undefined, {
                artifact_type: 'transcription',
                response_preview: result.text.slice(0, 240),
                estimated_tokens: this.estimateTokens(result.text)
            });
            return {
                data: result.text,
                model: result.model,
                debug_trace: result.debug_trace || debugTrace
            };
        } catch (error) {
            if (error && typeof error === 'object') {
                (error as Error & { debug_trace?: TranscriptionDebugTrace }).debug_trace = debugTrace;
            }
            finalizeTrace(debugTrace);
            persistClientTrace(debugTrace);
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
        clinicianName?: string,
        clinicianProfile?: string,
        styleReference?: ClinicalStyleReferencePayload
    ): Promise<AIResultWithMetadata> {
        this.emitInvocation('single_shot_history', 'single_shot_history_generation', 'start', SERVER_TEXT_MODEL);
        try {
            const learningContext = await buildLearningPayload(specialty, 'medical_history', 'generation', clinicianProfile);
            const result = await postJson<AIResultWithMetadata>('/api/ai/generate-history', {
                transcription,
                patientName,
                consultationType: specialty,
                learningContext,
                clinicianName,
                styleReference
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
        clinicianName?: string,
        clinicianProfile?: string
    ): Promise<AIResult<string>> {
        this.emitInvocation('report', 'report_generation', 'start', SERVER_GROQ_TEXT_MODEL);
        try {
            const learningContext = await buildLearningPayload(specialty, 'medical_report', 'generation', clinicianProfile);
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
            this.emitInvocation('report', 'report_generation', 'error', SERVER_GROQ_TEXT_MODEL, error, {
                specialty,
                artifact_type: 'medical_report'
            });
            throw error;
        }
    }

    async generatePatientBriefing(
        patientName: string,
        specialty: ClinicalSpecialtyId,
        clinicianName: string | undefined,
        timelineItems: BriefingTimelineItem[],
        signal?: AbortSignal
    ): Promise<AIResult<string>> {
        this.emitInvocation('patient_briefing', 'briefing_generation', 'start', SERVER_GROQ_BRIEFING_MODEL);
        try {
            const result = await postJson<{
                text: string;
                model: string;
                audit_trace?: {
                    thought_summary?: string;
                    thought_signature?: string;
                };
            }>('/api/ai/generate-briefing', {
                patientName,
                consultationType: specialty,
                clinicianName,
                timelineItems
            }, signal);
            this.emitInvocation('patient_briefing', 'briefing_generation', 'success', result.model, undefined, {
                specialty,
                artifact_type: 'patient_briefing',
                response_preview: result.text.slice(0, 240),
                estimated_tokens: this.estimateTokens(result.text)
            });
            return { data: result.text, model: result.model };
        } catch (error) {
            this.emitInvocation('patient_briefing', 'briefing_generation', 'error', SERVER_GROQ_BRIEFING_MODEL, error, {
                specialty,
                artifact_type: 'patient_briefing'
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
        clinicianName?: string,
        clinicianProfile?: string,
        styleReference?: ClinicalStyleReferencePayload
    ): Promise<AIResult<string>> {
        this.emitInvocation('generation', 'section_regeneration', 'start', SERVER_GROQ_TEXT_MODEL);
        try {
            const learningContext = await buildLearningPayload(specialty, 'medical_history', sectionTitle || 'generation', clinicianProfile);
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
                clinicianName,
                styleReference
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
            this.emitInvocation('generation', 'section_regeneration', 'error', SERVER_GROQ_TEXT_MODEL, error, {
                specialty,
                artifact_type: 'medical_history'
            });
            throw error;
        }
    }
}
