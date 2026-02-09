import { supabase } from './supabase';
import { getTaskModels } from './model-registry';
import { recordLearningMetric } from './audit-worker';
import type { ConsultationClassification } from './groq';
import type { RulePack, RulePackContext, RulePackRule } from './learning/types';

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

export class MemoryService {
    private static hybridCache: { value: HybridContext; expiresAt: number } | null = null;
    private static rulePackCache = new Map<string, RulePackCacheEntry>();
    private static readonly HYBRID_CACHE_TTL_MS = 60_000;
    private static readonly RULEPACK_CACHE_TTL_MS = 30_000;
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

    private static buildRulePriority(rule: {
        confidence_score?: number;
        category?: string;
        rule_json?: Record<string, unknown> | null;
        last_seen_at?: string;
    }, context: { section?: string; classification?: ConsultationClassification }): number {
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
        const targetSection = String(ruleJson.section || '').toLowerCase();
        const requestSection = String(context.section || '').toLowerCase();
        if (targetSection && requestSection && targetSection.includes(requestSection)) {
            relevance += 0.35;
        }

        const entArea = String(context.classification?.ent_area || '').toLowerCase();
        const urgency = String(context.classification?.urgency || '').toLowerCase();
        const text = JSON.stringify(ruleJson).toLowerCase();
        if (entArea && text.includes(entArea)) relevance += 0.15;
        if (urgency && text.includes(urgency)) relevance += 0.1;

        const ageMs = Date.now() - Date.parse(String(rule.last_seen_at || new Date().toISOString()));
        const recencyBoost = Number.isFinite(ageMs) ? Math.exp(-Math.max(0, ageMs) / (1000 * 60 * 60 * 24 * 21)) : 0.7;

        return confidence * categoryWeight * relevance * recencyBoost;
    }

    private static async getCandidateRules(limit = 300): Promise<Array<{
        id: string;
        rule_text: string;
        rule_json: Record<string, unknown>;
        category: string;
        confidence_score: number;
        lifecycle_state: string;
        last_seen_at: string;
        updated_at: string;
    }>> {
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('ai_rule_candidates')
            .select('id, rule_text, rule_json, category, confidence_score, lifecycle_state, last_seen_at, updated_at')
            .in('lifecycle_state', ['active', 'shadow'])
            .order('confidence_score', { ascending: false })
            .order('last_seen_at', { ascending: false })
            .limit(limit);

        if (error || !data) return [];
        return data as Array<{
            id: string;
            rule_text: string;
            rule_json: Record<string, unknown>;
            category: string;
            confidence_score: number;
            lifecycle_state: string;
            last_seen_at: string;
            updated_at: string;
        }>;
    }

    private static async ensureActiveRulePack(rules: RulePackRule[]): Promise<{ id: string; version: number }> {
        if (!supabase) return { id: 'local', version: 0 };

        const { data: existingActive } = await supabase
            .from('ai_rule_pack_versions_v2')
            .select('id, version, pack_json')
            .eq('active', true)
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
                pack_json: {
                    model: MEMORY_MODEL,
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

    static async consolidateDailyLessons(groqApiKey: string | string[]): Promise<void> {
        void groqApiKey;
        if (!supabase || !LEARNING_V2_ENABLED) return;
        if (MemoryService.pipelineBusy) return;
        if (MemoryService.isCircuitOpen()) return;

        try {
            const rules = await MemoryService.getCandidateRules(500);
            const activeRules = rules.filter((rule) => rule.lifecycle_state === 'active' || rule.lifecycle_state === 'shadow');
            if (activeRules.length === 0) return;

            const mappedRules: RulePackRule[] = activeRules.map((rule) => ({
                id: rule.id,
                text: rule.rule_text,
                category: (rule.category as RulePackRule['category']) || 'style',
                priority: MemoryService.buildRulePriority(rule, {}),
                confidence: Number(rule.confidence_score || 0),
                applicable_when: (rule.rule_json || {}).applicable_when as Record<string, unknown> | undefined,
                source_rule_ids: [rule.id],
                updated_at: rule.updated_at
            }));

            await MemoryService.ensureActiveRulePack(mappedRules);

            // Keep legacy long-term memory synchronized as plain text fallback.
            const legacySummary = mappedRules
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
                            terminology: mappedRules.filter((r) => r.category === 'terminology').map((r) => r.text),
                            formatting: mappedRules.filter((r) => r.category === 'formatting').map((r) => r.text),
                            style: mappedRules.filter((r) => r.category === 'style').map((r) => r.text),
                            clinical: mappedRules.filter((r) => r.category === 'clinical' || r.category === 'missing_data' || r.category === 'hallucination').map((r) => r.text)
                        },
                        last_consolidated_at: new Date().toISOString()
                    })
                    .eq('id', existingMemory.id);
            } else {
                await supabase.from('ai_long_term_memory').insert([{
                    global_rules: legacySummary,
                    global_rules_json: {
                        terminology: mappedRules.filter((r) => r.category === 'terminology').map((r) => r.text),
                        formatting: mappedRules.filter((r) => r.category === 'formatting').map((r) => r.text),
                        style: mappedRules.filter((r) => r.category === 'style').map((r) => r.text),
                        clinical: mappedRules.filter((r) => r.category === 'clinical' || r.category === 'missing_data' || r.category === 'hallucination').map((r) => r.text)
                    },
                    last_consolidated_at: new Date().toISOString()
                }]);
            }

            MemoryService.invalidateCache();
            MemoryService.markSuccess();
        } catch (error) {
            MemoryService.markFailure();
            console.error('[MemoryService] consolidation failed:', error);
        }
    }

    static async getRulePackContext(options?: {
        section?: string;
        classification?: ConsultationClassification;
        tokenBudget?: number;
    }): Promise<RulePackContext> {
        const section = options?.section || 'generation';
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

        const cacheKey = JSON.stringify({ section, ent: classification?.ent_area || '', urg: classification?.urgency || '', budget: tokenBudget });
        const now = Date.now();
        const cached = MemoryService.rulePackCache.get(cacheKey);
        if (cached && cached.expiresAt > now) return cached.value;
        if ((MemoryService.pipelineBusy || MemoryService.isCircuitOpen()) && cached) return cached.value;

        try {
            const candidates = await MemoryService.getCandidateRules(300);
            const ranked = candidates
                .map((rule) => ({
                    ...rule,
                    priority: MemoryService.buildRulePriority(rule, { section, classification })
                }))
                .filter((rule) => rule.priority > 0)
                .sort((a, b) => b.priority - a.priority);

            const applied: RulePackRule[] = [];
            const lines: string[] = [];

            for (const rule of ranked) {
                const line = `- [${rule.category}] (c=${Number(rule.confidence_score || 0).toFixed(2)}, p=${rule.priority.toFixed(2)}) ${rule.rule_text}`;
                const projected = [...lines, line].join('\n');
                const projectedTokens = MemoryService.estimateTokens(projected);
                if (projectedTokens > tokenBudget) {
                    recordLearningMetric('rule_pack_token_budget_exceeded');
                    continue;
                }

                lines.push(line);
                applied.push({
                    id: rule.id,
                    text: rule.rule_text,
                    category: (rule.category as RulePackRule['category']) || 'style',
                    confidence: Number(rule.confidence_score || 0),
                    priority: Number(rule.priority || 0),
                    applicable_when: (rule.rule_json || {}).applicable_when as Record<string, unknown> | undefined,
                    source_rule_ids: [rule.id],
                    updated_at: rule.updated_at
                });

                if (applied.length >= 25) break;
            }

            const persistedPack = await MemoryService.ensureActiveRulePack(applied);
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

    static async getHybridContext(): Promise<HybridContext> {
        if (!supabase) return { global_rules: '', daily_lessons: '', total_lessons_count: 0 };

        try {
            const now = Date.now();
            if (MemoryService.hybridCache && MemoryService.hybridCache.expiresAt > now) {
                return MemoryService.hybridCache.value;
            }
            if ((MemoryService.pipelineBusy || MemoryService.isCircuitOpen()) && MemoryService.hybridCache) {
                return MemoryService.hybridCache.value;
            }

            const rulePackContext = await MemoryService.getRulePackContext({ section: 'generation', tokenBudget: 900 });
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

