import { LearningLifecycleState, RuleCandidateRecord, RuleEvaluationWindow } from './types';

const RULE_AUTO_PROMOTE_ENABLED = String(import.meta.env.VITE_RULE_AUTO_PROMOTE_ENABLED ?? 'true').toLowerCase() === 'true';

const CATEGORY_WEIGHT: Record<string, number> = {
    hallucination: 1.3,
    missing_data: 1.2,
    clinical: 1.15,
    terminology: 1.0,
    style: 0.9,
    formatting: 0.85
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const contradictionRatio = (candidate: Pick<RuleCandidateRecord, 'evidence_count' | 'contradiction_count'>): number => {
    const evidence = Math.max(1, Number(candidate.evidence_count || 0));
    return Number(candidate.contradiction_count || 0) / evidence;
};

export const computeConfidenceScore = (params: {
    evidence_count: number;
    contradiction_count: number;
    category: string;
    recencyHours?: number;
    doctor_override_rate?: number;
}): number => {
    const evidence = Math.max(0, params.evidence_count || 0);
    const contradiction = Math.max(0, params.contradiction_count || 0);
    const baseEvidence = 1 - Math.exp(-evidence / 4);
    const contradictionPenalty = 1 - clamp(contradiction / Math.max(1, evidence), 0, 1);
    const categoryWeight = CATEGORY_WEIGHT[params.category] ?? 0.9;
    const recencyDecay = params.recencyHours && params.recencyHours > 0
        ? Math.exp(-params.recencyHours / (24 * 21))
        : 1;
    const overridePenalty = 1 - clamp(params.doctor_override_rate ?? 0, 0, 0.95);

    return clamp(baseEvidence * contradictionPenalty * categoryWeight * recencyDecay * overridePenalty, 0, 1);
};

export const shouldMoveCandidateToShadow = (candidate: Pick<RuleCandidateRecord, 'evidence_count' | 'contradiction_count'>): boolean => {
    if (!RULE_AUTO_PROMOTE_ENABLED) return false;
    return candidate.evidence_count >= 3 && contradictionRatio(candidate) < 0.25;
};

export const shouldPromoteShadowToActive = (window: RuleEvaluationWindow): boolean => {
    if (!RULE_AUTO_PROMOTE_ENABLED) return false;
    return (
        window.edit_rate_delta <= -0.05
        && window.hallucination_delta <= 0.005
        && window.inconsistency_delta <= 0.005
    );
};

export const shouldDemoteActive = (window: RuleEvaluationWindow): boolean => {
    return (
        window.edit_rate_delta > 0
        || window.hallucination_delta > 0.005
        || window.inconsistency_delta > 0.005
    );
};

export const shouldBlockActive = (window: RuleEvaluationWindow): boolean => {
    return window.hallucination_delta > 0.015 || window.inconsistency_delta > 0.015;
};

export const resolveNextLifecycleState = (
    currentState: LearningLifecycleState,
    candidate: Pick<RuleCandidateRecord, 'evidence_count' | 'contradiction_count'>,
    window?: RuleEvaluationWindow
): LearningLifecycleState => {
    if (currentState === 'blocked') return 'blocked';

    if (currentState === 'candidate') {
        return shouldMoveCandidateToShadow(candidate) ? 'shadow' : 'candidate';
    }

    if (currentState === 'shadow') {
        if (!window) return 'shadow';
        return shouldPromoteShadowToActive(window) ? 'active' : 'shadow';
    }

    if (currentState === 'active') {
        if (!window) return 'active';
        if (shouldBlockActive(window)) return 'blocked';
        if (shouldDemoteActive(window)) return 'deprecated';
        return 'active';
    }

    if (currentState === 'deprecated' && window && shouldPromoteShadowToActive(window)) {
        return 'active';
    }

    return currentState;
};

export const deriveDecisionType = (
    prevState: LearningLifecycleState,
    nextState: LearningLifecycleState
): 'promote' | 'demote' | 'block' | 'rollback' | 'force_shadow' | 'resume' | null => {
    if (prevState === nextState) return null;
    if (nextState === 'blocked') return 'block';
    if ((prevState === 'active' && nextState === 'deprecated') || (prevState === 'shadow' && nextState === 'candidate')) return 'demote';
    if ((prevState === 'candidate' && nextState === 'shadow') || (prevState === 'shadow' && nextState === 'active')) return 'promote';
    if (prevState === 'deprecated' && nextState === 'active') return 'resume';
    if (nextState === 'shadow') return 'force_shadow';
    return 'rollback';
};

