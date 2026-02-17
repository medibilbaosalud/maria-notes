import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getPipelineHealthSnapshot, getRecoverableSessions, requeueSession } from '../services/storage';
import { getAuditWorkerMetricsSnapshot, type AuditWorkerMetricsSnapshot } from '../services/audit-worker';
import { motionTransitions } from '../features/ui/motion-tokens';

interface HealthSnapshot {
  active_sessions: number;
  provisional_sessions: number;
  dead_letters: number;
  next_attempt_at: string | null;
  cloud_sync_failures: number;
  recent_failures: Array<{ id?: number; stage: string; reason: string; created_at: string }>;
}

const emptySnapshot: HealthSnapshot = {
  active_sessions: 0,
  provisional_sessions: 0,
  dead_letters: 0,
  next_attempt_at: null,
  cloud_sync_failures: 0,
  recent_failures: []
};

const emptyMetrics: AuditWorkerMetricsSnapshot = {
  processed_total: 0,
  worker_failures: 0,
  retries_scheduled: 0,
  dead_letters: 0,
  learning_events_ingested: 0,
  learning_events_dropped_noise: 0,
  learning_events_deduped: 0,
  learning_events_from_autosave: 0,
  learning_events_from_manual: 0,
  rule_promotions: 0,
  rule_rollbacks: 0,
  rule_conflict_incidents: 0,
  rule_pack_token_budget_exceeded: 0,
  queue_wait: { count: 0, total_ms: 0, max_ms: 0 },
  stage_latency: {},
  degradation_causes: {},
  last_updated_at: new Date(0).toISOString()
};

const HIGHLIGHT_MS = 600;

export const PipelineHealthPanel = () => {
  const [snapshot, setSnapshot] = useState<HealthSnapshot>(emptySnapshot);
  const [metrics, setMetrics] = useState<AuditWorkerMetricsSnapshot>(emptyMetrics);
  const [isRequeueing, setIsRequeueing] = useState(false);
  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set());
  const previousValuesRef = useRef<Record<string, string>>({});
  const highlightTimeoutRef = useRef<number | null>(null);

  const avgQueueMs = metrics.queue_wait.count > 0
    ? Math.round(metrics.queue_wait.total_ms / metrics.queue_wait.count)
    : 0;

  const stageSummaries = useMemo(
    () =>
      Object.entries(metrics.stage_latency)
        .map(([stage, value]) => ({
          stage,
          avg: value.count > 0 ? Math.round(value.total_ms / value.count) : 0,
          max: Math.round(value.max_ms || 0),
          count: value.count
        }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 4),
    [metrics.stage_latency]
  );

  const topPipelineFailure = useMemo(
    () =>
      Object.entries(
        snapshot.recent_failures.reduce<Record<string, number>>((acc, failure) => {
          const key = `${failure.stage}: ${failure.reason}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1])[0],
    [snapshot.recent_failures]
  );

  const markChanges = (nextValues: Record<string, string>) => {
    const changed = Object.entries(nextValues)
      .filter(([key, value]) => {
        const previous = previousValuesRef.current[key];
        return previous !== undefined && previous !== value;
      })
      .map(([key]) => key);

    previousValuesRef.current = nextValues;

    if (changed.length === 0) return;
    setChangedKeys(new Set(changed));
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setChangedKeys(new Set());
      highlightTimeoutRef.current = null;
    }, HIGHLIGHT_MS);
  };

  const refresh = async () => {
    const nextSnapshot = (await getPipelineHealthSnapshot()) as HealthSnapshot;
    const nextMetrics = getAuditWorkerMetricsSnapshot();

    setSnapshot(nextSnapshot);
    setMetrics(nextMetrics);

    const stageTokens = Object.entries(nextMetrics.stage_latency)
      .map(([stage, value]) => `stage_${stage}:${value.total_ms}:${value.max_ms}:${value.count}`)
      .sort()
      .join('|');
    const topFailureToken = Object.entries(
      nextSnapshot.recent_failures.reduce<Record<string, number>>((acc, failure) => {
        const key = `${failure.stage}: ${failure.reason}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1])[0];

    markChanges({
      active_sessions: String(nextSnapshot.active_sessions),
      provisional_sessions: String(nextSnapshot.provisional_sessions),
      dead_letters: String(nextSnapshot.dead_letters),
      next_attempt_at: nextSnapshot.next_attempt_at || 'n/a',
      processed_total: String(nextMetrics.processed_total),
      worker_failures: String(nextMetrics.worker_failures),
      retries_scheduled: String(nextMetrics.retries_scheduled),
      avg_queue_ms: String(nextMetrics.queue_wait.count > 0 ? Math.round(nextMetrics.queue_wait.total_ms / nextMetrics.queue_wait.count) : 0),
      learning_events_ingested: String(nextMetrics.learning_events_ingested),
      learning_events_dropped_noise: String(nextMetrics.learning_events_dropped_noise),
      learning_events_deduped: String(nextMetrics.learning_events_deduped),
      learning_events_from_autosave: String(nextMetrics.learning_events_from_autosave),
      learning_events_from_manual: String(nextMetrics.learning_events_from_manual),
      rule_promotions: String(nextMetrics.rule_promotions),
      rule_rollbacks: String(nextMetrics.rule_rollbacks),
      rule_conflict_incidents: String(nextMetrics.rule_conflict_incidents),
      rule_pack_token_budget_exceeded: String(nextMetrics.rule_pack_token_budget_exceeded),
      cloud_sync_failures: String(nextSnapshot.cloud_sync_failures),
      top_failure: topFailureToken ? `${topFailureToken[0]}:${topFailureToken[1]}` : 'none',
      last_failure: nextSnapshot.recent_failures[0] ? `${nextSnapshot.recent_failures[0].stage}:${nextSnapshot.recent_failures[0].reason}` : 'none',
      stage_tokens: stageTokens
    });
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      clearInterval(timer);
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const handleRequeue = async () => {
    if (isRequeueing) return;
    setIsRequeueing(true);
    try {
      const sessions = await getRecoverableSessions();
      const target = sessions.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
      if (target?.session_id) {
        await requeueSession(target.session_id);
      }
      await refresh();
    } finally {
      setIsRequeueing(false);
    }
  };

  const handleExportDiagnostics = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      health: snapshot,
      metrics
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pipeline-diagnostics-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const panelState = snapshot.recent_failures.length > 0
    ? 'error'
    : (snapshot.provisional_sessions > 0 || metrics.worker_failures > 0)
      ? 'warning'
      : 'healthy';

  const chipsA = [
    { key: 'active_sessions', label: `Activas: ${snapshot.active_sessions}` },
    { key: 'provisional_sessions', label: `Provisionales: ${snapshot.provisional_sessions}` },
    { key: 'dead_letters', label: `Dead-letter: ${snapshot.dead_letters}` },
    { key: 'next_attempt_at', label: `Proximo intento: ${snapshot.next_attempt_at ? new Date(snapshot.next_attempt_at).toLocaleTimeString() : 'n/a'}` }
  ];

  const chipsB = [
    { key: 'processed_total', label: `Intentos OK: ${metrics.processed_total}` },
    { key: 'worker_failures', label: `Errores worker: ${metrics.worker_failures}` },
    { key: 'retries_scheduled', label: `Retries: ${metrics.retries_scheduled}` },
    { key: 'avg_queue_ms', label: `Cola media: ${avgQueueMs} ms` }
  ];

  const chipsC = [
    { key: 'learning_events_ingested', label: `Learning events: ${metrics.learning_events_ingested}` },
    { key: 'learning_events_dropped_noise', label: `Ruido filtrado: ${metrics.learning_events_dropped_noise}` },
    { key: 'learning_events_deduped', label: `Deduped: ${metrics.learning_events_deduped}` },
    { key: 'learning_events_from_manual', label: `Manual: ${metrics.learning_events_from_manual}` },
    { key: 'learning_events_from_autosave', label: `Autosave: ${metrics.learning_events_from_autosave}` },
    { key: 'rule_promotions', label: `Promociones: ${metrics.rule_promotions}` },
    { key: 'rule_rollbacks', label: `Rollbacks: ${metrics.rule_rollbacks}` },
    { key: 'rule_conflict_incidents', label: `Conflictos: ${metrics.rule_conflict_incidents}` },
    { key: 'rule_pack_token_budget_exceeded', label: `Budget excedido: ${metrics.rule_pack_token_budget_exceeded}` },
    { key: 'cloud_sync_failures', label: `Cloud sync fallos: ${snapshot.cloud_sync_failures}` }
  ];

  const renderChip = (chip: { key: string; label: string }, extraClass = '') => (
    <motion.span
      key={chip.key}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTransitions.normal}
      className={`pipeline-health-chip ${extraClass} ${changedKeys.has(chip.key) ? 'changed' : ''}`}
      data-ui-state={changedKeys.has(chip.key) ? 'active' : 'idle'}
    >
      {chip.label}
    </motion.span>
  );

  return (
    <motion.div className="pipeline-health-panel" data-ui-state={panelState} layout transition={motionTransitions.normal}>
      <div className="pipeline-health-header">
        <strong>Pipeline Health</strong>
        <div className="pipeline-health-actions">
          <button
            onClick={handleRequeue}
            disabled={isRequeueing}
            className="pipeline-health-btn primary"
            aria-label="Reanudar sesion recuperable"
            data-ui-state={isRequeueing ? 'active' : 'idle'}
          >
            {isRequeueing ? 'Requeue...' : 'Reanudar ahora'}
          </button>
          <button
            onClick={handleExportDiagnostics}
            className="pipeline-health-btn secondary"
            aria-label="Exportar diagnostico de pipeline"
            data-ui-state="idle"
          >
            Exportar diagnostico
          </button>
        </div>
      </div>

      <div className="pipeline-health-chip-row">{chipsA.map((chip) => renderChip(chip))}</div>
      <div className="pipeline-health-chip-row compact">{chipsB.map((chip) => renderChip(chip))}</div>
      <div className="pipeline-health-chip-row compact">{chipsC.map((chip) => renderChip(chip))}</div>

      <AnimatePresence>
        {stageSummaries.length > 0 && (
          <motion.div
            className="pipeline-health-stage-grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransitions.fast}
          >
            {stageSummaries.map((stage) => (
              <motion.span
                key={stage.stage}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={motionTransitions.normal}
                className={`pipeline-health-chip stage-latency ${changedKeys.has('stage_tokens') ? 'changed' : ''}`}
              >
                {stage.stage}: avg {stage.avg} ms / max {stage.max} ms ({stage.count})
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {topPipelineFailure && (
        <div className={`pipeline-health-warning ${changedKeys.has('top_failure') ? 'changed' : ''}`}>
          Causa dominante pipeline: <strong>{topPipelineFailure[0]}</strong> ({topPipelineFailure[1]})
        </div>
      )}

      {snapshot.recent_failures[0] && (
        <div className={`pipeline-health-error ${changedKeys.has('last_failure') ? 'changed' : ''}`}>
          Ultimo fallo: <strong>{snapshot.recent_failures[0].stage}</strong> - {snapshot.recent_failures[0].reason}
        </div>
      )}

      <style>{`
        .pipeline-health-panel {
          margin-top: 1rem;
          max-width: 720px;
          width: 100%;
          margin-left: auto;
          margin-right: auto;
          padding: 0.9rem 1rem;
          border-radius: 12px;
          border: 1px solid #dbeafe;
          background: #f8fbff;
          font-size: 0.82rem;
          color: #1e3a8a;
          transition: border-color var(--motion-duration-fast) var(--motion-ease-base),
            box-shadow var(--motion-duration-fast) var(--motion-ease-base),
            background-color var(--motion-duration-fast) var(--motion-ease-base);
        }

        .pipeline-health-panel[data-ui-state="warning"] {
          border-color: #bfdbfe;
        }

        .pipeline-health-panel[data-ui-state="error"] {
          border-color: #fed7aa;
          box-shadow: 0 0 0 1px rgba(251, 146, 60, 0.2);
        }

        .pipeline-health-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .pipeline-health-actions {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .pipeline-health-btn {
          border-radius: 999px;
          padding: 0.35rem 0.75rem;
          cursor: pointer;
          font-size: 0.74rem;
          font-weight: 700;
          border: none;
          transition: transform var(--motion-duration-fast) var(--motion-ease-base),
            box-shadow var(--motion-duration-fast) var(--motion-ease-base),
            opacity var(--motion-duration-fast) var(--motion-ease-base);
        }

        .pipeline-health-btn.primary {
          background: #2563eb;
          color: #fff;
        }

        .pipeline-health-btn.secondary {
          border: 1px solid #93c5fd;
          background: #eff6ff;
          color: #1e3a8a;
        }

        .pipeline-health-btn:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 14px rgba(37, 99, 235, 0.18);
        }

        .pipeline-health-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .pipeline-health-chip-row {
          margin-top: 0.45rem;
          display: flex;
          gap: 0.45rem;
          flex-wrap: wrap;
        }

        .pipeline-health-chip {
          background: #eef5ff;
          border: 1px solid #dbeafe;
          border-radius: 999px;
          padding: 0.15rem 0.55rem;
          color: #1f3b74;
          transition: border-color var(--motion-duration-fast) var(--motion-ease-base),
            box-shadow var(--motion-duration-fast) var(--motion-ease-base),
            background-color var(--motion-duration-fast) var(--motion-ease-base),
            transform var(--motion-duration-fast) var(--motion-ease-base);
        }

        .pipeline-health-chip.changed {
          border-color: #7dd3fc;
          background: #f0f9ff;
          transform: translateY(-1px);
          box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.22);
        }

        .pipeline-health-chip-row.compact .pipeline-health-chip {
          font-size: 0.75rem;
        }

        .pipeline-health-stage-grid {
          margin-top: 0.45rem;
          display: flex;
          gap: 0.45rem;
          flex-wrap: wrap;
        }

        .pipeline-health-chip.stage-latency {
          background: #f0f9ff;
          border-color: #bae6fd;
          color: #0c4a6e;
        }

        .pipeline-health-warning {
          margin-top: 0.35rem;
          color: #b45309;
          transition: color var(--motion-duration-fast) var(--motion-ease-base),
            transform var(--motion-duration-fast) var(--motion-ease-base);
        }

        .pipeline-health-error {
          margin-top: 0.5rem;
          color: #92400e;
          transition: color var(--motion-duration-fast) var(--motion-ease-base),
            transform var(--motion-duration-fast) var(--motion-ease-base);
        }

        .pipeline-health-warning.changed,
        .pipeline-health-error.changed {
          animation: health-emphasis ${HIGHLIGHT_MS}ms var(--motion-ease-base);
        }

        @keyframes health-emphasis {
          0% {
            transform: translateY(0);
            opacity: 0.72;
          }

          40% {
            transform: translateY(-1px);
            opacity: 1;
          }

          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }

        @media (max-width: 1024px) {
          .pipeline-health-panel {
            font-size: 0.78rem;
          }

          .pipeline-health-chip {
            width: fit-content;
          }
        }
      `}</style>
    </motion.div>
  );
};
