import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, FileOutput, ChevronRight, Printer, Copy, Check, Pencil, Save, X } from 'lucide-react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { searchMedicalRecords, updateMedicalRecord, type MedicalRecord } from '../services/storage';
import { processDoctorFeedbackV2 } from '../services/doctor-feedback';
import { evaluateAndPersistRuleImpactV2 } from '../services/learning/rule-evaluator';
import { motionTransitions } from '../features/ui/motion-tokens';
import { safeCopyToClipboard } from '../utils/safeBrowser';
import { buildPrintableDocument } from '../utils/printTemplates';
import { getClinicalSpecialtyConfig, normalizeClinicalSpecialty } from '../clinical/specialties';
import './ReportsView.css';

interface ReportsViewProps {
  apiKey?: string;
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const renderPrintableMarkdown = (value: string): string => escapeHtml(value || '')
  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  .replace(/\n/g, '<br>');

export const ReportsView: React.FC<ReportsViewProps> = ({ apiKey }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MedicalRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [isEditingReport, setIsEditingReport] = useState(false);
  const [editedReportContent, setEditedReportContent] = useState('');
  const [doctorReasonCode, setDoctorReasonCode] = useState<'terminologia' | 'omision' | 'error_clinico' | 'redaccion' | 'formato' | 'otro' | ''>('');

  const reportEditIsSignificant = useMemo(() => {
    const base = selectedRecord?.medical_report || '';
    if (!isEditingReport) return false;
    const normalizedBase = base.trim();
    const normalizedEdited = editedReportContent.trim();
    if (!normalizedBase || !normalizedEdited) return false;
    const delta = Math.abs(normalizedEdited.length - normalizedBase.length);
    return delta >= 24 || normalizedBase !== normalizedEdited;
  }, [editedReportContent, isEditingReport, selectedRecord]);

  const queueReportLearning = useCallback((record: MedicalRecord, beforeReport: string, afterReport: string) => {
    const specialty = normalizeClinicalSpecialty(record.specialty || record.consultation_type);
    void processDoctorFeedbackV2({
      transcription: record.transcription || '',
      aiText: beforeReport || '',
      doctorText: afterReport || '',
      apiKey,
      recordId: record.record_uuid,
      auditId: record.audit_id,
      source: 'report_save',
      artifactType: 'medical_report',
      allowAutosaveLearn: true,
      specialty,
      doctorReasonCode: doctorReasonCode || undefined
    }).then((learningResult) => {
      if (!learningResult?.candidate_ids?.length) return;
      void evaluateAndPersistRuleImpactV2({
        candidateIds: learningResult.candidate_ids,
        aiOutput: beforeReport || '',
        doctorOutput: afterReport || '',
        source: 'report_save',
        artifactType: 'medical_report',
        specialty,
        doctorReasonCode: doctorReasonCode || undefined,
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
      setDoctorReasonCode('');
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
        setDoctorReasonCode('');
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
    if (!printWindow) return;
    {
      printWindow.document.write(buildPrintableDocument({
        specialty: normalizeClinicalSpecialty(selectedRecord?.specialty || selectedRecord?.consultation_type),
        kind: 'report',
        patientName,
        content,
        pageTitle: getClinicalSpecialtyConfig(selectedRecord?.specialty || selectedRecord?.consultation_type).reportTitle
      }));
      printWindow.document.close();
      return;

      const htmlContent = renderPrintableMarkdown(content);
      const safePatientName = escapeHtml(patientName);

      printWindow!.document.write(`
        <html>
          <head>
            <title>Informe Medico - ${safePatientName}</title>
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
              <strong>Paciente:</strong> ${safePatientName}
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
      printWindow!.document.close();
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
            <div className="reports-loading">
              <div className="skeleton-card" style={{ height: '80px' }} />
              <div className="skeleton-card" style={{ height: '80px' }} />
              <div className="skeleton-card" style={{ height: '80px' }} />
            </div>
          ) : results.length === 0 ? (
            <div className="reports-no-results">
              <Search size={24} style={{ opacity: 0.3 }} />
              <span>No se encontraron registros</span>
            </div>
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
                        <button className="reports-action-button secondary" onClick={() => { setIsEditingReport(false); setDoctorReasonCode(''); }} data-ui-state="idle">
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
                    <>
                    <textarea
                      className="reports-editor"
                      value={editedReportContent}
                      onChange={(e) => setEditedReportContent(e.target.value)}
                      placeholder="Editar informe..."
                    />
                    {reportEditIsSignificant && (
                      <div className="learning-reason-box">
                        <span className="learning-reason-label">Motivo del cambio</span>
                        <div className="learning-reason-chips">
                          {[
                            ['terminologia', 'Terminologia'],
                            ['omision', 'Omisión'],
                            ['error_clinico', 'Error clínico'],
                            ['redaccion', 'Redacción'],
                            ['formato', 'Formato'],
                            ['otro', 'Otro']
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              className={`learning-chip ${doctorReasonCode === value ? 'active' : ''}`}
                              onClick={() => setDoctorReasonCode((current) => current === value ? '' : value as typeof doctorReasonCode)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    </>
                  ) : (
                    <div className="reports-markdown-content">
                      <ReactMarkdown>{selectedRecord.medical_report}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="reports-empty-preview">
                <FileOutput size={48} className="empty-icon" strokeWidth={1.5} />
                <p>Este paciente no tiene un informe generado</p>
                <p className="reports-sub-text">Ve al Historial para generar uno</p>
              </div>
            )
          ) : (
            <div className="reports-empty-preview">
              <FileOutput size={48} className="empty-icon" strokeWidth={1.5} />
              <p>Selecciona un paciente para ver su informe</p>
              <p className="reports-sub-text">Busca o selecciona de la lista</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
