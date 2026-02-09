import React from 'react';
import { LabTestLog } from '../services/db';
import { X, CheckCircle, Cpu, Activity, Brain } from 'lucide-react';
import { motion } from 'framer-motion';

interface TestLogDetailModalProps {
  log: LabTestLog;
  onClose: () => void;
}

export const TestLogDetailModal: React.FC<TestLogDetailModalProps> = ({ log, onClose }) => {
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
                <label>Modelos Usados</label>
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

          <div className="test-log-section-title">
            <h3>Historial de Validacion</h3>
          </div>

          <div className="test-log-validation-list">
            {log.metadata.validationHistory && log.metadata.validationHistory.length > 0 ? (
              log.metadata.validationHistory.map((error, idx) => (
                <div key={idx} className="test-log-validation-item">
                  <div className="test-log-error-badge">
                    {error.type === 'hallucination' ? 'ALUCINACION' : error.type === 'missing' ? 'FALTANTE' : error.type.toUpperCase()}
                  </div>
                  <div className="test-log-error-content">
                    <strong>{error.field}</strong>: {error.reason}
                  </div>
                  <div className="test-log-status-fixed">
                    <CheckCircle size={14} /> Corregido
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
          max-width: 800px;
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

        .test-log-date-badge {
          font-size: 0.85rem;
          color: #64748b;
          font-weight: 500;
        }

        .test-log-close-btn {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          padding: 0.5rem;
          border-radius: 8px;
        }

        .test-log-close-btn:hover {
          background: #f1f5f9;
          color: #ef4444;
        }

        .test-log-modal-body {
          padding: 1.5rem;
          overflow-y: auto;
        }

        .test-log-metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1rem;
          margin-bottom: 2rem;
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

        .gold-glow {
          border-color: #fde047;
          background: #fefce8;
          box-shadow: 0 0 10px rgba(234, 179, 8, 0.1);
        }

        .test-log-metric-info {
          display: flex;
          flex-direction: column;
        }

        .test-log-metric-info label {
          font-size: 0.75rem;
          color: #64748b;
          font-weight: 600;
          text-transform: uppercase;
        }

        .test-log-metric-info strong {
          font-size: 1rem;
          color: #0f172a;
        }

        .test-log-model-tag {
          font-size: 0.75rem;
          background: #e2e8f0;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: monospace;
        }

        .test-log-section-title {
          margin-bottom: 1rem;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 0.5rem;
        }

        .test-log-section-title h3 {
          margin: 0;
          font-size: 1rem;
          color: #334155;
        }

        .test-log-validation-list {
          margin-bottom: 2rem;
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
        }

        .test-log-error-content {
          flex: 1;
          font-size: 0.9rem;
          color: #334155;
        }

        .test-log-status-fixed {
          font-size: 0.75rem;
          color: #16a34a;
          display: flex;
          align-items: center;
          gap: 4px;
          font-weight: 600;
        }

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
