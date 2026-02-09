import {
    db,
    type MedicalRecord,
    type LabTestLog,
    type PipelineJob,
    type ConsultationSession,
    type AudioSegment,
    type TranscriptSegment,
    type ExtractionSegment,
    type PipelineFailure
} from './db';
import { supabase } from './supabase';
import { isCloudSyncEnabled } from '../hooks/useCloudSync';
import type { ConsultationClassification, ExtractionMeta, ExtractionResult } from './groq';

export type { MedicalRecord };
const PIPELINE_ARTIFACT_RETENTION_MS = 24 * 60 * 60 * 1000;
const nowIso = () => new Date().toISOString();

const getCloudClient = () => (supabase && isCloudSyncEnabled() ? supabase : null);

const generateUuid = (): string => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `uuid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

// Helper to sync a record to Supabase (fire-and-forget)
const syncToCloud = async (record: MedicalRecord, operation: 'insert' | 'update' | 'delete') => {
    const client = getCloudClient();
    if (!client) return;

    try {
        if (operation === 'insert') {
            // For cloud, we don't send the local auto-increment id
            const { id, ...cloudRecord } = record;
            await client
                .from('medical_records')
                .upsert([cloudRecord], { onConflict: 'record_uuid' });
            console.log('[Cloud Sync] Record inserted');
        } else if (operation === 'update') {
            const { id, ...cloudRecord } = record;
            await client
                .from('medical_records')
                .upsert([cloudRecord], { onConflict: 'record_uuid' });
            console.log('[Cloud Sync] Record updated');
        } else if (operation === 'delete') {
            await client.from('medical_records')
                .delete()
                .eq('record_uuid', record.record_uuid);
            console.log('[Cloud Sync] Record deleted');
        }
    } catch (error) {
        console.warn('[Cloud Sync] Failed:', error);
        await db.pipeline_failures.add({
            session_id: (record.idempotency_key || record.record_uuid || 'cloud_sync') as string,
            stage: 'cloud_sync',
            reason: (error as Error)?.message || 'cloud_sync_failed',
            retry_count: 0,
            metadata: {
                operation,
                record_uuid: record.record_uuid
            },
            created_at: nowIso()
        });
    }
};

export const saveMedicalRecord = async (
    record: Omit<MedicalRecord, 'id' | 'created_at' | 'record_uuid' | 'updated_at'> & {
        record_uuid?: string;
        ai_model?: string;
        idempotency_key?: string;
    }
): Promise<MedicalRecord[] | null> => {
    try {
        const now = nowIso();
        if (record.idempotency_key) {
            const existing = await db.medical_records.where('idempotency_key').equals(record.idempotency_key).first();
            if (existing?.id) {
                await db.medical_records.update(existing.id, {
                    ...record,
                    updated_at: now
                });
                const updated = await db.medical_records.get(existing.id);
                if (updated) syncToCloud(updated, 'update');
                return updated ? [updated] : null;
            }
        }

        const newRecord: MedicalRecord = {
            ...record,
            record_uuid: record.record_uuid || generateUuid(),
            created_at: now,
            updated_at: now
        };
        const id = await db.medical_records.add(newRecord);
        const saved = await db.medical_records.get(id);

        // Cloud sync
        if (saved) syncToCloud(saved, 'insert');

        return saved ? [saved] : null;
    } catch (error) {
        console.error('Error saving record:', error);
        return null;
    }
};

export const searchMedicalRecords = async (query: string): Promise<MedicalRecord[]> => {
    try {
        const lowerQuery = query.toLowerCase();
        const all = await db.medical_records.orderBy('updated_at').reverse().toArray();
        if (!query.trim()) return all;
        return all.filter(
            r =>
                r.patient_name.toLowerCase().includes(lowerQuery) ||
                r.medical_history.toLowerCase().includes(lowerQuery)
        );
    } catch (error) {
        console.error('Error searching records:', error);
        return [];
    }
};

export const deleteMedicalRecord = async (idOrUuid: string | number): Promise<boolean> => {
    try {
        const record = typeof idOrUuid === 'string'
            ? await db.medical_records.where('record_uuid').equals(idOrUuid).first()
            : await db.medical_records.get(Number(idOrUuid));

        if (record?.id) await db.medical_records.delete(record.id);

        // Cloud sync
        if (record) syncToCloud(record, 'delete');

        return true;
    } catch (error) {
        console.error('Error deleting record:', error);
        return false;
    }
};

export const updateMedicalRecord = async (idOrUuid: string | number, updates: Partial<MedicalRecord>): Promise<MedicalRecord[] | null> => {
    try {
        const now = new Date().toISOString();
        const normalizedUpdates: Partial<MedicalRecord> = { ...updates, updated_at: now };

        const record = typeof idOrUuid === 'string'
            ? await db.medical_records.where('record_uuid').equals(idOrUuid).first()
            : await db.medical_records.get(Number(idOrUuid));

        if (!record?.id) return null;

        await db.medical_records.update(record.id, normalizedUpdates);
        const updated = await db.medical_records.get(record.id);

        // Cloud sync
        if (updated) syncToCloud(updated, 'update');

        return updated ? [updated] : null;
    } catch (error) {
        console.error('Error updating record:', error);
        return null;
    }
};

export const syncFromCloud = async (): Promise<number> => {
    const client = getCloudClient();
    if (!client) return 0;

    try {
        console.log('[Cloud Sync] Checking for new records...');
        const { data: cloudRecords, error } = await client
            .from('medical_records')
            .select('*')
            .order('created_at', { ascending: false });

        if (error || !cloudRecords) {
            console.error('[Cloud Sync] Fetch failed:', error);
            return 0;
        }

        const localRecords = await db.medical_records.toArray();
        const localByUuid = new Map(localRecords.map(r => [r.record_uuid, r]));

        const newRecords: any[] = [];
        let addedCount = 0;

        for (const cloudRec of cloudRecords) {
            const cloudUuid = cloudRec.record_uuid || cloudRec.id || '';
            if (!cloudUuid) continue;

            const local = localByUuid.get(cloudUuid);
            const cloudUpdatedAt = cloudRec.updated_at || cloudRec.created_at || '';
            const localUpdatedAt = local?.updated_at || local?.created_at || '';

            if (!local) {
                const { id, ...recordToInsert } = cloudRec;
                newRecords.push({
                    ...recordToInsert,
                    record_uuid: cloudUuid,
                    updated_at: cloudUpdatedAt || new Date().toISOString()
                });
                addedCount++;
                continue;
            }

            if (cloudUpdatedAt && localUpdatedAt && cloudUpdatedAt > localUpdatedAt) {
                const { id, ...cloudRecordWithoutId } = cloudRec;
                await db.medical_records.update(local.id!, {
                    ...cloudRecordWithoutId,
                    record_uuid: cloudUuid,
                    updated_at: cloudUpdatedAt
                });
            }
        }

        if (newRecords.length > 0) {
            await db.medical_records.bulkAdd(newRecords);
            console.log(`[Cloud Sync] Imported ${addedCount} records from cloud.`);
        } else {
            console.log('[Cloud Sync] Local DB is up to date.');
        }

        return addedCount;

    } catch (error) {
        console.error('[Cloud Sync] Sync error:', error);
        return 0;
    }
};
export const saveLabTestLog = async (log: Omit<LabTestLog, 'id' | 'created_at'>): Promise<void> => {
    try {
        const newLog: LabTestLog = {
            ...log,
            created_at: new Date().toISOString()
        };
        await db.lab_test_logs.add(newLog);
    } catch (error) {
        console.error('Error saving lab test log:', error);
    }
};

export const getLabTestLogs = async (): Promise<LabTestLog[]> => {
    try {
        return await db.lab_test_logs.orderBy('created_at').reverse().toArray();
    } catch (error) {
        console.error('Error getting lab test logs:', error);
        return [];
    }
};

export const clearLabTestLogs = async (): Promise<void> => {
    try {
        await db.lab_test_logs.clear();
    } catch (error) {
        console.error('Error clearing lab test logs:', error);
    }
};

export const upsertPipelineJob = async (job: {
    session_id: string;
    patient_name: string;
    status: PipelineJob['status'];
    result_status?: PipelineJob['result_status'];
    next_attempt_at?: string;
    retry_count?: number;
    last_stage?: string;
    session_version?: number;
    idempotency_key?: string;
    payload?: Record<string, unknown>;
    error_reason?: string;
}): Promise<void> => {
    try {
        const now = nowIso();
        const existing = await db.pipeline_jobs.where('session_id').equals(job.session_id).first();
        if (existing?.id) {
            await db.pipeline_jobs.update(existing.id, {
                status: job.status,
                result_status: job.result_status || existing.result_status,
                next_attempt_at: job.next_attempt_at || existing.next_attempt_at,
                retry_count: typeof job.retry_count === 'number' ? job.retry_count : (existing.retry_count || 0),
                last_stage: job.last_stage || existing.last_stage,
                session_version: typeof job.session_version === 'number' ? job.session_version : (existing.session_version || 1),
                idempotency_key: job.idempotency_key || existing.idempotency_key,
                payload: job.payload || existing.payload,
                error_reason: job.error_reason || existing.error_reason,
                updated_at: now
            });
            return;
        }
        await db.pipeline_jobs.add({
            session_id: job.session_id,
            patient_name: job.patient_name,
            status: job.status,
            result_status: job.result_status,
            next_attempt_at: job.next_attempt_at,
            retry_count: job.retry_count || 0,
            last_stage: job.last_stage,
            session_version: job.session_version || 1,
            idempotency_key: job.idempotency_key,
            payload: job.payload || {},
            error_reason: job.error_reason,
            created_at: now,
            updated_at: now
        });
    } catch (error) {
        console.error('Error upserting pipeline job:', error);
    }
};

export type SegmentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'provisional';
export type SegmentType = 'audio' | 'transcript' | 'extraction';

export const upsertConsultationSession = async (session: {
    session_id: string;
    patient_name: string;
    status: ConsultationSession['status'];
    result_status?: ConsultationSession['result_status'];
    last_batch_index?: number;
    next_attempt_at?: string;
    retry_count?: number;
    metadata?: Record<string, unknown>;
    error_reason?: string;
    idempotency_key?: string;
}): Promise<void> => {
    try {
        const now = nowIso();
        const existing = await db.consultation_sessions.where('session_id').equals(session.session_id).first();
        const ttl = new Date(Date.now() + PIPELINE_ARTIFACT_RETENTION_MS).toISOString();
        if (existing?.id) {
            await db.consultation_sessions.update(existing.id, {
                patient_name: session.patient_name || existing.patient_name,
                status: session.status || existing.status,
                result_status: session.result_status || existing.result_status,
                last_batch_index: typeof session.last_batch_index === 'number' ? session.last_batch_index : existing.last_batch_index,
                next_attempt_at: session.next_attempt_at || existing.next_attempt_at,
                retry_count: typeof session.retry_count === 'number' ? session.retry_count : existing.retry_count,
                metadata: session.metadata || existing.metadata,
                error_reason: session.error_reason || existing.error_reason,
                idempotency_key: session.idempotency_key || existing.idempotency_key,
                ttl_expires_at: ttl,
                updated_at: now
            });
            return;
        }
        await db.consultation_sessions.add({
            session_id: session.session_id,
            patient_name: session.patient_name,
            status: session.status,
            result_status: session.result_status,
            last_batch_index: session.last_batch_index || 0,
            next_attempt_at: session.next_attempt_at,
            retry_count: session.retry_count || 0,
            metadata: session.metadata || {},
            error_reason: session.error_reason,
            idempotency_key: session.idempotency_key || `session_${session.session_id}`,
            ttl_expires_at: ttl,
            created_at: now,
            updated_at: now
        });
    } catch (error) {
        console.error('Error upserting consultation session:', error);
    }
};

export const saveSegment = async (segment: {
    session_id: string;
    batch_index: number;
    type: SegmentType;
    status?: SegmentStatus;
    is_final?: boolean;
    blob?: Blob;
    text?: string;
    extraction?: ExtractionResult;
    classification?: ConsultationClassification;
    meta?: ExtractionMeta[];
    retry_count?: number;
    next_attempt_at?: string;
    error_reason?: string;
}): Promise<void> => {
    const now = nowIso();
    const status = segment.status || 'pending';
    const normalizeStoredStatus = (
        value: SegmentStatus
    ): 'pending' | 'completed' | 'failed' => {
        if (value === 'processing') return 'pending';
        if (value === 'provisional') return 'failed';
        return value;
    };
    if (segment.type === 'audio') {
        if (!segment.blob) throw new Error('audio_segment_requires_blob');
        const existing = await db.audio_segments.where('[session_id+batch_index]').equals([segment.session_id, segment.batch_index]).first();
        const payload: AudioSegment = {
            session_id: segment.session_id,
            batch_index: segment.batch_index,
            is_final: Boolean(segment.is_final),
            blob: segment.blob,
            status,
            retry_count: segment.retry_count || 0,
            next_attempt_at: segment.next_attempt_at,
            error_reason: segment.error_reason,
            created_at: existing?.created_at || now,
            updated_at: now
        };
        if (existing?.id) {
            await db.audio_segments.update(existing.id, payload);
        } else {
            await db.audio_segments.add(payload);
        }
        return;
    }

    if (segment.type === 'transcript') {
        const existing = await db.transcript_segments.where('[session_id+batch_index]').equals([segment.session_id, segment.batch_index]).first();
        const payload: TranscriptSegment = {
            session_id: segment.session_id,
            batch_index: segment.batch_index,
            text: segment.text || '',
            status: normalizeStoredStatus(status),
            error_reason: segment.error_reason,
            created_at: existing?.created_at || now,
            updated_at: now
        };
        if (existing?.id) {
            await db.transcript_segments.put({ ...payload, id: existing.id });
        } else {
            await db.transcript_segments.add(payload);
        }
        return;
    }

    const existing = await db.extraction_segments.where('[session_id+batch_index]').equals([segment.session_id, segment.batch_index]).first();
    const payload: ExtractionSegment = {
        session_id: segment.session_id,
        batch_index: segment.batch_index,
        extraction: (segment.extraction || {}) as Record<string, unknown>,
        classification: (segment.classification || undefined) as Record<string, unknown> | undefined,
        meta: (segment.meta || []) as unknown as Record<string, unknown>[],
        status: normalizeStoredStatus(status),
        error_reason: segment.error_reason,
        created_at: existing?.created_at || now,
        updated_at: now
    };
    if (existing?.id) {
        await db.extraction_segments.put({ ...payload, id: existing.id });
    } else {
        await db.extraction_segments.add(payload);
    }
};

export const markSegmentStatus = async (update: {
    session_id: string;
    batch_index: number;
    type: SegmentType;
    status: SegmentStatus;
    error_reason?: string;
    retry_count?: number;
    next_attempt_at?: string;
}): Promise<void> => {
    const now = nowIso();
    const normalizeStoredStatus = (
        value: SegmentStatus
    ): 'pending' | 'completed' | 'failed' => {
        if (value === 'processing') return 'pending';
        if (value === 'provisional') return 'failed';
        return value;
    };
    if (update.type === 'audio') {
        const existing = await db.audio_segments.where('[session_id+batch_index]').equals([update.session_id, update.batch_index]).first();
        if (!existing?.id) return;
        await db.audio_segments.update(existing.id, {
            status: update.status,
            error_reason: update.error_reason,
            retry_count: typeof update.retry_count === 'number' ? update.retry_count : existing.retry_count,
            next_attempt_at: update.next_attempt_at || existing.next_attempt_at,
            updated_at: now
        });
        return;
    }

    if (update.type === 'transcript') {
        const existing = await db.transcript_segments.where('[session_id+batch_index]').equals([update.session_id, update.batch_index]).first();
        if (!existing?.id) return;
        await db.transcript_segments.update(existing.id, {
            status: normalizeStoredStatus(update.status),
            error_reason: update.error_reason,
            updated_at: now
        });
        return;
    }

    const existing = await db.extraction_segments.where('[session_id+batch_index]').equals([update.session_id, update.batch_index]).first();
    if (!existing?.id) return;
    await db.extraction_segments.update(existing.id, {
        status: normalizeStoredStatus(update.status),
        error_reason: update.error_reason,
        updated_at: now
    });
};

export const loadRecoverableSession = async (sessionId?: string) => {
    const now = nowIso();
    let session: ConsultationSession | undefined;
    if (sessionId) {
        session = await db.consultation_sessions.where('session_id').equals(sessionId).first();
    } else {
        session = await db.consultation_sessions
            .where('status')
            .anyOf('recording', 'uploading_chunks', 'transcribing_partial', 'extracting', 'finalizing', 'awaiting_budget', 'provisional')
            .reverse()
            .sortBy('updated_at')
            .then((rows) => rows[rows.length - 1]);
    }
    if (!session) return null;
    if (session.ttl_expires_at < now) return null;

    const [audioSegments, transcriptSegments, extractionSegments] = await Promise.all([
        db.audio_segments.where('session_id').equals(session.session_id).sortBy('batch_index'),
        db.transcript_segments.where('session_id').equals(session.session_id).sortBy('batch_index'),
        db.extraction_segments.where('session_id').equals(session.session_id).sortBy('batch_index')
    ]);

    return {
        session,
        audio_segments: audioSegments,
        transcript_segments: transcriptSegments,
        extraction_segments: extractionSegments
    };
};

export const resumeSession = async (sessionId: string) => loadRecoverableSession(sessionId);

export const getRecoverableSessions = async (): Promise<ConsultationSession[]> => {
    const now = nowIso();
    const sessions = await db.consultation_sessions
        .where('status')
        .anyOf('recording', 'uploading_chunks', 'transcribing_partial', 'extracting', 'finalizing', 'awaiting_budget', 'provisional')
        .toArray();
    return sessions.filter((session) => session.ttl_expires_at >= now);
};

export const requeueSession = async (sessionId: string, nextAttemptAt?: string): Promise<void> => {
    const existing = await db.consultation_sessions.where('session_id').equals(sessionId).first();
    if (!existing?.id) return;
    const attempt = (existing.retry_count || 0) + 1;
    await db.consultation_sessions.update(existing.id, {
        status: 'awaiting_budget',
        retry_count: attempt,
        next_attempt_at: nextAttemptAt || new Date(Date.now() + Math.min(300_000, 3_000 * attempt)).toISOString(),
        updated_at: nowIso()
    });
};

export const finalizeSession = async (sessionId: string, options?: {
    status?: ConsultationSession['status'];
    result_status?: ConsultationSession['result_status'];
    error_reason?: string;
    purgeArtifacts?: boolean;
}): Promise<void> => {
    const existing = await db.consultation_sessions.where('session_id').equals(sessionId).first();
    if (!existing?.id) return;
    const status = options?.status || 'completed';
    await db.consultation_sessions.update(existing.id, {
        status,
        result_status: options?.result_status || (status === 'provisional' ? 'provisional' : 'completed'),
        error_reason: options?.error_reason,
        updated_at: nowIso()
    });

    if (options?.purgeArtifacts || status === 'completed') {
        await Promise.all([
            db.audio_segments.where('session_id').equals(sessionId).delete(),
            db.transcript_segments.where('session_id').equals(sessionId).delete(),
            db.extraction_segments.where('session_id').equals(sessionId).delete()
        ]);
    }
};

export const purgeExpiredPipelineArtifacts = async (): Promise<void> => {
    const now = nowIso();
    const expired = await db.consultation_sessions.where('ttl_expires_at').below(now).toArray();
    for (const session of expired) {
        await Promise.all([
            session.id ? db.consultation_sessions.delete(session.id) : Promise.resolve(),
            db.audio_segments.where('session_id').equals(session.session_id).delete(),
            db.transcript_segments.where('session_id').equals(session.session_id).delete(),
            db.extraction_segments.where('session_id').equals(session.session_id).delete()
        ]);
    }
};

export const recordPipelineFailure = async (failure: Omit<PipelineFailure, 'id' | 'created_at'>): Promise<void> => {
    await db.pipeline_failures.add({
        ...failure,
        created_at: nowIso()
    });
};

export const getPipelineHealthSnapshot = async () => {
    const [sessions, outbox, failures] = await Promise.all([
        db.consultation_sessions.toArray(),
        db.audit_outbox.toArray(),
        db.pipeline_failures.orderBy('created_at').reverse().limit(50).toArray()
    ]);

    const active = sessions.filter((s) => ['recording', 'uploading_chunks', 'transcribing_partial', 'extracting', 'finalizing', 'awaiting_budget'].includes(s.status)).length;
    const provisional = sessions.filter((s) => s.status === 'provisional').length;
    const deadLetters = outbox.filter((item) => item.status === 'dead_letter').length;
    const nextAttempt = sessions
        .map((s) => s.next_attempt_at)
        .filter((value): value is string => Boolean(value))
        .sort()[0];

    return {
        active_sessions: active,
        provisional_sessions: provisional,
        dead_letters: deadLetters,
        next_attempt_at: nextAttempt || null,
        recent_failures: failures
    };
};
