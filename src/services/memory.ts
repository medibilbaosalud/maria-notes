import { supabase } from './supabase';
import { getTaskModels } from './model-registry';
import { recordLearningMetric } from './audit-worker';
import type { ConsultationClassification } from './groq';
import type { LearningArtifactType, RulePack, RulePackContext, RulePackRule } from './learning/types';
import { normalizeClinicalSpecialty } from '../clinical/specialties';
import { normalizeClinicianProfileForSpecialty } from '../clinical/clinicians';

const MEMORY_MODEL = getTaskModels('memory')[0] || 'llama-3.3-70b-versatile';
const RULEPACK_APPLY_ENABLED = String(import.meta.env.VITE_RULEPACK_APPLY_ENABLED ?? 'true').toLowerCase() === 'true';
const LEARNING_V2_ENABLED = String(import.meta.env.VITE_LEARNING_V2_ENABLED ?? 'true').toLowerCase() === 'true';
const CHARS_PER_TOKEN = 4;

interface HybridContext {
    global_rules: string;
    daily_lessons: string;
    total_lessons_count: number;
    global_rules_json?: {
        terminology: string[];
        formatting: string[];
        style: string[];
        clinical: string[];
    };
}

interface RulePackCacheEntry {
    value: RulePackContext;
    expiresAt: number;
}

type ConsolidationWindowName = 'daily' | 'weekly' | 'monthly';

interface RankedRuleCandidate {
    id: string;
    rule_text: string;
    prompt_text: string;
    rule_json: Record<string, unknown>;
    category: string;
    confidence_score: number;
    lifecycle_state: string;
    last_seen_at: string;
    updated_at: string;
    evidence_count: number;
    priority: number;
}

interface ScopeConsolidationState {
    daily: string;
    weekly: string;
    monthly: string;
    updated_at: string;
}

export class MemoryService {
    private static hybridCache: { value: HybridContext; expiresAt: number } | null = null;
    private static rulePackCache = new Map<string, RulePackCacheEntry>();
    private static readonly HYBRID_CACHE_TTL_MS = 60_000;
    private static readonly RULEPACK_CACHE_TTL_MS = 30_000;
    private static readonly CONSOLIDATION_SCOPE_STORAGE_KEY = 'memory_consolidation_scope_state_v1';
    private static readonly CONSOLIDATION_WINDOWS: Array<{
        name: ConsolidationWindowName;
        title: string;
        maxAgeDays: number;
        minConfidence: number;
        minEvidence: number;
        maxRules: number;
    }> = [
            { name: 'daily', title: 'Senales del dia', maxAgeDays: 1, minConfidence: 0.58, minEvidence: 1, maxRules: 8 },
            { name: 'weekly', title: 'Patrones de la semana', maxAgeDays: 7, minConfidence: 0.68, minEvidence: 2, maxRules: 8 },
            { name: 'monthly', title: 'Patrones del mes', maxAgeDays: 30, minConfidence: 0.78, minEvidence: 3, maxRules: 6 }
        ];
    private static pipelineBusy = false;
    private static breakerFailures = 0;
    private static breakerOpenUntil = 0;
    private static readonly BREAKER_FAILURE_THRESHOLD = 3;
    private static readonly BREAKER_COOLDOWN_MS = 30_000;

    static invalidateCache() {
        MemoryService.hybridCache = null;
        MemoryService.rulePackCache.clear();
    }

    static setPipelineBusy(isBusy: boolean) {
        MemoryService.pipelineBusy = isBusy;
    }

    private static isCircuitOpen() {
        return Date.now() < MemoryService.breakerOpenUntil;
    }

    private static markFailure() {
        MemoryService.breakerFailures += 1;
        if (MemoryService.breakerFailures >= MemoryService.BREAKER_FAILURE_THRESHOLD) {
            MemoryService.breakerOpenUntil = Date.now() + MemoryService.BREAKER_COOLDOWN_MS;
        }
    }

    private static markSuccess() {
        MemoryService.breakerFailures = 0;
        MemoryService.breakerOpenUntil = 0;
    }

    private static estimateTokens(text: string): number {
        return Math.ceil((text || '').length / CHARS_PER_TOKEN);
    }

    private static normalizeCategory(category: string): 'terminology' | 'formatting' | 'style' | 'clinical' {
        const normalized = String(category || '').toLowerCase();
        if (normalized === 'terminology') return 'terminology';
        if (normalized === 'formatting') return 'formatting';
        if (normalized === 'missing_data' || normalized === 'hallucination' || normalized === 'clinical') return 'clinical';
        return 'style';
    }

    private static resolveRuleArtifactType(ruleJson: Record<string, unknown> | null | undefined): LearningArtifactType {
        const raw = String(
            ruleJson?.artifact_type
            || (ruleJson?.metadata as Record<string, unknown> | undefined)?.artifact_type
            || ''
        ).toLowerCase();
        return raw === 'medical_report' ? 'medical_report' : 'medical_history';
    }

    private static resolveRuleSpecialty(ruleJson: Record<string, unknown> | null | undefined): string {
        const raw = String(
            ruleJson?.specialty
            || (ruleJson?.applicable_when as Record<string, unknown> | undefined)?.specialty
            || ''
        );
        return normalizeClinicalSpecialty(raw);
    }

    private static normalizeClinicianScope(specialty?: string, clinicianProfile?: string | null): string {
        const normalizedSpecialty = normalizeClinicalSpecialty(specialty);
        const normalizedClinician = normalizeClinicianProfileForSpecialty(normalizedSpecialty, clinicianProfile);
        if (normalizedSpecialty === 'otorrino') return normalizedClinician || 'gotxi';
        return normalizedClinician || 'ainhoa';
    }

    private static resolveRuleClinicianProfile(
        ruleJson: Record<string, unknown> | null | undefined,
        specialty?: string
    ): string {
        const raw = String(
            ruleJson?.clinician_profile
            || (ruleJson?.applicable_when as Record<string, unknown> | undefined)?.clinician_profile
            || ''
        );
        return MemoryService.normalizeClinicianScope(specialty || MemoryService.resolveRuleSpecialty(ruleJson), raw);
    }

    private static resolveRuleSection(ruleJson: Record<string, unknown> | null | undefined): string {
        return String(
            ruleJson?.target_section
            || ruleJson?.section
            || (ruleJson?.applicable_when as Record<string, unknown> | undefined)?.section
            || ''
        ).toLowerCase();
    }

    private static resolveRulePatternKey(ruleJson: Record<string, unknown> | null | undefined): string {
        return String(ruleJson?.pattern_key || '').trim().toLowerCase();
    }

    private static resolveRuleReasonCode(ruleJson: Record<string, unknown> | null | undefined): string {
        return String(ruleJson?.doctor_reason_code || '').trim().toLowerCase();
    }

    private static resolveRuleSignalStrength(ruleJson: Record<string, unknown> | null | undefined): string {
        return String(ruleJson?.signal_strength || '').trim().toLowerCase();
    }

    private static formatRuleReason(reasonCode: string): string {
        if (reasonCode === 'terminologia') return 'terminologia';
        if (reasonCode === 'omision') return 'omision';
        if (reasonCode === 'error_clinico') return 'criterio clinico';
        if (reasonCode === 'formato') return 'formato';
        if (reasonCode === 'redaccion') return 'redaccion';
        return '';
    }

    private static buildScopeKey(context: {
        specialty?: string;
        artifactType?: LearningArtifactType;
        section?: string;
        clinicianProfile?: string | null;
    }): string {
        const specialty = normalizeClinicalSpecialty(context.specialty);
        const artifactType = context.artifactType || 'medical_history';
        const section = String(context.section || 'generation').trim().toLowerCase();
        const clinicianScope = MemoryService.normalizeClinicianScope(specialty, context.clinicianProfile);
        return `${specialty}:${clinicianScope}:${artifactType}:${section}`;
    }

    private static getCurrentWindowIds(now = new Date()): Omit<ScopeConsolidationState, 'updated_at'> {
        const date = new Date(now);
        const daily = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        const weekDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = weekDate.getUTCDay() || 7;
        weekDate.setUTCDate(weekDate.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((weekDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        const weekly = `${weekDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;

        const monthly = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        return { daily, weekly, monthly };
    }

    private static readScopeConsolidationState(scopeKey: string): ScopeConsolidationState | null {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return null;
            const raw = window.localStorage.getItem(MemoryService.CONSOLIDATION_SCOPE_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as Record<string, ScopeConsolidationState>;
            return parsed[scopeKey] || null;
        } catch {
            return null;
        }
    }

    private static writeScopeConsolidationState(scopeKey: string, state: ScopeConsolidationState): void {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return;
            const raw = window.localStorage.getItem(MemoryService.CONSOLIDATION_SCOPE_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) as Record<string, ScopeConsolidationState> : {};
            parsed[scopeKey] = state;
            window.localStorage.setItem(MemoryService.CONSOLIDATION_SCOPE_STORAGE_KEY, JSON.stringify(parsed));
        } catch {
            // Best-effort persistence; learning still works without this cache.
        }
    }

    private static isScopeConsolidationDue(scopeKey: string): boolean {
        const stored = MemoryService.readScopeConsolidationState(scopeKey);
        if (!stored) return true;
        const current = MemoryService.getCurrentWindowIds();
        return stored.daily !== current.daily || stored.weekly !== current.weekly || stored.monthly !== current.monthly;
    }

    private static buildPromptRuleText(rule: {
        rule_text: string;
        category?: string;
        rule_json?: Record<string, unknown> | null;
    }): string {
        const ruleJson = (rule.rule_json || {}) as Record<string, unknown>;
        const section = String(ruleJson.target_section || ruleJson.section || 'general').trim();
        const fieldPath = String(ruleJson.field_path || '').trim().split('.').filter(Boolean).pop() || 'contenido';
        const fieldLabel = fieldPath.replace(/_/g, ' ').trim();
        const exampleAfter = String(ruleJson.example_after || '').trim();
        const reason = MemoryService.formatRuleReason(MemoryService.resolveRuleReasonCode(ruleJson));
        const signalStrength = MemoryService.resolveRuleSignalStrength(ruleJson);
        const category = String(rule.category || '').toLowerCase();
        const sourceText = String(rule.rule_text || '').trim();

        const base = category === 'missing_data'
            ? `En ${section}, no omitir datos explicitamente presentes en ${fieldLabel}; si aparecen, incluirlos de forma fiel.`
            : category === 'clinical'
                ? `En ${section}, mantener el criterio clinico y el contenido relevante del profesional en ${fieldLabel}, sin reinterpretar.`
                : category === 'hallucination'
                    ? `En ${section}, eliminar o evitar afirmaciones no sustentadas al redactar ${fieldLabel}.`
                    : category === 'terminology'
                        ? `En ${section}, respetar la terminologia preferida por el profesional al redactar ${fieldLabel}.`
                        : category === 'formatting'
                            ? `En ${section}, mantener el formato y la estructura esperados para ${fieldLabel}.`
                            : `En ${section}, redactar ${fieldLabel} de forma breve, clara y clinicamente util.`;

        const reasonSuffix = reason ? ` Motivo repetido: ${reason}.` : '';
        const signalSuffix = signalStrength === 'high' ? ' Evidencia fuerte de correccion manual.' : '';
        const exampleSuffix = exampleAfter ? ` Ejemplo observado: "${exampleAfter}".` : '';
        const fallbackSuffix = !exampleAfter && sourceText ? ` Referencia aprendida: ${sourceText}` : '';
        return `${base}${reasonSuffix}${signalSuffix}${exampleSuffix}${fallbackSuffix}`.trim();
    }

    private static getRuleAgeDays(lastSeenAt: string): number {
        const parsed = Date.parse(String(lastSeenAt || ''));
        if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
        return Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60 * 24));
    }

    private static selectWindowedRules(
        ranked: RankedRuleCandidate[],
        tokenBudget: number
    ): { applied: RulePackRule[]; lines: string[] } {
        const applied: RulePackRule[] = [];
        const lines: string[] = [];
        const seenPatternKeys = new Set<string>();
        const seenPromptTexts = new Set<string>();
        let previousMaxAgeDays = 0;

        for (const windowConfig of MemoryService.CONSOLIDATION_WINDOWS) {
            const eligible = ranked
                .filter((rule) => {
                    const ageDays = MemoryService.getRuleAgeDays(rule.last_seen_at);
                    if (ageDays > windowConfig.maxAgeDays) return false;
                    if (windowConfig.name !== 'daily' && ageDays <= previousMaxAgeDays) return false;
                    if (Number(rule.confidence_score || 0) < windowConfig.minConfidence) return false;
                    if (Number(rule.evidence_count || 0) < windowConfig.minEvidence) return false;

                    const patternKey = MemoryService.resolveRulePatternKey(rule.rule_json)
                        || `${rule.category}:${MemoryService.resolveRuleSection(rule.rule_json)}:${rule.id}`;
                    if (seenPatternKeys.has(patternKey)) return false;

                    const normalizedPrompt = String(rule.prompt_text || '').trim().toLowerCase();
                    if (!normalizedPrompt || seenPromptTexts.has(normalizedPrompt)) return false;
                    return true;
                })
                .sort((a, b) => b.priority - a.priority)
                .slice(0, windowConfig.maxRules);

            if (eligible.length === 0) {
                previousMaxAgeDays = windowConfig.maxAgeDays;
                continue;
            }

            const sectionHeader = `## ${windowConfig.title}`;
            const projectedSection = [...lines, sectionHeader].join('\n');
            if (MemoryService.estimateTokens(projectedSection) <= tokenBudget) {
                lines.push(sectionHeader);
            }

            for (const rule of eligible) {
                const line = `- [${windowConfig.name}/${rule.category}] (c=${Number(rule.confidence_score || 0).toFixed(2)}, p=${rule.priority.toFixed(2)}) ${rule.prompt_text}`;
                const projected = [...lines, line].join('\n');
                if (MemoryService.estimateTokens(projected) > tokenBudget) {
                    recordLearningMetric('rule_pack_token_budget_exceeded');
                    continue;
                }

                const patternKey = MemoryService.resolveRulePatternKey(rule.rule_json)
                    || `${rule.category}:${MemoryService.resolveRuleSection(rule.rule_json)}:${rule.id}`;
                const normalizedPrompt = String(rule.prompt_text || '').trim().toLowerCase();
                seenPatternKeys.add(patternKey);
                seenPromptTexts.add(normalizedPrompt);
                lines.push(line);
                applied.push({
                    id: rule.id,
                    text: rule.prompt_text,
                    category: (rule.category as RulePackRule['category']) || 'style',
                    confidence: Number(rule.confidence_score || 0),
                    priority: Number(rule.priority || 0),
                    specialty: MemoryService.resolveRuleSpecialty(rule.rule_json),
                    artifact_type: MemoryService.resolveRuleArtifactType(rule.rule_json),
                    target_section: String((rule.rule_json || {}).target_section || (rule.rule_json || {}).section || ''),
                    scope_level: ((rule.rule_json || {}).scope_level as RulePackRule['scope_level']) || 'section',
                    doctor_reason_code: ((rule.rule_json || {}).doctor_reason_code as RulePackRule['doctor_reason_code']) || undefined,
                    manual_weight: Number((rule.rule_json || {}).manual_weight || 1),
                    applicable_when: {
                        ...((rule.rule_json || {}).applicable_when as Record<string, unknown> | undefined),
                        pattern_key: MemoryService.resolveRulePatternKey(rule.rule_json) || undefined,
                        clinician_profile: MemoryService.resolveRuleClinicianProfile(rule.rule_json, MemoryService.resolveRuleSpecialty(rule.rule_json)),
                        consolidation_window: windowConfig.name
                    },
                    source_rule_ids: [rule.id],
                    updated_at: rule.updated_at
                });
            }

            previousMaxAgeDays = windowConfig.maxAgeDays;
        }

        return { applied, lines };
    }

    private static doesRuleMatchContext(
        ruleJson: Record<string, unknown> | null | undefined,
        context: { specialty?: string; artifactType?: LearningArtifactType; section?: string; clinicianProfile?: string | null }
    ): boolean {
        const requestSpecialty = normalizeClinicalSpecialty(context.specialty);
        const ruleSpecialty = MemoryService.resolveRuleSpecialty(ruleJson);
        if (requestSpecialty && ruleSpecialty && requestSpecialty !== ruleSpecialty) return false;

        const requestArtifactType = context.artifactType || 'medical_history';
        const ruleArtifactType = MemoryService.resolveRuleArtifactType(ruleJson);
        if (requestArtifactType !== ruleArtifactType) return false;

        const requestSection = String(context.section || '').toLowerCase();
        const ruleSection = MemoryService.resolveRuleSection(ruleJson);
        if (ruleSection && requestSection && !ruleSection.includes(requestSection) && !requestSection.includes(ruleSection)) {
            return false;
        }

        const requestClinician = MemoryService.normalizeClinicianScope(requestSpecialty, context.clinicianProfile);
        const ruleClinician = MemoryService.resolveRuleClinicianProfile(ruleJson, requestSpecialty);
        if (requestClinician && ruleClinician && requestClinician !== ruleClinician) return false;

        return true;
    }

    private static isPreferredClinicalCategory(category: string): boolean {
        return ['clinical', 'missing_data', 'hallucination', 'terminology'].includes(String(category || '').toLowerCase());
    }

    private static buildRulePriority(rule: {
        confidence_score?: number;
        category?: string;
        rule_json?: Record<string, unknown> | null;
        last_seen_at?: string;
    }, context: {
        section?: string;
        specialty?: string;
        artifactType?: LearningArtifactType;
        clinicianProfile?: string | null;
        classification?: ConsultationClassification;
    }): number {
        const confidence = Number(rule.confidence_score || 0);
        const categoryWeight = rule.category === 'hallucination'
            ? 1.35
            : rule.category === 'missing_data'
                ? 1.25
                : rule.category === 'clinical'
                    ? 1.15
                    : rule.category === 'terminology'
                        ? 1
                        : 0.9;

        let relevance = 1;
        const ruleJson = (rule.rule_json || {}) as Record<string, unknown>;
        if (!MemoryService.doesRuleMatchContext(ruleJson, context)) return 0;

        const targetSection = MemoryService.resolveRuleSection(ruleJson);
        const requestSection = String(context.section || '').toLowerCase();
        if (targetSection && requestSection && targetSection.includes(requestSection)) {
            relevance += 0.35;
        }

        const requestSpecialty = normalizeClinicalSpecialty(context.specialty);
        const ruleSpecialty = MemoryService.resolveRuleSpecialty(ruleJson);
        if (requestSpecialty && ruleSpecialty && requestSpecialty === ruleSpecialty) {
            relevance += 0.3;
        }

        const requestClinician = MemoryService.normalizeClinicianScope(requestSpecialty, context.clinicianProfile);
        const ruleClinician = MemoryService.resolveRuleClinicianProfile(ruleJson, requestSpecialty);
        if (requestClinician && ruleClinician && requestClinician === ruleClinician) {
            relevance += 0.25;
        }

        const entArea = String(context.classification?.ent_area || '').toLowerCase();
        const urgency = String(context.classification?.urgency || '').toLowerCase();
        const text = JSON.stringify(ruleJson).toLowerCase();
        if (entArea && text.includes(entArea)) relevance += 0.15;
        if (urgency && text.includes(urgency)) relevance += 0.1;

        const reasonCode = MemoryService.resolveRuleReasonCode(ruleJson);
        if (reasonCode === 'error_clinico') relevance += 0.22;
        else if (reasonCode === 'omision') relevance += 0.16;
        else if (reasonCode === 'terminologia') relevance += 0.1;

        const manualWeight = Number(ruleJson.manual_weight || 1);
        relevance += Math.max(0, Math.min(0.25, (manualWeight - 1) * 0.18));

        const signalStrength = MemoryService.resolveRuleSignalStrength(ruleJson);
        if (signalStrength === 'high') relevance += 0.12;
        else if (signalStrength === 'medium') relevance += 0.05;

        const ageMs = Date.now() - Date.parse(String(rule.last_seen_at || new Date().toISOString()));
        const recencyBoost = Number.isFinite(ageMs) ? Math.exp(-Math.max(0, ageMs) / (1000 * 60 * 60 * 24 * 21)) : 0.7;

        return confidence * categoryWeight * relevance * recencyBoost;
    }

    private static async getCandidateRules(limit = 300, artifactType: LearningArtifactType = 'medical_history'): Promise<Array<{
        id: string;
        rule_text: string;
        rule_json: Record<string, unknown>;
        category: string;
        confidence_score: number;
        lifecycle_state: string;
        last_seen_at: string;
        updated_at: string;
        evidence_count: number;
    }>> {
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('ai_rule_candidates')
            .select('id, rule_text, rule_json, category, confidence_score, lifecycle_state, last_seen_at, updated_at, evidence_count')
            .in('lifecycle_state', ['active', 'shadow'])
            .order('confidence_score', { ascending: false })
            .order('last_seen_at', { ascending: false })
            .limit(limit);

        if (error || !data) return [];
        const rows = data as Array<{
            id: string;
            rule_text: string;
            rule_json: Record<string, unknown>;
            category: string;
            confidence_score: number;
            lifecycle_state: string;
            last_seen_at: string;
            updated_at: string;
            evidence_count: number;
        }>;

        return rows.filter((rule) => MemoryService.resolveRuleArtifactType(rule.rule_json) === artifactType);
    }

    private static async ensureActiveRulePack(
        rules: RulePackRule[],
        context: { specialty: string; artifactType: LearningArtifactType; section: string; clinicianProfile?: string | null }
    ): Promise<{ id: string; version: number }> {
        if (!supabase) return { id: 'local', version: 0 };
        const clinicianProfile = MemoryService.normalizeClinicianScope(context.specialty, context.clinicianProfile);
        const scopedTargetSection = `${context.section}::${clinicianProfile}`;

        const { data: existingActive } = await supabase
            .from('ai_rule_pack_versions_v2')
            .select('id, version, pack_json')
            .eq('active', true)
            .eq('specialty', context.specialty)
            .eq('artifact_type', context.artifactType)
            .eq('target_section', scopedTargetSection)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();

        const compactRules = rules.map((rule) => ({
            id: rule.id,
            category: rule.category,
            confidence: rule.confidence,
            priority: rule.priority,
            text: rule.text,
            applicable_when: rule.applicable_when,
            source_rule_ids: rule.source_rule_ids
        }));

        const currentPayload = JSON.stringify(compactRules);
        const previousPayload = JSON.stringify((existingActive?.pack_json as any)?.rules || []);

        if (existingActive?.id && previousPayload === currentPayload) {
            return { id: existingActive.id, version: Number(existingActive.version || 0) };
        }

        const { data: lastVersion } = await supabase
            .from('ai_rule_pack_versions_v2')
            .select('version')
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();

        const nextVersion = Number(lastVersion?.version || 0) + 1;
        await supabase.from('ai_rule_pack_versions_v2').update({ active: false }).eq('active', true);

        const { data: inserted } = await supabase
            .from('ai_rule_pack_versions_v2')
            .insert([{
                version: nextVersion,
                specialty: context.specialty,
                artifact_type: context.artifactType,
                target_section: scopedTargetSection,
                pack_json: {
                    model: MEMORY_MODEL,
                    specialty: context.specialty,
                    artifact_type: context.artifactType,
                    target_section: context.section,
                    clinician_profile: clinicianProfile,
                    rules: compactRules
                },
                active: true,
                rollout_pct: 100,
                source_rule_ids: rules.map((rule) => rule.id),
                updated_at: new Date().toISOString()
            }])
            .select('id, version')
            .maybeSingle();

        return {
            id: inserted?.id || 'local',
            version: Number(inserted?.version || nextVersion)
        };
    }

    static async consolidateLearningWindows(
        groqApiKey: string | string[],
        options?: {
            specialty?: string;
            artifactType?: LearningArtifactType;
            section?: string;
            clinicianProfile?: string | null;
        }
    ): Promise<void> {
        void groqApiKey;
        if (!supabase || !LEARNING_V2_ENABLED) return;
        if (MemoryService.pipelineBusy) return;
        if (MemoryService.isCircuitOpen()) return;
        const specialty = normalizeClinicalSpecialty(options?.specialty);
        const artifactType = options?.artifactType || 'medical_history';
        const section = options?.section || 'generation';
        const clinicianProfile = MemoryService.normalizeClinicianScope(specialty, options?.clinicianProfile);
        const scopeKey = MemoryService.buildScopeKey({ specialty, artifactType, section, clinicianProfile });

        try {
            const rules = await MemoryService.getCandidateRules(500, artifactType);
            const activeRules = rules.filter((rule) => rule.lifecycle_state === 'active' || rule.lifecycle_state === 'shadow');
            if (activeRules.length === 0) {
                MemoryService.writeScopeConsolidationState(scopeKey, {
                    ...MemoryService.getCurrentWindowIds(),
                    updated_at: new Date().toISOString()
                });
                return;
            }

            const rankedCandidates: RankedRuleCandidate[] = activeRules
                .filter((rule) => {
                    if (MemoryService.isPreferredClinicalCategory(rule.category)) return true;
                    if (rule.category === 'style' || rule.category === 'formatting') {
                        return Number(rule.confidence_score || 0) >= 0.72;
                    }
                    return false;
                })
                .map((rule) => ({
                    ...rule,
                    prompt_text: MemoryService.buildPromptRuleText(rule),
                    evidence_count: Number(rule.evidence_count || 0),
                    priority: MemoryService.buildRulePriority(rule, { specialty, artifactType, clinicianProfile })
                }))
                .sort((a, b) => {
                    const aPreferred = MemoryService.isPreferredClinicalCategory(a.category) ? 1 : 0;
                    const bPreferred = MemoryService.isPreferredClinicalCategory(b.category) ? 1 : 0;
                    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
                    return b.priority - a.priority;
                });

            const { applied: prioritizedRules, lines: prioritizedRuleLines } = MemoryService.selectWindowedRules(
                rankedCandidates,
                1200
            );

            await MemoryService.ensureActiveRulePack(prioritizedRules, {
                specialty,
                artifactType,
                section,
                clinicianProfile
            });

            // Keep legacy long-term memory synchronized as plain text fallback.
            const legacySummary = prioritizedRules
                .sort((a, b) => b.priority - a.priority)
                .slice(0, 80)
                .map((rule) => `- [${rule.category}] ${rule.text}`)
                .join('\n');

            const { data: existingMemory } = await supabase
                .from('ai_long_term_memory')
                .select('id')
                .limit(1)
                .maybeSingle();

            if (existingMemory?.id) {
                await supabase
                    .from('ai_long_term_memory')
                    .update({
                        global_rules: legacySummary,
                        global_rules_json: {
                            terminology: prioritizedRules.filter((r) => r.category === 'terminology').map((r) => r.text),
                            formatting: prioritizedRules.filter((r) => r.category === 'formatting').map((r) => r.text),
                            style: prioritizedRules.filter((r) => r.category === 'style').map((r) => r.text),
                            clinical: prioritizedRules.filter((r) => r.category === 'clinical' || r.category === 'missing_data' || r.category === 'hallucination').map((r) => r.text)
                        },
                        daily_lessons: prioritizedRuleLines.join('\n'),
                        last_consolidated_at: new Date().toISOString()
                    })
                    .eq('id', existingMemory.id);
            } else {
                await supabase.from('ai_long_term_memory').insert([{
                    global_rules: legacySummary,
                    global_rules_json: {
                        terminology: prioritizedRules.filter((r) => r.category === 'terminology').map((r) => r.text),
                        formatting: prioritizedRules.filter((r) => r.category === 'formatting').map((r) => r.text),
                        style: prioritizedRules.filter((r) => r.category === 'style').map((r) => r.text),
                        clinical: prioritizedRules.filter((r) => r.category === 'clinical' || r.category === 'missing_data' || r.category === 'hallucination').map((r) => r.text)
                    },
                    daily_lessons: prioritizedRuleLines.join('\n'),
                    last_consolidated_at: new Date().toISOString()
                }]);
            }

            MemoryService.invalidateCache();
            MemoryService.writeScopeConsolidationState(scopeKey, {
                ...MemoryService.getCurrentWindowIds(),
                updated_at: new Date().toISOString()
            });
            MemoryService.markSuccess();
        } catch (error) {
            MemoryService.markFailure();
            console.error('[MemoryService] consolidation failed:', error);
        }
    }

    static async consolidateDailyLessons(
        groqApiKey: string | string[],
        options?: {
            specialty?: string;
            artifactType?: LearningArtifactType;
            section?: string;
        }
    ): Promise<void> {
        await MemoryService.consolidateLearningWindows(groqApiKey, options);
    }

    static async getRulePackContext(options?: {
        section?: string;
        specialty?: string;
        artifactType?: LearningArtifactType;
        clinicianProfile?: string | null;
        classification?: ConsultationClassification;
        tokenBudget?: number;
    }): Promise<RulePackContext> {
        const section = options?.section || 'generation';
        const specialty = normalizeClinicalSpecialty(options?.specialty);
        const artifactType = options?.artifactType || 'medical_history';
        const clinicianProfile = MemoryService.normalizeClinicianScope(specialty, options?.clinicianProfile);
        const classification = options?.classification;
        const tokenBudget = Math.max(300, Math.min(1200, options?.tokenBudget || 850));

        const emptyPack: RulePack = {
            id: 'empty',
            version: 0,
            rules: [],
            created_at: new Date().toISOString()
        };

        if (!RULEPACK_APPLY_ENABLED || !LEARNING_V2_ENABLED || !supabase) {
            return {
                pack: emptyPack,
                applied_rules: [],
                prompt_context: 'Ninguna regla de aprendizaje activa.',
                token_estimate: 0
            };
        }

        const cacheKey = JSON.stringify({
            section,
            specialty,
            artifactType,
            clinicianProfile,
            ent: classification?.ent_area || '',
            urg: classification?.urgency || '',
            budget: tokenBudget
        });
        const now = Date.now();
        const cached = MemoryService.rulePackCache.get(cacheKey);
        if (cached && cached.expiresAt > now) return cached.value;
        if ((MemoryService.pipelineBusy || MemoryService.isCircuitOpen()) && cached) return cached.value;

        try {
            const scopeKey = MemoryService.buildScopeKey({ specialty, artifactType, section, clinicianProfile });
            if (MemoryService.isScopeConsolidationDue(scopeKey)) {
                await MemoryService.consolidateLearningWindows('', {
                    specialty,
                    artifactType,
                    section,
                    clinicianProfile
                });
            }

            const candidates = await MemoryService.getCandidateRules(300, artifactType);
            const ranked: RankedRuleCandidate[] = candidates
                .map((rule) => ({
                    ...rule,
                    priority: MemoryService.buildRulePriority(rule, { section, specialty, artifactType, clinicianProfile, classification }),
                    prompt_text: MemoryService.buildPromptRuleText(rule),
                    evidence_count: Number(rule.evidence_count || 0)
                }))
                .filter((rule) => {
                    if (rule.priority <= 0) return false;
                    if (MemoryService.isPreferredClinicalCategory(rule.category)) return true;
                    if (rule.category === 'style' || rule.category === 'formatting') {
                        return Number(rule.confidence_score || 0) >= 0.72;
                    }
                    return false;
                })
                .filter((rule) => MemoryService.doesRuleMatchContext(rule.rule_json, {
                    specialty,
                    artifactType,
                    section,
                    clinicianProfile
                }))
                .sort((a, b) => {
                    const aPreferred = MemoryService.isPreferredClinicalCategory(a.category) ? 1 : 0;
                    const bPreferred = MemoryService.isPreferredClinicalCategory(b.category) ? 1 : 0;
                    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
                    return b.priority - a.priority;
                });

            const { applied, lines } = MemoryService.selectWindowedRules(ranked, tokenBudget);

            const persistedPack = await MemoryService.ensureActiveRulePack(applied, {
                specialty,
                artifactType,
                section,
                clinicianProfile
            });
            const promptContext = applied.length > 0
                ? lines.join('\n')
                : 'Ninguna regla de aprendizaje activa.';

            const result: RulePackContext = {
                pack: {
                    id: persistedPack.id,
                    version: persistedPack.version,
                    rules: applied,
                    created_at: new Date().toISOString()
                },
                applied_rules: applied,
                prompt_context: promptContext,
                token_estimate: MemoryService.estimateTokens(promptContext)
            };

            MemoryService.rulePackCache.set(cacheKey, {
                value: result,
                expiresAt: now + MemoryService.RULEPACK_CACHE_TTL_MS
            });
            MemoryService.markSuccess();
            return result;
        } catch (error) {
            MemoryService.markFailure();
            console.error('[MemoryService] getRulePackContext failed:', error);
            if (cached) return cached.value;
            return {
                pack: emptyPack,
                applied_rules: [],
                prompt_context: 'Ninguna regla de aprendizaje activa.',
                token_estimate: 0
            };
        }
    }

    static async getHybridContext(options?: {
        specialty?: string;
        artifactType?: LearningArtifactType;
        section?: string;
        classification?: ConsultationClassification;
        tokenBudget?: number;
    }): Promise<HybridContext> {
        if (!supabase) return { global_rules: '', daily_lessons: '', total_lessons_count: 0 };

        try {
            const now = Date.now();
            if (MemoryService.hybridCache && MemoryService.hybridCache.expiresAt > now) {
                return MemoryService.hybridCache.value;
            }
            if ((MemoryService.pipelineBusy || MemoryService.isCircuitOpen()) && MemoryService.hybridCache) {
                return MemoryService.hybridCache.value;
            }

            const rulePackContext = await MemoryService.getRulePackContext({
                section: options?.section || 'generation',
                specialty: normalizeClinicalSpecialty(options?.specialty),
                artifactType: options?.artifactType || 'medical_history',
                classification: options?.classification,
                tokenBudget: options?.tokenBudget || 900
            });
            const rules = rulePackContext.applied_rules;
            const grouped = {
                terminology: rules.filter((r) => MemoryService.normalizeCategory(r.category) === 'terminology').map((r) => r.text),
                formatting: rules.filter((r) => MemoryService.normalizeCategory(r.category) === 'formatting').map((r) => r.text),
                style: rules.filter((r) => MemoryService.normalizeCategory(r.category) === 'style').map((r) => r.text),
                clinical: rules.filter((r) => MemoryService.normalizeCategory(r.category) === 'clinical').map((r) => r.text)
            };

            const result: HybridContext = {
                global_rules: rules.map((r) => `- [${r.category}] ${r.text}`).join('\n'),
                daily_lessons: rules.filter((r) => r.priority > 0.4).slice(0, 10).map((r) => `- ${r.text}`).join('\n'),
                total_lessons_count: rules.length,
                global_rules_json: grouped
            };

            MemoryService.hybridCache = {
                value: result,
                expiresAt: now + MemoryService.HYBRID_CACHE_TTL_MS
            };

            return result;
        } catch (error) {
            MemoryService.markFailure();
            console.error('[MemoryService] getHybridContext failed:', error);
            if (MemoryService.hybridCache) return MemoryService.hybridCache.value;
            return { global_rules: '', daily_lessons: '', total_lessons_count: 0 };
        }
    }
}

