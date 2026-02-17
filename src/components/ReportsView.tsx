import React, { useState, useEffect, useCallback } from 'react';
import { Search, FileOutput, ChevronRight, Printer, Copy, Check, Pencil, Save, X } from 'lucide-react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { searchMedicalRecords, updateMedicalRecord, type MedicalRecord } from '../services/storage';
import { processDoctorFeedbackV2 } from '../services/doctor-feedback';
import { evaluateAndPersistRuleImpactV2 } from '../services/learning/rule-evaluator';
import { motionTransitions } from '../features/ui/motion-tokens';
import { safeCopyToClipboard } from '../utils/safeBrowser';

interface ReportsViewProps {
  apiKey?: string;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ apiKey }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MedicalRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [isEditingReport, setIsEditingReport] = useState(false);
  const [editedReportContent, setEditedReportContent] = useState('');

  const queueReportLearning = useCallback((record: MedicalRecord, beforeReport: string, afterReport: string) => {
    void processDoctorFeedbackV2({
      transcription: record.transcription || '',
      aiText: beforeReport || '',
      doctorText: afterReport || '',
      apiKey,
      recordId: record.record_uuid,
      auditId: record.audit_id,
      source: 'report_save',
      artifactType: 'medical_report',
      allowAutosaveLearn: true
    }).then((learningResult) => {
      if (!learningResult?.candidate_ids?.length) return;
      void evaluateAndPersistRuleImpactV2({
        candidateIds: learningResult.candidate_ids,
        aiOutput: beforeReport || '',
        doctorOutput: afterReport || '',
        source: 'report_save',
        artifactType: 'medical_report',
        metadata: {
          record_id: record.record_uuid,
          audit_id: record.audit_id || null,
          learning_event_ids: learningResult.event_ids
        }
      });
    }).catch((error) => {
      console.warn('[ReportsView] learning V2 failed:', error);
    });
  }, [apiKey]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const data = await searchMedicalRecords(query);
      setResults(data || []);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void handleSearch({ preventDefault: () => { } } as React.FormEvent);
  }, []);

  const handleCopy = async (text: string) => {
    const copiedOk = await safeCopyToClipboard(text);
    if (!copiedOk) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartEditReport = () => {
    if (selectedRecord?.medical_report) {
      setEditedReportContent(selectedRecord.medical_report);
      setIsEditingReport(true);
    }
  };

  const handleSaveReport = async () => {
    if (!selectedRecord) return;
    try {
      const beforeReport = selectedRecord.medical_report || '';
      const updated = await updateMedicalRecord(selectedRecord.record_uuid, { medical_report: editedReportContent });
      if (updated && updated.length > 0) {
        setSelectedRecord({ ...selectedRecord, medical_report: editedReportContent });
        setResults(results.map((r) => r.record_uuid === selectedRecord.record_uuid ? { ...r, medical_report: editedReportContent } : r));
        queueReportLearning(selectedRecord, beforeReport, editedReportContent);
        setIsEditingReport(false);
      } else {
        alert('No se pudo guardar el informe.');
      }
    } catch (error) {
      console.error('Error saving report:', error);
      alert('Error al guardar el informe');
    }
  };

  const handlePrint = (content: string, patientName: string) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const htmlContent = content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

      printWindow.document.write(`
        <html>
          <head>
            <title>Informe Medico - ${patientName}</title>
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
                <div>Otorrinolaringologia</div>
                <br/>
                <div>N. Col. 484809757</div>
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
              <div>MediSalud Bilbao Gran Via 63bis 2 dpto.6 48011 BILBAO Tel: 944329670</div>
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

  return (
    <div className="reports-container">
      <div className="reports-search-header">
        <h2>Informes Medicos</h2>
        <form onSubmit={handleSearch} className="reports-search-bar">
          <Search size={20} className="reports-search-icon" />
          <input
            type="text"
            placeholder="Buscar informe por paciente..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="reports-search-input"
            aria-label="Buscar informe"
          />
        </form>
      </div>

      <div className="reports-content">
        <div className="reports-results-list">
          {isLoading ? (
            <div className="reports-loading">Cargando...</div>
          ) : results.length === 0 ? (
            <div className="reports-no-results">No se encontraron registros</div>
          ) : (
            results.map((record) => (
              <motion.div
                key={record.record_uuid}
                className={`reports-result-card ${selectedRecord?.record_uuid === record.record_uuid ? 'active' : ''}`}
                onClick={() => setSelectedRecord(record)}
                whileHover={{ scale: 1.01, y: -1, transition: motionTransitions.fast }}
                whileTap={{ scale: 0.98, transition: motionTransitions.fast }}
                transition={motionTransitions.normal}
                data-ui-state={selectedRecord?.record_uuid === record.record_uuid ? 'active' : 'idle'}
              >
                <div className="reports-card-header">
                  <span className="reports-patient-name">{record.patient_name}</span>
                  <span className="reports-date">{new Date(record.created_at || '').toLocaleDateString()}</span>
                </div>
                <div className="reports-card-meta">
                  {record.medical_report ? (
                    <span className="reports-status-badge success">Informe Disponible</span>
                  ) : (
                    <span className="reports-status-badge pending">Sin Informe</span>
                  )}
                </div>
                <ChevronRight size={16} className="reports-chevron" />
              </motion.div>
            ))
          )}
        </div>

        <div className="reports-preview-panel">
          {selectedRecord ? (
            selectedRecord.medical_report ? (
              <div className="reports-preview">
                <div className="reports-preview-header">
                  <h3>Informe: {selectedRecord.patient_name}</h3>
                  <div className="reports-actions">
                    {isEditingReport ? (
                      <>
                        <button className="reports-action-button success" onClick={handleSaveReport} data-ui-state="success">
                          <Save size={16} /> Guardar
                        </button>
                        <button className="reports-action-button secondary" onClick={() => setIsEditingReport(false)} data-ui-state="idle">
                          <X size={16} /> Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="reports-action-button secondary" onClick={handleStartEditReport} data-ui-state="idle">
                          <Pencil size={16} /> Editar
                        </button>
                        <button className="reports-action-button primary" onClick={() => void handleCopy(selectedRecord.medical_report!)} data-ui-state={copied ? 'success' : 'idle'}>
                          {copied ? <Check size={16} /> : <Copy size={16} />}
                          {copied ? 'Copiado' : 'Copiar'}
                        </button>
                        <button className="reports-action-button success" onClick={() => handlePrint(selectedRecord.medical_report!, selectedRecord.patient_name)} data-ui-state="idle">
                          <Printer size={16} /> Imprimir
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="reports-body">
                  {isEditingReport ? (
                    <textarea
                      className="reports-editor"
                      value={editedReportContent}
                      onChange={(e) => setEditedReportContent(e.target.value)}
                      placeholder="Editar informe..."
                    />
                  ) : (
                    <div className="reports-markdown-content">
                      <ReactMarkdown>{selectedRecord.medical_report}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="reports-empty-preview">
                <FileOutput size={48} />
                <p>Este paciente no tiene un informe generado.</p>
                <p className="reports-sub-text">Ve al Historial para generar uno.</p>
              </div>
            )
          ) : (
            <div className="reports-empty-preview">
              <FileOutput size={48} />
              <p>Selecciona un paciente para ver su informe</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .reports-container {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .reports-search-header h2 {
          margin: 0 0 1rem 0;
          color: var(--text-primary);
        }

        .reports-search-bar {
          position: relative;
          max-width: 540px;
        }

        .reports-search-icon {
          position: absolute;
          left: 1rem;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-secondary);
        }

        .reports-search-input {
          width: 100%;
          padding: 0.9rem 1rem 0.9rem 2.8rem;
          border-radius: var(--radius-full);
          border: 1px solid var(--border-soft);
          background: white;
          font-size: 1rem;
          color: var(--text-primary);
          box-shadow: var(--shadow-sm);
        }

        .reports-search-input:focus {
          outline: none;
          box-shadow: var(--shadow-glow);
          border-color: var(--brand-primary);
        }

        .reports-content {
          display: grid;
          grid-template-columns: 340px 1fr;
          gap: 1.5rem;
          flex: 1;
          overflow: hidden;
          min-height: 0;
        }

        .reports-results-list {
          overflow-y: auto;
          padding-right: 0.4rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .reports-result-card {
          background: var(--bg-primary);
          padding: 1rem;
          border-radius: 14px;
          cursor: pointer;
          border: 1px solid transparent;
          transition: border-color var(--motion-duration-fast) var(--motion-ease-base),
            background-color var(--motion-duration-fast) var(--motion-ease-base),
            box-shadow var(--motion-duration-fast) var(--motion-ease-base),
            transform var(--motion-duration-fast) var(--motion-ease-base);
          position: relative;
          box-shadow: var(--shadow-sm);
        }

        .reports-result-card:hover {
          box-shadow: var(--shadow-md);
        }

        .reports-result-card.active {
          border-color: var(--brand-primary);
          background: rgba(38, 166, 154, 0.05);
        }

        .reports-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.4rem;
        }

        .reports-patient-name {
          font-weight: 600;
          color: var(--text-primary);
        }

        .reports-date {
          font-size: 0.8rem;
          color: var(--text-tertiary);
        }

        .reports-status-badge {
          font-size: 0.75rem;
          padding: 4px 8px;
          border-radius: 8px;
          font-weight: 500;
          transition: background-color var(--motion-duration-fast) var(--motion-ease-base),
            color var(--motion-duration-fast) var(--motion-ease-base);
        }

        .reports-status-badge.success {
          background: #dcfce7;
          color: #166534;
        }

        .reports-status-badge.pending {
          background: #f1f5f9;
          color: #64748b;
        }

        .reports-chevron {
          position: absolute;
          right: 0.7rem;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-tertiary);
          opacity: 0;
          transition: opacity var(--motion-duration-fast) var(--motion-ease-base);
        }

        .reports-result-card:hover .reports-chevron {
          opacity: 1;
        }

        .reports-preview-panel {
          background: var(--bg-primary);
          border-radius: 20px;
          padding: 1.25rem;
          box-shadow: var(--shadow-md);
          overflow: auto;
          border: 1px solid var(--border-soft);
          min-height: 0;
        }

        .reports-preview-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 1rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid var(--border-soft);
        }

        .reports-preview-header h3 {
          margin: 0;
          color: var(--text-primary);
        }

        .reports-actions {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .reports-body {
          background: white;
          padding: 1.5rem;
          border-radius: 10px;
          box-shadow: var(--shadow-sm);
          min-height: 420px;
        }

        .reports-markdown-content {
          font-family: 'Georgia', serif;
          line-height: 1.78;
          color: var(--text-primary);
          font-size: 1.05rem;
        }

        .reports-markdown-content p {
          margin-bottom: 1rem;
          white-space: pre-wrap;
        }

        .reports-markdown-content h1,
        .reports-markdown-content h2,
        .reports-markdown-content h3 {
          margin-top: 1.3rem;
          margin-bottom: 0.8rem;
          color: #2c3e50;
        }

        .reports-empty-preview {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: var(--text-tertiary);
          gap: 1rem;
          text-align: center;
        }

        .reports-sub-text {
          font-size: 0.9rem;
          color: var(--text-secondary);
        }

        .reports-action-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.9rem;
          border-radius: 10px;
          border: none;
          font-size: 0.88rem;
          font-weight: 600;
          cursor: pointer;
          transition: background-color var(--motion-duration-fast) var(--motion-ease-base),
            border-color var(--motion-duration-fast) var(--motion-ease-base),
            color var(--motion-duration-fast) var(--motion-ease-base),
            transform var(--motion-duration-fast) var(--motion-ease-base),
            box-shadow var(--motion-duration-fast) var(--motion-ease-base);
        }

        .reports-action-button:hover {
          transform: translateY(-1px);
        }

        .reports-action-button:active {
          transform: scale(0.98);
        }

        .reports-action-button.primary {
          background: var(--bg-secondary);
          color: var(--text-primary);
          border: 1px solid var(--glass-border);
        }

        .reports-action-button.success {
          background: #10b981;
          color: white;
        }

        .reports-action-button.secondary {
          background: #f1f5f9;
          color: #475569;
          border: 1px solid #e2e8f0;
        }

        .reports-action-button.secondary:hover {
          background: #e2e8f0;
        }

        .reports-editor {
          width: 100%;
          min-height: 400px;
          padding: 1.25rem;
          font-family: 'Georgia', serif;
          font-size: 1rem;
          line-height: 1.6;
          border: 1px solid var(--glass-border);
          border-radius: 8px;
          resize: vertical;
          background: #fafafa;
        }

        .reports-editor:focus {
          outline: none;
          border-color: var(--brand-primary);
          box-shadow: 0 0 0 3px rgba(38, 166, 154, 0.1);
        }

        @media (max-width: 1024px) {
          .reports-content {
            grid-template-columns: 1fr;
            gap: 1rem;
          }

          .reports-results-list {
            max-height: 260px;
            border-bottom: 1px solid var(--border-soft);
            padding-bottom: 1rem;
          }

          .reports-preview-panel {
            padding: 1rem;
          }

          .reports-preview-header {
            flex-direction: column;
          }

          .reports-actions {
            width: 100%;
          }

          .reports-action-button {
            flex: 1;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
};
