import Dexie, { type EntityTable, type Table } from 'dexie';

export interface MedicalRecord {
    id?: number;
    record_uuid: string;
    idempotency_key?: string;
    patient_name: string;
    consultation_type: string;
    transcription: string;
    medical_history: string;
    original_medical_history?: string; // Preserves the raw AI output before user edits
    medical_report?: string;
    ai_model?: string;
    audit_id?: string; // Links to ai_audit_logs.id when available
    created_at: string;
    updated_at?: string; // Used for ordering and cloud conflict resolution
}

export interface LabTestLog {
    id?: number;
    test_name: string;
    created_at: string;
    input_type: 'audio' | 'text';
    transcription: string;
    medical_history: string;
    metadata: {
        corrections: number;
        models: { generation: string; validation: string };
        errorsFixed: number;
        versionsCount: number;
        validationHistory?: { type: string; field: string; reason: string }[];
        remainingErrors?: { type: string; field: string; reason: string }[];
        active_memory_used?: boolean;
        diagnostics?: {
            run_id: string;
            mode: 'simulated' | 'real' | 'hybrid';
            input_source?: 'audio' | 'text';
            scenario_id?: string;
            status: 'passed' | 'failed' | 'degraded' | 'skipped';
            stage_results: Array<{
                stage: string;
                status: 'passed' | 'failed' | 'degraded' | 'skipped';
                duration_ms: number;
                ended_at?: number;
                error_code?: string;
                error_message?: string;
                error_detail?: {
                    code: string;
                    message: string;
                    stage?: string;
                    batch_index?: number;
                    occurred_at: string;
                    context?: {
                        http_status?: number;
                        retryable?: boolean;
                        attempt?: number;
                        provider?: string;
                        operation?: string;
                        endpoint?: string;
                        input_type?: string;
                        mime_type?: string;
                        chunk_bytes?: number;
                        notes?: string[];
                    };
                };
            }>;
            audio_stats?: {
                chunk_count: number;
                failed_chunks: number;
                avg_chunk_bytes: number;
                transcription_p95_ms: number;
            };
            quality_gate?: {
                required_sections_ok: boolean;
                result_status?: string;
                pipeline_status?: string;
                critical_gaps_count: number;
            };
            root_causes?: string[];
            error_catalog?: {
                by_code: Array<{
                    code: string;
                    count: number;
                    stages: string[];
                    last_message?: string;
                }>;
                by_stage: Array<{
                    stage: string;
                    failed: number;
                    degraded: number;
                    last_error_code?: string;
                }>;
            };
            failure_timeline?: Array<{
                timestamp: string;
                stage: string;
                status: 'passed' | 'failed' | 'degraded' | 'skipped';
                error_code?: string;
                error_message?: string;
                batch_index?: number;
            }>;
            recommendations?: string[];
            insights?: string[];
        };
    };
}

export interface PipelineJob {
    id?: number;
    session_id: string;
    patient_name: string;
    status: 'idle' | 'recovering' | 'recording' | 'processing_partials' | 'awaiting_budget' | 'finalizing' | 'provisional' | 'completed' | 'degraded' | 'failed';
    result_status?: 'completed' | 'provisional' | 'failed_recoverable' | 'failed_final';
    next_attempt_at?: string;
    retry_count?: number;
    last_stage?: string;
    session_version?: number;
    idempotency_key?: string;
    payload?: Record<string, unknown>;
    error_reason?: string;
    created_at: string;
    updated_at: string;
}

export interface ConsultationSession {
    id?: number;
    session_id: string;
    patient_name: string;
    status: 'preflight' | 'recording' | 'uploading_chunks' | 'transcribing_partial' | 'extracting' | 'finalizing' | 'awaiting_budget' | 'provisional' | 'completed' | 'failed';
    result_status?: 'completed' | 'provisional' | 'failed_recoverable' | 'failed_final';
    last_batch_index: number;
    next_attempt_at?: string;
    retry_count: number;
    idempotency_key: string;
    metadata?: Record<string, unknown>;
    error_reason?: string;
    ttl_expires_at: string;
    created_at: string;
    updated_at: string;
}

export interface AudioSegment {
    id?: number;
    session_id: string;
    batch_index: number;
    is_final: boolean;
    blob: Blob;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'provisional';
    retry_count: number;
    next_attempt_at?: string;
    error_reason?: string;
    created_at: string;
    updated_at: string;
}

export interface TranscriptSegment {
    id?: number;
    session_id: string;
    batch_index: number;
    text: string;
    status: 'pending' | 'completed' | 'failed';
    error_reason?: string;
    created_at: string;
    updated_at: string;
}

export interface ExtractionSegment {
    id?: number;
    session_id: string;
    batch_index: number;
    extraction: Record<string, unknown>;
    classification?: Record<string, unknown>;
    meta?: Record<string, unknown>[];
    status: 'pending' | 'completed' | 'failed';
    error_reason?: string;
    created_at: string;
    updated_at: string;
}

export interface PipelineFailure {
    id?: number;
    session_id: string;
    stage: string;
    reason: string;
    retry_count: number;
    metadata?: Record<string, unknown>;
    created_at: string;
}

export interface AuditOutboxItem {
    id?: number;
    event_type: string;
    payload: Record<string, unknown>;
    status: 'pending' | 'processing' | 'completed' | 'dead_letter';
    attempts: number;
    next_attempt_at: string;
    last_error?: string;
    created_at: string;
    updated_at: string;
}

const db = new Dexie('MariaNotesDB') as Dexie & {
    medical_records: EntityTable<MedicalRecord, 'id'>;
    lab_test_logs: EntityTable<LabTestLog, 'id'>;
    pipeline_jobs: EntityTable<PipelineJob, 'id'>;
    audit_outbox: EntityTable<AuditOutboxItem, 'id'>;
    consultation_sessions: EntityTable<ConsultationSession, 'id'>;
    audio_segments: EntityTable<AudioSegment, 'id'>;
    transcript_segments: EntityTable<TranscriptSegment, 'id'>;
    extraction_segments: EntityTable<ExtractionSegment, 'id'>;
    pipeline_failures: EntityTable<PipelineFailure, 'id'>;
};

const generateUuid = (): string => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    // Fallback (not RFC4122, but stable enough for local uniqueness if needed)
    return `uuid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

db.version(2).stores({
    medical_records: '++id, patient_name, created_at',
    lab_test_logs: '++id, test_name, created_at'
});

db.version(3).stores({
    medical_records: '++id, record_uuid, patient_name, created_at, updated_at',
    lab_test_logs: '++id, test_name, created_at'
}).upgrade(async (tx) => {
    const table = tx.table('medical_records') as Table<MedicalRecord, number>;
    await table.toCollection().modify((record) => {
        if (!record.record_uuid) record.record_uuid = generateUuid();
        if (!record.updated_at) record.updated_at = record.created_at || new Date().toISOString();
    });
});

db.version(4).stores({
    medical_records: '++id, record_uuid, patient_name, created_at, updated_at',
    lab_test_logs: '++id, test_name, created_at',
    pipeline_jobs: '++id, session_id, status, updated_at',
    audit_outbox: '++id, status, next_attempt_at, created_at, updated_at'
});

db.version(5).stores({
    medical_records: '++id, record_uuid, idempotency_key, patient_name, created_at, updated_at',
    lab_test_logs: '++id, test_name, created_at',
    pipeline_jobs: '++id, session_id, status, result_status, next_attempt_at, updated_at',
    audit_outbox: '++id, status, next_attempt_at, created_at, updated_at',
    consultation_sessions: '++id, session_id, status, next_attempt_at, updated_at, ttl_expires_at',
    audio_segments: '++id, [session_id+batch_index], session_id, batch_index, status, is_final, updated_at',
    transcript_segments: '++id, [session_id+batch_index], session_id, batch_index, status, updated_at',
    extraction_segments: '++id, [session_id+batch_index], session_id, batch_index, status, updated_at',
    pipeline_failures: '++id, session_id, stage, created_at'
}).upgrade(async (tx) => {
    const jobs = tx.table('pipeline_jobs') as Table<PipelineJob, number>;
    await jobs.toCollection().modify((job) => {
        if (typeof job.retry_count !== 'number') job.retry_count = 0;
        if (typeof job.session_version !== 'number') job.session_version = 1;
    });
});

export { db };
