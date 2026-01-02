import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, FileText, Sparkles, FileOutput, X, Printer, Plus, AlertTriangle, Edit2, Brain, Wand2, ThumbsDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { MBSLogo } from './MBSLogo';
import { AIAuditWidget } from './AIAuditWidget';
import { processDoctorFeedback } from '../services/doctor-feedback';
import type { ExtractionMeta, ConsultationClassification, UncertaintyFlag, FieldEvidence } from '../services/groq';
import { saveFieldConfirmation, logQualityEvent } from '../services/supabase';

interface HistoryViewProps {
  content: string;
  isLoading: boolean;
  patientName?: string;
  transcription?: string; // Needed for learning context
  apiKey?: string; // Needed for Qwen3 analysis call
  onGenerateReport?: () => Promise<string>;
  onNewConsultation?: () => void;
  onContentChange?: (newContent: string) => void;
  metadata?: {
    corrections: number;
    models: { generation: string; validation: string };
    errorsFixed: number;
    versionsCount: number;
    remainingErrors?: { type: string; field: string; reason: string }[];
    validationHistory?: { type: string; field: string; reason: string }[];
    extractionMeta?: ExtractionMeta[];
    classification?: ConsultationClassification;
    uncertaintyFlags?: UncertaintyFlag[];
    auditId?: string;
  };
}

const LoadingMessages = () => {
  const messages = [
    "Analizando audio...",
    "Identificando hablantes...",
    "Transcribiendo consulta...",
    "Detectando síntomas...",
    "Estructurando historia clínica...",
    "Redactando informe preliminar...",
    "Finalizando..."
  ];
  const [index, setIndex] = useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % messages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return createPortal(
    <div className="loading-container">
      <div className="background-shapes">
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
      </div>
      <div className="spinner-wrapper">
        <motion.div
          className="loading-ring"
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />
        <div className="logo-center">
          <MBSLogo size={50} />
        </div>
      </div>

      <div className="loading-text-wrapper">
        <AnimatePresence mode="wait">
          <motion.p
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5 }}
            className="loading-text"
          >
            {messages[index]}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>,
    document.body
  );
};

export const HistoryView: React.FC<HistoryViewProps> = ({
  content,
  isLoading,
  patientName,
  transcription,
  apiKey,
  onGenerateReport,
  onNewConsultation,
  onContentChange,
  metadata
}) => {
  // ... (existing state)
  const [copied, setCopied] = useState(false);

  // Edit Mode State
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [showSourcesModal, setShowSourcesModal] = useState(false);
  const [flagDecisions, setFlagDecisions] = useState<Record<string, 'confirmed' | 'rejected'>>({});

  // Split content into History and Maria Notes
  const [historyText, mariaNotes] = content ? content.split('---MARIA_NOTES---') : ['', ''];

  const evidenceByField = useMemo(() => {
    const entries: FieldEvidence[] = [];
    const meta = metadata?.extractionMeta || [];
    meta.forEach((chunk) => {
      (chunk.field_evidence || []).forEach((evidence) => {
        if (!evidence.field_path) return;
        if (!evidence.value && !evidence.evidence_snippet) return;
        entries.push(evidence);
      });
    });
    const grouped = new Map<string, FieldEvidence[]>();
    entries.forEach((entry) => {
      const list = grouped.get(entry.field_path) || [];
      list.push(entry);
      grouped.set(entry.field_path, list);
    });
    return Array.from(grouped.entries());
  }, [metadata]);

  const handleFlagDecision = async (flag: UncertaintyFlag, confirmed: boolean) => {
    if (flagDecisions[flag.field_path]) return;
    setFlagDecisions((prev) => ({
      ...prev,
      [flag.field_path]: confirmed ? 'confirmed' : 'rejected'
    }));

    await saveFieldConfirmation({
      record_id: metadata?.auditId,
      field_path: flag.field_path,
      suggested_value: flag.value,
      confirmed
    });

    await logQualityEvent({
      record_id: metadata?.auditId,
      event_type: confirmed ? 'field_confirmation' : 'field_rejection',
      payload: {
        field_path: flag.field_path,
        reason: flag.reason,
        suggested_value: flag.value || null
      }
    });

    if (!confirmed && !isEditing) {
      handleEditClick();
    }
  };

  const handleEditClick = () => {
    setEditValue(historyText);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    // TRIGGER LEARNING: If content changed, analyze why
    if (editValue !== historyText) {
      if (transcription && apiKey) {
        processDoctorFeedback(
          transcription,
          historyText, // Original AI version
          editValue,   // Doctor's edited version
          apiKey,
          metadata?.auditId
        ).then(lesson => {
          if (lesson) {
            console.log('[HistoryView] Aprendizaje registrado:', lesson.improvement_category);
          }
        });
      }
      logQualityEvent({
        record_id: metadata?.auditId,
        event_type: 'doctor_edit',
        payload: {
          length_diff: Math.abs(editValue.length - historyText.length),
          sections_changed: 1
        }
      });
    }

    if (onContentChange) {
      const fullContent = editValue + (mariaNotes ? '\n---MARIA_NOTES---\n' + mariaNotes : '');
      onContentChange(fullContent);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenReport = async () => {
    setShowReportModal(true);
    if (!reportContent && onGenerateReport) {
      setIsGeneratingReport(true);
      try {
        const report = await onGenerateReport();
        setReportContent(report);
      } catch (error) {
        console.error("Error generating report:", error);
        setReportContent("Error al generar el informe. Inténtelo de nuevo.");
      } finally {
        setIsGeneratingReport(false);
      }
    }
  };

  const handlePrintReport = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const htmlContent = reportContent
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

      printWindow.document.write(`
        <html>
          <head>
            <title>Informe Médico - ${patientName}</title>
            <style>
              body { font-family: 'Georgia', serif; padding: 40px; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
              .header-container { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 60px; }
              .logo-img { width: 180px; height: auto; }
              .doctor-info { text-align: right; font-family: 'Arial', sans-serif; font-size: 14px; color: #000; }
              .doctor-name { font-weight: bold; font-size: 16px; margin-bottom: 4px; }
              .report-title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 18px; margin-bottom: 40px; text-transform: uppercase; }
              .patient-info { margin-bottom: 30px; font-size: 16px; }
              .content { font-size: 16px; text-align: justify; }
              .footer { margin-top: 80px; text-align: center; font-size: 12px; color: #000; font-family: 'Arial', sans-serif; }
              strong { font-weight: bold; color: #000; }
            </style>
          </head>
          <body>
            <div class="header-container">
              <img src="${window.location.origin}/medibilbao_logo.png" alt="MediBilbao Salud" class="logo-img" />
              <div class="doctor-info">
                <div class="doctor-name">Dra. Itziar Gotxi</div>
                <div>Especialista en</div>
                <div>Otorrinolaringología</div>
                <br/>
                <div>Nº. Col. 484809757</div>
              </div>
            </div>

            <div class="report-title">INFORME MEDICO</div>

            <div class="patient-info">
              <strong>Paciente:</strong> ${patientName}
            </div>

            <div class="content">
              ${htmlContent}
            </div>

            <div class="footer">
              <div>MediSalud Bilbao Gran Vía 63bis 2º dpto.6 48011 BILBAO Tel: 944329670</div>
              <div>Email:info@medibilbaosalud.com www.medibilbaosalud.com</div>
            </div>

            <script>
              window.onload = function() { window.print(); window.close(); }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  if (isLoading) {
    return <LoadingMessages />;
  }

  if (!content) {
    return (
      <div className="empty-state">
        <FileText size={48} className="empty-icon" />
        <p>No hay historia clínica generada aún.</p>
      </div>
    );
  }

  return (
    <div className="history-view-container">
      <div className="history-layout">
        {/* Main Document Column */}
        <div className="document-column">
          <motion.div
            className="document-card"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="document-header">
              <div className="doc-title">
                <FileText size={20} className="doc-icon" />
                <span>Historia Clínica</span>
              </div>
              <div className="doc-actions">
                {metadata && (
                  <AIAuditWidget
                    corrections={metadata.corrections}
                    models={metadata.models}
                    errorsFixed={metadata.errorsFixed}
                    versionsCount={metadata.versionsCount}
                    validationLogs={metadata.validationHistory || metadata.remainingErrors}
                  />
                )}
                <div className="action-buttons-group">

                  {!isEditing ? (
                    <>
                      {onNewConsultation && (
                        <button
                          className="action-button new-consultation"
                          onClick={onNewConsultation}
                        >
                          <Plus size={18} />
                          <span>Nueva Consulta</span>
                        </button>
                      )}
                      <button
                        className="action-button secondary"
                        onClick={handleEditClick}
                        title="Editar texto"
                      >
                        <Edit2 size={16} />
                        <span>Editar</span>
                      </button>
                      {metadata?.extractionMeta && metadata.extractionMeta.length > 0 && (
                        <button
                          className="action-button secondary"
                          onClick={() => setShowSourcesModal(true)}
                          title="Ver fuentes"
                        >
                          <FileText size={16} />
                          <span>Fuentes</span>
                        </button>
                      )}
                      <button
                        className="action-button secondary"
                        onClick={handleOpenReport}
                        title="Generar Informe Médico Formal"
                      >
                        <FileOutput size={16} />
                        <span>Informe</span>
                      </button>
                      <button
                        className={`action-button copy-btn ${copied ? 'success' : ''}`}
                        onClick={() => handleCopy(historyText)} // Keep historyText here as we copy what is shown
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        <span>{copied ? 'Copiado' : 'Copiar'}</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="action-button secondary" onClick={handleCancelEdit}>
                        <X size={16} />
                        <span>Cancelar</span>
                      </button>
                      <button className="action-button primary success" onClick={handleSaveEdit}>
                        <Check size={16} />
                        <span>Guardar</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {metadata?.classification && (
              <div className="classification-banner">
                <span>Contexto ENT:</span>
                <span className="classification-pill">{metadata.classification.visit_type}</span>
                <span className="classification-pill">{metadata.classification.ent_area}</span>
                <span className="classification-pill">{metadata.classification.urgency}</span>
              </div>
            )}

            <div className="document-content markdown-body">
              {isEditing ? (
                <>
                  <textarea
                    className="history-edit-textarea"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: '400px',
                      padding: '1rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      fontFamily: 'inherit',
                      fontSize: '1rem',
                      lineHeight: '1.6',
                      resize: 'vertical'
                    }}
                  />

                  {/* AI Feedback Widget */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="ai-feedback-widget"
                  >
                    <div className="feedback-header">
                      <div className="brain-icon-wrapper">
                        <Brain size={20} />
                      </div>
                      <div className="feedback-title">
                        <h4>Aprendizaje Activo en Curso</h4>
                        <p>Sus ediciones entrenarán al modelo para la próxima vez.</p>
                      </div>
                    </div>

                    <div className="feedback-content">
                      <div className="improvement-preview">
                        <Wand2 size={18} className="improvement-icon" />
                        <span>
                          <strong>Impacto:</strong> Al guardar, el sistema analizará la diferencia entre el borrador original y su versión final para ajustar el prompt de "Enfermedad Actual" y evitar errores similares.
                        </span>
                      </div>
                    </div>

                    <div className="feedback-actions">
                      <button className="decline-btn" title="Rechazar este borrador por completo">
                        <ThumbsDown size={16} />
                        <span>Declinar Borrador</span>
                      </button>
                    </div>
                  </motion.div>
                </>
              ) : (
                <ReactMarkdown>{historyText}</ReactMarkdown>
              )}
            </div>

            {/* Remaining Errors Warning */}
            {metadata?.remainingErrors && metadata.remainingErrors.length > 0 && (
              <div className="remaining-errors-warning">
                <div className="warning-header">
                  <AlertTriangle size={18} />
                  <span>Posibles inconsistencias detectadas</span>
                </div>
                <ul className="error-list">
                  {metadata.remainingErrors.map((err, i) => (
                    <li key={i}>
                      <strong>{err.field}:</strong> {err.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {metadata?.uncertaintyFlags && metadata.uncertaintyFlags.length > 0 && (
              <div className="uncertainty-panel">
                <div className="uncertainty-header">
                  <AlertTriangle size={18} />
                  <span>Campos con baja confianza</span>
                </div>
                <ul className="uncertainty-list">
                  {metadata.uncertaintyFlags.map((flag, i) => {
                    const decision = flagDecisions[flag.field_path];
                    return (
                      <li key={`${flag.field_path}-${i}`} className="uncertainty-item">
                        <div className="uncertainty-details">
                          <strong>{flag.field_path}</strong>
                          <span>{flag.reason}</span>
                          {flag.value && <em>Valor: {flag.value}</em>}
                        </div>
                        <div className="uncertainty-actions">
                          <button
                            className="flag-action confirm"
                            disabled={Boolean(decision)}
                            onClick={() => handleFlagDecision(flag, true)}
                          >
                            {decision === 'confirmed' ? 'Confirmado' : 'Confirmar'}
                          </button>
                          <button
                            className="flag-action reject"
                            disabled={Boolean(decision)}
                            onClick={() => handleFlagDecision(flag, false)}
                          >
                            {decision === 'rejected' ? 'Marcado' : 'Corregir'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

          </motion.div>
        </div>

        {/* Maria Notes Column */}
        {mariaNotes && (
          <div className="notes-column">
            <motion.div
              className="maria-notes-card"
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <div className="notes-header">
                <Sparkles size={18} className="notes-icon" />
                <span>Notas de Maria AI</span>
              </div>
              <div className="notes-content">
                <ReactMarkdown>{mariaNotes}</ReactMarkdown>
              </div>
            </motion.div>
          </div>
        )}
      </div>

      {/* Report Modal */}
      <AnimatePresence>
        {showReportModal && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="modal-header">
                <h3>Informe Médico Formal</h3>
                <button className="close-btn" onClick={() => setShowReportModal(false)}>
                  <X size={20} />
                </button>
              </div>

              <div className="modal-body">
                {isGeneratingReport ? (
                  <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Redactando informe...</p>
                  </div>
                ) : (
                  <textarea
                    className="report-editor"
                    value={reportContent}
                    onChange={(e) => setReportContent(e.target.value)}
                  />
                )}
              </div>

              <div className="modal-footer">
                {isGeneratingReport ? null : (
                  <>
                    <button className="action-button primary" onClick={() => handleCopy(reportContent)}>
                      <Copy size={16} /> Copiar
                    </button>
                    <button className="action-button success" onClick={handlePrintReport}>
                      <Printer size={16} /> Imprimir
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sources Modal */}
      <AnimatePresence>
        {showSourcesModal && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content sources-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="modal-header">
                <h3>Fuentes y evidencia</h3>
                <button className="close-btn" onClick={() => setShowSourcesModal(false)}>
                  <X size={20} />
                </button>
              </div>

              <div className="modal-body sources-body">
                {evidenceByField.length === 0 ? (
                  <p>No hay evidencia disponible.</p>
                ) : (
                  evidenceByField.map(([fieldPath, entries]) => (
                    <div key={fieldPath} className="source-group">
                      <h4>{fieldPath}</h4>
                      {entries.map((entry, idx) => (
                        <div key={`${fieldPath}-${idx}`} className="source-entry">
                          <div className="source-meta">
                            <span className="source-value">{entry.value}</span>
                            <span className="source-chunk">{entry.chunk_id}</span>
                          </div>
                          <p className="source-snippet">{entry.evidence_snippet || 'Sin evidencia literal.'}</p>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .history-view-container {
          height: 100%;
          width: 100%; /* Ensure full width */
          overflow-y: auto;
          padding-bottom: 2rem;
        }

        .history-layout {
          display: flex;
          gap: 2rem;
          align-items: flex-start;
          max-width: 1200px;
          margin: 0 auto;
        }

        .document-column {
          flex: 3;
          min-width: 0;
        }

        .notes-column {
          flex: 1;
          min-width: 280px;
          position: sticky;
          top: 0;
        }

  .document-card {
          background: white;
          border-radius: 16px;
          box-shadow: var(--shadow-md);
          /* overflow: hidden; Removed to prevent clipping */
          border: 1px solid var(--glass-border);
          position: relative;
        }

        .document-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 2rem;
          background: #f8fafc;
          border-bottom: 1px solid var(--glass-border);
        }

        .classification-banner {
          display: flex;
          gap: 10px;
          align-items: center;
          padding: 0.75rem 2rem;
          background: #f1f5f9;
          border-bottom: 1px solid #e2e8f0;
          font-size: 0.85rem;
          color: #334155;
        }

        .classification-pill {
          background: #e2e8f0;
          color: #0f172a;
          padding: 2px 8px;
          border-radius: 999px;
          font-weight: 600;
          font-size: 0.75rem;
        }

        .doc-title {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-weight: 600;
          color: var(--text-primary);
          font-size: 1.1rem;
        }

        .doc-icon {
          color: var(--brand-primary);
        }

        .doc-actions {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .action-buttons-group {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }

        .action-button {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.6rem 1.2rem;
          border-radius: 12px;
          border: none;
          font-size: 0.95rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        .action-button.new-consultation {
          background: var(--brand-gradient);
          color: white;
          box-shadow: 0 4px 12px rgba(38, 166, 154, 0.3);
          font-weight: 600;
        }
        
        .action-button.new-consultation:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(38, 166, 154, 0.4);
        }

        .action-button.copy-btn {
          background: white;
          color: var(--text-secondary);
          border: 1px solid var(--glass-border);
          box-shadow: var(--shadow-sm);
        }
        
        .action-button.copy-btn:hover {
          border-color: var(--brand-primary);
          color: var(--brand-primary);
          background: #f0fdfa;
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .action-button.primary {
          background: var(--bg-secondary);
          color: var(--text-primary);
          border: 1px solid var(--glass-border);
        }

        .action-button.primary:hover {
          background: var(--bg-tertiary);
        }

        .action-button.secondary {
          background: transparent;
          color: var(--brand-primary);
          border: 1px solid var(--brand-primary);
        }
        
        .action-button.secondary:hover {
          background: rgba(38, 166, 154, 0.05);
        }

        .action-button.success {
          background: #10b981;
          color: white;
        }

        .document-content {
          padding: 3rem;
          font-family: 'Georgia', serif;
          color: #334155;
          line-height: 1.6;
          font-size: 1.05rem;
        }

        /* Markdown Styles */
        .markdown-body h1, .markdown-body h2, .markdown-body h3 {
          margin-top: 1.5em;
          margin-bottom: 0.75em;
          color: #1e293b;
          font-family: var(--font-sans);
        }
        
        .markdown-body h1 { font-size: 1.5em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
        .markdown-body h2 { font-size: 1.25em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--brand-primary); margin-top: 2em; }
        .markdown-body p { margin-bottom: 1em; }
        .markdown-body ul { padding-left: 1.5em; margin-bottom: 1em; }

        /* Remaining Errors Warning */
        .remaining-errors-warning {
          margin: 1.5rem 2rem;
          padding: 1rem 1.5rem;
          background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
          border: 1px solid #fca5a5;
          border-left: 4px solid #ef4444;
          border-radius: 12px;
        }

        .remaining-errors-warning .warning-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #dc2626;
          font-weight: 600;
          font-size: 0.95rem;
          margin-bottom: 0.75rem;
        }

        .remaining-errors-warning .error-list {
          margin: 0;
          padding-left: 1.5rem;
          font-size: 0.9rem;
          color: #991b1b;
        }

        .remaining-errors-warning .error-list li {
          margin-bottom: 0.5rem;
        }

        .remaining-errors-warning .error-list li strong {
          color: #b91c1c;
        }

        .uncertainty-panel {
          margin: 1.5rem 2rem 2rem;
          padding: 1rem;
          border-radius: 12px;
          background: #fefce8;
          border: 1px solid #fde68a;
        }

        .uncertainty-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          color: #92400e;
          margin-bottom: 0.75rem;
        }

        .uncertainty-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 0.75rem;
        }

        .uncertainty-item {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.75rem;
          background: #fff7ed;
          border-radius: 10px;
          border: 1px solid #fed7aa;
        }

        .uncertainty-details {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 0.85rem;
          color: #7c2d12;
        }

        .uncertainty-details em {
          font-style: normal;
          color: #9a3412;
        }

        .uncertainty-actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .flag-action {
          border: none;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
        }

        .flag-action.confirm {
          background: #16a34a;
          color: white;
        }

        .flag-action.reject {
          background: #f97316;
          color: white;
        }

        .flag-action:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .sources-modal {
          max-width: 720px;
          width: 92%;
          max-height: 80vh;
          overflow: hidden;
        }

        .sources-body {
          max-height: 60vh;
          overflow-y: auto;
          display: grid;
          gap: 1rem;
        }

        .source-group h4 {
          margin: 0 0 0.5rem 0;
          font-size: 0.9rem;
          color: #0f172a;
        }

        .source-entry {
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 0.75rem;
          background: #f8fafc;
          margin-bottom: 0.5rem;
        }

        .source-meta {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: #475569;
          margin-bottom: 0.5rem;
        }

        .source-value {
          font-weight: 600;
          color: #0f172a;
        }

        .source-snippet {
          margin: 0;
          font-size: 0.85rem;
          color: #1e293b;
          white-space: pre-wrap;
        }
        .maria-notes-card {
          background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow: var(--shadow-sm);
          border: 1px solid rgba(251, 191, 36, 0.2);
        }

        .notes-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 600;
          color: #92400e;
          margin-bottom: 1rem;
          font-size: 0.95rem;
        }

        .notes-content {
          font-size: 0.9rem;
          color: #78350f;
          line-height: 1.5;
        }

        .loading-container {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 50%, #f0fdfa 100%);
          z-index: 2000;
          gap: 2.5rem;
          overflow: hidden;
        }

        .background-shapes {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            z-index: -1;
        }

        .shape {
            position: absolute;
            border-radius: 50%;
            filter: blur(80px);
            opacity: 0.6;
            animation: float 20s infinite ease-in-out;
        }

        .shape-1 {
            top: -10%;
            left: -10%;
            width: 500px;
            height: 500px;
            background: rgba(38, 166, 154, 0.15);
            animation-delay: 0s;
        }

        .shape-2 {
            bottom: -20%;
            right: -10%;
            width: 600px;
            height: 600px;
            background: rgba(0, 191, 165, 0.1);
            animation-delay: -5s;
        }

        .shape-3 {
            top: 40%;
            left: 40%;
            width: 300px;
            height: 300px;
            background: rgba(128, 203, 196, 0.15);
            animation-delay: -10s;
        }

        @keyframes float {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(30px, -50px) scale(1.1); }
            66% { transform: translate(-20px, 20px) scale(0.9); }
        }

        .spinner-wrapper {
            position: relative;
            width: 100px;
            height: 100px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .loading-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border: 3px solid transparent;
          border-top-color: var(--brand-primary);
          border-right-color: var(--brand-secondary);
          border-radius: 50%;
        }
        
        .logo-center {
            z-index: 2;
        }
        
        .loading-text-wrapper {
            height: 32px;
            overflow: hidden;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 300px;
        }
        
        .loading-text {
            font-size: 1.2rem;
            font-weight: 500;
            color: var(--text-primary);
            letter-spacing: 0.3px;
            background: linear-gradient(90deg, var(--brand-dark), var(--brand-primary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          min-height: 400px;
          gap: 1rem;
          color: var(--text-tertiary);
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }

        .modal-content {
          background: white;
          width: 90%;
          max-width: 800px;
          height: 85vh;
          border-radius: 20px;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-lg);
        }

        .modal-header {
          padding: 1.5rem;
          border-bottom: 1px solid var(--glass-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .modal-header h3 {
          margin: 0;
          font-family: var(--font-display);
          color: var(--text-primary);
        }
        
        .close-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
        }

        .modal-body {
          flex: 1;
          padding: 1.5rem;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .report-editor {
          width: 100%;
          height: 100%;
          border: 1px solid var(--glass-border);
          border-radius: 12px;
          padding: 2rem;
          font-family: 'Georgia', serif;
          font-size: 1.1rem;
          line-height: 1.6;
          resize: none;
          outline: none;
          background: #fdfdfd;
        }

        .report-editor:focus {
          border-color: var(--brand-primary);
        }

        .modal-footer {
          padding: 1.5rem;
          border-top: 1px solid var(--glass-border);
          display: flex;
          justify-content: flex-end;
          gap: 1rem;
        }

        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 1rem;
          color: var(--text-secondary);
        }

        .spinner {
          width: 30px;
          height: 30px;
          border: 3px solid var(--bg-tertiary);
          border-top-color: var(--brand-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Markdown Styles for Medical Report */
        .markdown-body {
            color: #334155;
            line-height: 1.7;
            font-size: 1rem;
        }

        .markdown-body h2 {
            font-size: 1.1rem;
            font-weight: 700;
            color: #0f766e; /* Teal-700 */
            margin-top: 1.5rem;
            margin-bottom: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 0.25rem;
        }

        .markdown-body h3 {
            font-size: 1rem;
            font-weight: 600;
            color: #475569;
            margin-top: 1.25rem;
            margin-bottom: 0.5rem;
        }

        .markdown-body p {
            margin-bottom: 1rem;
            text-align: justify;
        }

        .markdown-body ul {
            list-style-type: none; /* Removed bullets for clean "Form" look */
            padding-left: 0;       /* Align with headers */
            margin-bottom: 1rem;
        }

        .markdown-body li {
            margin-bottom: 0.5rem;
            border-bottom: 1px dashed #f1f5f9; /* Subtle separator line */
            padding-bottom: 0.25rem;
        }
        
        .markdown-body li:last-child {
            border-bottom: none;
        }

        .markdown-body strong {
            color: #1e293b;
            font-weight: 600;
        }
      `}</style>
    </div>
  );
};
