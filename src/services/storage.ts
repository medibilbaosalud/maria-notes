import {
    db,
    type MedicalRecord,
    type LegacyClinicalRecord,
    type PatientBriefing,
    type LabTestLog,
    type PipelineJob,
    type ConsultationSession,
    type AudioSegment,
    type TranscriptSegment,
    type ExtractionSegment,
    type PipelineFailure,
    type AiLearningEvent,
    type AiImprovementLesson
} from './db';
import { AIService } from './ai';
import { hasSupabaseSession, supabase } from './supabase';
import { isCloudSyncEnabled } from '../hooks/useCloudSync';
import type { ConsultationClassification, ExtractionMeta, ExtractionResult } from './groq';
import { normalizeClinicalSpecialty } from '../clinical/specialties';

export type { MedicalRecord };
export type { LegacyClinicalRecord };
export type { PatientBriefing };
export interface PatientNameSuggestion {
    name: string;
    normalized: string;
    uses: number;
    lastUsedAt: string;
    score: number;
}

export interface PatientTimelineItem {
    id: string;
    source: 'current' | 'legacy';
    patientName: string;
    specialty: string;
    clinicianProfile?: string;
    clinicianName?: string;
    consultationAt: string;
    medicalHistory: string;
    isEditable: boolean;
    sourceLabel: 'Consulta actual' | 'Historico importado';
    sourceEmail?: string;
    recordUuid?: string;
    rawRow?: Record<string, unknown> | null;
}

export interface PatientTimelineGroup {
    patientName: string;
    normalizedPatientName: string;
    latestConsultationAt: string;
    sessionCount: number;
    clinicians: string[];
    specialties: string[];
    sourceCounts: { current: number; legacy: number };
    items: PatientTimelineItem[];
}

export interface PatientCaseSummary {
    patientName: string;
    latestConsultationAt: string;
    sessionCount: number;
    clinicians: string[];
    mainFocus: string;
    recurringTopics: string[];
    openItems: string[];
    sensitiveFlags: string[];
}

const PIPELINE_ARTIFACT_RETENTION_MS = 24 * 60 * 60 * 1000;
const nowIso = () => new Date().toISOString();

const getCloudClient = () => (supabase && isCloudSyncEnabled() && hasSupabaseSession() ? supabase : null);

const normalizeKey = (value: string): string => value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const normalizePatientName = (value: string): string => normalizeKey(value);

const isTechnicalPatientName = (value: string): boolean => {
    const normalized = normalizePatientName(value).toUpperCase();
    return normalized.startsWith('TEST_LAB_') || normalized.startsWith('DIAG_');
};

const displayPsychologyClinician = (value?: string | null): string | undefined => {
    if (!value) return undefined;
    if (value.toLowerCase() === 'ainhoa') return 'Ainhoa';
    if (value.toLowerCase() === 'june') return 'June';
    return value;
};

const normalizePsychologyClinicianProfile = (value?: string | null): string | undefined => {
    const normalized = normalizeKey(String(value || ''));
    if (normalized === 'ainhoa') return 'ainhoa';
    if (normalized === 'june') return 'june';
    return undefined;
};

const getNormalizedTimelineClinician = (item: Pick<PatientTimelineItem, 'clinicianProfile' | 'clinicianName'>): string | undefined => {
    return normalizePsychologyClinicianProfile(item.clinicianProfile || item.clinicianName || undefined);
};

const toIsoString = (value?: string | null): string => {
    const candidate = String(value || '').trim();
    return candidate || nowIso();
};

const cleanText = (value?: string | null): string => String(value || '').replace(/\s+/g, ' ').trim();

const safeRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
};

const generateUuid = (): string => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `uuid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const mapCurrentRecordToTimelineItem = (record: MedicalRecord): PatientTimelineItem => ({
    id: record.record_uuid,
    source: 'current',
    patientName: record.patient_name,
    specialty: normalizeClinicalSpecialty(record.specialty || record.consultation_type),
    clinicianProfile: record.clinician_profile || undefined,
    clinicianName: displayPsychologyClinician(record.clinician_profile),
    consultationAt: toIsoString(record.updated_at || record.created_at),
    medicalHistory: cleanText(record.medical_history),
    isEditable: true,
    sourceLabel: 'Consulta actual',
    recordUuid: record.record_uuid,
    rawRow: null
});

const mapLegacyRecordToTimelineItem = (record: LegacyClinicalRecord): PatientTimelineItem => ({
    id: record.id,
    source: 'legacy',
    patientName: record.patient_name,
    specialty: normalizeClinicalSpecialty(record.specialty || 'psicologia'),
    clinicianProfile: record.clinician_profile || undefined,
    clinicianName: displayPsychologyClinician(record.specialist_name || record.clinician_profile),
    consultationAt: toIsoString(record.consultation_at || record.updated_at || record.created_at),
    medicalHistory: cleanText(record.medical_history),
    isEditable: false,
    sourceLabel: 'Historico importado',
    sourceEmail: record.source_email || undefined,
    rawRow: safeRecord(record.raw_row)
});

const getTimelineSourceDate = (item: PatientTimelineItem): string => toIsoString(item.consultationAt);

const extractSnippetAfterLabel = (text: string, label: string): string => {
    const normalizedText = String(text || '');
    const lower = normalizedText.toLowerCase();
    const index = lower.indexOf(label.toLowerCase());
    if (index < 0) return '';
    const start = index + label.length;
    const remainder = normalizedText.slice(start);
    const nextLabelMatch = remainder.search(/(?:\n\s*\n|##\s|motivo de consulta:|antecedentes relevantes:|antecedentes:|observaciones clinicas:|impresion clinica:|plan terapeutico:|proxima sesion:|próxima sesión:|ot:)/i);
    const snippet = nextLabelMatch > 0 ? remainder.slice(0, nextLabelMatch) : remainder;
    return cleanText(snippet.replace(/^[:\-\s]+/, ''));
};

const stripSectionNoise = (text: string): string => cleanText(text)
    .replace(/^motivo de consulta:\s*/i, '')
    .replace(/^situacion actual:\s*/i, '')
    .replace(/^situación actual:\s*/i, '');

const findExplicitFocus = (text: string): string => {
    const candidates = [
        extractSnippetAfterLabel(text, 'Motivo de consulta:'),
        extractSnippetAfterLabel(text, 'MOTIVO DE CONSULTA'),
        extractSnippetAfterLabel(text, 'Acude a consulta por'),
        extractSnippetAfterLabel(text, 'OT:'),
        extractSnippetAfterLabel(text, 'Objetivos terapéuticos:'),
        extractSnippetAfterLabel(text, 'Objetivos terapeuticos:')
    ].map(stripSectionNoise).filter(Boolean);
    return candidates[0] || '';
};

const TOPIC_KEYWORDS: Array<{ topic: string; keywords: string[] }> = [
    { topic: 'ansiedad', keywords: ['ansiedad', 'ataque de panico', 'pánico', 'panico', 'nerviosismo'] },
    { topic: 'autoestima', keywords: ['autoestima', 'inseguridad', 'inseguridades', 'autoconcepto', 'autovalor'] },
    { topic: 'pareja', keywords: ['pareja', 'relacion', 'relación', 'novio', 'novia', 'divorcio', 'ruptura'] },
    { topic: 'familia', keywords: ['familia', 'madre', 'padre', 'hermana', 'hermano', 'hijo', 'hija'] },
    { topic: 'duelo', keywords: ['duelo', 'fallecio', 'falleció', 'muerte', 'perdida', 'pérdida'] },
    { topic: 'trabajo', keywords: ['trabajo', 'laboral', 'empresa', 'empleo', 'liderando', 'autonomo', 'autónomo'] },
    { topic: 'sueño', keywords: ['sueño', 'sueno', 'insomnio', 'dormir', 'descanso'] },
    { topic: 'consumo', keywords: ['cannabis', 'alcohol', 'cocaína', 'cocaina', 'oh ', 'drog', 'consumo'] },
    { topic: 'regulacion emocional', keywords: ['regulacion emocional', 'regulación emocional', 'gestión emocional', 'gestion emocional'] },
    { topic: 'autocuidado', keywords: ['autocuidado', 'autocuid', 'skincare', 'higiene'] },
    { topic: 'trauma', keywords: ['abuso', 'violencia', 'agres', 'autoles', 'suicid', 'ideac', 'trauma'] }
];

const getMatchedTopics = (text: string): string[] => {
    const lower = normalizeKey(text);
    return TOPIC_KEYWORDS
        .filter(({ keywords }) => keywords.some((keyword) => lower.includes(normalizeKey(keyword))))
        .map(({ topic }) => topic);
};

const getSensitiveFlags = (text: string): string[] => {
    const lower = normalizeKey(text);
    const flags = new Set<string>();
    const addIf = (needle: string, label: string) => {
        if (lower.includes(normalizeKey(needle))) flags.add(label);
    };
    addIf('ideación suicida', 'Ideación suicida');
    addIf('ideacion suicida', 'Ideación suicida');
    addIf('autolesión', 'Autolesión');
    addIf('autolesion', 'Autolesión');
    addIf('abuso sexual', 'Abuso sexual');
    addIf('violencia intrafamiliar', 'Violencia intrafamiliar');
    addIf('cocaína', 'Consumo de cocaína');
    addIf('cocaina', 'Consumo de cocaína');
    addIf('cannabis', 'Consumo de cannabis');
    addIf('alcohol', 'Consumo de alcohol');
    addIf('agresiones verbales', 'Agresiones verbales');
    return Array.from(flags);
};

const getOpenItems = (text: string): string[] => {
    const raw = cleanText(text);
    const candidates = [
        extractSnippetAfterLabel(raw, 'Próxima sesión:'),
        extractSnippetAfterLabel(raw, 'Proxima sesion:'),
        extractSnippetAfterLabel(raw, 'Próximas sesiones:'),
        extractSnippetAfterLabel(raw, 'Objetivos terapéuticos:'),
        extractSnippetAfterLabel(raw, 'Objetivos terapeuticos:'),
        extractSnippetAfterLabel(raw, 'Plan terapéutico:'),
        extractSnippetAfterLabel(raw, 'Plan terapeutico:'),
        extractSnippetAfterLabel(raw, 'OT:')
    ].map(stripSectionNoise).filter(Boolean);
    return Array.from(new Set(candidates)).slice(0, 5);
};

const getBriefingSourceKind = (items: PatientTimelineItem[]): 'current' | 'legacy' | 'mixed' => {
    const hasCurrent = items.some((item) => item.source === 'current');
    const hasLegacy = items.some((item) => item.source === 'legacy');
    if (hasCurrent && hasLegacy) return 'mixed';
    if (hasLegacy) return 'legacy';
    return 'current';
};

const getBriefingRecordIds = (items: PatientTimelineItem[]): string[] => {
    return items
        .map((item) => item.recordUuid || item.id)
        .filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);
};

const getPatientBriefingCandidates = async (
    patientName: string,
    specialty?: string,
    clinician?: string
): Promise<PatientBriefing[]> => {
    const normalizedName = normalizePatientName(patientName || '');
    if (!normalizedName) return [];

    const normalizedSpecialty = specialty ? normalizeClinicalSpecialty(specialty) : null;
    const normalizedClinician = normalizePsychologyClinicianProfile(clinician);
    const rows = await db.patient_briefings
        .where('normalized_patient_name')
        .equals(normalizedName)
        .toArray();

    return rows.filter((briefing) => {
        if (normalizedSpecialty && normalizeClinicalSpecialty(briefing.specialty) !== normalizedSpecialty) return false;
        const briefingClinician = normalizePsychologyClinicianProfile(briefing.clinician_profile || undefined);
        if (normalizedClinician && briefingClinician !== normalizedClinician) return false;
        return true;
    });
};

const isBriefingCurrent = (briefing: PatientBriefing, latestConsultationAt: string): boolean => {
    if (!latestConsultationAt) return briefing.status === 'ready';
    return toIsoString(briefing.latest_consultation_at || '') >= toIsoString(latestConsultationAt);
};

const createBriefingClient = () => new AIService();

const mapTimelineForBriefing = (items: PatientTimelineItem[]) => items.slice(0, 12).map((item) => ({
    id: item.id,
    source: item.source,
    patientName: item.patientName,
    specialty: item.specialty,
    clinicianProfile: item.clinicianProfile,
    clinicianName: item.clinicianName,
    consultationAt: item.consultationAt,
    medicalHistory: item.medicalHistory
}));

const normalizeBriefingSummaryText = (value: string): string => String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

const buildCaseSummaryFromTimeline = (patientName: string, items: PatientTimelineItem[]): PatientCaseSummary => {
    const sorted = [...items].sort((a, b) => getTimelineSourceDate(b).localeCompare(getTimelineSourceDate(a)));
    const latest = sorted[0];
    const topicCounter = new Map<string, number>();
    const openItemSet = new Set<string>();
    const sensitiveSet = new Set<string>();
    const clinicians = new Set<string>();

    sorted.forEach((item) => {
        if (item.clinicianName) clinicians.add(item.clinicianName);
        const topics = getMatchedTopics(item.medicalHistory);
        topics.forEach((topic) => {
            topicCounter.set(topic, (topicCounter.get(topic) || 0) + 1);
        });
        getOpenItems(item.medicalHistory).forEach((value) => openItemSet.add(value));
        getSensitiveFlags(item.medicalHistory).forEach((value) => sensitiveSet.add(value));
    });

    const recurringTopics = Array.from(topicCounter.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([topic]) => topic)
        .slice(0, 4);

    const latestFocus = latest ? findExplicitFocus(latest.medicalHistory) : '';
    const mainFocus = latestFocus || recurringTopics[0] || 'Sin foco claro en la nota';

    return {
        patientName,
        latestConsultationAt: latest ? latest.consultationAt : '',
        sessionCount: sorted.length,
        clinicians: Array.from(clinicians),
        mainFocus,
        recurringTopics,
        openItems: Array.from(openItemSet).slice(0, 5),
        sensitiveFlags: Array.from(sensitiveSet).slice(0, 5)
    };
};

const buildPatientGroups = (items: PatientTimelineItem[]): PatientTimelineGroup[] => {
    const groups = new Map<string, PatientTimelineGroup>();

    items.forEach((item) => {
        const normalizedPatientName = normalizePatientName(item.patientName);
        if (!normalizedPatientName) return;
        const existing = groups.get(normalizedPatientName);
        const nextItems = existing ? [...existing.items, item] : [item];
        const sortedItems = nextItems.sort((a, b) => getTimelineSourceDate(b).localeCompare(getTimelineSourceDate(a)));
        const clinicians = new Set<string>(existing?.clinicians || []);
        const specialties = new Set<string>(existing?.specialties || []);
        if (item.clinicianName) clinicians.add(item.clinicianName);
        specialties.add(item.specialty);

        const sourceCounts = existing?.sourceCounts || { current: 0, legacy: 0 };
        sourceCounts[item.source] += 1;

        groups.set(normalizedPatientName, {
            patientName: sortedItems[0]?.patientName || item.patientName,
            normalizedPatientName,
            latestConsultationAt: sortedItems[0]?.consultationAt || item.consultationAt,
            sessionCount: sortedItems.length,
            clinicians: Array.from(clinicians),
            specialties: Array.from(specialties),
            sourceCounts,
            items: sortedItems
        });
    });

    return Array.from(groups.values()).sort((a, b) => b.latestConsultationAt.localeCompare(a.latestConsultationAt));
};

// Map Dexie MedicalRecord fields to Supabase column names.
// Dexie uses record_uuid / original_medical_history / audit_id / idempotency_key / updated_at.
// Supabase canonical schema uses record_uuid as deterministic sync key.
// Supabase canonical schema uses 'id' as primary key (uuid).
// We map local 'record_uuid' to Supabase 'id'.
const toCloudRecord = (record: MedicalRecord) => {
    return {
        id: record.record_uuid, // Map local record_uuid to Supabase id
        record_uuid: record.record_uuid,
        audit_id: record.audit_id || null,
        idempotency_key: record.idempotency_key || null,
        patient_name: record.patient_name,
        consultation_type: record.consultation_type,
        specialty: record.specialty || record.consultation_type,
        clinician_profile: record.clinician_profile || null,
        transcription: record.transcription,
        medical_history: record.medical_history,
        original_medical_history: record.original_medical_history || null,
        medical_report: record.medical_report || null,
        ai_model: record.ai_model || null,
        output_tier: record.output_tier || null,
        supersedes_record_uuid: record.supersedes_record_uuid || null,
        source_session_id: record.source_session_id || null,
        critical_path_ms: typeof record.critical_path_ms === 'number' ? record.critical_path_ms : null,
        hardening_ms: typeof record.hardening_ms === 'number' ? record.hardening_ms : null,
        created_at: record.created_at,
        updated_at: record.updated_at || record.created_at
    };
};

// Helper to sync a record to Supabase (fire-and-forget)
const syncToCloud = async (record: MedicalRecord, operation: 'insert' | 'update' | 'delete') => {
    const client = getCloudClient();
    if (!client) return;

    try {
        if (operation === 'insert' || operation === 'update') {
            const cloudRecord = toCloudRecord(record);
            const { error } = await client
                .from('medical_records')
                .upsert([cloudRecord], { onConflict: 'record_uuid' });
            if (error) {
                console.error(`[Cloud Sync] Upsert error (${operation}):`, error.message, error.details);
                throw error;
            }
            console.log(`[Cloud Sync] Record ${operation === 'insert' ? 'inserted' : 'updated'}:`, cloudRecord.id);
        } else if (operation === 'delete') {
            const { error } = await client.from('medical_records')
                .delete()
                .eq('id', record.record_uuid);
            if (error) {
                console.error('[Cloud Sync] Delete error:', error.message);
                throw error;
            }
            console.log('[Cloud Sync] Record deleted:', record.record_uuid);
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

export const saveAiLearningEvent = async (event: Omit<AiLearningEvent, 'id'>): Promise<number | null> => {
    try {
        const now = nowIso();
        const localEvent = { ...event, created_at: now, updated_at: now };
        const id = await db.ai_learning_events.add(localEvent);

        const client = getCloudClient();
        if (client) {
            const { error } = await client.from('ai_learning_events').insert([event]);
            if (error) console.error('[Cloud Sync] AiLearningEvent insert error:', error.message);
        }
        return id ?? null;
    } catch (error) {
        console.error('Error saving AiLearningEvent:', error);
        return null;
    }
};

export const saveAiImprovementLesson = async (lesson: Omit<AiImprovementLesson, 'id'>): Promise<number | null> => {
    try {
        const now = nowIso();
        const localLesson = { ...lesson, created_at: now, updated_at: now };
        const id = await db.ai_improvement_lessons.add(localLesson);

        const client = getCloudClient();
        if (client) {
            const { error } = await client.from('ai_improvement_lessons').insert([lesson]);
            if (error) console.error('[Cloud Sync] AiImprovementLesson insert error:', error.message);
        }
        return id ?? null;
    } catch (error) {
        console.error('Error saving AiImprovementLesson:', error);
        return null;
    }
};

export const saveMedicalRecord = async (
    record: Omit<MedicalRecord, 'id' | 'created_at' | 'record_uuid' | 'updated_at'> & {
        record_uuid?: string;
        ai_model?: string;
        idempotency_key?: string;
        output_tier?: 'draft' | 'final';
        supersedes_record_uuid?: string;
        source_session_id?: string;
        critical_path_ms?: number;
        hardening_ms?: number;
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

const upsertPatientBriefingToCloud = async (briefing: PatientBriefing): Promise<void> => {
    const client = getCloudClient();
    if (!client) return;

    const { owner_user_id: _ownerUserId, ...payload } = briefing;
    const { error } = await client
        .from('patient_briefings')
        .upsert([payload], {
            onConflict: 'owner_user_id,normalized_patient_name,specialty,clinician_scope'
        });
    if (error) {
        console.error('[Cloud Sync] patient_briefings upsert error:', error.message);
    }
};

const normalizeBriefingRow = (briefing: PatientBriefing): PatientBriefing => ({
    ...briefing,
    normalized_patient_name: normalizePatientName(briefing.normalized_patient_name || briefing.patient_name),
    patient_name: cleanText(briefing.patient_name) || 'Sin nombre',
    specialty: normalizeClinicalSpecialty(briefing.specialty || 'psicologia'),
    clinician_profile: normalizePsychologyClinicianProfile(briefing.clinician_profile || undefined) || briefing.clinician_profile || null,
    clinician_name: displayPsychologyClinician(briefing.clinician_name || briefing.clinician_profile || undefined) || briefing.clinician_name || null,
    source_kind: briefing.source_kind === 'legacy' || briefing.source_kind === 'mixed' ? briefing.source_kind : 'current',
    summary_text: normalizeBriefingSummaryText(briefing.summary_text || ''),
    latest_consultation_at: toIsoString(briefing.latest_consultation_at),
    generated_from_count: Math.max(0, Number(briefing.generated_from_count || 0) || 0),
    generated_from_record_ids: Array.isArray(briefing.generated_from_record_ids)
        ? Array.from(new Set(briefing.generated_from_record_ids.map((value) => String(value || '').trim()).filter(Boolean)))
        : [],
    model: cleanText(briefing.model || '') || 'unknown',
    status: briefing.status === 'failed' || briefing.status === 'stale' ? briefing.status : 'ready',
    created_at: toIsoString(briefing.created_at),
    updated_at: toIsoString(briefing.updated_at || briefing.created_at)
});

export const savePatientBriefing = async (briefing: PatientBriefing): Promise<PatientBriefing | null> => {
    try {
        const now = nowIso();
        const normalized = normalizeBriefingRow({
            ...briefing,
            created_at: briefing.created_at || now,
            updated_at: now
        });
        await db.patient_briefings.put(normalized);
        await upsertPatientBriefingToCloud(normalized);
        return normalized;
    } catch (error) {
        console.error('Error saving patient briefing:', error);
        return null;
    }
};

export const getPatientBriefing = async (
    patientName: string,
    specialty?: string,
    clinician?: string
): Promise<PatientBriefing | null> => {
    try {
        const normalizedName = normalizePatientName(patientName || '');
        if (!normalizedName) return null;

        const timeline = await getPatientTimeline(patientName, specialty, clinician);
        const latestConsultationAt = timeline[0]?.consultationAt || '';
        const candidates = await getPatientBriefingCandidates(patientName, specialty, clinician);
        const readyCandidates = candidates
            .filter((briefing) => briefing.status === 'ready')
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        const current = readyCandidates.find((briefing) => isBriefingCurrent(briefing, latestConsultationAt));
        return current || null;
    } catch (error) {
        console.error('Error getting patient briefing:', error);
        return null;
    }
};

export const getMedicalRecordByUuid = async (recordUuid: string): Promise<MedicalRecord | null> => {
    try {
        if (!recordUuid) return null;
        return await db.medical_records.where('record_uuid').equals(recordUuid).first() || null;
    } catch (error) {
        console.error('Error getting medical record by uuid:', error);
        return null;
    }
};

export const markPatientBriefingStale = async (
    patientName: string,
    specialty?: string,
    clinician?: string
): Promise<PatientBriefing | null> => {
    try {
        const timeline = await getPatientTimeline(patientName, specialty, clinician);
        if (!timeline.length) return null;

        const normalizedName = normalizePatientName(patientName || '');
        const latestConsultationAt = timeline[0]?.consultationAt || nowIso();
        const sourceKind = getBriefingSourceKind(timeline);
        const recordIds = getBriefingRecordIds(timeline);
        const candidates = await getPatientBriefingCandidates(patientName, specialty, clinician);
        const existing = candidates.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        const staleRow: PatientBriefing = normalizeBriefingRow({
            id: existing?.id || generateUuid(),
            owner_user_id: existing?.owner_user_id || null,
            normalized_patient_name: normalizedName,
            patient_name: timeline[0]?.patientName || patientName,
            specialty: normalizeClinicalSpecialty(specialty || timeline[0]?.specialty || 'psicologia'),
            clinician_profile: normalizePsychologyClinicianProfile(clinician || timeline[0]?.clinicianProfile || undefined) || existing?.clinician_profile || null,
            clinician_name: displayPsychologyClinician(clinician || timeline[0]?.clinicianName || existing?.clinician_name || undefined) || existing?.clinician_name || null,
            source_kind: sourceKind,
            summary_text: existing?.summary_text || '',
            latest_consultation_at: latestConsultationAt,
            generated_from_count: timeline.length,
            generated_from_record_ids: recordIds,
            model: existing?.model || 'pending',
            status: 'stale',
            created_at: existing?.created_at || nowIso(),
            updated_at: nowIso()
        });

        await db.patient_briefings.put(staleRow);
        await upsertPatientBriefingToCloud(staleRow);
        return staleRow;
    } catch (error) {
        console.error('Error marking patient briefing stale:', error);
        return null;
    }
};

export const ensurePatientBriefing = async (
    patientName: string,
    specialty?: string,
    clinician?: string
): Promise<PatientBriefing | null> => {
    try {
        const timeline = await getPatientTimeline(patientName, specialty, clinician);
        if (!timeline.length) return null;

        const latestConsultationAt = timeline[0]?.consultationAt || '';
        const candidates = await getPatientBriefingCandidates(patientName, specialty, clinician);
        const latestCandidate = candidates.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        if (latestCandidate?.status === 'failed') {
            return null;
        }

        const currentReady = candidates
            .filter((briefing) => briefing.status === 'ready')
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .find((briefing) => isBriefingCurrent(briefing, latestConsultationAt));
        if (currentReady) {
            return currentReady;
        }

        const sourceKind = getBriefingSourceKind(timeline);
        const shouldGenerate = Boolean(
            sourceKind === 'legacy'
            || candidates.some((briefing) => briefing.status === 'stale')
            || (latestCandidate && latestCandidate.status === 'ready' && !isBriefingCurrent(latestCandidate, latestConsultationAt))
        );
        if (!shouldGenerate) {
            return null;
        }

        const aiService = createBriefingClient();
        const briefingResult = await aiService.generatePatientBriefing(
            timeline[0]?.patientName || patientName,
            normalizeClinicalSpecialty(specialty || timeline[0]?.specialty || 'psicologia'),
            clinician || timeline[0]?.clinicianProfile || timeline[0]?.clinicianName,
            mapTimelineForBriefing(timeline)
        );

        const generated: PatientBriefing = normalizeBriefingRow({
            id: latestCandidate?.id || generateUuid(),
            owner_user_id: latestCandidate?.owner_user_id || null,
            normalized_patient_name: normalizePatientName(patientName || timeline[0]?.patientName || ''),
            patient_name: timeline[0]?.patientName || patientName || 'Sin nombre',
            specialty: normalizeClinicalSpecialty(specialty || timeline[0]?.specialty || 'psicologia'),
            clinician_profile: normalizePsychologyClinicianProfile(clinician || timeline[0]?.clinicianProfile || undefined) || latestCandidate?.clinician_profile || null,
            clinician_name: displayPsychologyClinician(clinician || timeline[0]?.clinicianName || latestCandidate?.clinician_name || undefined) || latestCandidate?.clinician_name || null,
            source_kind: sourceKind,
            summary_text: briefingResult.data,
            latest_consultation_at: latestConsultationAt,
            generated_from_count: timeline.length,
            generated_from_record_ids: getBriefingRecordIds(timeline),
            model: briefingResult.model,
            status: 'ready',
            created_at: latestCandidate?.created_at || nowIso(),
            updated_at: nowIso()
        });

        await db.patient_briefings.put(generated);
        await upsertPatientBriefingToCloud(generated);
        return generated;
    } catch (error) {
        try {
            const timeline = await getPatientTimeline(patientName, specialty, clinician);
            if (!timeline.length) return null;
            const latestConsultationAt = timeline[0]?.consultationAt || nowIso();
            const candidates = await getPatientBriefingCandidates(patientName, specialty, clinician);
            const latestCandidate = candidates.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
            const failedRow: PatientBriefing = normalizeBriefingRow({
                id: latestCandidate?.id || generateUuid(),
                owner_user_id: latestCandidate?.owner_user_id || null,
                normalized_patient_name: normalizePatientName(patientName || timeline[0]?.patientName || ''),
                patient_name: timeline[0]?.patientName || patientName || 'Sin nombre',
                specialty: normalizeClinicalSpecialty(specialty || timeline[0]?.specialty || 'psicologia'),
                clinician_profile: normalizePsychologyClinicianProfile(clinician || timeline[0]?.clinicianProfile || undefined) || latestCandidate?.clinician_profile || null,
                clinician_name: displayPsychologyClinician(clinician || timeline[0]?.clinicianName || latestCandidate?.clinician_name || undefined) || latestCandidate?.clinician_name || null,
                source_kind: getBriefingSourceKind(timeline),
                summary_text: '',
                latest_consultation_at: latestConsultationAt,
                generated_from_count: timeline.length,
                generated_from_record_ids: getBriefingRecordIds(timeline),
                model: 'groq:briefing',
                status: 'failed',
                created_at: latestCandidate?.created_at || nowIso(),
                updated_at: nowIso()
            });
            await db.patient_briefings.put(failedRow);
            await upsertPatientBriefingToCloud(failedRow);
        } catch (secondaryError) {
            console.error('Error storing failed patient briefing:', secondaryError);
        }
        console.error('Error ensuring patient briefing:', error);
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

const getAllUnifiedTimelineItems = async (): Promise<PatientTimelineItem[]> => {
    const [currentRecords, legacyRecords] = await Promise.all([
        db.medical_records.orderBy('updated_at').reverse().toArray(),
        db.legacy_clinical_records.orderBy('updated_at').reverse().toArray()
    ]);

    return [
        ...currentRecords.map(mapCurrentRecordToTimelineItem),
        ...legacyRecords.map(mapLegacyRecordToTimelineItem)
    ].filter((item) => Boolean(cleanText(item.patientName)));
};

export const searchPatientTimeline = async (query: string, specialty?: string, clinician?: string): Promise<PatientTimelineGroup[]> => {
    try {
        const normalizedQuery = normalizePatientName(query || '');
        const normalizedSpecialty = specialty ? normalizeClinicalSpecialty(specialty) : null;
        const normalizedClinician = clinician ? normalizePsychologyClinicianProfile(clinician) : undefined;
        const allItems = await getAllUnifiedTimelineItems();
        const filteredItems = allItems.filter((item) => {
            if (normalizedSpecialty && normalizeClinicalSpecialty(item.specialty) !== normalizedSpecialty) {
                return false;
            }
            if (normalizedClinician && normalizedSpecialty === 'psicologia') {
                const itemClinician = getNormalizedTimelineClinician(item);
                if (itemClinician !== normalizedClinician) return false;
            }
            if (!normalizedQuery) return true;
            const haystack = normalizeKey([
                item.patientName,
                item.medicalHistory,
                item.clinicianName || '',
                item.sourceEmail || ''
            ].join(' '));
            return haystack.includes(normalizedQuery);
        });

        return buildPatientGroups(filteredItems);
    } catch (error) {
        console.error('Error searching patient timeline:', error);
        return [];
    }
};

export const getPatientTimeline = async (
    patientName: string,
    specialty?: string,
    clinician?: string
): Promise<PatientTimelineItem[]> => {
    try {
        const normalizedName = normalizePatientName(patientName || '');
        if (!normalizedName) return [];
        const normalizedSpecialty = specialty ? normalizeClinicalSpecialty(specialty) : null;
        const normalizedClinician = clinician ? normalizePatientName(clinician) : '';
        const items = await getAllUnifiedTimelineItems();
        return items
            .filter((item) => {
                if (normalizePatientName(item.patientName) !== normalizedName) return false;
                if (normalizedSpecialty && normalizeClinicalSpecialty(item.specialty) !== normalizedSpecialty) {
                    return false;
                }
                if (normalizedClinician && normalizedSpecialty === 'psicologia') {
                    const itemClinician = getNormalizedTimelineClinician(item);
                    if (itemClinician !== normalizedClinician) return false;
                }
                return true;
            })
            .sort((a, b) => {
                const dateComparison = getTimelineSourceDate(b).localeCompare(getTimelineSourceDate(a));
                if (dateComparison !== 0) return dateComparison;
                if (!normalizedClinician) return 0;
                const aMatch = normalizePatientName(a.clinicianName || '') === normalizedClinician;
                const bMatch = normalizePatientName(b.clinicianName || '') === normalizedClinician;
                if (aMatch === bMatch) return 0;
                return bMatch ? 1 : -1;
            });
    } catch (error) {
        console.error('Error getting patient timeline:', error);
        return [];
    }
};

export const buildPsychologyCaseSummary = async (
    patientName: string,
    clinician?: string
): Promise<PatientCaseSummary | null> => {
    try {
        const timeline = await getPatientTimeline(patientName, 'psicologia', clinician);
        if (!timeline.length) return null;
        return buildCaseSummaryFromTimeline(patientName, timeline);
    } catch (error) {
        console.error('Error building psychology case summary:', error);
        return null;
    }
};

export const getPatientNameSuggestions = async (
    query: string,
    limit: number = 8
): Promise<PatientNameSuggestion[]> => {
    try {
        const normalizedQuery = normalizePatientName(query);
        const rows = await getAllUnifiedTimelineItems();
        const buckets = new Map<string, PatientNameSuggestion>();

        rows.forEach((record, index) => {
            const rawName = (record.patientName || '').trim();
            if (!rawName || isTechnicalPatientName(rawName)) return;

            const normalizedName = normalizePatientName(rawName);
            if (!normalizedName) return;

            const lastUsedAt = record.consultationAt || nowIso();
            const recencyBonus = Math.max(0, 80 - index);
            const baseScore = normalizedQuery
                ? normalizedName === normalizedQuery
                    ? 1000
                    : normalizedName.startsWith(normalizedQuery)
                        ? 350
                        : normalizedName.includes(normalizedQuery)
                            ? 120
                            : 0
                : 40;

            if (normalizedQuery && baseScore === 0) return;

            const current = buckets.get(normalizedName);
            if (!current) {
                buckets.set(normalizedName, {
                    name: rawName,
                    normalized: normalizedName,
                    uses: 1,
                    lastUsedAt,
                    score: baseScore + recencyBonus + 10
                });
                return;
            }

            current.uses += 1;
            if (lastUsedAt > current.lastUsedAt) {
                current.lastUsedAt = lastUsedAt;
                current.name = rawName;
            }
            current.score = Math.max(current.score, baseScore + recencyBonus) + 10;
        });

        return Array.from(buckets.values())
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (b.lastUsedAt !== a.lastUsedAt) return b.lastUsedAt.localeCompare(a.lastUsedAt);
                return a.name.localeCompare(b.name);
            })
            .slice(0, Math.max(1, limit));
    } catch (error) {
        console.error('Error getting patient suggestions:', error);
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
        const [medicalResult, historyResult, legacyResult, briefingResult] = await Promise.all([
            client
                .from('medical_records')
                .select('*')
                .order('created_at', { ascending: false }),
            client
                .from('consultation_histories')
                .select('*')
                .order('created_at', { ascending: false }),
            client
                .from('legacy_clinical_records')
                .select('*')
                .order('consultation_at', { ascending: false }),
            client
                .from('patient_briefings')
                .select('*')
                .order('updated_at', { ascending: false })
        ]);

        const cloudRecords = medicalResult.data || [];
        const cloudHistories = historyResult.data || [];
        const cloudLegacyRecords = legacyResult.data || [];
        const cloudBriefings = briefingResult.data || [];

        if (medicalResult.error) {
            console.error('[Cloud Sync] Fetch failed:', medicalResult.error);
            return 0;
        }
        if (historyResult.error) {
            console.warn('[Cloud Sync] consultation_histories fetch failed:', historyResult.error.message);
        }
        if (legacyResult.error) {
            console.warn('[Cloud Sync] legacy_clinical_records fetch failed:', legacyResult.error.message);
        }
        if (briefingResult.error) {
            console.warn('[Cloud Sync] patient_briefings fetch failed:', briefingResult.error.message);
        }

        const localRecords = await db.medical_records.toArray();
        const localByUuid = new Map(localRecords.map(r => [r.record_uuid, r]));
        const knownAuditIds = new Set(localRecords.map((record) => String(record.audit_id || '').trim()).filter(Boolean));
        const localLegacyRecords = await db.legacy_clinical_records.toArray();
        const localLegacyById = new Map(localLegacyRecords.map((record) => [record.id, record]));
        const localBriefings = await db.patient_briefings.toArray();
        const localBriefingsById = new Map(localBriefings.map((record) => [record.id, record]));

        const newRecords: any[] = [];
        const newLegacyRecords: LegacyClinicalRecord[] = [];
        const newBriefings: PatientBriefing[] = [];
        let addedCount = 0;

        for (const cloudRec of cloudRecords) {
            const cloudUuid = String(cloudRec.record_uuid || cloudRec.uuid || cloudRec.id || '');
            if (!cloudUuid) continue;

            const local = localByUuid.get(cloudUuid);
            const cloudUpdatedAt = cloudRec.updated_at || cloudRec.created_at || '';
            const localUpdatedAt = local?.updated_at || local?.created_at || '';

            if (!local) {
                const { id, ...recordToInsert } = cloudRec;
                newRecords.push({
                    ...recordToInsert,
                    audit_id: cloudRec.audit_id || null,
                    idempotency_key: cloudRec.idempotency_key || null,
                    specialty: cloudRec.specialty || cloudRec.consultation_type || 'otorrino',
                    clinician_profile: cloudRec.clinician_profile || null,
                    record_uuid: cloudUuid,
                    updated_at: cloudUpdatedAt || new Date().toISOString()
                });
                if (cloudRec.audit_id) {
                    knownAuditIds.add(String(cloudRec.audit_id));
                }
                addedCount++;
                continue;
            }

            if (cloudUpdatedAt && localUpdatedAt && cloudUpdatedAt > localUpdatedAt) {
                const { id, ...cloudRecordWithoutId } = cloudRec;
                await db.medical_records.update(local.id!, {
                    ...cloudRecordWithoutId,
                    audit_id: cloudRec.audit_id || null,
                    idempotency_key: cloudRec.idempotency_key || null,
                    specialty: cloudRec.specialty || cloudRec.consultation_type || local.specialty || 'otorrino',
                    clinician_profile: cloudRec.clinician_profile || local.clinician_profile || null,
                    record_uuid: cloudUuid,
                    updated_at: cloudUpdatedAt
                });
                if (cloudRec.audit_id) {
                    knownAuditIds.add(String(cloudRec.audit_id));
                }
            }
        }

        for (const history of cloudHistories) {
            const auditId = String(history.audit_id || '').trim();
            if (!auditId || knownAuditIds.has(auditId)) continue;

            const syntheticUuid = String(history.record_uuid || `hist_${auditId}`);
            if (!syntheticUuid || localByUuid.has(syntheticUuid)) continue;

            const patientName = String(history.name || history.patient_name || 'Sin nombre').trim() || 'Sin nombre';
            const historyText = String(history.medical_history || '');
            const createdAt = String(history.created_at || nowIso());

            newRecords.push({
                record_uuid: syntheticUuid,
                idempotency_key: `history_${auditId}`,
                patient_name: patientName,
                consultation_type: String(history.consultation_type || history.specialty || 'Historia'),
                specialty: normalizeClinicalSpecialty(history.specialty || history.consultation_type || history.medical_history),
                clinician_profile: String(history.clinician_profile || '') || null,
                transcription: '',
                medical_history: historyText,
                original_medical_history: historyText,
                ai_model: String(history.primary_model || ''),
                audit_id: auditId,
                output_tier: 'final',
                created_at: createdAt,
                updated_at: createdAt
            });
            localByUuid.set(syntheticUuid, {} as MedicalRecord);
            knownAuditIds.add(auditId);
            addedCount++;
        }

        for (const legacy of cloudLegacyRecords) {
            const legacyId = String(legacy.id || legacy.dedupe_key || '').trim();
            if (!legacyId) continue;
            const consultationAt = String(legacy.consultation_at || legacy.created_at || legacy.updated_at || nowIso());
            const updatedAt = String(legacy.updated_at || legacy.created_at || consultationAt || nowIso());
            const normalizedLegacy: LegacyClinicalRecord = {
                id: legacyId,
                dedupe_key: String(legacy.dedupe_key || legacyId),
                source_csv: legacy.source_csv || null,
                import_batch: legacy.import_batch || null,
                source_row_id: typeof legacy.source_row_id === 'number' ? legacy.source_row_id : Number(legacy.source_row_id || 0) || null,
                source_email: legacy.source_email || null,
                specialist_name: legacy.specialist_name || null,
                clinician_profile: legacy.clinician_profile || null,
                specialty: legacy.specialty || null,
                external_contact_id: legacy.external_contact_id || null,
                patient_name: String(legacy.patient_name || 'Sin nombre').trim() || 'Sin nombre',
                consultation_at: consultationAt,
                medical_history: String(legacy.medical_history || ''),
                original_medical_history: legacy.original_medical_history || legacy.medical_history || '',
                raw_row: safeRecord(legacy.raw_row) || legacy.raw_row || null,
                created_at: String(legacy.created_at || consultationAt),
                updated_at: updatedAt
            };
            const localLegacy = localLegacyById.get(legacyId);
            if (!localLegacy) {
                newLegacyRecords.push(normalizedLegacy);
                localLegacyById.set(legacyId, normalizedLegacy);
                addedCount++;
                continue;
            }
            const existingUpdatedAt = localLegacy.updated_at || localLegacy.consultation_at || '';
            if (updatedAt > existingUpdatedAt) {
                await db.legacy_clinical_records.put(normalizedLegacy);
                localLegacyById.set(legacyId, normalizedLegacy);
            }
        }

        for (const briefing of cloudBriefings) {
            const briefingId = String(briefing.id || '').trim();
            if (!briefingId) continue;

            const normalizedBriefing = normalizeBriefingRow({
                id: briefingId,
                owner_user_id: briefing.owner_user_id || null,
                normalized_patient_name: briefing.normalized_patient_name || briefing.patient_name || '',
                patient_name: briefing.patient_name || 'Sin nombre',
                specialty: briefing.specialty || 'psicologia',
                clinician_profile: briefing.clinician_profile || null,
                clinician_name: briefing.clinician_name || null,
                source_kind: briefing.source_kind || 'current',
                summary_text: briefing.summary_text || '',
                latest_consultation_at: briefing.latest_consultation_at || briefing.updated_at || briefing.created_at || nowIso(),
                generated_from_count: typeof briefing.generated_from_count === 'number'
                    ? briefing.generated_from_count
                    : Number(briefing.generated_from_count || 0) || 0,
                generated_from_record_ids: Array.isArray(briefing.generated_from_record_ids)
                    ? briefing.generated_from_record_ids
                        .map((value: string) => String(value || '').trim())
                        .filter(Boolean)
                    : [],
                model: briefing.model || 'unknown',
                status: briefing.status || 'ready',
                created_at: briefing.created_at || briefing.updated_at || nowIso(),
                updated_at: briefing.updated_at || briefing.created_at || nowIso()
            });

            const localBriefing = localBriefingsById.get(briefingId);
            if (!localBriefing) {
                newBriefings.push(normalizedBriefing);
                localBriefingsById.set(briefingId, normalizedBriefing);
                addedCount++;
                continue;
            }

            const existingUpdatedAt = localBriefing.updated_at || localBriefing.created_at || '';
            if ((normalizedBriefing.updated_at || '') > existingUpdatedAt) {
                await db.patient_briefings.put(normalizedBriefing);
                localBriefingsById.set(briefingId, normalizedBriefing);
            }
        }

        if (newRecords.length > 0) {
            await db.medical_records.bulkAdd(newRecords);
        }

        if (newLegacyRecords.length > 0) {
            await db.legacy_clinical_records.bulkPut(newLegacyRecords);
        }

        if (newBriefings.length > 0) {
            await db.patient_briefings.bulkPut(newBriefings);
        }

        if (newRecords.length > 0 || newLegacyRecords.length > 0 || newBriefings.length > 0) {
            console.log(`[Cloud Sync] Imported ${newRecords.length} records, ${newLegacyRecords.length} legacy records and ${newBriefings.length} briefings from cloud.`);
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
    session_version?: number;
    status?: SegmentStatus;
    is_final?: boolean;
    blob?: Blob;
    text?: string;
    part_index?: number;
    attempt_id?: string;
    latency_ms?: number;
    model_used?: string;
    extraction?: ExtractionResult;
    classification?: ConsultationClassification;
    meta?: ExtractionMeta[];
    retry_count?: number;
    next_attempt_at?: string;
    error_reason?: string;
}): Promise<void> => {
    const now = nowIso();
    const session = await db.consultation_sessions.where('session_id').equals(segment.session_id).first();
    const currentSessionVersion = Number((session?.metadata as { session_version?: number } | undefined)?.session_version || 0);
    if (typeof segment.session_version === 'number' && currentSessionVersion > segment.session_version) {
        return;
    }
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
            part_index: typeof segment.part_index === 'number' ? segment.part_index : existing?.part_index,
            attempt_id: segment.attempt_id || existing?.attempt_id,
            latency_ms: typeof segment.latency_ms === 'number' ? segment.latency_ms : existing?.latency_ms,
            model_used: segment.model_used || existing?.model_used,
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
    session_version?: number;
    status: SegmentStatus;
    error_reason?: string;
    retry_count?: number;
    next_attempt_at?: string;
}): Promise<void> => {
    const now = nowIso();
    const session = await db.consultation_sessions.where('session_id').equals(update.session_id).first();
    const currentSessionVersion = Number((session?.metadata as { session_version?: number } | undefined)?.session_version || 0);
    if (typeof update.session_version === 'number' && currentSessionVersion > update.session_version) {
        return;
    }
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
            .anyOf('recording', 'uploading_chunks', 'transcribing_partial', 'transcribing_live', 'extracting', 'draft_ready', 'hardening', 'finalizing', 'awaiting_budget', 'provisional')
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
        .anyOf('recording', 'uploading_chunks', 'transcribing_partial', 'transcribing_live', 'extracting', 'draft_ready', 'hardening', 'finalizing', 'awaiting_budget', 'provisional')
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

    const active = sessions.filter((s) => ['recording', 'uploading_chunks', 'transcribing_partial', 'transcribing_live', 'extracting', 'draft_ready', 'hardening', 'finalizing', 'awaiting_budget'].includes(s.status)).length;
    const provisional = sessions.filter((s) => s.status === 'provisional').length;
    const deadLetters = outbox.filter((item) => item.status === 'dead_letter').length;
    const nextAttempt = sessions
        .map((s) => s.next_attempt_at)
        .filter((value): value is string => Boolean(value))
        .sort()[0];
    const pipelineFailures = failures.filter((failure) => failure.stage !== 'cloud_sync');
    const cloudSyncFailures = failures.filter((failure) => failure.stage === 'cloud_sync');

    return {
        active_sessions: active,
        provisional_sessions: provisional,
        dead_letters: deadLetters,
        next_attempt_at: nextAttempt || null,
        recent_failures: pipelineFailures,
        cloud_sync_failures: cloudSyncFailures.length
    };
};
