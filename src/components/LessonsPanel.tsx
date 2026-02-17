import { useEffect, useMemo, useState } from 'react';
import { X, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { supabase } from '../services/supabase';
import type { LearningLifecycleState } from '../services/learning/types';

interface LessonsPanelProps {
    onClose: () => void;
    readOnly?: boolean;
}

interface RuleCandidateRow {
    id: string;
    signature_hash: string;
    rule_text: string;
    category: string;
    evidence_count: number;
    contradiction_count: number;
    confidence_score: number;
    lifecycle_state: LearningLifecycleState;
    last_seen_at: string;
    rule_json?: Record<string, unknown>;
    metrics_snapshot?: {
        score?: number;
        edit_delta?: number;
        hallucination_delta?: number;
        inconsistency_delta?: number;
    };
}

const tabs: LearningLifecycleState[] = ['candidate', 'shadow', 'active', 'deprecated', 'blocked'];

const tabLabel: Record<LearningLifecycleState, string> = {
    candidate: 'Candidatas',
    shadow: 'Shadow',
    active: 'Activas',
    deprecated: 'Deprecadas',
    blocked: 'Bloqueadas'
};

const decisionByTransition = (
    from: LearningLifecycleState,
    to: LearningLifecycleState
): 'promote' | 'demote' | 'block' | 'rollback' | 'force_shadow' | 'resume' => {
    if (to === 'blocked') return 'block';
    if ((from === 'active' && to === 'deprecated') || (from === 'shadow' && to === 'candidate')) return 'demote';
    if ((from === 'candidate' && to === 'shadow') || (from === 'shadow' && to === 'active')) return 'promote';
    if (from === 'deprecated' && to === 'active') return 'resume';
    if (to === 'shadow') return 'force_shadow';
    return 'rollback';
};

export default function LessonsPanel({ onClose, readOnly = false }: LessonsPanelProps) {
    const [rules, setRules] = useState<RuleCandidateRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<LearningLifecycleState>('active');
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    const loadRules = async () => {
        if (!supabase) {
            setRules([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        const { data, error } = await supabase
            .from('ai_rule_candidates')
            .select('id, signature_hash, rule_text, category, evidence_count, contradiction_count, confidence_score, lifecycle_state, last_seen_at, rule_json, metrics_snapshot')
            .order('confidence_score', { ascending: false })
            .order('last_seen_at', { ascending: false })
            .limit(300);

        if (error) {
            console.error('[LessonsPanel] failed to load rule candidates:', error);
            setRules([]);
        } else {
            setRules((data || []) as RuleCandidateRow[]);
        }
        setLoading(false);
    };

    useEffect(() => {
        void loadRules();
    }, []);

    const filtered = useMemo(() => rules.filter((rule) => rule.lifecycle_state === activeTab), [rules, activeTab]);

    const updateLifecycle = async (rule: RuleCandidateRow, nextState: LearningLifecycleState, reason: string) => {
        if (readOnly || !supabase || updatingId) return;
        setUpdatingId(rule.id);
        try {
            const decisionType = decisionByTransition(rule.lifecycle_state, nextState);
            await supabase
                .from('ai_rule_candidates')
                .update({
                    lifecycle_state: nextState,
                    updated_at: new Date().toISOString()
                })
                .eq('id', rule.id);

            await supabase.from('ai_learning_decisions').insert([{
                rule_id: rule.id,
                decision_type: decisionType,
                reason,
                metrics_snapshot: rule.metrics_snapshot || {},
                context: {
                    previous_state: rule.lifecycle_state,
                    new_state: nextState,
                    manual: true
                }
            }]);

            setRules((prev) => prev.map((item) => (
                item.id === rule.id
                    ? { ...item, lifecycle_state: nextState }
                    : item
            )));
        } finally {
            setUpdatingId(null);
        }
    };

    return (
        <div className="lessons-modal-backdrop">
            <div className="lessons-modal-card">
                <div className="lessons-header">
                    <div>
                        <h2>Control de Auto-Mejora IA</h2>
                        <p>Reglas con trazabilidad, evidencia e impacto clínico.</p>
                    </div>
                    <div className="header-actions">
                        <button onClick={() => void loadRules()} className="icon-btn" title="Recargar">
                            <RefreshCw size={16} className={loading ? 'spin' : ''} />
                        </button>
                        <button onClick={onClose} className="icon-btn" title="Cerrar">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div className="tabs">
                    {tabs.map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`tab ${activeTab === tab ? 'active' : ''}`}
                        >
                            {tabLabel[tab]} <span>{rules.filter((r) => r.lifecycle_state === tab).length}</span>
                        </button>
                    ))}
                </div>

                <div className="content">
                    {loading ? (
                        <div className="state">Cargando reglas...</div>
                    ) : filtered.length === 0 ? (
                        <div className="state">Sin reglas en este estado.</div>
                    ) : (
                        filtered.map((rule) => (
                            <div key={rule.id} className="rule-card">
                                <div className="rule-top">
                                    <div className="rule-badges">
                                        <span className="badge">{rule.category}</span>
                                        <span className="badge">
                                            {String(rule.rule_json?.artifact_type || 'medical_history')}
                                        </span>
                                        <span className="badge">
                                            {String(rule.rule_json?.source_view || 'history_save')}
                                        </span>
                                        <span className="badge">
                                            {String(rule.rule_json?.signal_strength || 'medium')}
                                        </span>
                                        <span className="badge">conf {rule.confidence_score.toFixed(2)}</span>
                                        <span className="badge">ev {rule.evidence_count}</span>
                                        <span className={`badge ${rule.contradiction_count > 0 ? 'warn' : ''}`}>contr {rule.contradiction_count}</span>
                                    </div>
                                    <small>{new Date(rule.last_seen_at).toLocaleString()}</small>
                                </div>

                                <p className="rule-text">{rule.rule_text}</p>

                                <div className="impact-grid">
                                    <span>score: {Number(rule.metrics_snapshot?.score || 0).toFixed(3)}</span>
                                    <span>edit ?: {Number(rule.metrics_snapshot?.edit_delta || 0).toFixed(3)}</span>
                                    <span>halluc ?: {Number(rule.metrics_snapshot?.hallucination_delta || 0).toFixed(3)}</span>
                                    <span>incons ?: {Number(rule.metrics_snapshot?.inconsistency_delta || 0).toFixed(3)}</span>
                                </div>

                                {!readOnly && (
                                    <div className="actions">
                                        <button
                                            disabled={Boolean(updatingId)}
                                            onClick={() => void updateLifecycle(rule, 'active', 'manual_approve')}
                                            className="ok"
                                        >
                                            <ShieldCheck size={14} /> Aprobar
                                        </button>
                                        <button
                                            disabled={Boolean(updatingId)}
                                            onClick={() => void updateLifecycle(rule, 'shadow', 'manual_force_shadow')}
                                        >
                                            Forzar shadow
                                        </button>
                                        <button
                                            disabled={Boolean(updatingId)}
                                            onClick={() => void updateLifecycle(rule, 'blocked', 'manual_block')}
                                            className="danger"
                                        >
                                            <AlertTriangle size={14} /> Bloquear
                                        </button>
                                        {(rule.lifecycle_state === 'deprecated' || rule.lifecycle_state === 'blocked') && (
                                            <button
                                                disabled={Boolean(updatingId)}
                                                onClick={() => void updateLifecycle(rule, 'active', 'manual_resume')}
                                            >
                                                Reanudar
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            <style>{`
                .lessons-modal-backdrop {
                    position: fixed;
                    inset: 0;
                    z-index: 1000;
                    background: rgba(15, 23, 42, 0.48);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 1.5rem;
                }
                .lessons-modal-card {
                    width: min(980px, 100%);
                    max-height: 88vh;
                    overflow: hidden;
                    border-radius: 16px;
                    background: #fff;
                    border: 1px solid #e2e8f0;
                    display: flex;
                    flex-direction: column;
                }
                .lessons-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 1rem;
                    padding: 1rem 1.2rem;
                    border-bottom: 1px solid #e2e8f0;
                }
                .lessons-header h2 {
                    margin: 0;
                    font-size: 1.1rem;
                    color: #0f172a;
                }
                .lessons-header p {
                    margin: 0.2rem 0 0;
                    color: #64748b;
                    font-size: 0.85rem;
                }
                .header-actions { display: flex; gap: 0.5rem; }
                .icon-btn {
                    border: 1px solid #e2e8f0;
                    background: #fff;
                    border-radius: 8px;
                    width: 32px;
                    height: 32px;
                    cursor: pointer;
                    color: #334155;
                }
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { to { transform: rotate(360deg); } }
                .tabs {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.4rem;
                    padding: 0.8rem 1.2rem;
                    border-bottom: 1px solid #e2e8f0;
                }
                .tab {
                    border: 1px solid #dbeafe;
                    background: #f8fafc;
                    color: #334155;
                    border-radius: 999px;
                    padding: 0.35rem 0.65rem;
                    font-size: 0.8rem;
                    cursor: pointer;
                }
                .tab.active {
                    background: #eff6ff;
                    border-color: #93c5fd;
                    color: #1d4ed8;
                }
                .tab span {
                    margin-left: 0.35rem;
                    font-weight: 700;
                }
                .content {
                    overflow-y: auto;
                    padding: 1rem 1.2rem;
                    display: grid;
                    gap: 0.75rem;
                }
                .state {
                    color: #64748b;
                    font-size: 0.9rem;
                    padding: 0.8rem;
                }
                .rule-card {
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 0.8rem;
                    background: #fff;
                    display: grid;
                    gap: 0.6rem;
                }
                .rule-top {
                    display: flex;
                    justify-content: space-between;
                    gap: 1rem;
                    align-items: center;
                }
                .rule-badges {
                    display: flex;
                    gap: 0.35rem;
                    flex-wrap: wrap;
                }
                .badge {
                    border-radius: 999px;
                    background: #f1f5f9;
                    color: #334155;
                    font-size: 0.72rem;
                    padding: 0.2rem 0.45rem;
                }
                .badge.warn {
                    background: #fff1f2;
                    color: #be123c;
                }
                .rule-text {
                    margin: 0;
                    color: #0f172a;
                    line-height: 1.4;
                    font-size: 0.9rem;
                }
                .impact-grid {
                    display: grid;
                    grid-template-columns: repeat(4, minmax(0, 1fr));
                    gap: 0.4rem;
                    font-size: 0.78rem;
                    color: #475569;
                }
                .actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.45rem;
                }
                .actions button {
                    border: 1px solid #dbeafe;
                    background: #eff6ff;
                    color: #1e40af;
                    border-radius: 8px;
                    padding: 0.35rem 0.6rem;
                    font-size: 0.76rem;
                    font-weight: 600;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 0.3rem;
                }
                .actions button.ok {
                    border-color: #86efac;
                    background: #f0fdf4;
                    color: #166534;
                }
                .actions button.danger {
                    border-color: #fecdd3;
                    background: #fff1f2;
                    color: #be123c;
                }
                .actions button:disabled {
                    opacity: 0.55;
                    cursor: not-allowed;
                }
            `}</style>
        </div>
    );
}

