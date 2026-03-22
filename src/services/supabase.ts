import { createClient } from '@supabase/supabase-js';
import { buildSupabaseFetch } from './net';

// These should be environment variables in a real app
// For now, we'll use placeholders that the user needs to fill
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_AUTOLOGIN_EMAIL = import.meta.env.VITE_SUPABASE_AUTOLOGIN_EMAIL || '';
const SUPABASE_AUTOLOGIN_PASSWORD = import.meta.env.VITE_SUPABASE_AUTOLOGIN_PASSWORD || '';

// Create a dummy client or null if config is missing to prevent crash
export const supabase = (SUPABASE_URL && SUPABASE_KEY && SUPABASE_URL !== 'YOUR_SUPABASE_URL')
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: {
            fetch: buildSupabaseFetch({
                timeoutMs: 15_000,
                retries: 2,
                baseDelayMs: 250,
                maxDelayMs: 2_000
            })
        },
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    })
    : null;

export interface SupabaseAuthSnapshot {
    isConfigured: boolean;
    isAuthenticated: boolean;
    userEmail: string | null;
}

export type SupabaseAccessMode = 'disabled' | 'internal' | 'session';

let authSnapshot: SupabaseAuthSnapshot = {
    isConfigured: Boolean(supabase),
    isAuthenticated: false,
    userEmail: null
};

let autoLoginAttempted = false;

const authListeners = new Set<(snapshot: SupabaseAuthSnapshot) => void>();

const emitAuthSnapshot = () => {
    authListeners.forEach((listener) => listener(authSnapshot));
};

const setAuthSnapshot = (next: Partial<SupabaseAuthSnapshot>) => {
    authSnapshot = {
        ...authSnapshot,
        ...next,
        isConfigured: Boolean(supabase)
    };
    emitAuthSnapshot();
};

if (supabase) {
    void supabase.auth.getSession().then(({ data }) => {
        const session = data.session;
        setAuthSnapshot({
            isAuthenticated: Boolean(session),
            userEmail: session?.user?.email || null
        });
        if (!session) {
            void ensureSupabaseAutologin();
        }
    }).catch(() => {
        setAuthSnapshot({
            isAuthenticated: false,
            userEmail: null
        });
        void ensureSupabaseAutologin();
    });

    supabase.auth.onAuthStateChange((_event, session) => {
        setAuthSnapshot({
            isAuthenticated: Boolean(session),
            userEmail: session?.user?.email || null
        });
    });
}

export const isSupabaseAutologinConfigured = (): boolean =>
    Boolean(
        supabase
        && String(SUPABASE_AUTOLOGIN_EMAIL).trim()
        && String(SUPABASE_AUTOLOGIN_PASSWORD).trim()
    );

export const ensureSupabaseAutologin = async (): Promise<boolean> => {
    if (!supabase || hasSupabaseSession()) return true;
    if (!isSupabaseAutologinConfigured()) return false;
    if (autoLoginAttempted) return false;

    autoLoginAttempted = true;
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: String(SUPABASE_AUTOLOGIN_EMAIL).trim(),
            password: String(SUPABASE_AUTOLOGIN_PASSWORD).trim()
        });
        if (error) throw error;
        const session = data.session;
        setAuthSnapshot({
            isAuthenticated: Boolean(session),
            userEmail: session?.user?.email || null
        });
        return Boolean(session);
    } catch (error) {
        console.warn('[Supabase] Automatic sign-in failed:', error);
        return false;
    }
};

export const getSupabaseAuthSnapshot = (): SupabaseAuthSnapshot => authSnapshot;

export const hasSupabaseSession = (): boolean => authSnapshot.isAuthenticated;

export const getSupabaseAccessMode = (): SupabaseAccessMode => {
    if (!supabase) return 'disabled';
    return authSnapshot.isAuthenticated ? 'session' : 'internal';
};

export const hasSupabaseDirectAccess = (): boolean => Boolean(supabase);

export const onSupabaseAuthChange = (listener: (snapshot: SupabaseAuthSnapshot) => void): (() => void) => {
    authListeners.add(listener);
    listener(authSnapshot);
    return () => {
        authListeners.delete(listener);
    };
};

export const signInWithMagicLink = async (email: string): Promise<void> => {
    if (!supabase) throw new Error('supabase_not_configured');
    const normalizedEmail = email.trim();
    if (!normalizedEmail) throw new Error('email_required');
    const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
            emailRedirectTo: redirectTo
        }
    });
    if (error) throw error;
};

export const signOutSupabase = async (): Promise<void> => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
};

type ProtectedSupabaseClient = NonNullable<typeof supabase>;
const getProtectedSupabase = (): ProtectedSupabaseClient | null => {
    if (!supabase || !hasSupabaseSession()) return null;
    return supabase;
};

export interface MedicalRecord {
    id?: string;
    patient_name: string;
    consultation_type: string;
    specialty?: string;
    clinician_profile?: string;
    transcription: string;
    medical_history: string;
    medical_report?: string;
    ai_model?: string;
    created_at?: string;
}

export interface ConsultationTranscriptChunk {
    session_id: string;
    session_version: number;
    batch_index: number;
    part_index: number;
    text: string;
    status: 'completed' | 'failed';
    error_reason?: string | null;
    latency_ms?: number | null;
    model_used?: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface ClinicalGenerationDiagnosticEntry {
    dedupe_key: string;
    record_id?: string;
    audit_id?: string;
    session_id?: string;
    specialty: string;
    clinician_profile?: string;
    artifact_type: string;
    patient_name_snapshot?: string;
    transcription_text: string;
    ai_draft_text: string;
    doctor_final_text?: string;
    doctor_score?: number | null;
    doctor_feedback_text?: string | null;
    review_status?: 'pending' | 'reviewed' | 'audited' | 'locked';
    model_used?: string | null;
    provider_used?: string | null;
    prompt_version?: string | null;
    rule_pack_version?: number | null;
    rule_ids_used?: string[];
    pipeline_status?: string | null;
    result_status?: string | null;
    quality_score?: number | null;
    metadata?: Record<string, unknown>;
}

export interface ClinicalGenerationDiagnosticEditEntry {
    diagnostic_id: string;
    clinician_profile?: string;
    section_name?: string | null;
    edit_type: 'added' | 'removed' | 'rewritten' | 'terminology' | 'style' | 'formatting' | 'clinical_precision' | 'omission';
    importance?: 'low' | 'medium' | 'high';
    edit_source?: 'generated' | 'manual_save' | 'autosave' | 'finalized';
    before_text?: string | null;
    after_text?: string | null;
    edit_distance_chars?: number;
    metadata?: Record<string, unknown>;
}

export const saveMedicalRecord = async (record: MedicalRecord) => {
    const client = getProtectedSupabase();
    if (!client) {
        console.warn('Supabase not configured');
        return null;
    }

    const { data, error } = await client
        .from('medical_records')
        .insert([record])
        .select();

    if (error) throw error;
    return data?.[0] || null;
};

export const searchMedicalRecords = async (query: string) => {
    const client = getProtectedSupabase();
    if (!client) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await client
        .from('medical_records')
        .select('*')
        .or(`patient_name.ilike.%${query}%,medical_history.ilike.%${query}%`)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
};

export const deleteMedicalRecord = async (id: string): Promise<boolean> => {
    const client = getProtectedSupabase();
    if (!client) return false;

    const { error } = await client
        .from('medical_records')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting record:', error);
        return false;
    }
    return true;
};

export const updateMedicalRecord = async (id: string, updates: Partial<MedicalRecord>) => {
    const client = getProtectedSupabase();
    if (!client) return null;

    const { data, error } = await client
        .from('medical_records')
        .update(updates)
        .eq('id', id)
        .select();

    if (error) {
        console.error('Error updating record:', error);
        throw error;
    }
    return data;
};
// AI Audit Logging
export const logAIAudit = async (auditData: {
    patient_name: string;
    pipeline_version: string;
    models_used: any;
    extraction_data: any;
    generation_versions: any[];
    validation_logs: any[];
    corrections_applied: number;
    successful: boolean;
    duration_ms: number;
}): Promise<string | null> => {
    const client = getProtectedSupabase();
    if (!client) return null;

    try {
        const { data, error } = await client
            .from('ai_audit_logs')
            .insert([{
                ...auditData,
                created_at: new Date().toISOString()
            }])
            .select('id');

        if (error) {
            console.error('Error logging AI audit:', error);
            return null;
        }
        return data?.[0]?.id || null;
    } catch (error) {
        console.error('Error logging AI audit:', error);
        return null;
    }
};

interface LineageEvidence {
    field_path: string;
    value: string;
    chunk_id: string;
    evidence_snippet: string;
    polarity?: string;
    temporality?: string;
    confidence?: number;
}

interface LineageMeta {
    chunk_id: string;
    chunk_text?: string;
    field_evidence: LineageEvidence[];
}

export const logFieldLineage = async (recordId: string, meta: LineageMeta[]): Promise<void> => {
    const client = getProtectedSupabase();
    if (!client || !recordId || meta.length === 0) return;

    const chunkRows = meta.map((chunk) => ({
        record_id: recordId,
        chunk_id: chunk.chunk_id,
        text: chunk.chunk_text || ''
    }));

    const evidenceRows = meta.flatMap((chunk) =>
        (chunk.field_evidence || []).map((evidence) => ({
            record_id: recordId,
            field_path: evidence.field_path,
            value: evidence.value,
            chunk_id: evidence.chunk_id,
            evidence: evidence.evidence_snippet || '',
            polarity: evidence.polarity || null,
            temporality: evidence.temporality || null,
            confidence: evidence.confidence ?? null
        }))
    );

    const chunkedInsert = async (table: string, rows: any[], chunkSize: number) => {
        for (let i = 0; i < rows.length; i += chunkSize) {
            const slice = rows.slice(i, i + chunkSize);
            const { error } = await client.from(table).insert(slice);
            if (error) {
                console.error(`[Supabase] Insert failed for ${table}:`, error);
                return;
            }
        }
    };

    await chunkedInsert('ai_chunks', chunkRows, 100);
    await chunkedInsert('ai_field_lineage', evidenceRows, 200);
};

export const upsertTranscriptChunk = async (chunk: ConsultationTranscriptChunk): Promise<void> => {
    const client = getProtectedSupabase();
    if (!client) return;
    const now = new Date().toISOString();
    const row = {
        session_id: chunk.session_id,
        session_version: Math.max(1, Number(chunk.session_version || 1)),
        batch_index: Number(chunk.batch_index),
        part_index: Math.max(0, Number(chunk.part_index || 0)),
        text: chunk.text || '',
        status: chunk.status,
        error_reason: chunk.error_reason || null,
        latency_ms: typeof chunk.latency_ms === 'number' ? chunk.latency_ms : null,
        model_used: chunk.model_used || null,
        created_at: chunk.created_at || now,
        updated_at: now
    };

    const { error } = await client
        .from('consultation_transcript_chunks')
        .upsert([row], { onConflict: 'session_id,session_version,batch_index,part_index' });
    if (error) throw error;
};

export const getTranscriptChunksBySession = async (
    sessionId: string,
    sessionVersion: number
): Promise<ConsultationTranscriptChunk[]> => {
    const client = getProtectedSupabase();
    if (!client || !sessionId) return [];
    const { data, error } = await client
        .from('consultation_transcript_chunks')
        .select('*')
        .eq('session_id', sessionId)
        .eq('session_version', Math.max(1, Number(sessionVersion || 1)))
        .order('batch_index', { ascending: true })
        .order('part_index', { ascending: true });
    if (error) throw error;
    return (data || []) as ConsultationTranscriptChunk[];
};

export interface SemanticCheckLog {
    field_path: string;
    value_a: string;
    value_b: string;
    chosen: string;
    polarity: string;
    temporality: string;
    evidence: string;
    confidence: number;
    model: string;
}

export const logSemanticChecks = async (recordId: string, checks: SemanticCheckLog[]): Promise<void> => {
    const client = getProtectedSupabase();
    if (!client || !recordId || checks.length === 0) return;

    const rows = checks.map((check) => ({
        record_id: recordId,
        field_path: check.field_path,
        value_a: check.value_a,
        value_b: check.value_b,
        chosen: check.chosen,
        polarity: check.polarity,
        temporality: check.temporality,
        evidence: check.evidence || '',
        confidence: check.confidence ?? null,
        model: check.model || ''
    }));

    const { error } = await client.from('ai_semantic_checks').insert(rows);
    if (error) console.error('Error logging semantic checks:', error);
};

export const saveFieldConfirmation = async (confirmation: {
    record_id?: string;
    field_path: string;
    suggested_value?: string;
    doctor_value?: string;
    confirmed: boolean;
}): Promise<void> => {
    const client = getProtectedSupabase();
    if (!client) return;

    const { error } = await client.from('ai_field_confirmations').insert([{
        record_id: confirmation.record_id || null,
        field_path: confirmation.field_path,
        suggested_value: confirmation.suggested_value || null,
        doctor_value: confirmation.doctor_value || null,
        confirmed: confirmation.confirmed,
        created_at: new Date().toISOString()
    }]);

    if (error) console.error('Error saving field confirmation:', error);
};

const upsertDailyMetrics = async (metricDate: string, updates: {
    total_consultations?: number;
    corrected_consultations?: number;
    total_corrections?: number;
    total_uncertainty_flags?: number;
    total_missing?: number;
    total_hallucinations?: number;
    total_inconsistencies?: number;
    total_manual_edits?: number;
    total_duration_ms?: number;
    total_transcript_tokens?: number;
}) => {
    const client = getProtectedSupabase();
    if (!client) return;

    const { data, error } = await client
        .from('ai_quality_metrics_daily')
        .select('*')
        .eq('metric_date', metricDate)
        .maybeSingle();

    if (error) {
        console.error('Error fetching daily metrics:', error);
        return;
    }

    if (!data) {
        const insertPayload = {
            metric_date: metricDate,
            total_consultations: updates.total_consultations || 0,
            corrected_consultations: updates.corrected_consultations || 0,
            total_corrections: updates.total_corrections || 0,
            total_uncertainty_flags: updates.total_uncertainty_flags || 0,
            total_missing: updates.total_missing || 0,
            total_hallucinations: updates.total_hallucinations || 0,
            total_inconsistencies: updates.total_inconsistencies || 0,
            total_manual_edits: updates.total_manual_edits || 0,
            total_duration_ms: updates.total_duration_ms || 0,
            total_transcript_tokens: updates.total_transcript_tokens || 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        const { error: insertError } = await client.from('ai_quality_metrics_daily').insert([insertPayload]);
        if (insertError) console.error('Error inserting daily metrics:', insertError);
        return;
    }

    const updatedPayload = {
        total_consultations: (data.total_consultations || 0) + (updates.total_consultations || 0),
        corrected_consultations: (data.corrected_consultations || 0) + (updates.corrected_consultations || 0),
        total_corrections: (data.total_corrections || 0) + (updates.total_corrections || 0),
        total_uncertainty_flags: (data.total_uncertainty_flags || 0) + (updates.total_uncertainty_flags || 0),
        total_missing: (data.total_missing || 0) + (updates.total_missing || 0),
        total_hallucinations: (data.total_hallucinations || 0) + (updates.total_hallucinations || 0),
        total_inconsistencies: (data.total_inconsistencies || 0) + (updates.total_inconsistencies || 0),
        total_manual_edits: (data.total_manual_edits || 0) + (updates.total_manual_edits || 0),
        total_duration_ms: (data.total_duration_ms || 0) + (updates.total_duration_ms || 0),
        total_transcript_tokens: (data.total_transcript_tokens || 0) + (updates.total_transcript_tokens || 0),
        updated_at: new Date().toISOString()
    };

    const { error: updateError } = await client
        .from('ai_quality_metrics_daily')
        .update(updatedPayload)
        .eq('metric_date', metricDate);

    if (updateError) console.error('Error updating daily metrics:', updateError);
};

export const logQualityEvent = async (event: {
    record_id?: string;
    event_type: 'pipeline_completed' | 'doctor_edit' | 'field_confirmation' | 'field_rejection';
    payload: any;
}): Promise<void> => {
    const client = getProtectedSupabase();
    if (!client) return;

    const { error } = await client.from('ai_quality_events').insert([{
        record_id: event.record_id || null,
        event_type: event.event_type,
        payload: event.payload || {},
        created_at: new Date().toISOString()
    }]);

    if (error) {
        console.error('Error logging quality event:', error);
        return;
    }

    const metricDate = new Date().toISOString().slice(0, 10);
    if (event.event_type === 'pipeline_completed') {
        const errorCounts = event.payload?.error_counts || {};
        await upsertDailyMetrics(metricDate, {
            total_consultations: 1,
            corrected_consultations: event.payload?.corrections_applied > 0 ? 1 : 0,
            total_corrections: event.payload?.corrections_applied || 0,
            total_uncertainty_flags: event.payload?.uncertainty_flags || 0,
            total_missing: errorCounts.missing || 0,
            total_hallucinations: errorCounts.hallucination || 0,
            total_inconsistencies: errorCounts.inconsistency || 0,
            total_duration_ms: event.payload?.duration_ms || 0,
            total_transcript_tokens: event.payload?.transcript_tokens || 0
        });
    }

    if (event.event_type === 'doctor_edit') {
        await upsertDailyMetrics(metricDate, { total_manual_edits: 1 });
    }
};

export const saveDoctorSatisfactionEvent = async (entry: {
    score: number;
    record_id?: string;
    audit_id?: string;
    session_id?: string;
    specialty?: string;
    clinician_profile?: string;
    artifact_type?: string;
    feedback_stage?: string;
    feedback_text?: string;
    context?: Record<string, unknown>;
}): Promise<void> => {
    const client = getProtectedSupabase();
    if (!client) return;
    const score = Math.max(1, Math.min(10, Math.round(entry.score)));
    const { error } = await client.from('doctor_satisfaction_events').insert([{
        score,
        record_id: entry.record_id || null,
        audit_id: entry.audit_id || null,
        session_id: entry.session_id || null,
        specialty: entry.specialty || null,
        clinician_profile: entry.clinician_profile || null,
        artifact_type: entry.artifact_type || null,
        feedback_stage: entry.feedback_stage || 'generated',
        feedback_text: entry.feedback_text || null,
        context: entry.context || {},
        created_at: new Date().toISOString()
    }]);
    if (error) console.error('Error saving doctor satisfaction event:', error);
};

export const upsertClinicalGenerationDiagnostic = async (
    entry: ClinicalGenerationDiagnosticEntry
): Promise<string | null> => {
    const client = getProtectedSupabase();
    if (!client) return null;

    const payload = {
        dedupe_key: entry.dedupe_key,
        record_id: entry.record_id || null,
        audit_id: entry.audit_id || null,
        session_id: entry.session_id || null,
        specialty: entry.specialty,
        clinician_profile: entry.clinician_profile || null,
        artifact_type: entry.artifact_type,
        patient_name_snapshot: entry.patient_name_snapshot || null,
        transcription_text: entry.transcription_text || '',
        ai_draft_text: entry.ai_draft_text || '',
        doctor_final_text: entry.doctor_final_text || null,
        doctor_score: typeof entry.doctor_score === 'number'
            ? Math.max(1, Math.min(10, Math.round(entry.doctor_score)))
            : null,
        doctor_feedback_text: entry.doctor_feedback_text || null,
        review_status: entry.review_status || 'pending',
        model_used: entry.model_used || null,
        provider_used: entry.provider_used || null,
        prompt_version: entry.prompt_version || null,
        rule_pack_version: typeof entry.rule_pack_version === 'number' ? entry.rule_pack_version : null,
        rule_ids_used: Array.isArray(entry.rule_ids_used) ? entry.rule_ids_used : [],
        pipeline_status: entry.pipeline_status || null,
        result_status: entry.result_status || null,
        quality_score: typeof entry.quality_score === 'number' ? entry.quality_score : null,
        metadata: entry.metadata || {},
        updated_at: new Date().toISOString()
    };

    const { data, error } = await client
        .from('clinical_generation_diagnostics')
        .upsert([payload], { onConflict: 'dedupe_key' })
        .select('id')
        .maybeSingle();

    if (error) {
        console.error('Error upserting clinical generation diagnostic:', error);
        return null;
    }

    return data?.id || null;
};

export const saveClinicalGenerationDiagnosticEdit = async (
    entry: ClinicalGenerationDiagnosticEditEntry
): Promise<void> => {
    const client = getProtectedSupabase();
    if (!client) return;

    const { error } = await client
        .from('clinical_generation_diagnostic_edits')
        .insert([{
            diagnostic_id: entry.diagnostic_id,
            clinician_profile: entry.clinician_profile || null,
            section_name: entry.section_name || null,
            edit_type: entry.edit_type,
            importance: entry.importance || 'medium',
            edit_source: entry.edit_source || 'manual_save',
            before_text: entry.before_text || null,
            after_text: entry.after_text || null,
            edit_distance_chars: Math.max(0, Number(entry.edit_distance_chars || 0)),
            metadata: entry.metadata || {},
            created_at: new Date().toISOString()
        }]);

    if (error) console.error('Error saving clinical generation diagnostic edit:', error);
};

export const upsertConsultationQualitySummary = async (summary: {
    record_id: string;
    quality_score: number;
    critical_gaps_count: number;
    corrected_count: number;
    clinician_profile?: string;
}): Promise<void> => {
    const client = getProtectedSupabase();
    if (!client || !summary.record_id) return;
    const { error } = await client
        .from('consultation_quality_summary')
        .upsert([{
            record_id: summary.record_id,
            clinician_profile: summary.clinician_profile || null,
            quality_score: Math.max(0, Math.min(100, Math.round(summary.quality_score))),
            critical_gaps_count: Math.max(0, Math.round(summary.critical_gaps_count || 0)),
            corrected_count: Math.max(0, Math.round(summary.corrected_count || 0)),
            created_at: new Date().toISOString()
        }], {
            onConflict: 'record_id'
        });
    if (error) console.error('Error upserting consultation quality summary:', error);
};

// ════════════════════════════════════════════════════════════════
// ERROR LOGGING: Log errors to Supabase for debugging
// ════════════════════════════════════════════════════════════════
export interface ErrorLogEntry {
    message: string;
    stack?: string;
    context?: Record<string, any>;
    source?: string;
    severity?: 'error' | 'warning' | 'info';
    url?: string;
}

export interface AppErrorEvent {
    message: string;
    stack?: string;
    source?: string;
    severity?: 'error' | 'warning' | 'info';
    handled?: boolean;
    session_id?: string;
    route?: string;
    context?: Record<string, any>;
    breadcrumbs?: Array<{
        at: string;
        type: string;
        message: string;
        metadata?: Record<string, unknown>;
    }>;
    user_agent?: string;
    app_version?: string;
    release_channel?: string;
    fingerprint?: string;
}

const buildErrorFingerprint = (event: AppErrorEvent): string => {
    const base = [
        (event.source || '').toLowerCase(),
        (event.message || '').toLowerCase(),
        (event.stack || '').split('\n')[0]?.toLowerCase() || ''
    ].join('|');

    let hash = 2166136261;
    for (let i = 0; i < base.length; i++) {
        hash ^= base.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `err_${(hash >>> 0).toString(16)}`;
};

export const logAppErrorEvent = async (event: AppErrorEvent): Promise<void> => {
    const client = getProtectedSupabase();
    if (!client) return;

    const normalizedEvent = {
        message: event.message,
        stack: event.stack || null,
        source: event.source || 'app',
        severity: event.severity || 'error',
        handled: Boolean(event.handled),
        session_id: event.session_id || null,
        route: event.route || (typeof window !== 'undefined' ? window.location.pathname : null),
        fingerprint: event.fingerprint || buildErrorFingerprint(event),
        context: event.context || {},
        breadcrumbs: event.breadcrumbs || [],
        user_agent: event.user_agent || (typeof navigator !== 'undefined' ? navigator.userAgent : null),
        app_version: event.app_version || (import.meta.env.VITE_APP_VERSION || null),
        release_channel: event.release_channel || (import.meta.env.MODE || 'unknown'),
        created_at: new Date().toISOString()
    };

    try {
        const { error } = await client.from('app_error_events').insert([normalizedEvent]);
        if (error) {
            console.error('[logAppErrorEvent] Failed to log app error:', error);
        }
    } catch (insertError) {
        console.error('[logAppErrorEvent] Exception while logging app error:', insertError);
    }
};

export const logError = async (error: ErrorLogEntry): Promise<void> => {
    const client = getProtectedSupabase();
    if (!client) {
        console.warn('[logError] Supabase not configured, logging to console only:', error);
        return;
    }

    try {
        const { error: insertError } = await client.from('error_logs').insert([{
            message: error.message,
            stack: error.stack || null,
            context: error.context || {},
            source: error.source || 'maria-notes-app',
            severity: error.severity || 'error',
            url: error.url || (typeof window !== 'undefined' ? window.location.href : null),
            created_at: new Date().toISOString()
        }]);

        if (insertError) {
            console.error('[logError] Failed to log error to Supabase:', insertError);
        } else {
            console.log('[logError] Error logged to Supabase:', error.message);
        }

        await logAppErrorEvent({
            message: error.message,
            stack: error.stack,
            source: error.source,
            severity: error.severity,
            handled: true,
            context: error.context
        });
    } catch (e) {
        console.error('[logError] Exception while logging error:', e);
    }
};
