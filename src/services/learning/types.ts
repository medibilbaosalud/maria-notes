export type LearningRuleCategory = 'formatting' | 'terminology' | 'missing_data' | 'hallucination' | 'style' | 'clinical';

export type LearningLifecycleState = 'candidate' | 'shadow' | 'active' | 'deprecated' | 'blocked';

export type LearningChangeType = 'added' | 'removed' | 'modified';

export type LearningSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DoctorEditSource =
    | 'history_save'
    | 'history_autosave'
    | 'search_history_save'
    | 'search_history_autosave'
    | 'report_save';

export type LearningArtifactType = 'medical_history' | 'medical_report';

export type LearningSignalStrength = 'low' | 'medium' | 'high';

export type LearningEditIntent =
    | 'terminology'
    | 'missing_data'
    | 'hallucination'
    | 'clinical_decision'
    | 'style'
    | 'formatting';

export type LearningDoctorReasonCode =
    | 'terminologia'
    | 'omision'
    | 'error_clinico'
    | 'redaccion'
    | 'formato'
    | 'otro';

export type LearningScopeLevel = 'field' | 'section' | 'document';

export type LearningEditScope = 'minor' | 'sectional' | 'structural';

export interface LearningRuleContext {
    specialty?: string;
    artifact_type?: LearningArtifactType;
    target_section?: string;
    source_view?: DoctorEditSource;
}

export interface LearningEventMetadata extends Record<string, unknown> {
    artifact_type?: LearningArtifactType;
    source_view?: DoctorEditSource;
    signal_strength?: LearningSignalStrength;
    edit_distance_ratio?: number;
    sections_changed?: number;
    record_uuid?: string;
    specialty?: string;
    target_section?: string;
    scope_level?: LearningScopeLevel;
    edit_scope?: LearningEditScope;
    edit_intent?: LearningEditIntent;
    doctor_reason_code?: LearningDoctorReasonCode;
    is_manual_save?: boolean;
    is_autosave?: boolean;
    manual_weight?: number;
}

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
    specialty?: string;
    artifact_type?: LearningArtifactType;
    target_section?: string;
    scope_level?: LearningScopeLevel;
    edit_intent?: LearningEditIntent;
    doctor_reason_code?: LearningDoctorReasonCode;
    manual_weight?: number;
    metadata?: LearningEventMetadata;
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
    specialty?: string;
    artifact_type?: LearningArtifactType;
    target_section?: string;
    scope_level?: LearningScopeLevel;
    doctor_reason_code?: LearningDoctorReasonCode;
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
    specialty?: string;
    artifact_type?: LearningArtifactType;
    target_section?: string;
    scope_level?: LearningScopeLevel;
    doctor_reason_code?: LearningDoctorReasonCode;
    manual_weight?: number;
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
    specialty?: string;
    artifact_type?: LearningArtifactType;
    target_section?: string;
    scope_level?: LearningScopeLevel;
    doctor_reason_code?: LearningDoctorReasonCode;
    manual_weight?: number;
    metadata?: Record<string, unknown>;
}

