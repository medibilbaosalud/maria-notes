import { supabase } from './supabase';
import { getTaskModels } from './model-registry';
import { GroqService } from './groq';
import { computeConfidenceScore, deriveDecisionType, resolveNextLifecycleState } from './learning/rule-lifecycle';
import {
    LearningEventResult,
    LearningLifecycleState,
    LearningRuleCategory,
    RuleCandidateRecord,
    StructuredLearningEvent
} from './learning/types';
import { recordLearningMetric } from './audit-worker';

const ANALYZER_MODEL = getTaskModels('feedback')[0] || 'qwen/qwen3-32b';

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

const categorizeDeterministically = (change: ChangeDetected): LearningRuleCategory | null => {
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

const summarizeRuleText = (change: ChangeDetected, category: LearningRuleCategory): string => {
    const section = change.section || 'GENERAL';
    const from = change.original ? change.original.slice(0, 120) : '(vacio)';
    const to = change.edited ? change.edited.slice(0, 120) : '(vacio)';
    return `[${category}] ${section}: usar "${to}" en lugar de "${from}"`;
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
    groqApiKey: string | string[]
): Promise<{ summary: string; category: LearningRuleCategory; isFormat: boolean }> => {
    const changesDescription = changes.map((c) => (
        `Seccion: ${c.section}\nOriginal: ${c.original.slice(0, 140)}\nEditado: ${c.edited.slice(0, 140)}`
    )).join('\n\n');

    const prompt = `Analiza estas correcciones medicas y responde SOLO JSON.
Reglas:
- Resume en una leccion accionable, corta y reutilizable.
- category debe ser una de: formatting|terminology|missing_data|hallucination|style|clinical.
- Usa formatting solo para estructura/plantilla, terminology para terminos, missing_data para omisiones, hallucination para afirmaciones sin soporte, clinical para criterio medico, style para redaccion general.
- is_format=true solo si el cambio principal es de formato/estructura.
- No inventes contexto fuera de los cambios proporcionados.

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
        const fallback = changes[0] ? categorizeDeterministically(changes[0]) : null;
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
    doctorHistory: string
): StructuredLearningEvent[] => {
    const changes = detectChanges(aiHistory, doctorHistory);
    return changes.map((change) => {
        const category = categorizeDeterministically(change) || 'style';
        const normalizedBefore = normalizeText(change.original);
        const normalizedAfter = normalizeText(change.edited);
        const signatureHash = deterministicHash([
            normalizeHeader(change.section),
            normalizedBefore,
            normalizedAfter,
            category
        ].join('|'));

        return {
            section: normalizeHeader(change.section || 'GENERAL'),
            field_path: `section.${normalizeHeader(change.section || 'GENERAL').toLowerCase().replace(/\s+/g, '_')}`,
            before_value: change.original,
            after_value: change.edited,
            change_type: change.type,
            severity: severityByCategory[category],
            source: 'doctor_edit',
            category,
            normalized_before: normalizedBefore,
            normalized_after: normalizedAfter,
            signature_hash: signatureHash,
            metadata: {
                section: change.section
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
    metricsSnapshot?: Record<string, unknown>
): Promise<void> => {
    if (!supabase) return;
    await supabase.from('ai_learning_decisions').insert([{
        rule_id: ruleId,
        decision_type: decisionType,
        reason,
        metrics_snapshot: metricsSnapshot || {},
        context: {
            previous_state: previousState,
            new_state: nextState
        }
    }]);

    if (decisionType === 'promote') recordLearningMetric('rule_promotions');
    if (decisionType === 'rollback' || decisionType === 'demote') recordLearningMetric('rule_rollbacks');
    if (decisionType === 'block') recordLearningMetric('rule_conflict_incidents');
};

export const upsertRuleCandidateFromEvent = async (
    event: StructuredLearningEvent,
    fallbackSummary: string
): Promise<{ candidate_id?: string; lifecycle_state?: LearningLifecycleState }> => {
    if (!supabase) return {};

    const reverseSignature = deterministicHash([
        normalizeHeader(event.section),
        event.normalized_after,
        event.normalized_before,
        event.category
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
                evidence_count: reverseEvidence,
                contradiction_count: reverseContradiction,
                confidence_score: reverseScore,
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
            contradiction_count: nextContradiction
        });

        await supabase
            .from('ai_rule_candidates')
            .update({
                evidence_count: nextEvidence,
                confidence_score: nextConfidence,
                lifecycle_state: nextState,
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
            section: event.section,
            field_path: event.field_path,
            before: event.before_value,
            after: event.after_value,
            source: event.source,
            category: event.category
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

export async function processDoctorFeedback(
    transcription: string,
    aiHistory: string,
    doctorHistory: string,
    groqApiKey: string | string[],
    recordId?: string,
    auditId?: string,
    sessionId?: string
): Promise<LearningEventResult | null> {
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
        const ruleSummary = aiSummary || summarizeRuleText(changes[0], effectiveCategory);
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

        const { data: createdEvent } = await supabase
            .from('ai_learning_events')
            .insert([{
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
            }])
            .select('id')
            .maybeSingle();

        if (createdEvent?.id) eventIds.push(createdEvent.id);

        const candidate = await upsertRuleCandidateFromEvent(normalizedEvent, ruleSummary);
        if (candidate.candidate_id) candidateIds.push(candidate.candidate_id);
        if (!firstLifecycleState && candidate.lifecycle_state) firstLifecycleState = candidate.lifecycle_state;

        // Keep legacy lessons table for backward compatibility and migration safety.
        const isFormat = effectiveCategory === 'formatting' || effectiveCategory === 'style';
        const similarLessons = await supabase
            .from('ai_improvement_lessons')
            .select('lesson_summary, recurrence_count')
            .neq('status', 'rejected')
            .order('created_at', { ascending: false })
            .limit(20);
        const similar = similarLessons.data?.find((lesson) => similarityScore(String(lesson.lesson_summary || ''), ruleSummary) >= 0.6);
        const recurrenceCount = similar ? Number(similar.recurrence_count || 1) + 1 : 1;

        await supabase.from('ai_improvement_lessons').insert([{
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
        }]);
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
}

export async function getRelevantLessonsForPrompt(): Promise<string> {
    return '';
}

