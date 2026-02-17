import { db, type AuditOutboxItem } from './db';
import { logQualityEvent, supabase } from './supabase';
import { safeGetLocalStorage, safeSetLocalStorage } from '../utils/safeBrowser';

const MAX_ATTEMPTS = 6;
const PROCESS_BATCH_SIZE = 8;
const METRICS_STORAGE_KEY = 'maria_notes_audit_worker_metrics_v1';

let workerTimer: number | null = null;
let workerRunning = false;

const nowIso = () => new Date().toISOString();

interface StageMetric {
    count: number;
    total_ms: number;
    max_ms: number;
}

interface QueueMetric {
    count: number;
    total_ms: number;
    max_ms: number;
}

export interface AuditWorkerMetricsSnapshot {
    processed_total: number;
    worker_failures: number;
    retries_scheduled: number;
    dead_letters: number;
    learning_events_ingested: number;
    learning_events_dropped_noise: number;
    learning_events_deduped: number;
    learning_events_from_autosave: number;
    learning_events_from_manual: number;
    rule_promotions: number;
    rule_rollbacks: number;
    rule_conflict_incidents: number;
    rule_pack_token_budget_exceeded: number;
    queue_wait: QueueMetric;
    stage_latency: Record<string, StageMetric>;
    degradation_causes: Record<string, number>;
    last_updated_at: string;
}

const defaultMetricsSnapshot = (): AuditWorkerMetricsSnapshot => ({
    processed_total: 0,
    worker_failures: 0,
    retries_scheduled: 0,
    dead_letters: 0,
    learning_events_ingested: 0,
    learning_events_dropped_noise: 0,
    learning_events_deduped: 0,
    learning_events_from_autosave: 0,
    learning_events_from_manual: 0,
    rule_promotions: 0,
    rule_rollbacks: 0,
    rule_conflict_incidents: 0,
    rule_pack_token_budget_exceeded: 0,
    queue_wait: { count: 0, total_ms: 0, max_ms: 0 },
    stage_latency: {},
    degradation_causes: {},
    last_updated_at: nowIso()
});

const loadMetrics = (): AuditWorkerMetricsSnapshot => {
    if (typeof window === 'undefined') return defaultMetricsSnapshot();
    try {
        const raw = safeGetLocalStorage(METRICS_STORAGE_KEY, '');
        if (!raw) return defaultMetricsSnapshot();
        const parsed = JSON.parse(raw) as Partial<AuditWorkerMetricsSnapshot>;
        return {
            ...defaultMetricsSnapshot(),
            ...parsed,
            queue_wait: {
                ...defaultMetricsSnapshot().queue_wait,
                ...(parsed.queue_wait || {})
            },
            stage_latency: parsed.stage_latency || {},
            degradation_causes: parsed.degradation_causes || {}
        };
    } catch {
        return defaultMetricsSnapshot();
    }
};

let metricsSnapshot: AuditWorkerMetricsSnapshot = loadMetrics();

const persistMetrics = () => {
    metricsSnapshot.last_updated_at = nowIso();
    if (typeof window === 'undefined') return;
    try {
        safeSetLocalStorage(METRICS_STORAGE_KEY, JSON.stringify(metricsSnapshot));
    } catch {
        // Best-effort persistence only.
    }
};

const recordQueueWait = (waitMs: number) => {
    const normalized = Number.isFinite(waitMs) ? Math.max(0, waitMs) : 0;
    metricsSnapshot.queue_wait.count += 1;
    metricsSnapshot.queue_wait.total_ms += normalized;
    metricsSnapshot.queue_wait.max_ms = Math.max(metricsSnapshot.queue_wait.max_ms, normalized);
};

const recordStageLatency = (stage: string, durationMs: number) => {
    if (!stage || !Number.isFinite(durationMs)) return;
    const normalized = Math.max(0, durationMs);
    const existing = metricsSnapshot.stage_latency[stage] || { count: 0, total_ms: 0, max_ms: 0 };
    existing.count += 1;
    existing.total_ms += normalized;
    existing.max_ms = Math.max(existing.max_ms, normalized);
    metricsSnapshot.stage_latency[stage] = existing;
};

const recordDegradationCause = (reason: string) => {
    const normalized = String(reason || '').trim();
    if (!normalized) return;
    metricsSnapshot.degradation_causes[normalized] = (metricsSnapshot.degradation_causes[normalized] || 0) + 1;
};

export const getAuditWorkerMetricsSnapshot = (): AuditWorkerMetricsSnapshot => ({ ...metricsSnapshot });

export const recordLearningMetric = (
    metric:
        | 'learning_events_ingested'
        | 'learning_events_dropped_noise'
        | 'learning_events_deduped'
        | 'learning_events_from_autosave'
        | 'learning_events_from_manual'
        | 'rule_promotions'
        | 'rule_rollbacks'
        | 'rule_conflict_incidents'
        | 'rule_pack_token_budget_exceeded',
    amount = 1
): void => {
    const normalized = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
    if (normalized <= 0) return;
    metricsSnapshot[metric] += normalized;
    persistMetrics();
};

const computeNextAttempt = (attempt: number): string => {
    const base = Math.min(60_000, 500 * Math.pow(2, Math.max(0, attempt)));
    const jitter = Math.floor(Math.random() * 500);
    return new Date(Date.now() + base + jitter).toISOString();
};

const isNonRetryableOutboxError = (error: unknown): boolean => {
    const status = Number((error as { status?: number })?.status || 0);
    if ([400, 401, 403, 404, 409, 410, 422].includes(status)) return true;

    const message = ((error as Error)?.message || '').toLowerCase();
    if (!message) return false;
    if (
        message.includes('http 400')
        || message.includes('http 401')
        || message.includes('http 403')
        || message.includes('http 404')
        || message.includes('http 409')
        || message.includes('http 410')
        || message.includes('http 422')
        || message.includes('http_400')
        || message.includes('http_401')
        || message.includes('http_403')
        || message.includes('http_404')
        || message.includes('http_409')
        || message.includes('http_410')
        || message.includes('http_422')
        || message.includes('invalid_pipeline_')
        || message.includes('relation') && message.includes('does not exist')
        || message.includes('column') && message.includes('does not exist')
    ) {
        return true;
    }
    return false;
};

export const enqueueAuditEvent = async (
    eventType: string,
    payload: Record<string, unknown>
): Promise<number | undefined> => {
    const now = nowIso();
    const item: AuditOutboxItem = {
        event_type: eventType,
        payload,
        status: 'pending',
        attempts: 0,
        next_attempt_at: now,
        created_at: now,
        updated_at: now
    };
    return db.audit_outbox.add(item);
};

const chunkInsert = async (table: string, rows: Record<string, unknown>[], chunkSize: number) => {
    if (!supabase || rows.length === 0) return;
    for (let i = 0; i < rows.length; i += chunkSize) {
        const slice = rows.slice(i, i + chunkSize);
        const { error } = await supabase.from(table).insert(slice);
        if (error) throw error;
    }
};

const processPipelineAuditBundle = async (payload: Record<string, unknown>) => {
    if (!supabase) return;

    const auditId = (payload.audit_id as string | undefined) || undefined;
    const auditData = payload.audit_data as Record<string, unknown> | undefined;
    if (!auditId || !auditData) {
        throw new Error('invalid_pipeline_audit_bundle_payload');
    }

    const { error: auditError } = await supabase.from('ai_audit_logs').upsert([{
        id: auditId,
        patient_name: auditData.patient_name || null,
        pipeline_version: auditData.pipeline_version || null,
        models_used: auditData.models_used || {},
        extraction_data: auditData.extraction_data || null,
        generation_versions: auditData.generation_versions || [],
        validation_logs: auditData.validation_logs || [],
        corrections_applied: auditData.corrections_applied || 0,
        successful: auditData.successful !== false,
        duration_ms: auditData.duration_ms || 0,
        created_at: auditData.created_at || nowIso()
    }], { onConflict: 'id' });

    if (auditError) throw auditError;

    const extractionMeta = Array.isArray(payload.extraction_meta) ? payload.extraction_meta as Record<string, unknown>[] : [];
    if (extractionMeta.length > 0) {
        const chunkRows = extractionMeta.map((chunk) => ({
            record_id: auditId,
            chunk_id: String(chunk.chunk_id || ''),
            text: String(chunk.chunk_text || '')
        }));

        const evidenceRows = extractionMeta.flatMap((chunk) => {
            const evidence = Array.isArray(chunk.field_evidence) ? chunk.field_evidence as Record<string, unknown>[] : [];
            return evidence.map((entry) => ({
                record_id: auditId,
                field_path: String(entry.field_path || ''),
                value: String(entry.value || ''),
                chunk_id: String(entry.chunk_id || ''),
                evidence: String(entry.evidence_snippet || ''),
                polarity: entry.polarity || null,
                temporality: entry.temporality || null,
                confidence: typeof entry.confidence === 'number' ? entry.confidence : null
            }));
        });

        await chunkInsert('ai_chunks', chunkRows, 100);
        await chunkInsert('ai_field_lineage', evidenceRows, 200);
    }

    const semanticChecks = Array.isArray(payload.semantic_checks) ? payload.semantic_checks as Record<string, unknown>[] : [];
    if (semanticChecks.length > 0) {
        const rows = semanticChecks.map((check) => ({
            record_id: auditId,
            field_path: check.field_path || '',
            value_a: check.value_a || '',
            value_b: check.value_b || '',
            chosen: check.chosen || '',
            polarity: check.polarity || '',
            temporality: check.temporality || '',
            evidence: check.evidence || '',
            confidence: typeof check.confidence === 'number' ? check.confidence : null,
            model: check.model || '',
            created_at: nowIso()
        }));
        await chunkInsert('ai_semantic_checks', rows, 150);
    }

    const modelInvocations = Array.isArray(payload.model_invocations) ? payload.model_invocations as Record<string, unknown>[] : [];
    if (modelInvocations.length > 0) {
        const rows = modelInvocations.map((entry, index) => ({
            audit_id: auditId,
            session_id: String(entry.session_id || payload.session_id || ''),
            task: String(entry.task || ''),
            phase: String(entry.phase || entry.task || ''),
            provider: String(entry.provider || ''),
            model: String(entry.model || ''),
            route_key: String(entry.route_key || ''),
            attempt_index: Number.isFinite(Number(entry.attempt_index)) ? Number(entry.attempt_index) : index,
            is_fallback: Boolean(entry.is_fallback),
            success: Boolean(entry.success),
            error_type: entry.error_type ? String(entry.error_type) : null,
            error_code: entry.error_code ? String(entry.error_code) : null,
            latency_ms: Number.isFinite(Number(entry.latency_ms)) ? Number(entry.latency_ms) : null,
            estimated_tokens: Number.isFinite(Number(entry.estimated_tokens)) ? Number(entry.estimated_tokens) : null,
            created_at: entry.created_at || nowIso()
        }));
        await chunkInsert('ai_model_invocations', rows, 200);
    }

    const qualityEvent = payload.quality_event as Record<string, unknown> | undefined;
    if (qualityEvent && typeof qualityEvent.event_type === 'string') {
        await logQualityEvent({
            record_id: typeof qualityEvent.record_id === 'string' ? qualityEvent.record_id : auditId,
            event_type: qualityEvent.event_type as 'pipeline_completed' | 'doctor_edit' | 'field_confirmation' | 'field_rejection',
            payload: qualityEvent.payload || {}
        });
    }
};

const processPipelineRunUpdate = async (payload: Record<string, unknown>) => {
    if (!supabase) return;
    const sessionId = String(payload.session_id || '');
    if (!sessionId) throw new Error('invalid_pipeline_run_payload');

    const patientName = payload.patient_name ? String(payload.patient_name) : null;
    const status = String(payload.status || 'recording');
    const outcome = payload.outcome ? String(payload.outcome) : null;
    const metadata = (payload.metadata as Record<string, unknown> | undefined) || {};
    if (status === 'awaiting_budget' || status === 'provisional' || status === 'degraded' || status === 'failed') {
        const reason = String(metadata.reason || outcome || status);
        recordDegradationCause(reason);
    }
    const finishedAt = (status === 'completed' || status === 'degraded' || status === 'failed')
        ? nowIso()
        : null;

    const { data: existing } = await supabase
        .from('ai_pipeline_runs')
        .select('id, started_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!existing?.id) {
        const { error } = await supabase.from('ai_pipeline_runs').insert([{
            session_id: sessionId,
            patient_name: patientName,
            status,
            outcome,
            metadata,
            started_at: nowIso(),
            finished_at: finishedAt,
            updated_at: nowIso(),
            created_at: nowIso()
        }]);
        if (error) throw error;
        return;
    }

    const startedAtMs = Date.parse(existing.started_at || nowIso());
    const nowMs = Date.now();
    const durationMs = Number.isFinite(startedAtMs) ? Math.max(0, nowMs - startedAtMs) : null;
    const { error: updateError } = await supabase
        .from('ai_pipeline_runs')
        .update({
            patient_name: patientName,
            status,
            outcome,
            metadata,
            finished_at: finishedAt,
            duration_ms: durationMs,
            updated_at: nowIso()
        })
        .eq('id', existing.id);
    if (updateError) throw updateError;
};

const processPipelineAttempt = async (payload: Record<string, unknown>) => {
    if (!supabase) return;
    const sessionId = String(payload.session_id || '');
    const stage = String(payload.stage || '');
    if (!sessionId || !stage) throw new Error('invalid_pipeline_attempt_payload');

    const attemptIndexRaw = Number(payload.attempt_index || 0);
    const attemptIndex = Number.isFinite(attemptIndexRaw) ? attemptIndexRaw : 0;
    const status = String(payload.status || 'started');
    const durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : null;
    const metadata = (payload.metadata as Record<string, unknown> | undefined) || {};
    if (durationMs !== null) {
        recordStageLatency(stage, durationMs);
    }
    if (status === 'failed') {
        recordDegradationCause(String(payload.error_message || `${stage}_failed`));
    }

    const { data: run } = await supabase
        .from('ai_pipeline_runs')
        .select('id')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const { error } = await supabase.from('ai_pipeline_attempts').insert([{
        run_id: run?.id || null,
        session_id: sessionId,
        stage,
        attempt_index: attemptIndex,
        status,
        started_at: payload.started_at || nowIso(),
        finished_at: payload.finished_at || nowIso(),
        duration_ms: durationMs,
        error_code: payload.error_code || null,
        error_message: payload.error_message || null,
        metadata,
        created_at: nowIso()
    }]);
    if (error) throw error;
};

const processPipelineMarker = async (eventType: string, payload: Record<string, unknown>) => {
    if (!supabase) return;
    const sessionId = String(payload.session_id || '');
    if (!sessionId) return;
    const { data: run } = await supabase
        .from('ai_pipeline_runs')
        .select('id')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const { error } = await supabase.from('ai_pipeline_attempts').insert([{
        run_id: run?.id || null,
        session_id: sessionId,
        stage: eventType,
        attempt_index: 0,
        status: 'completed',
        started_at: nowIso(),
        finished_at: nowIso(),
        duration_ms: 0,
        error_code: null,
        error_message: null,
        metadata: payload || {},
        created_at: nowIso()
    }]);
    if (error) throw error;
};

const processItem = async (item: AuditOutboxItem) => {
    switch (item.event_type) {
        case 'pipeline_audit_bundle':
            await processPipelineAuditBundle(item.payload);
            return;
        case 'pipeline_run_update':
            await processPipelineRunUpdate(item.payload);
            return;
        case 'pipeline_attempt':
            await processPipelineAttempt(item.payload);
            return;
        case 'pipeline_draft_ready':
        case 'pipeline_final_promoted':
        case 'pipeline_hardening_failed':
        case 'pipeline_sla_breach':
            await processPipelineMarker(item.event_type, item.payload);
            return;
        default:
            // Keep unknown events non-blocking so telemetry never breaks the critical path.
            return;
    }
};

export const processAuditOutboxOnce = async (): Promise<number> => {
    if (workerRunning) return 0;
    workerRunning = true;
    try {
        const now = nowIso();
        const staleProcessingCutoff = Date.now() - 60_000;
        const candidates = await db.audit_outbox
            .where('status')
            .anyOf('pending', 'processing')
            .filter((item) => {
                if (item.status === 'pending') return item.next_attempt_at <= now;
                const updatedAt = Date.parse(item.updated_at);
                return Number.isFinite(updatedAt) && updatedAt <= staleProcessingCutoff;
            })
            .limit(PROCESS_BATCH_SIZE)
            .toArray();

        let processedCount = 0;

        for (const item of candidates) {
            if (!item.id) continue;
            const queueWaitMs = Date.now() - Date.parse(item.created_at || nowIso());
            recordQueueWait(queueWaitMs);
            await db.audit_outbox.update(item.id, { status: 'processing', updated_at: nowIso() });
            try {
                await processItem(item);
                metricsSnapshot.processed_total += 1;
                if (item.attempts > 0) {
                    metricsSnapshot.retries_scheduled += item.attempts;
                }
                await db.audit_outbox.update(item.id, {
                    status: 'completed',
                    updated_at: nowIso(),
                    attempts: item.attempts + 1,
                    last_error: undefined
                });
                processedCount++;
            } catch (error) {
                metricsSnapshot.worker_failures += 1;
                const nextAttempts = item.attempts + 1;
                const nonRetryable = isNonRetryableOutboxError(error);
                const deadLetter = !nonRetryable && nextAttempts >= MAX_ATTEMPTS;
                if (!deadLetter && !nonRetryable) {
                    metricsSnapshot.retries_scheduled += 1;
                }
                if (deadLetter) {
                    metricsSnapshot.dead_letters += 1;
                }
                const reason = (error as Error)?.message || 'unknown_audit_worker_error';
                recordDegradationCause(nonRetryable ? `non_retryable:${reason}` : reason);
                await db.audit_outbox.update(item.id, {
                    status: nonRetryable ? 'completed' : (deadLetter ? 'dead_letter' : 'pending'),
                    attempts: nextAttempts,
                    next_attempt_at: deadLetter ? item.next_attempt_at : computeNextAttempt(nextAttempts),
                    last_error: nonRetryable
                        ? `dropped_non_retryable:${reason}`
                        : reason,
                    updated_at: nowIso()
                });
            }
        }

        persistMetrics();
        return processedCount;
    } finally {
        workerRunning = false;
    }
};

export const startAuditWorker = (intervalMs = 5_000): void => {
    if (typeof window === 'undefined') return;
    if (workerTimer) return;
    workerTimer = window.setInterval(() => {
        void processAuditOutboxOnce();
    }, intervalMs);
    void processAuditOutboxOnce();
};

export const stopAuditWorker = (): void => {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
};
