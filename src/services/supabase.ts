import { createClient } from '@supabase/supabase-js';

// These should be environment variables in a real app
// For now, we'll use placeholders that the user needs to fill
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create a dummy client or null if config is missing to prevent crash
export const supabase = (SUPABASE_URL && SUPABASE_KEY && SUPABASE_URL !== 'YOUR_SUPABASE_URL')
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

export interface MedicalRecord {
    id?: string;
    patient_name: string;
    consultation_type: string;
    transcription: string;
    medical_history: string;
    medical_report?: string;
    ai_model?: string;
    created_at?: string;
}

export const saveMedicalRecord = async (record: MedicalRecord) => {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    const { data, error } = await supabase
        .from('medical_records')
        .insert([record])
        .select();

    if (error) throw error;
    return data;
};

export const searchMedicalRecords = async (query: string) => {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('medical_records')
        .select('*')
        .or(`patient_name.ilike.%${query}%,medical_history.ilike.%${query}%`)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
};

export const deleteMedicalRecord = async (id: string): Promise<boolean> => {
    if (!supabase) return false;

    const { error } = await supabase
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
    if (!supabase) return null;

    const { data, error } = await supabase
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
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
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
    if (!supabase || !recordId || meta.length === 0) return;

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
            const { error } = await supabase.from(table).insert(slice);
            if (error) {
                console.error(`[Supabase] Insert failed for ${table}:`, error);
                return;
            }
        }
    };

    await chunkedInsert('ai_chunks', chunkRows, 100);
    await chunkedInsert('ai_field_lineage', evidenceRows, 200);
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
    if (!supabase || !recordId || checks.length === 0) return;

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

    const { error } = await supabase.from('ai_semantic_checks').insert(rows);
    if (error) console.error('Error logging semantic checks:', error);
};

export const saveFieldConfirmation = async (confirmation: {
    record_id?: string;
    field_path: string;
    suggested_value?: string;
    doctor_value?: string;
    confirmed: boolean;
}): Promise<void> => {
    if (!supabase) return;

    const { error } = await supabase.from('ai_field_confirmations').insert([{
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
    if (!supabase) return;

    const { data, error } = await supabase
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
        const { error: insertError } = await supabase.from('ai_quality_metrics_daily').insert([insertPayload]);
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

    const { error: updateError } = await supabase
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
    if (!supabase) return;

    const { error } = await supabase.from('ai_quality_events').insert([{
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
