import React from 'react';
import { LabTestLog } from '../services/db';
import { X, CheckCircle, Cpu, Activity, Brain, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

interface TestLogDetailModalProps {
  log: LabTestLog;
  onClose: () => void;
}

export const TestLogDetailModal: React.FC<TestLogDetailModalProps> = ({ log, onClose }) => {
  const diagnostics = log.metadata.diagnostics;
  const uniqueValidationHistory = React.useMemo(() => {
    const history = log.metadata.validationHistory || [];
    const seen = new Set<string>();
    return history.filter((item) => {
      const key = `${item.type}|${item.field}|${item.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [log.metadata.validationHistory]);

  return (
    <div className="test-log-modal-overlay" onClick={onClose}>
      <motion.div
        className="test-log-modal-content"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="test-log-modal-header">
          <div className="test-log-header-title">
            <h2>Detalle de Prueba: {log.test_name}</h2>
            <span className="test-log-date-badge">{new Date(log.created_at).toLocaleString()}</span>
          </div>
          <button className="test-log-close-btn" onClick={onClose} aria-label="Cerrar detalle de prueba">
            <X size={20} />
          </button>
        </div>

        <div className="test-log-modal-body">
          <div className="test-log-metrics-grid">
            <div className="test-log-metric-card">
              <div className="test-log-metric-icon blue"><Activity size={20} /></div>
              <div className="test-log-metric-info">
                <label>Ciclos de Mejora</label>
                <strong>{log.metadata.versionsCount || 1}</strong>
              </div>
            </div>
            <div className="test-log-metric-card">
              <div className="test-log-metric-icon green"><CheckCircle size={20} /></div>
              <div className="test-log-metric-info">
                <label>Errores Corregidos</label>
                <strong>{log.metadata.errorsFixed || 0}</strong>
              </div>
            </div>
            <div className="test-log-metric-card">
              <div className="test-log-metric-icon purple"><Cpu size={20} /></div>
              <div className="test-log-metric-info">
                <label>Modelo principal</label>
                <span className="test-log-model-tag">{log.metadata.models.generation}</span>
              </div>
            </div>
            <div className={`test-log-metric-card ${log.metadata.active_memory_used ? 'gold-glow' : ''}`}>
              <div className={`test-log-metric-icon ${log.metadata.active_memory_used ? 'gold' : 'gray'}`}>
                <Brain size={20} />
              </div>
              <div className="test-log-metric-info">
                <label>Aprendizaje Activo</label>
                <strong>{log.metadata.active_memory_used ? 'SI - Inyectado' : 'NO - Estandar'}</strong>
              </div>
            </div>
          </div>

          {diagnostics && (
            <>
              <div className="test-log-section-title">
                <h3>Diagnostico E2E</h3>
              </div>
              <div className="test-log-diagnostics-summary">
                <p><strong>Estado:</strong> {diagnostics.status}</p>
                <p><strong>Motivo primario:</strong> {diagnostics.status_reason_primary || 'n/a'}</p>
                {diagnostics.status_reason_chain && diagnostics.status_reason_chain.length > 0 && (
                  <p><strong>Cadena causal:</strong> {diagnostics.status_reason_chain.join(' -> ')}</p>
                )}
                {diagnostics.primary_failure_evidence && (
                  <p><strong>Evidencia primaria:</strong> <code>{diagnostics.primary_failure_evidence}</code></p>
                )}
                <p><strong>Run ID:</strong> {diagnostics.run_id}</p>
                <p><strong>Modo:</strong> {diagnostics.mode}</p>
                <p><strong>Modo ejecucion:</strong> {diagnostics.execution_mode || 'n/a'}</p>
                <p><strong>Ruta STT:</strong> {diagnostics.stt_route_policy || 'default'}</p>
                <p><strong>Fuente:</strong> {diagnostics.input_source || log.input_type}</p>
                {diagnostics.scenario_id && <p><strong>Escenario:</strong> {diagnostics.scenario_id}</p>}
                {diagnostics.audio_stats && (
                  <p>
                    <strong>Audio:</strong> chunks={diagnostics.audio_stats.chunk_count}, fallidos={diagnostics.audio_stats.failed_chunks},
                    p95 STT={diagnostics.audio_stats.transcription_p95_ms}ms
                  </p>
                )}
                {diagnostics.quality_gate && (
                  <p>
                    <strong>Quality Gate:</strong> required_sections_ok={String(diagnostics.quality_gate.required_sections_ok)},
                    pipeline_status={diagnostics.quality_gate.pipeline_status || 'n/a'},
                    result_status={diagnostics.quality_gate.result_status || 'n/a'},
                    critical_gaps={diagnostics.quality_gate.critical_gaps_count}
                  </p>
                )}
                {diagnostics.quality_gate?.blocking_rule_id && (
                  <p><strong>Regla bloqueante:</strong> {diagnostics.quality_gate.blocking_rule_id} ({diagnostics.quality_gate.blocking_reason || 'sin detalle'})</p>
                )}
                {diagnostics.root_causes && diagnostics.root_causes.length > 0 && (
                  <p><strong>Causas raiz:</strong> {diagnostics.root_causes.join(', ')}</p>
                )}
              </div>

              {diagnostics.failure_graph && diagnostics.failure_graph.length > 0 && (
                <>
                  <div className="test-log-section-title">
                    <h3>Grafo Causal</h3>
                  </div>
                  <div className="test-log-validation-list">
                    {diagnostics.failure_graph.map((node, idx) => (
                      <div key={`${node.node}-${idx}`} className="test-log-validation-item">
                        <div className="test-log-error-badge info">CAUSE</div>
                        <div className="test-log-error-content">
                          <strong>{node.node}</strong>
                          {node.caused_by && <div>caused_by={node.caused_by}</div>}
                          {node.evidence_ref && <div><code>{node.evidence_ref}</code></div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="test-log-section-title">
                <h3>Etapas</h3>
              </div>
              <div className="test-log-validation-list">
                {diagnostics.stage_results.map((stage, idx) => (
                  <div key={`${stage.stage}-${idx}`} className="test-log-validation-item">
                    <div className={`test-log-error-badge ${stage.status}`}>{stage.status.toUpperCase()}</div>
                    <div className="test-log-error-content">
                      <strong>{stage.stage}</strong> ({stage.duration_ms}ms)
                      {stage.error_code && <span> - {stage.error_code}</span>}
                      {stage.error_message && <div>{stage.error_message}</div>}
                      {stage.error_detail?.context && (
                        <div className="test-log-error-meta">
                          {stage.error_detail.context.http_status ? `http=${stage.error_detail.context.http_status} ` : ''}
                          {typeof stage.error_detail.context.retryable === 'boolean' ? `retryable=${String(stage.error_detail.context.retryable)} ` : ''}
                          {typeof stage.error_detail.context.attempt === 'number' ? `attempt=${stage.error_detail.context.attempt} ` : ''}
                          {stage.error_detail.context.provider ? `provider=${stage.error_detail.context.provider} ` : ''}
                          {stage.error_detail.context.model ? `model=${stage.error_detail.context.model} ` : ''}
                          {stage.error_detail.context.route_key ? `route=${stage.error_detail.context.route_key} ` : ''}
                          {stage.error_detail.context.operation ? `op=${stage.error_detail.context.operation} ` : ''}
                          {stage.error_detail.context.endpoint ? `endpoint=${stage.error_detail.context.endpoint} ` : ''}
                          {stage.error_detail.context.provider_code ? `provider_code=${stage.error_detail.context.provider_code} ` : ''}
                          {stage.error_detail.context.request_id ? `request_id=${stage.error_detail.context.request_id} ` : ''}
                          {stage.error_detail.context.blocking_rule_id ? `blocking_rule_id=${stage.error_detail.context.blocking_rule_id} ` : ''}
                          {stage.error_detail.context.phase ? `phase=${stage.error_detail.context.phase} ` : ''}
                          {stage.error_detail.context.origin ? `origin=${stage.error_detail.context.origin} ` : ''}
                          {typeof stage.error_detail.context.blocking === 'boolean' ? `blocking=${String(stage.error_detail.context.blocking)}` : ''}
                        </div>
                      )}
                      {stage.error_detail?.context?.raw_payload_excerpt && (
                        <div className="test-log-error-meta"><code>{stage.error_detail.context.raw_payload_excerpt}</code></div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {diagnostics.error_catalog && diagnostics.error_catalog.by_code.length > 0 && (
                <>
                  <div className="test-log-section-title">
                    <h3>Catalogo de Errores</h3>
                  </div>
                  <div className="test-log-validation-list">
                    {diagnostics.error_catalog.by_code.map((entry, idx) => (
                      <div key={`${entry.code}-${idx}`} className="test-log-validation-item">
                        <div className="test-log-error-badge failed">{entry.count}x</div>
                        <div className="test-log-error-content">
                          <strong>{entry.code}</strong>
                          <div>Etapas: {entry.stages.join(', ')}</div>
                          {entry.last_message && <div>{entry.last_message}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {diagnostics.reconciliation && (
                <>
                  <div className="test-log-section-title">
                    <h3>Pre vs Post Sanitizacion</h3>
                  </div>
                  <div className="test-log-validation-list">
                    <div className="test-log-validation-item">
                      <div className="test-log-error-badge info">PRE</div>
                      <div className="test-log-error-content">
                        {(diagnostics.reconciliation.pre_sanitize_issues || []).length > 0
                          ? diagnostics.reconciliation.pre_sanitize_issues.map((issue) => `${issue.type}:${issue.field}:${issue.reason}[sev=${issue.severity},blocking=${String(issue.blocking)}]`).join(' | ')
                          : 'Sin issues pre-sanitizacion'}
                      </div>
                    </div>
                    <div className="test-log-validation-item">
                      <div className="test-log-error-badge info">POST</div>
                      <div className="test-log-error-content">
                        {(diagnostics.reconciliation.post_sanitize_issues || []).length > 0
                          ? diagnostics.reconciliation.post_sanitize_issues.map((issue) => `${issue.type}:${issue.field}:${issue.reason}[sev=${issue.severity},blocking=${String(issue.blocking)}]`).join(' | ')
                          : 'Sin issues post-sanitizacion'}
                      </div>
                    </div>
                    <div className="test-log-validation-item">
                      <div className="test-log-error-badge info">NEUTRALIZADAS</div>
                      <div className="test-log-error-content">
                        {(diagnostics.reconciliation.neutralized_issues || []).length > 0
                          ? diagnostics.reconciliation.neutralized_issues.map((issue) => `${issue.type}:${issue.field}:${issue.reason}[sev=${issue.severity}]`).join(' | ')
                          : 'Sin neutralizaciones'}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {diagnostics.debug && (
                <>
                  <div className="test-log-section-title">
                    <h3>Errores Exactos</h3>
                  </div>
                  <div className="test-log-validation-list">
                    {(diagnostics.debug.remaining_errors || []).length > 0 ? (
                      diagnostics.debug.remaining_errors.map((issue, idx) => (
                        <div key={`${issue.type}-${issue.field}-${idx}`} className="test-log-validation-item">
                          <div className="test-log-error-badge failed">ERR</div>
                          <div className="test-log-error-content">
                            <strong>{issue.type}</strong> {issue.field}: {issue.reason}
                            {issue.severity && <div>severity={issue.severity}</div>}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="test-log-validation-item">
                        <div className="test-log-error-badge info">INFO</div>
                        <div className="test-log-error-content">No hay errores finales bloqueantes en `remaining_errors`.</div>
                      </div>
                    )}
                    <div className="test-log-validation-item">
                      <div className="test-log-error-badge info">CTX</div>
                      <div className="test-log-error-content">
                        provisional_reason={diagnostics.debug.provisional_reason || 'n/a'} | quality_score={String(diagnostics.debug.quality_score ?? 'n/a')}
                        {' '}| pipeline_status={diagnostics.debug.pipeline_status || 'n/a'} | result_status={diagnostics.debug.result_status || 'n/a'}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {diagnostics.failure_timeline && diagnostics.failure_timeline.length > 0 && (
                <>
                  <div className="test-log-section-title">
                    <h3>Timeline de Fallos</h3>
                  </div>
                  <div className="test-log-validation-list">
                    {diagnostics.failure_timeline.map((item, idx) => (
                      <div key={`${item.stage}-${item.timestamp}-${idx}`} className="test-log-validation-item">
                        <div className={`test-log-error-badge ${item.status}`}>{item.status.toUpperCase()}</div>
                        <div className="test-log-error-content">
                          <strong>{new Date(item.timestamp).toLocaleTimeString()}</strong> - {item.stage}
                          {typeof item.batch_index === 'number' && <span> (batch {item.batch_index})</span>}
                          {item.error_code && <div>{item.error_code}</div>}
                          {item.error_message && <div>{item.error_message}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {diagnostics.recommendations && diagnostics.recommendations.length > 0 && (
                <>
                  <div className="test-log-section-title">
                    <h3>Acciones Recomendadas</h3>
                  </div>
                  <div className="test-log-validation-list">
                    {diagnostics.recommendations.map((action, idx) => (
                      <div key={idx} className="test-log-validation-item">
                        <div className="test-log-error-badge info"><AlertTriangle size={12} /> NEXT</div>
                        <div className="test-log-error-content">{action}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="test-log-section-title">
                <h3>Insights</h3>
              </div>
              <div className="test-log-validation-list">
                {(diagnostics.insights || []).map((insight, idx) => (
                  <div key={idx} className="test-log-validation-item">
                    <div className="test-log-error-badge info"><AlertTriangle size={12} /> INFO</div>
                    <div className="test-log-error-content">{insight}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="test-log-section-title">
            <h3>Historial de Validacion</h3>
          </div>

          <div className="test-log-validation-list">
            {uniqueValidationHistory.length > 0 ? (
              uniqueValidationHistory.map((error, idx) => (
                <div key={idx} className="test-log-validation-item">
                  <div className="test-log-error-badge">
                    {error.type === 'hallucination' ? 'ALUCINACION' : error.type === 'missing' ? 'FALTANTE' : error.type.toUpperCase()}
                  </div>
                  <div className="test-log-error-content">
                    <strong>{error.field}</strong>: {error.reason}
                  </div>
                </div>
              ))
            ) : (
              <div className="test-log-clean-run">
                <CheckCircle size={40} />
                <p>Ejecucion limpia: 0 errores detectados</p>
              </div>
            )}
          </div>

          <div className="test-log-result-preview">
            <div className="test-log-section-title">
              <h3>Historia Generada</h3>
            </div>
            <div className="test-log-text-preview">
              <pre>{log.medical_history}</pre>
            </div>
          </div>
        </div>
      </motion.div>

      <style>{`
        .test-log-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: var(--z-modal);
          backdrop-filter: blur(4px);
          padding: 1rem;
        }

        .test-log-modal-content {
          background: white;
          width: 90%;
          max-width: 860px;
          max-height: 90vh;
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }

        .test-log-modal-header {
          padding: 1.5rem;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .test-log-header-title h2 {
          margin: 0;
          color: #1e293b;
          font-size: 1.25rem;
        }

        .test-log-date-badge { font-size: 0.85rem; color: #64748b; font-weight: 500; }

        .test-log-close-btn {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          padding: 0.5rem;
          border-radius: 8px;
        }

        .test-log-close-btn:hover { background: #f1f5f9; color: #ef4444; }

        .test-log-modal-body { padding: 1.5rem; overflow-y: auto; }

        .test-log-metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .test-log-metric-card {
          background: #f8fafc;
          padding: 1rem;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .test-log-metric-icon {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .test-log-metric-icon.blue { background: #dbeafe; color: #2563eb; }
        .test-log-metric-icon.green { background: #dcfce7; color: #16a34a; }
        .test-log-metric-icon.purple { background: #f3e8ff; color: #9333ea; }
        .test-log-metric-icon.gold { background: #fef9c3; color: #ca8a04; }
        .test-log-metric-icon.gray { background: #e2e8f0; color: #94a3b8; }

        .gold-glow { border-color: #fde047; background: #fefce8; box-shadow: 0 0 10px rgba(234, 179, 8, 0.1); }

        .test-log-metric-info { display: flex; flex-direction: column; }
        .test-log-metric-info label { font-size: 0.75rem; color: #64748b; font-weight: 600; text-transform: uppercase; }
        .test-log-metric-info strong { font-size: 1rem; color: #0f172a; }

        .test-log-model-tag {
          font-size: 0.75rem;
          background: #e2e8f0;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: monospace;
        }

        .test-log-section-title { margin-bottom: 1rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; }
        .test-log-section-title h3 { margin: 0; font-size: 1rem; color: #334155; }

        .test-log-diagnostics-summary {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 0.9rem;
          margin-bottom: 1rem;
        }

        .test-log-diagnostics-summary p { margin: 0.3rem 0; }
        .test-log-error-meta { margin-top: 0.35rem; font-size: 0.78rem; color: #64748b; font-family: monospace; }

        .test-log-validation-list {
          margin-bottom: 1.4rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .test-log-validation-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          background: #fff;
          border: 1px solid #e2e8f0;
          padding: 0.75rem;
          border-radius: 8px;
        }

        .test-log-error-badge {
          font-size: 0.7rem;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 100px;
          background: #fee2e2;
          color: #991b1b;
          min-width: 80px;
          text-align: center;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          justify-content: center;
        }

        .test-log-error-badge.passed { background: #dcfce7; color: #166534; }
        .test-log-error-badge.failed { background: #fee2e2; color: #991b1b; }
        .test-log-error-badge.degraded { background: #fef3c7; color: #92400e; }
        .test-log-error-badge.info { background: #e0f2fe; color: #0c4a6e; }

        .test-log-error-content { flex: 1; font-size: 0.9rem; color: #334155; }

        .test-log-clean-run {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          padding: 2rem;
          color: #16a34a;
          background: #f0fdfa;
          border-radius: 12px;
          border: 1px dashed #16a34a;
        }

        .test-log-text-preview pre {
          background: #f8fafc;
          padding: 1rem;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          white-space: pre-wrap;
          font-family: monospace;
          font-size: 0.85rem;
          color: #334155;
          max-height: 200px;
          overflow-y: auto;
        }
      `}</style>
    </div>
  );
};
