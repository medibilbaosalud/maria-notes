import { supabase } from './supabase';
import { getTaskModels } from './model-registry';
import { GroqService } from './groq';
import { computeConfidenceScore, deriveDecisionType, resolveNextLifecycleState } from './learning/rule-lifecycle';
import {
    LearningDoctorReasonCode,
    LearningEditIntent,
    LearningEditScope,
    DoctorEditSource,
    LearningArtifactType,
    LearningEventResult,
    LearningLifecycleState,
    LearningRuleCategory,
    LearningScopeLevel,
    LearningSignalStrength,
    RuleCandidateRecord,
    StructuredLearningEvent
} from './learning/types';
import { recordLearningMetric } from './audit-worker';
import { normalizeClinicalSpecialty, type ClinicalSpecialtyId } from '../clinical/specialties';
import { saveAiLearningEvent, saveAiImprovementLesson } from './storage';

const ANALYZER_MODEL = getTaskModels('feedback')[0] || 'qwen/qwen3-32b';
const LEARNING_CAPTURE_V2_ENABLED = String(import.meta.env.VITE_LEARNING_CAPTURE_V2 ?? 'true').toLowerCase() === 'true';
const TEMPORAL_DEDUPE_WINDOW_MS = 30_000;

export interface ChangeDetected {
    section: string;
    original: string;
    edited: string;
    type: 'added' | 'removed' | 'modified';
}

export interface ImprovementLesson {
    id?: string;
    created_at?: string;
    original_transcription: string;
    ai_generated_history: string;
    doctor_edited_history: string;
    changes_detected: ChangeDetected[];
    lesson_summary: string;
    improvement_category: 'formatting' | 'terminology' | 'missing_data' | 'hallucination' | 'style';
    status: 'active' | 'rejected' | 'learning';
    is_format: boolean;
    recurrence_count: number;
    doctor_comment?: string;
    last_seen_at?: string;
    consolidated?: boolean;
    doctor_id?: string;
    record_id?: string;
}

export interface ProcessDoctorFeedbackV2Params {
    transcription?: string;
    aiText: string;
    doctorText: string;
    apiKey?: string | string[];
    recordId?: string;
    auditId?: string;
    sessionId?: string;
    source: DoctorEditSource;
    artifactType: LearningArtifactType;
    allowAutosaveLearn: boolean;
    specialty?: ClinicalSpecialtyId | string;
    clinicianProfile?: string;
    doctorReasonCode?: LearningDoctorReasonCode;
    doctorFeedbackText?: string;
    doctorScore?: number | null;
}

const AUTOSAVE_SOURCES: DoctorEditSource[] = ['history_autosave', 'search_history_autosave'];

const isAutosaveSource = (source: DoctorEditSource): boolean => AUTOSAVE_SOURCES.includes(source);
const isManualSaveSource = (source: DoctorEditSource): boolean => !isAutosaveSource(source);

const hashText = (value: string): string => deterministicHash(normalizeText(value || ''));

export async function getLessonsFromDB(): Promise<ImprovementLesson[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('ai_improvement_lessons')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(80);
    if (error) throw error;
    return data || [];
}

const normalizeHeader = (value: string): string => value
    .trim()
    .replace(/:$/, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();

const parseSections = (text: string): Record<string, string> => {
    const sections: Record<string, string> = {};
    const lines = (text || '').split('\n');
    let currentSection = 'HEADER';
    let currentContent: string[] = [];

    const flush = () => {
        sections[currentSection] = currentContent.join('\n').trim();
        currentContent = [];
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            currentContent.push(line);
            continue;
        }

        const md = trimmed.match(/^#{1,6}\s+(.+)$/);
        if (md) {
            flush();
            currentSection = normalizeHeader(md[1]);
            continue;
        }

        const candidate = normalizeHeader(trimmed);
        const allowed = /^[A-ZÁÉÍÓÚÜÑ0-9\s]+$/.test(candidate);
        if (allowed && candidate.length >= 3 && candidate === candidate.toUpperCase()) {
            flush();
            currentSection = candidate;
            continue;
        }

        currentContent.push(line);
    }

    flush();
    return sections;
};

const normalizeText = (value: string): string => {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const deterministicHash = (input: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `sig_${(hash >>> 0).toString(16)}`;
};

const similarityScore = (a: string, b: string): number => {
    const tokensA = new Set(normalizeText(a).split(' ').filter(Boolean));
    const tokensB = new Set(normalizeText(b).split(' ').filter(Boolean));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const token of tokensA) {
        if (tokensB.has(token)) intersection += 1;
    }
    return intersection / Math.max(tokensA.size, tokensB.size);
};

const levenshtein = (a: string, b: string): number => {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;

    const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[a.length][b.length];
};

const calcEditDistanceRatio = (beforeText: string, afterText: string): number => {
    const base = Math.max(1, beforeText.length, afterText.length);
    return Number((levenshtein(beforeText, afterText) / base).toFixed(4));
};

const normalizeTextForTriviality = (value: string): string => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sortedTokenSignature = (value: string): string => normalizeTextForTriviality(value)
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');

const isLikelyTrivialEdit = (beforeText: string, afterText: string): boolean => {
    if (!beforeText && !afterText) return true;
    if (beforeText === afterText) return true;

    const normalizedBefore = normalizeTextForTriviality(beforeText);
    const normalizedAfter = normalizeTextForTriviality(afterText);
    if (normalizedBefore === normalizedAfter) return true;

    if (sortedTokenSignature(beforeText) === sortedTokenSignature(afterText)) {
        return true;
    }

    return false;
};

const inferSignalStrength = (
    source: DoctorEditSource,
    editDistanceRatio: number,
    sectionsChanged: number
): LearningSignalStrength => {
    if (!isAutosaveSource(source)) {
        if (editDistanceRatio >= 0.08 || sectionsChanged >= 3) return 'high';
        if (editDistanceRatio >= 0.02 || sectionsChanged >= 1) return 'medium';
        return 'low';
    }
    if (editDistanceRatio >= 0.08 || sectionsChanged >= 3) return 'medium';
    if (editDistanceRatio >= 0.03 || sectionsChanged >= 2) return 'low';
    return 'low';
};

const canIngestBySignalGate = (
    source: DoctorEditSource,
    editDistanceRatio: number,
    sectionsChanged: number,
    allowAutosaveLearn: boolean
): boolean => {
    if (isAutosaveSource(source)) {
        if (!allowAutosaveLearn) return false;
        return editDistanceRatio >= 0.03 || sectionsChanged >= 2;
    }
    return editDistanceRatio >= 0.01 || sectionsChanged >= 1;
};

const mapDoctorReasonToCategory = (reasonCode?: LearningDoctorReasonCode): LearningRuleCategory | null => {
    if (reasonCode === 'terminologia') return 'terminology';
    if (reasonCode === 'omision') return 'missing_data';
    if (reasonCode === 'error_clinico') return 'clinical';
    if (reasonCode === 'formato') return 'formatting';
    if (reasonCode === 'redaccion') return 'style';
    return null;
};

const formatDoctorReasonLabel = (reasonCode?: LearningDoctorReasonCode): string => {
    if (reasonCode === 'terminologia') return 'terminologia';
    if (reasonCode === 'omision') return 'omision';
    if (reasonCode === 'error_clinico') return 'criterio clinico';
    if (reasonCode === 'formato') return 'formato';
    if (reasonCode === 'redaccion') return 'redaccion';
    return 'ajuste profesional';
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const enforceArtifactCategoryPolicy = (
    category: LearningRuleCategory,
    artifactType: LearningArtifactType
): LearningRuleCategory => {
    if (artifactType === 'medical_report' && !['style', 'formatting', 'terminology'].includes(category)) {
        return 'style';
    }
    return category;
};

export function detectChanges(aiHistory: string, doctorHistory: string): ChangeDetected[] {
    const aiSections = parseSections(aiHistory);
    const doctorSections = parseSections(doctorHistory);
    const allSections = new Set([...Object.keys(aiSections), ...Object.keys(doctorSections)]);
    const changes: ChangeDetected[] = [];

    for (const section of allSections) {
        const original = (aiSections[section] || '').trim();
        const edited = (doctorSections[section] || '').trim();
        if (original === edited) continue;

        if (!original && edited) {
            changes.push({ section, original: '', edited, type: 'added' });
        } else if (original && !edited) {
            changes.push({ section, original, edited: '', type: 'removed' });
        } else {
            changes.push({ section, original, edited, type: 'modified' });
        }
    }

    return changes;
}

const inferEditIntent = (category: LearningRuleCategory): LearningEditIntent => {
    if (category === 'clinical') return 'clinical_decision';
    return category;
};

const inferScopeLevel = (
    change: ChangeDetected,
    editDistanceRatio: number,
    sectionsChanged: number
): LearningScopeLevel => {
    if (sectionsChanged >= 3 || editDistanceRatio >= 0.12) return 'document';
    if ((change.original || '').includes('\n') || (change.edited || '').includes('\n') || editDistanceRatio >= 0.04) {
        return 'section';
    }
    return 'field';
};

const inferEditScope = (
    editDistanceRatio: number,
    sectionsChanged: number
): LearningEditScope => {
    if (sectionsChanged >= 3 || editDistanceRatio >= 0.12) return 'structural';
    if (sectionsChanged >= 2 || editDistanceRatio >= 0.04) return 'sectional';
    return 'minor';
};

const deriveManualWeight = (
    source: DoctorEditSource,
    doctorReasonCode?: LearningDoctorReasonCode,
    doctorScore?: number | null
): number => {
    const base = isAutosaveSource(source) ? 0.45 : 1;
    const reasonBoost = doctorReasonCode === 'error_clinico'
        ? 0.4
        : doctorReasonCode === 'omision'
            ? 0.28
            : doctorReasonCode === 'terminologia'
                ? 0.16
                : doctorReasonCode === 'formato'
                    ? 0.08
                    : doctorReasonCode === 'redaccion'
                        ? 0.05
                        : 0;
    const scoreBoost = typeof doctorScore === 'number'
        ? doctorScore <= 2
            ? 0.28
            : doctorScore === 3
                ? 0.12
                : doctorScore >= 5
                    ? -0.06
                    : 0
        : 0;
    return Number(clamp(base + reasonBoost + scoreBoost, 0.2, 1.75).toFixed(2));
};

const buildFieldPath = (section: string, change: ChangeDetected): string => {
    const normalizedSection = normalizeHeader(section || 'GENERAL').toLowerCase().replace(/\s+/g, '_');
    const firstEditedLine = String(change.edited || change.original || '')
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
    const label = firstEditedLine
        ? normalizeText(firstEditedLine.split(':')[0]).replace(/\s+/g, '_')
        : 'content';
    return `section.${normalizedSection}.${label || 'content'}`;
};

const buildSignatureHash = (params: {
    specialty?: string;
    clinicianProfile?: string;
    artifactType?: LearningArtifactType;
    section: string;
    intent: LearningEditIntent;
    normalizedAfter: string;
}): string => deterministicHash([
    normalizeClinicalSpecialty(params.specialty),
    String(params.clinicianProfile || '').trim().toLowerCase(),
    params.artifactType || 'medical_history',
    normalizeHeader(params.section),
    params.intent,
    params.normalizedAfter
].join('|'));

const categorizeDeterministically = (
    change: ChangeDetected,
    doctorReasonCode?: LearningDoctorReasonCode
): LearningRuleCategory | null => {
    const explicitCategory = mapDoctorReasonToCategory(doctorReasonCode);
    if (explicitCategory) return explicitCategory;
    const s = normalizeText(`${change.section} ${change.original} ${change.edited}`);
    if (/alucin|invent|hallucin/.test(s)) return 'hallucination';
    if (/falta|missing|no consta|anadir|agregar/.test(s)) return 'missing_data';
    if (/dosi|termin|abrevi|sigla|unidad|mm hg|mmhg/.test(s)) return 'terminology';
    if (/formato|plantilla|markdown|encabezado|titulo/.test(s)) return 'formatting';
    if (/diagnost|plan|antecedent|enfermedad actual|exploracion/.test(s)) return 'clinical';
    return null;
};

const severityByCategory: Record<LearningRuleCategory, StructuredLearningEvent['severity']> = {
    hallucination: 'critical',
    missing_data: 'high',
    clinical: 'high',
    terminology: 'medium',
    formatting: 'low',
    style: 'low'
};

const stateToLessonStatus = (state: LearningLifecycleState): ImprovementLesson['status'] => {
    if (state === 'active') return 'active';
    if (state === 'blocked') return 'rejected';
    return 'learning';
};

const truncateSnippet = (value: string, limit = 120): string => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}...`;
};

const extractFieldLabelFromPath = (fieldPath: string): string => {
    const parts = String(fieldPath || '').split('.').filter(Boolean);
    return String(parts[parts.length - 1] || 'contenido').replace(/_/g, ' ').trim();
};

const buildPatternKey = (params: {
    specialty?: string;
    clinicianProfile?: string;
    artifactType?: LearningArtifactType;
    section: string;
    fieldPath: string;
    category: LearningRuleCategory;
    doctorReasonCode?: LearningDoctorReasonCode;
}): string => deterministicHash([
    normalizeClinicalSpecialty(params.specialty),
    String(params.clinicianProfile || '').trim().toLowerCase(),
    params.artifactType || 'medical_history',
    normalizeHeader(params.section),
    extractFieldLabelFromPath(params.fieldPath).toLowerCase(),
    params.category,
    params.doctorReasonCode || ''
].join('|'));

const buildReusableRuleSummary = (
    change: ChangeDetected,
    category: LearningRuleCategory,
    options?: {
        fieldPath?: string;
        doctorReasonCode?: LearningDoctorReasonCode;
        doctorFeedbackText?: string;
    }
): string => {
    const section = normalizeHeader(change.section || 'GENERAL');
    const fieldLabel = extractFieldLabelFromPath(options?.fieldPath || buildFieldPath(section, change));
    const reasonLabel = formatDoctorReasonLabel(options?.doctorReasonCode);
    const exampleAfter = truncateSnippet(change.edited || change.original, 90);
    const feedbackHint = truncateSnippet(options?.doctorFeedbackText || '', 80);

    const base = category === 'missing_data'
        ? `[${category}] ${section}/${fieldLabel}: no omitir informacion explicitamente presente; si aparece en transcripcion, incluirla de forma fiel.`
        : category === 'clinical'
            ? `[${category}] ${section}/${fieldLabel}: preservar el criterio clinico escrito por el profesional y evitar reinterpretaciones no explicitadas.`
            : category === 'hallucination'
                ? `[${category}] ${section}/${fieldLabel}: eliminar afirmaciones no sostenidas por la transcripcion o la evidencia documentada.`
                : category === 'terminology'
                    ? `[${category}] ${section}/${fieldLabel}: respetar la terminologia clinica preferida por el profesional en esta seccion.`
                    : category === 'formatting'
                        ? `[${category}] ${section}/${fieldLabel}: mantener la estructura y rotulacion esperadas por el profesional.`
                        : `[${category}] ${section}/${fieldLabel}: ajustar la redaccion para que sea mas clara, breve y util en contexto clinico.`;

    const reasonSuffix = options?.doctorReasonCode ? ` Motivo recurrente: ${reasonLabel}.` : '';
    const exampleSuffix = exampleAfter ? ` Ejemplo observado: "${exampleAfter}".` : '';
    const feedbackSuffix = feedbackHint ? ` Comentario del profesional: "${feedbackHint}".` : '';
    return `${base}${reasonSuffix}${exampleSuffix}${feedbackSuffix}`.trim();
};

const parseAnalysisCategory = (value: unknown): LearningRuleCategory => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'formatting') return 'formatting';
    if (normalized === 'terminology') return 'terminology';
    if (normalized === 'missing_data') return 'missing_data';
    if (normalized === 'hallucination') return 'hallucination';
    if (normalized === 'clinical') return 'clinical';
    return 'style';
};

const analyzeChangesWithAI = async (
    changes: ChangeDetected[],
    groqApiKey: string | string[],
    options?: {
        doctorReasonCode?: LearningDoctorReasonCode;
        doctorFeedbackText?: string;
        doctorScore?: number | null;
        specialty?: string;
        artifactType?: LearningArtifactType;
        source?: DoctorEditSource;
    }
): Promise<{ summary: string; category: LearningRuleCategory; isFormat: boolean }> => {
    const changesDescription = changes.map((c) => (
        `Seccion: ${c.section}\nOriginal: ${c.original.slice(0, 140)}\nEditado: ${c.edited.slice(0, 140)}`
    )).join('\n\n');

    const explicitReason = options?.doctorReasonCode
        ? `Motivo marcado por el profesional: ${formatDoctorReasonLabel(options.doctorReasonCode)}.`
        : 'Motivo marcado por el profesional: no especificado.';
    const feedbackLine = options?.doctorFeedbackText
        ? `Comentario libre del profesional: ${truncateSnippet(options.doctorFeedbackText, 220)}`
        : 'Comentario libre del profesional: ninguno.';
    const scoreLine = typeof options?.doctorScore === 'number'
        ? `Valoracion del profesional: ${options.doctorScore}/5`
        : 'Valoracion del profesional: sin puntuacion.';

    const prompt = `Analiza estas correcciones medicas y responde SOLO JSON.
Reglas:
- Resume en una leccion accionable, corta y reutilizable.
- La leccion debe sonar a instruccion general aplicable a futuros casos, no a un cambio puntual de un paciente.
- category debe ser una de: formatting|terminology|missing_data|hallucination|style|clinical.
- Usa formatting solo para estructura/plantilla, terminology para terminos, missing_data para omisiones, hallucination para afirmaciones sin soporte, clinical para criterio medico, style para redaccion general.
- is_format=true solo si el cambio principal es de formato/estructura.
- No inventes contexto fuera de los cambios proporcionados.
- Si el profesional marco un motivo explicito, priorizalo sobre heuristicas debiles del texto.

CONTEXTO:
- artifact_type: ${options?.artifactType || 'medical_history'}
- specialty: ${normalizeClinicalSpecialty(options?.specialty)}
- source: ${options?.source || 'history_save'}
- ${explicitReason}
- ${feedbackLine}
- ${scoreLine}

CAMBIOS:
${changesDescription}

Salida JSON:
{
  "lesson": "...",
  "category": "formatting|terminology|missing_data|hallucination|style|clinical",
  "is_format": true|false
}`;

    const groq = new GroqService(groqApiKey);
    const jsonText = await groq.chat(prompt, ANALYZER_MODEL, {
        jsonMode: true,
        temperature: 0,
        maxTokens: 500,
        task: 'feedback'
    });
    let parsed: Record<string, unknown> = {};
    try {
        parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
        const fallback = changes[0] ? categorizeDeterministically(changes[0], options?.doctorReasonCode) : null;
        return {
            summary: 'Ajustar redaccion para mantener trazabilidad clinica y consistencia.',
            category: fallback || 'style',
            isFormat: fallback === 'formatting' || fallback === 'style'
        };
    }
    const category = parseAnalysisCategory(parsed.category);

    return {
        summary: String(parsed.lesson || 'Ajuste de redaccion clinica'),
        category,
        isFormat: Boolean(parsed.is_format ?? (category === 'formatting' || category === 'style'))
    };
};

export const extractStructuredEdits = (
    aiHistory: string,
    doctorHistory: string,
    options?: {
        source?: string;
        artifactType?: LearningArtifactType;
        sourceView?: DoctorEditSource;
        signalStrength?: LearningSignalStrength;
        editDistanceRatio?: number;
        sectionsChanged?: number;
        recordUuid?: string;
        specialty?: string;
        clinicianProfile?: string;
        doctorReasonCode?: LearningDoctorReasonCode;
        doctorFeedbackText?: string;
        doctorScore?: number | null;
    }
): StructuredLearningEvent[] => {
    const changes = detectChanges(aiHistory, doctorHistory);
    const editScope = inferEditScope(options?.editDistanceRatio || 0, options?.sectionsChanged || changes.length);
    const manualWeight = deriveManualWeight(
        (options?.sourceView || 'history_save') as DoctorEditSource,
        options?.doctorReasonCode,
        options?.doctorScore
    );
    return changes.map((change) => {
        const category = categorizeDeterministically(change, options?.doctorReasonCode) || 'style';
        const normalizedBefore = normalizeText(change.original);
        const normalizedAfter = normalizeText(change.edited);
        const intent = inferEditIntent(category);
        const targetSection = normalizeHeader(change.section || 'GENERAL');
        const signatureHash = buildSignatureHash({
            specialty: options?.specialty,
            clinicianProfile: options?.clinicianProfile,
            artifactType: options?.artifactType,
            section: targetSection,
            intent,
            normalizedAfter
        });
        const scopeLevel = inferScopeLevel(change, options?.editDistanceRatio || 0, options?.sectionsChanged || changes.length);

        return {
            section: targetSection,
            field_path: buildFieldPath(targetSection, change),
            before_value: change.original,
            after_value: change.edited,
            change_type: change.type,
            severity: severityByCategory[category],
            source: options?.source || 'doctor_edit',
            category,
            normalized_before: normalizedBefore,
            normalized_after: normalizedAfter,
            signature_hash: signatureHash,
            specialty: normalizeClinicalSpecialty(options?.specialty),
            clinician_profile: options?.clinicianProfile || undefined,
            artifact_type: options?.artifactType,
            target_section: targetSection,
            scope_level: scopeLevel,
            edit_intent: intent,
            doctor_reason_code: options?.doctorReasonCode,
            manual_weight: manualWeight,
            metadata: {
                section: targetSection,
                artifact_type: options?.artifactType,
                source_view: options?.sourceView,
                signal_strength: options?.signalStrength,
                edit_distance_ratio: options?.editDistanceRatio,
                sections_changed: options?.sectionsChanged,
                record_uuid: options?.recordUuid,
                specialty: normalizeClinicalSpecialty(options?.specialty),
                clinician_profile: options?.clinicianProfile || undefined,
                target_section: targetSection,
                scope_level: scopeLevel,
                edit_scope: editScope,
                edit_intent: intent,
                doctor_reason_code: options?.doctorReasonCode,
                is_manual_save: isManualSaveSource((options?.sourceView || 'history_save') as DoctorEditSource),
                is_autosave: isAutosaveSource((options?.sourceView || 'history_save') as DoctorEditSource),
                manual_weight: manualWeight,
                doctor_feedback_text: options?.doctorFeedbackText,
                doctor_score: options?.doctorScore ?? null,
                evidence_kind: options?.doctorReasonCode ? 'explicit_reason' : 'implicit_edit',
                example_before: change.original.slice(0, 220),
                example_after: change.edited.slice(0, 220)
            }
        };
    });
};

export const normalizeLearningEvent = (
    event: StructuredLearningEvent,
    context?: { recordId?: string; auditId?: string; sessionId?: string }
): StructuredLearningEvent => {
    return {
        ...event,
        record_id: context?.recordId,
        audit_id: context?.auditId,
        session_id: context?.sessionId,
        before_value: event.before_value || '',
        after_value: event.after_value || '',
        normalized_before: normalizeText(event.before_value || ''),
        normalized_after: normalizeText(event.after_value || ''),
        created_at: new Date().toISOString()
    };
};

const persistLearningDecision = async (
    ruleId: string,
    decisionType: 'promote' | 'demote' | 'block' | 'rollback' | 'force_shadow' | 'resume',
    reason: string,
    previousState: LearningLifecycleState,
    nextState: LearningLifecycleState,
    metricsSnapshot?: Record<string, unknown>,
    context?: {
        specialty?: string;
        clinician_profile?: string;
        artifact_type?: LearningArtifactType;
        target_section?: string;
        doctor_reason_code?: LearningDoctorReasonCode;
    }
): Promise<void> => {
    if (!supabase) return;
    await supabase.from('ai_learning_decisions').insert([{
        rule_id: ruleId,
        decision_type: decisionType,
        reason,
        specialty: context?.specialty || null,
        clinician_profile: context?.clinician_profile || null,
        artifact_type: context?.artifact_type || null,
        target_section: context?.target_section || null,
        doctor_reason_code: context?.doctor_reason_code || null,
        metrics_snapshot: metricsSnapshot || {},
        context: {
            previous_state: previousState,
            new_state: nextState,
            clinician_profile: context?.clinician_profile || null
        }
    }]);

    if (decisionType === 'promote') recordLearningMetric('rule_promotions');
    if (decisionType === 'rollback' || decisionType === 'demote') recordLearningMetric('rule_rollbacks');
    if (decisionType === 'block') recordLearningMetric('rule_conflict_incidents');
};

const updateEvidenceRollup = async (event: StructuredLearningEvent): Promise<void> => {
    if (!supabase) return;
    const signatureHash = event.signature_hash;
    const { data: existing } = await supabase
        .from('ai_rule_evidence_rollups')
        .select('*')
        .eq('signature_hash', signatureHash)
        .maybeSingle();

    const nextRecurrence = Number(existing?.recurrence_count || 0) + 1;
    const contradictionRate = 0;
    const manualWeight = Number(event.manual_weight || 1);
    const isAutosave = Boolean(event.metadata?.is_autosave);
    const payload = {
        signature_hash: signatureHash,
        specialty: event.specialty || 'otorrino',
        clinician_profile: event.clinician_profile || event.metadata?.clinician_profile || null,
        artifact_type: event.artifact_type || event.metadata?.artifact_type || 'medical_history',
        target_section: event.target_section || event.section,
        recurrence_count: nextRecurrence,
        contradiction_rate: contradictionRate,
        manual_weight_total: Number(existing?.manual_weight_total || 0) + (isAutosave ? 0 : manualWeight),
        autosave_weight_total: Number(existing?.autosave_weight_total || 0) + (isAutosave ? manualWeight : 0),
        last_event_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    if (existing?.id) {
        await supabase.from('ai_rule_evidence_rollups').update(payload).eq('id', existing.id);
        return;
    }

    await supabase.from('ai_rule_evidence_rollups').insert([payload]);
};

export const upsertRuleCandidateFromEvent = async (
    event: StructuredLearningEvent,
    fallbackSummary: string
): Promise<{ candidate_id?: string; lifecycle_state?: LearningLifecycleState }> => {
    if (!supabase) return {};

    const reverseSignature = deterministicHash([
        normalizeClinicalSpecialty(event.specialty),
        String(event.clinician_profile || event.metadata?.clinician_profile || '').trim().toLowerCase(),
        event.artifact_type || event.metadata?.artifact_type || 'medical_history',
        normalizeHeader(event.section),
        event.edit_intent || inferEditIntent(event.category),
        event.normalized_before
    ].join('|'));

    const [{ data: existing }, { data: reverse }] = await Promise.all([
        supabase.from('ai_rule_candidates').select('*').eq('signature_hash', event.signature_hash).maybeSingle(),
        supabase.from('ai_rule_candidates').select('*').eq('signature_hash', reverseSignature).maybeSingle()
    ]);

    if (reverse?.id && !existing?.id) {
        const reverseEvidence = Number(reverse.evidence_count || 0) + 1;
        const reverseContradiction = Number(reverse.contradiction_count || 0) + 1;
        const reverseScore = computeConfidenceScore({
            evidence_count: reverseEvidence,
            contradiction_count: reverseContradiction,
            category: String(reverse.category || event.category)
        });

        await supabase
            .from('ai_rule_candidates')
            .update({
                rule_text: fallbackSummary || reverse.rule_text,
                evidence_count: reverseEvidence,
                contradiction_count: reverseContradiction,
                confidence_score: reverseScore,
                specialty: event.specialty || 'otorrino',
                clinician_profile: event.clinician_profile || event.metadata?.clinician_profile || null,
                artifact_type: event.artifact_type || event.metadata?.artifact_type || 'medical_history',
                target_section: event.target_section || event.section,
                scope_level: event.scope_level || 'section',
                rule_json: {
                    ...(reverse.rule_json || {}),
                    specialty: event.specialty || (reverse.rule_json as Record<string, unknown> | undefined)?.specialty || 'otorrino',
                    clinician_profile: event.clinician_profile || (reverse.rule_json as Record<string, unknown> | undefined)?.clinician_profile || undefined,
                    artifact_type: event.artifact_type || event.metadata?.artifact_type || (reverse.rule_json as Record<string, unknown> | undefined)?.artifact_type || 'medical_history',
                    target_section: event.target_section || event.section,
                    scope_level: event.scope_level || 'section',
                    doctor_reason_code: event.doctor_reason_code || undefined,
                    manual_weight: event.manual_weight ?? 1,
                    applicable_when: {
                        specialty: event.specialty || 'otorrino',
                        artifact_type: event.artifact_type || event.metadata?.artifact_type || 'medical_history',
                        section: event.target_section || event.section
                    },
                    pattern_key: event.metadata?.pattern_key || undefined,
                    example_before: truncateSnippet(event.before_value, 180),
                    example_after: truncateSnippet(event.after_value, 180),
                    doctor_feedback_text: event.metadata?.doctor_feedback_text || undefined,
                    doctor_score: event.metadata?.doctor_score ?? null,
                    source_view: event.metadata?.source_view || (reverse.rule_json as Record<string, unknown> | undefined)?.source_view || 'history_save',
                    signal_strength: event.metadata?.signal_strength || (reverse.rule_json as Record<string, unknown> | undefined)?.signal_strength || 'medium'
                },
                updated_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString()
            })
            .eq('id', reverse.id);

        recordLearningMetric('rule_conflict_incidents');
        return {
            candidate_id: reverse.id,
            lifecycle_state: reverse.lifecycle_state as LearningLifecycleState
        };
    }

    if (existing?.id) {
        const nextEvidence = Number(existing.evidence_count || 0) + 1;
        const nextContradiction = Number(existing.contradiction_count || 0);
        const nextConfidence = computeConfidenceScore({
            evidence_count: nextEvidence,
            contradiction_count: nextContradiction,
            category: String(existing.category || event.category)
        });

        const prevState = (existing.lifecycle_state || 'candidate') as LearningLifecycleState;
        const nextState = resolveNextLifecycleState(prevState, {
            evidence_count: nextEvidence,
            contradiction_count: nextContradiction,
            category: String(existing.category || event.category) as LearningRuleCategory
        });

        await supabase
            .from('ai_rule_candidates')
            .update({
                rule_text: fallbackSummary || existing.rule_text,
                evidence_count: nextEvidence,
                confidence_score: nextConfidence,
                lifecycle_state: nextState,
                specialty: event.specialty || 'otorrino',
                clinician_profile: event.clinician_profile || event.metadata?.clinician_profile || null,
                artifact_type: event.artifact_type || event.metadata?.artifact_type || 'medical_history',
                target_section: event.target_section || event.section,
                scope_level: event.scope_level || 'section',
                doctor_reason_code: event.doctor_reason_code || undefined,
                rule_json: {
                    ...(existing.rule_json || {}),
                    specialty: event.specialty || (existing.rule_json as Record<string, unknown> | undefined)?.specialty || 'otorrino',
                    clinician_profile: event.clinician_profile || (existing.rule_json as Record<string, unknown> | undefined)?.clinician_profile || undefined,
                    artifact_type: event.artifact_type || event.metadata?.artifact_type || (existing.rule_json as Record<string, unknown> | undefined)?.artifact_type || 'medical_history',
                    target_section: event.target_section || event.section,
                    scope_level: event.scope_level || 'section',
                    doctor_reason_code: event.doctor_reason_code || undefined,
                    manual_weight: event.manual_weight ?? 1,
                    applicable_when: {
                        specialty: event.specialty || 'otorrino',
                        artifact_type: event.artifact_type || event.metadata?.artifact_type || 'medical_history',
                        section: event.target_section || event.section
                    },
                    pattern_key: event.metadata?.pattern_key || undefined,
                    example_before: truncateSnippet(event.before_value, 180),
                    example_after: truncateSnippet(event.after_value, 180),
                    doctor_feedback_text: event.metadata?.doctor_feedback_text || undefined,
                    doctor_score: event.metadata?.doctor_score ?? null,
                    source_view: event.metadata?.source_view || (existing.rule_json as Record<string, unknown> | undefined)?.source_view || 'history_save',
                    signal_strength: event.metadata?.signal_strength || (existing.rule_json as Record<string, unknown> | undefined)?.signal_strength || 'medium'
                },
                last_seen_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                metrics_snapshot: {
                    confidence_score: nextConfidence,
                    evidence_count: nextEvidence,
                    contradiction_count: nextContradiction
                },
                promoted_at: nextState === 'active' ? new Date().toISOString() : existing.promoted_at
            })
            .eq('id', existing.id);

        const decision = deriveDecisionType(prevState, nextState);
        if (decision) {
            await persistLearningDecision(
                existing.id,
                decision,
                'candidate_reinforced',
                prevState,
                nextState,
                {
                    confidence_score: nextConfidence,
                    evidence_count: nextEvidence,
                    contradiction_count: nextContradiction
                },
                {
                    specialty: event.specialty || 'otorrino',
                    clinician_profile: event.clinician_profile || event.metadata?.clinician_profile || undefined,
                    artifact_type: event.artifact_type || event.metadata?.artifact_type || 'medical_history',
                    target_section: event.target_section || event.section,
                    doctor_reason_code: event.doctor_reason_code || undefined
                }
            );
        }

        return {
            candidate_id: existing.id,
            lifecycle_state: nextState
        };
    }

    const initialCandidate: RuleCandidateRecord = {
        signature_hash: event.signature_hash,
        rule_text: fallbackSummary,
        rule_json: {
            specialty: event.specialty || 'otorrino',
            clinician_profile: event.clinician_profile || event.metadata?.clinician_profile || undefined,
            section: event.section,
            target_section: event.target_section || event.section,
            field_path: event.field_path,
            before: event.before_value,
            after: event.after_value,
            source: event.source,
            category: event.category,
            artifact_type: event.artifact_type || event.metadata?.artifact_type || 'medical_history',
            source_view: event.metadata?.source_view || 'history_save',
            signal_strength: event.metadata?.signal_strength || 'medium',
            scope_level: event.scope_level || 'section',
            doctor_reason_code: event.doctor_reason_code || undefined,
            manual_weight: event.manual_weight ?? 1,
            pattern_key: event.metadata?.pattern_key || undefined,
            example_before: truncateSnippet(event.before_value, 180),
            example_after: truncateSnippet(event.after_value, 180),
            doctor_feedback_text: event.metadata?.doctor_feedback_text || undefined,
            doctor_score: event.metadata?.doctor_score ?? null,
            applicable_when: {
                specialty: event.specialty || 'otorrino',
                artifact_type: event.artifact_type || event.metadata?.artifact_type || 'medical_history',
                section: event.target_section || event.section
            }
        },
        category: event.category,
        evidence_count: 1,
        contradiction_count: 0,
        confidence_score: computeConfidenceScore({
            evidence_count: 1,
            contradiction_count: 0,
            category: event.category
        }),
        lifecycle_state: 'candidate',
        specialty: event.specialty || 'otorrino',
        clinician_profile: event.clinician_profile || event.metadata?.clinician_profile || undefined,
        artifact_type: event.artifact_type || event.metadata?.artifact_type || 'medical_history',
        target_section: event.target_section || event.section,
        scope_level: event.scope_level || 'section',
        doctor_reason_code: event.doctor_reason_code || undefined,
        last_seen_at: new Date().toISOString()
    };

    const { data: inserted } = await supabase
        .from('ai_rule_candidates')
        .insert([initialCandidate])
        .select('id, lifecycle_state')
        .maybeSingle();

    return {
        candidate_id: inserted?.id,
        lifecycle_state: (inserted?.lifecycle_state || 'candidate') as LearningLifecycleState
    };
};

const wasRecentlyPersisted = async (
    event: StructuredLearningEvent,
    source: DoctorEditSource,
    afterHash: string
): Promise<boolean> => {
    if (!supabase) return false;
    const { data } = await supabase
        .from('ai_learning_events')
        .select('created_at, metadata')
        .eq('signature_hash', event.signature_hash)
        .eq('source', source)
        .order('created_at', { ascending: false })
        .limit(6);

    const nowMs = Date.now();
    return Boolean(data?.some((row) => {
        const rowCreatedAt = Date.parse(String(row.created_at || ''));
        if (!Number.isFinite(rowCreatedAt) || nowMs - rowCreatedAt > TEMPORAL_DEDUPE_WINDOW_MS) {
            return false;
        }
        const metadata = (row.metadata || {}) as Record<string, unknown>;
        return String(metadata.after_hash || '') === afterHash;
    }));
};

const isDuplicateLearnedState = async (
    recordId: string | undefined,
    artifactType: LearningArtifactType,
    finalTextHash: string
): Promise<boolean> => {
    if (!supabase || !recordId) return false;
    const { data } = await supabase
        .from('ai_learning_events')
        .select('metadata')
        .eq('record_id', recordId)
        .order('created_at', { ascending: false })
        .limit(25);

    return Boolean(data?.find((row) => {
        const metadata = (row.metadata || {}) as Record<string, unknown>;
        return String(metadata.artifact_type || '') === artifactType
            && String(metadata.final_text_hash || '') === finalTextHash;
    }));
};

const processDoctorFeedbackLegacy = async (
    transcription: string,
    aiHistory: string,
    doctorHistory: string,
    groqApiKey: string | string[],
    recordId?: string,
    auditId?: string,
    sessionId?: string
): Promise<LearningEventResult | null> => {
    if (!supabase) return null;

    const changes = detectChanges(aiHistory, doctorHistory);
    if (changes.length === 0) return null;

    const structuredEdits = extractStructuredEdits(aiHistory, doctorHistory)
        .map((event) => normalizeLearningEvent(event, { recordId, auditId, sessionId }));

    const eventIds: string[] = [];
    const candidateIds: string[] = [];
    let firstLifecycleState: LearningLifecycleState | undefined;

    let aiSummary = '';
    let aiCategory: LearningRuleCategory | undefined;
    try {
        const deterministicCategory = categorizeDeterministically(changes[0]);
        if (!deterministicCategory) {
            const analysis = await analyzeChangesWithAI(changes, groqApiKey);
            aiSummary = analysis.summary;
            aiCategory = analysis.category;
        }
    } catch (error) {
        console.warn('[doctor-feedback] AI analysis unavailable, fallback to deterministic summary:', error);
    }

    for (const event of structuredEdits) {
        const effectiveCategory = aiCategory || event.category;
        const ruleSummary = aiSummary || buildReusableRuleSummary(changes[0], effectiveCategory, {
            fieldPath: event.field_path
        });
        const normalizedEvent: StructuredLearningEvent = {
            ...event,
            category: effectiveCategory,
            severity: severityByCategory[effectiveCategory],
            signature_hash: deterministicHash([
                normalizeHeader(event.section),
                event.normalized_before,
                event.normalized_after,
                effectiveCategory
            ].join('|'))
        };

        const createdEventId = await saveAiLearningEvent({
            record_id: normalizedEvent.record_id,
            audit_id: normalizedEvent.audit_id,
            session_id: normalizedEvent.session_id,
            section: normalizedEvent.section,
            field_path: normalizedEvent.field_path,
            before_value: normalizedEvent.before_value,
            after_value: normalizedEvent.after_value,
            change_type: normalizedEvent.change_type,
            severity: normalizedEvent.severity,
            source: normalizedEvent.source,
            category: normalizedEvent.category,
            normalized_before: normalizedEvent.normalized_before,
            normalized_after: normalizedEvent.normalized_after,
            signature_hash: normalizedEvent.signature_hash,
            metadata: normalizedEvent.metadata || {}
        });

        if (createdEventId) eventIds.push(String(createdEventId));

        let candidate: Awaited<ReturnType<typeof upsertRuleCandidateFromEvent>> = {};
        try {
            candidate = await upsertRuleCandidateFromEvent(normalizedEvent, ruleSummary);
            if (candidate.candidate_id) candidateIds.push(candidate.candidate_id);
            if (!firstLifecycleState && candidate.lifecycle_state) firstLifecycleState = candidate.lifecycle_state;
        } catch (error) {
            console.warn('[doctor-feedback] Candidate upsert unavailable, continuing with local lesson capture:', error);
        }

        try {
            const isFormat = effectiveCategory === 'formatting' || effectiveCategory === 'style';
            const similarLessons = await supabase
                .from('ai_improvement_lessons')
                .select('lesson_summary, recurrence_count')
                .neq('status', 'rejected')
                .order('created_at', { ascending: false })
                .limit(20);
            const similar = similarLessons.data?.find((lesson) => similarityScore(String(lesson.lesson_summary || ''), ruleSummary) >= 0.6);
            const recurrenceCount = similar ? Number(similar.recurrence_count || 1) + 1 : 1;

            await saveAiImprovementLesson({
                original_transcription: transcription,
                ai_generated_history: aiHistory,
                doctor_edited_history: doctorHistory,
                changes_detected: changes,
                lesson_summary: ruleSummary,
                improvement_category: effectiveCategory === 'clinical' ? 'missing_data' : effectiveCategory,
                is_format: isFormat,
                status: candidate.lifecycle_state ? stateToLessonStatus(candidate.lifecycle_state) : 'learning',
                recurrence_count: recurrenceCount,
                record_id: recordId,
                last_seen_at: new Date().toISOString()
            });
        } catch (error) {
            console.warn('[doctor-feedback] Improvement lesson capture failed:', error);
        }
    }

    if (eventIds.length > 0) {
        recordLearningMetric('learning_events_ingested', eventIds.length);
    }

    return {
        event_id: eventIds[0],
        candidate_id: candidateIds[0],
        lifecycle_state: firstLifecycleState,
        event_ids: eventIds,
        candidate_ids: candidateIds,
        structured_events: structuredEdits
    };
};

export const processDoctorFeedbackV2 = async (
    params: ProcessDoctorFeedbackV2Params
): Promise<LearningEventResult | null> => {
    if (!LEARNING_CAPTURE_V2_ENABLED) {
        return processDoctorFeedbackLegacy(
            params.transcription || '',
            params.aiText,
            params.doctorText,
            params.apiKey || '',
            params.recordId,
            params.auditId,
            params.sessionId
        );
    }
    if (!supabase) return null;

    const aiText = params.aiText || '';
    const doctorText = params.doctorText || '';
    const changes = detectChanges(aiText, doctorText);
    if (changes.length === 0) return null;

    const editDistanceRatio = calcEditDistanceRatio(aiText, doctorText);
    const sectionsChanged = changes.length;
    if (!canIngestBySignalGate(params.source, editDistanceRatio, sectionsChanged, params.allowAutosaveLearn)) {
        recordLearningMetric('learning_events_dropped_noise');
        return null;
    }

    if (isLikelyTrivialEdit(aiText, doctorText)) {
        recordLearningMetric('learning_events_dropped_noise');
        return null;
    }

    const finalTextHash = hashText(doctorText);
    if (await isDuplicateLearnedState(params.recordId, params.artifactType, finalTextHash)) {
        recordLearningMetric('learning_events_deduped');
        return null;
    }

    const signalStrength = inferSignalStrength(params.source, editDistanceRatio, sectionsChanged);
    const specialty = normalizeClinicalSpecialty(params.specialty);
    const changeCategoryHints = changes.map((change) => categorizeDeterministically(change, params.doctorReasonCode));
    const unresolvedCount = changeCategoryHints.filter((value) => !value).length;
    const uniqueDeterministic = new Set(changeCategoryHints.filter((value): value is LearningRuleCategory => Boolean(value)));
    const shouldUseAIClassifier = Boolean(params.apiKey) && (unresolvedCount > 0 || uniqueDeterministic.size > 1);

    let aiSummary = '';
    let aiCategory: LearningRuleCategory | undefined;
    if (shouldUseAIClassifier) {
        try {
            const analysis = await analyzeChangesWithAI(changes, params.apiKey as string | string[], {
                doctorReasonCode: params.doctorReasonCode,
                doctorFeedbackText: params.doctorFeedbackText,
                doctorScore: params.doctorScore,
                specialty,
                artifactType: params.artifactType,
                source: params.source
            });
            aiSummary = analysis.summary;
            aiCategory = analysis.category;
        } catch (error) {
            console.warn('[doctor-feedback] AI analysis unavailable for V2, using deterministic categories:', error);
        }
    }

    const structuredEdits = extractStructuredEdits(aiText, doctorText, {
        source: params.source,
        artifactType: params.artifactType,
        sourceView: params.source,
        signalStrength,
        editDistanceRatio,
        sectionsChanged,
        recordUuid: params.recordId
        ,
        specialty,
        clinicianProfile: params.clinicianProfile,
        doctorReasonCode: params.doctorReasonCode,
        doctorFeedbackText: params.doctorFeedbackText,
        doctorScore: params.doctorScore
    }).map((event) => normalizeLearningEvent(event, {
        recordId: params.recordId,
        auditId: params.auditId,
        sessionId: params.sessionId
    }));

    const eventIds: string[] = [];
    const candidateIds: string[] = [];
    const acceptedStructuredEvents: StructuredLearningEvent[] = [];
    let firstLifecycleState: LearningLifecycleState | undefined;
    let dedupedCount = 0;

    for (let index = 0; index < structuredEdits.length; index++) {
        const event = structuredEdits[index];
        const deterministicCategory = changeCategoryHints[index] || null;
        const effectiveCategory = enforceArtifactCategoryPolicy(
            deterministicCategory || aiCategory || event.category,
            params.artifactType
        );
        const change = changes[index] || changes[0];
        const ruleSummary = deterministicCategory
            ? buildReusableRuleSummary(change, effectiveCategory, {
                fieldPath: event.field_path,
                doctorReasonCode: params.doctorReasonCode,
                doctorFeedbackText: params.doctorFeedbackText
            })
            : (aiSummary || buildReusableRuleSummary(change, effectiveCategory, {
                fieldPath: event.field_path,
                doctorReasonCode: params.doctorReasonCode,
                doctorFeedbackText: params.doctorFeedbackText
            }));
        const patternKey = buildPatternKey({
            specialty,
            clinicianProfile: params.clinicianProfile,
            artifactType: params.artifactType,
            section: event.section,
            fieldPath: event.field_path,
            category: effectiveCategory,
            doctorReasonCode: params.doctorReasonCode
        });
        const normalizedEvent: StructuredLearningEvent = {
            ...event,
            category: effectiveCategory,
            severity: severityByCategory[effectiveCategory],
            edit_intent: inferEditIntent(effectiveCategory),
            signature_hash: buildSignatureHash({
                specialty,
                clinicianProfile: params.clinicianProfile,
                artifactType: params.artifactType,
                section: event.section,
                intent: inferEditIntent(effectiveCategory),
                normalizedAfter: event.normalized_after
            })
        };

        const afterHash = hashText(normalizedEvent.after_value);
        const isTemporalDuplicate = await wasRecentlyPersisted(normalizedEvent, params.source, afterHash);
        if (isTemporalDuplicate) {
            dedupedCount += 1;
            continue;
        }

        const evidenceKind: 'explicit_reason' | 'implicit_edit' = params.doctorReasonCode ? 'explicit_reason' : 'implicit_edit';
        const metadata = {
            ...(normalizedEvent.metadata || {}),
            artifact_type: params.artifactType,
            source_view: params.source,
            signal_strength: signalStrength,
            edit_distance_ratio: editDistanceRatio,
            sections_changed: sectionsChanged,
            record_uuid: params.recordId,
            after_hash: afterHash,
            final_text_hash: finalTextHash,
            specialty,
            clinician_profile: params.clinicianProfile || undefined,
            target_section: normalizedEvent.target_section || normalizedEvent.section,
            scope_level: normalizedEvent.scope_level || 'section',
            edit_intent: normalizedEvent.edit_intent || inferEditIntent(effectiveCategory),
            doctor_reason_code: params.doctorReasonCode || undefined,
            is_manual_save: isManualSaveSource(params.source),
            is_autosave: isAutosaveSource(params.source),
            manual_weight: normalizedEvent.manual_weight ?? deriveManualWeight(params.source, params.doctorReasonCode, params.doctorScore),
            doctor_feedback_text: params.doctorFeedbackText || undefined,
            doctor_score: params.doctorScore ?? null,
            pattern_key: patternKey,
            evidence_kind: evidenceKind,
            example_before: truncateSnippet(normalizedEvent.before_value, 220),
            example_after: truncateSnippet(normalizedEvent.after_value, 220)
        };

        const createdEventId = await saveAiLearningEvent({
            record_id: normalizedEvent.record_id,
            audit_id: normalizedEvent.audit_id,
            session_id: normalizedEvent.session_id,
            section: normalizedEvent.section,
            field_path: normalizedEvent.field_path,
            before_value: normalizedEvent.before_value,
            after_value: normalizedEvent.after_value,
            change_type: normalizedEvent.change_type,
            severity: normalizedEvent.severity,
            source: params.source,
            category: normalizedEvent.category,
            normalized_before: normalizedEvent.normalized_before,
            normalized_after: normalizedEvent.normalized_after,
            signature_hash: normalizedEvent.signature_hash,
            specialty,
            clinician_profile: params.clinicianProfile || undefined,
            artifact_type: params.artifactType,
            target_section: normalizedEvent.target_section || normalizedEvent.section,
            scope_level: normalizedEvent.scope_level || 'section',
            metadata
        });

        if (createdEventId) {
            eventIds.push(String(createdEventId));
            const acceptedEvent = {
                ...normalizedEvent,
                metadata
            };
            acceptedStructuredEvents.push(acceptedEvent);
            try {
                await updateEvidenceRollup(acceptedEvent);
            } catch (error) {
                console.warn('[doctor-feedback] Evidence rollup unavailable, learning event kept locally:', error);
            }
        }

        let candidate: Awaited<ReturnType<typeof upsertRuleCandidateFromEvent>> = {};
        try {
            candidate = await upsertRuleCandidateFromEvent(
                {
                    ...normalizedEvent,
                    metadata
                },
                ruleSummary
            );
            if (candidate.candidate_id) candidateIds.push(candidate.candidate_id);
            if (!firstLifecycleState && candidate.lifecycle_state) firstLifecycleState = candidate.lifecycle_state;
        } catch (error) {
            console.warn('[doctor-feedback] Candidate upsert unavailable, keeping base learning event only:', error);
        }

        try {
            const isFormat = effectiveCategory === 'formatting' || effectiveCategory === 'style';
            const similarLessons = await supabase
                .from('ai_improvement_lessons')
                .select('lesson_summary, recurrence_count')
                .neq('status', 'rejected')
                .order('created_at', { ascending: false })
                .limit(20);
            const similar = similarLessons.data?.find((lesson) => similarityScore(String(lesson.lesson_summary || ''), ruleSummary) >= 0.6);
            const recurrenceCount = similar ? Number(similar.recurrence_count || 1) + 1 : 1;

            await saveAiImprovementLesson({
                original_transcription: params.transcription || '',
                ai_generated_history: aiText,
                doctor_edited_history: doctorText,
                changes_detected: changes,
                lesson_summary: ruleSummary,
                improvement_category: effectiveCategory === 'clinical' ? 'missing_data' : effectiveCategory,
                is_format: isFormat,
                status: candidate.lifecycle_state ? stateToLessonStatus(candidate.lifecycle_state) : 'learning',
                recurrence_count: recurrenceCount,
                record_id: params.recordId,
                last_seen_at: new Date().toISOString()
            });
        } catch (error) {
            console.warn('[doctor-feedback] Improvement lesson capture failed:', error);
        }
    }

    if (dedupedCount > 0) {
        recordLearningMetric('learning_events_deduped', dedupedCount);
    }
    if (eventIds.length === 0) return null;

    recordLearningMetric('learning_events_ingested', eventIds.length);
    if (isAutosaveSource(params.source)) {
        recordLearningMetric('learning_events_from_autosave', eventIds.length);
    } else {
        recordLearningMetric('learning_events_from_manual', eventIds.length);
    }

    return {
        event_id: eventIds[0],
        candidate_id: candidateIds[0],
        lifecycle_state: firstLifecycleState,
        event_ids: eventIds,
        candidate_ids: candidateIds,
        structured_events: acceptedStructuredEvents
    };
};

export async function processDoctorFeedback(
    transcription: string,
    aiHistory: string,
    doctorHistory: string,
    groqApiKey: string | string[],
    recordId?: string,
    auditId?: string,
    sessionId?: string
): Promise<LearningEventResult | null> {
    if (LEARNING_CAPTURE_V2_ENABLED) {
        return processDoctorFeedbackV2({
            transcription,
            aiText: aiHistory,
            doctorText: doctorHistory,
            apiKey: groqApiKey,
            recordId,
            auditId,
            sessionId,
            source: 'history_save',
            artifactType: 'medical_history',
            allowAutosaveLearn: false
        });
    }

    return processDoctorFeedbackLegacy(
        transcription,
        aiHistory,
        doctorHistory,
        groqApiKey,
        recordId,
        auditId,
        sessionId
    );
}

export async function getRelevantLessonsForPrompt(): Promise<string> {
    return '';
}

