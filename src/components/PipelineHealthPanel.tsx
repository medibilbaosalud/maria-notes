import { useEffect, useState } from 'react';
import { getPipelineHealthSnapshot, getRecoverableSessions, requeueSession } from '../services/storage';
import { getAuditWorkerMetricsSnapshot, type AuditWorkerMetricsSnapshot } from '../services/audit-worker';

interface HealthSnapshot {
  active_sessions: number;
  provisional_sessions: number;
  dead_letters: number;
  next_attempt_at: string | null;
  recent_failures: Array<{ id?: number; stage: string; reason: string; created_at: string }>;
}

const emptySnapshot: HealthSnapshot = {
  active_sessions: 0,
  provisional_sessions: 0,
  dead_letters: 0,
  next_attempt_at: null,
  recent_failures: []
};

const emptyMetrics: AuditWorkerMetricsSnapshot = {
  processed_total: 0,
  worker_failures: 0,
  retries_scheduled: 0,
  dead_letters: 0,
  learning_events_ingested: 0,
  rule_promotions: 0,
  rule_rollbacks: 0,
  rule_conflict_incidents: 0,
  rule_pack_token_budget_exceeded: 0,
  queue_wait: { count: 0, total_ms: 0, max_ms: 0 },
  stage_latency: {},
  degradation_causes: {},
  last_updated_at: new Date(0).toISOString()
};

export const PipelineHealthPanel = () => {
  const [snapshot, setSnapshot] = useState<HealthSnapshot>(emptySnapshot);
  const [metrics, setMetrics] = useState<AuditWorkerMetricsSnapshot>(emptyMetrics);
  const [isRequeueing, setIsRequeueing] = useState(false);

  const refresh = async () => {
    const data = await getPipelineHealthSnapshot();
    setSnapshot(data as HealthSnapshot);
    setMetrics(getAuditWorkerMetricsSnapshot());
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
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

  const avgQueueMs = metrics.queue_wait.count > 0
    ? Math.round(metrics.queue_wait.total_ms / metrics.queue_wait.count)
    : 0;

  const stageSummaries = Object.entries(metrics.stage_latency)
    .map(([stage, value]) => ({
      stage,
      avg: value.count > 0 ? Math.round(value.total_ms / value.count) : 0,
      max: Math.round(value.max_ms || 0),
      count: value.count
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 4);

  const topDegradation = Object.entries(metrics.degradation_causes)
    .sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="pipeline-health-panel">
      <div className="pipeline-health-header">
        <strong>Pipeline Health</strong>
        <div className="pipeline-health-actions">
          <button
            onClick={handleRequeue}
            disabled={isRequeueing}
            className="pipeline-health-btn primary"
            aria-label="Reanudar sesion recuperable"
          >
            {isRequeueing ? 'Requeue...' : 'Reanudar ahora'}
          </button>
          <button
            onClick={handleExportDiagnostics}
            className="pipeline-health-btn secondary"
            aria-label="Exportar diagnostico de pipeline"
          >
            Exportar diagnostico
          </button>
        </div>
      </div>

      <div className="pipeline-health-chip-row">
        <span className="pipeline-health-chip">Activas: {snapshot.active_sessions}</span>
        <span className="pipeline-health-chip">Provisionales: {snapshot.provisional_sessions}</span>
        <span className="pipeline-health-chip">Dead-letter: {snapshot.dead_letters}</span>
        <span className="pipeline-health-chip">
          Proximo intento: {snapshot.next_attempt_at ? new Date(snapshot.next_attempt_at).toLocaleTimeString() : 'n/a'}
        </span>
      </div>

      <div className="pipeline-health-chip-row compact">
        <span className="pipeline-health-chip">Intentos OK: {metrics.processed_total}</span>
        <span className="pipeline-health-chip">Errores worker: {metrics.worker_failures}</span>
        <span className="pipeline-health-chip">Retries: {metrics.retries_scheduled}</span>
        <span className="pipeline-health-chip">Cola media: {avgQueueMs} ms</span>
      </div>

      <div className="pipeline-health-chip-row compact">
        <span className="pipeline-health-chip">Learning events: {metrics.learning_events_ingested}</span>
        <span className="pipeline-health-chip">Promociones: {metrics.rule_promotions}</span>
        <span className="pipeline-health-chip">Rollbacks: {metrics.rule_rollbacks}</span>
        <span className="pipeline-health-chip">Conflictos: {metrics.rule_conflict_incidents}</span>
        <span className="pipeline-health-chip">Budget excedido: {metrics.rule_pack_token_budget_exceeded}</span>
      </div>

      {stageSummaries.length > 0 && (
        <div className="pipeline-health-stage-grid">
          {stageSummaries.map((stage) => (
            <span key={stage.stage} className="pipeline-health-chip stage-latency">
              {stage.stage}: avg {stage.avg} ms / max {stage.max} ms ({stage.count})
            </span>
          ))}
        </div>
      )}

      {topDegradation && (
        <div className="pipeline-health-warning">
          Causa dominante: <strong>{topDegradation[0]}</strong> ({topDegradation[1]})
        </div>
      )}

      {snapshot.recent_failures[0] && (
        <div className="pipeline-health-error">
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
        }

        .pipeline-health-error {
          margin-top: 0.5rem;
          color: #92400e;
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
    </div>
  );
};
