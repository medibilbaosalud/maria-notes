export type LearningRuleCategory = 'formatting' | 'terminology' | 'missing_data' | 'hallucination' | 'style' | 'clinical';

export type LearningLifecycleState = 'candidate' | 'shadow' | 'active' | 'deprecated' | 'blocked';

export type LearningChangeType = 'added' | 'removed' | 'modified';

export type LearningSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface StructuredLearningEvent {
    id?: string;
    record_id?: string;
    audit_id?: string;
    session_id?: string;
    section: string;
    field_path: string;
    before_value: string;
    after_value: string;
    change_type: LearningChangeType;
    severity: LearningSeverity;
    source: string;
    category: LearningRuleCategory;
    normalized_before: string;
    normalized_after: string;
    signature_hash: string;
    metadata?: Record<string, unknown>;
    created_at?: string;
}

export interface RuleCandidateRecord {
    id?: string;
    signature_hash: string;
    rule_text: string;
    rule_json: Record<string, unknown>;
    category: LearningRuleCategory;
    evidence_count: number;
    contradiction_count: number;
    confidence_score: number;
    lifecycle_state: LearningLifecycleState;
    last_seen_at: string;
    promoted_at?: string;
    blocked_reason?: string;
    metrics_snapshot?: Record<string, unknown>;
    created_at?: string;
    updated_at?: string;
}

export interface RuleEvaluationWindow {
    edit_rate_delta: number;
    hallucination_delta: number;
    inconsistency_delta: number;
    doctor_override_rate: number;
}

export interface LearningEventResult {
    event_id?: string;
    candidate_id?: string;
    lifecycle_state?: LearningLifecycleState;
    event_ids: string[];
    candidate_ids: string[];
    structured_events: StructuredLearningEvent[];
}

export interface RulePackRule {
    id: string;
    text: string;
    category: LearningRuleCategory;
    priority: number;
    confidence: number;
    applicable_when?: Record<string, unknown>;
    source_rule_ids: string[];
    updated_at?: string;
}

export interface RulePack {
    id: string;
    version: number;
    rules: RulePackRule[];
    created_at: string;
}

export interface RulePackContext {
    pack: RulePack;
    applied_rules: RulePackRule[];
    prompt_context: string;
    token_estimate: number;
}

export interface RuleEvaluationInput {
    rule_id: string;
    uses: number;
    accepted: number;
    overridden: number;
    edit_delta: number;
    hallucination_delta: number;
    inconsistency_delta: number;
    score: number;
    metadata?: Record<string, unknown>;
}

