import { supabase } from '../supabase';
import { deriveDecisionType, resolveNextLifecycleState } from './rule-lifecycle';
import { LearningLifecycleState, RuleEvaluationInput, RuleEvaluationWindow } from './types';
import { recordLearningMetric } from '../audit-worker';

const levenshtein = (a: string, b: string): number => {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

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

const parseSections = (text: string): Record<string, string> => {
    const sections: Record<string, string> = {};
    const lines = (text || '').split('\n');
    let current = 'HEADER';
    let content: string[] = [];

    const flush = () => {
        sections[current] = content.join('\n').trim();
        content = [];
    };

    for (const line of lines) {
        const trimmed = line.trim();
        const mdHeader = trimmed.match(/^#{1,6}\s+(.+)$/);
        const header = mdHeader ? mdHeader[1] : null;
        const isUpperHeader = /^[A-ZÁÉÍÓÚÜÑ0-9\s:]{3,}$/.test(trimmed) && trimmed === trimmed.toUpperCase();
        if (header || isUpperHeader) {
            flush();
            current = (header || trimmed).replace(/:$/, '').trim().toUpperCase();
            continue;
        }
        content.push(line);
    }

    flush();
    return sections;
};

const calcSectionsChanged = (aiOutput: string, doctorOutput: string): number => {
    const a = parseSections(aiOutput);
    const b = parseSections(doctorOutput);
    const all = new Set([...Object.keys(a), ...Object.keys(b)]);
    let changed = 0;
    for (const key of all) {
        if ((a[key] || '').trim() !== (b[key] || '').trim()) changed += 1;
    }
    return changed;
};

const scoreFromInput = (input: RuleEvaluationInput): number => {
    const acceptance = input.uses > 0 ? input.accepted / input.uses : 0;
    const overrideRate = input.uses > 0 ? input.overridden / input.uses : 0;
    const safetyPenalty = (Math.max(0, input.hallucination_delta) * 4) + (Math.max(0, input.inconsistency_delta) * 4);
    return Number((acceptance - (overrideRate * 0.8) - Math.max(0, input.edit_delta) - safetyPenalty).toFixed(3));
};

const today = () => new Date().toISOString().slice(0, 10);

const toWindow = (evalRow: {
    edit_delta?: number | null;
    hallucination_delta?: number | null;
    inconsistency_delta?: number | null;
    uses?: number | null;
    overridden?: number | null;
}): RuleEvaluationWindow => ({
    edit_rate_delta: Number(evalRow.edit_delta || 0),
    hallucination_delta: Number(evalRow.hallucination_delta || 0),
    inconsistency_delta: Number(evalRow.inconsistency_delta || 0),
    doctor_override_rate: Number(evalRow.uses || 0) > 0 ? Number(evalRow.overridden || 0) / Number(evalRow.uses) : 0
});

export interface EvaluateRuleImpactParams {
    ruleIds: string[];
    aiOutput: string;
    doctorOutput: string;
    hallucinationDelta?: number;
    inconsistencyDelta?: number;
    metadata?: Record<string, unknown>;
}

export const evaluateAndPersistRuleImpact = async (params: EvaluateRuleImpactParams): Promise<void> => {
    if (!supabase) return;
    const ruleIds = Array.from(new Set(params.ruleIds.filter(Boolean)));
    if (ruleIds.length === 0) return;

    const baseLen = Math.max(1, (params.aiOutput || '').length, (params.doctorOutput || '').length);
    const editDistanceRatio = levenshtein(params.aiOutput || '', params.doctorOutput || '') / baseLen;
    const sectionsChanged = calcSectionsChanged(params.aiOutput || '', params.doctorOutput || '');
    const overridden = editDistanceRatio > 0.02 || sectionsChanged > 0 ? 1 : 0;

    for (const ruleId of ruleIds) {
        const { data: existingEval } = await supabase
            .from('ai_rule_evaluations')
            .select('*')
            .eq('rule_id', ruleId)
            .eq('metric_date', today())
            .maybeSingle();

        const nextUses = Number(existingEval?.uses || 0) + 1;
        const nextOverridden = Number(existingEval?.overridden || 0) + overridden;
        const nextAccepted = Number(existingEval?.accepted || 0) + (overridden ? 0 : 1);

        const evalInput: RuleEvaluationInput = {
            rule_id: ruleId,
            uses: nextUses,
            accepted: nextAccepted,
            overridden: nextOverridden,
            edit_delta: Number(editDistanceRatio.toFixed(4)),
            hallucination_delta: Number((params.hallucinationDelta || 0).toFixed(4)),
            inconsistency_delta: Number((params.inconsistencyDelta || 0).toFixed(4)),
            score: 0,
            metadata: {
                ...params.metadata,
                sections_changed: sectionsChanged
            }
        };
        evalInput.score = scoreFromInput(evalInput);

        const payload = {
            rule_id: ruleId,
            metric_date: today(),
            uses: evalInput.uses,
            accepted: evalInput.accepted,
            overridden: evalInput.overridden,
            edit_delta: evalInput.edit_delta,
            hallucination_delta: evalInput.hallucination_delta,
            inconsistency_delta: evalInput.inconsistency_delta,
            score: evalInput.score,
            metadata: evalInput.metadata || {}
        };

        if (existingEval?.id) {
            await supabase.from('ai_rule_evaluations').update(payload).eq('id', existingEval.id);
        } else {
            await supabase.from('ai_rule_evaluations').insert([payload]);
        }

        const { data: candidate } = await supabase
            .from('ai_rule_candidates')
            .select('*')
            .eq('id', ruleId)
            .maybeSingle();

        if (!candidate) continue;

        const prevState = candidate.lifecycle_state as LearningLifecycleState;
        const nextState = resolveNextLifecycleState(prevState, {
            evidence_count: Number(candidate.evidence_count || 0),
            contradiction_count: Number(candidate.contradiction_count || 0)
        }, toWindow(payload));

        if (nextState !== prevState) {
            await supabase
                .from('ai_rule_candidates')
                .update({
                    lifecycle_state: nextState,
                    updated_at: new Date().toISOString(),
                    metrics_snapshot: payload,
                    promoted_at: nextState === 'active' ? new Date().toISOString() : candidate.promoted_at
                })
                .eq('id', ruleId);

            const decision = deriveDecisionType(prevState, nextState);
            if (decision) {
                await supabase.from('ai_learning_decisions').insert([{
                    rule_id: ruleId,
                    decision_type: decision,
                    reason: 'automatic_evaluation',
                    metrics_snapshot: payload,
                    context: {
                        previous_state: prevState,
                        new_state: nextState
                    }
                }]);

                if (decision === 'promote') recordLearningMetric('rule_promotions');
                if (decision === 'rollback' || decision === 'demote') recordLearningMetric('rule_rollbacks');
                if (decision === 'block') recordLearningMetric('rule_conflict_incidents');
            }
        }
    }
};

