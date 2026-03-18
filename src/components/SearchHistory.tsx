import React, { useState, useEffect, useCallback } from 'react';
import { Search, FileText, ChevronRight, Copy, Check, Sparkles, Trash2, FileOutput, Printer, X, Calendar, User, Pencil, Save, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { searchMedicalRecords, type MedicalRecord, deleteMedicalRecord, updateMedicalRecord, syncFromCloud } from '../services/storage';
import { isCloudSyncEnabled } from '../hooks/useCloudSync';
import { AIService } from '../services/ai';
import { processDoctorFeedbackV2 } from '../services/doctor-feedback';
import { evaluateAndPersistRuleImpactV2 } from '../services/learning/rule-evaluator';
import ReactMarkdown from 'react-markdown';
import { motionTransitions } from '../features/ui/motion-tokens';
import { safeCopyToClipboard } from '../utils/safeBrowser';
import { buildPrintableDocument, escapeHtml, renderPrintableMarkdown } from '../utils/printTemplates';
import { getClinicalSpecialtyConfig, normalizeClinicalSpecialty } from '../clinical/specialties';
import './SearchHistory.css';

interface SearchHistoryProps {
  apiKey: string;
  onLoadRecord?: (record: MedicalRecord) => void;
}

const modalOverlayVariants = {
  initial: { opacity: 0 },
  enter: { opacity: 1, transition: motionTransitions.fast },
  exit: { opacity: 0, transition: motionTransitions.fast }
};

const modalContentVariants = {
  initial: { opacity: 0, scale: 0.98, y: 8 },
  enter: { opacity: 1, scale: 1, y: 0, transition: motionTransitions.normal },
  exit: { opacity: 0, scale: 0.98, y: 6, transition: motionTransitions.fast }
};



export const SearchHistory: React.FC<SearchHistoryProps> = ({ apiKey, onLoadRecord }) => {

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MedicalRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [copied, setCopied] = useState(false);

  // Report Modal State
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isEditingReport, setIsEditingReport] = useState(false);

  // Name Editing State
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  // History Editing State
  const [isEditingHistory, setIsEditingHistory] = useState(false);
  const [editedHistory, setEditedHistory] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    try {
      const data = await searchMedicalRecords(query);
      console.log(`[SearchHistory] Fetched ${data.length} records from local DB.`);
      setResults(data || []);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      if (isCloudSyncEnabled()) {
        console.log('[SearchHistory] Refreshing from cloud...');
        await syncFromCloud();
      }
      await handleSearch();
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      // Auto-sync from cloud on mount if enabled
      if (isCloudSyncEnabled()) {
        setIsSyncing(true);
        try {
          await syncFromCloud();
        } finally {
          setIsSyncing(false);
        }
      }
      handleSearch();
    };
    init();
  }, []);

  const handleCopy = async (text: string) => {
    const copiedOk = await safeCopyToClipboard(text);
    if (!copiedOk) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async (recordUuid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (window.confirm('¿Estás seguro de que quieres eliminar esta consulta?')) {
      try {
        const success = await deleteMedicalRecord(recordUuid);
        if (success) {
          setResults(prevResults => prevResults.filter(r => r.record_uuid !== recordUuid));
          if (selectedRecord?.record_uuid === recordUuid) {
            setSelectedRecord(null);
          }
        } else {
          alert("No se pudo eliminar el registro. Inténtelo de nuevo.");
        }
      } catch (error) {
        console.error('Error in handleDelete:', error);
        alert("Ocurrió un error al eliminar.");
      }
    }
  };

  const handleOpenReport = async () => {
    if (!selectedRecord) return;
    setShowReportModal(true);

    if (selectedRecord.medical_report) {
      setReportContent(selectedRecord.medical_report);
      return;
    }

    setIsGeneratingReport(true);
    try {
      const aiService = new AIService(apiKey);
      const reportResult = await aiService.generateMedicalReport(
        selectedRecord.transcription,
        selectedRecord.patient_name,
        normalizeClinicalSpecialty(selectedRecord.specialty || selectedRecord.consultation_type)
      );
      const report = reportResult.data;

      setReportContent(report);

      if (selectedRecord.record_uuid) {
        const updated = await updateMedicalRecord(selectedRecord.record_uuid, { medical_report: report });

        if (updated) {
          console.log("Report saved to Supabase successfully:", updated);
          setSelectedRecord({ ...selectedRecord, medical_report: report });
          setResults(results.map(r => r.record_uuid === selectedRecord.record_uuid ? { ...r, medical_report: report } : r));
          // alert("Informe guardado correctamente en la base de datos."); // Optional: Uncomment if user wants explicit confirmation
        } else {
          console.error("Failed to update record in Supabase. updateInSupabase returned null.");
          alert("Error: No se pudo guardar el informe en la base de datos. Revise la consola.");
        }
      } else {
        console.error("Selected record has no ID:", selectedRecord);
        alert("Error: El registro seleccionado no tiene ID válido.");
      }

    } catch (error) {
      console.error("Error generating/saving report:", error);
      setReportContent("Error al generar el informe. Por favor, inténtelo de nuevo.");
      alert(`Error crítico: ${error instanceof Error ? error.message : 'Desconocido'}`);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handlePrintReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    {
      printWindow.document.write(buildPrintableDocument({
        specialty: normalizeClinicalSpecialty(selectedRecord?.specialty || selectedRecord?.consultation_type),
        kind: 'report',
        patientName: selectedRecord?.patient_name || 'Paciente',
        content: reportContent,
        pageTitle: getClinicalSpecialtyConfig(selectedRecord?.specialty || selectedRecord?.consultation_type).reportTitle
      }));
      printWindow.document.close();
      return;

      const htmlContent = renderPrintableMarkdown(reportContent);
      const safePatientName = escapeHtml(selectedRecord?.patient_name || 'Paciente');

      printWindow!.document.write(`
        <html>
          <head>
            <title>Informe Médico - ${selectedRecord?.patient_name}</title>
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
              <strong>Paciente:</strong> ${safePatientName}
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
      printWindow!.document.close();
    }
  };



  const handleStartEditingName = () => {
    if (selectedRecord) {
      setEditedName(selectedRecord.patient_name);
      setIsEditingName(true);
    }
  };

  const handleSaveName = async () => {
    if (!selectedRecord || !editedName.trim()) return;

    try {
      const updated = await updateMedicalRecord(selectedRecord.record_uuid, { patient_name: editedName });

      if (updated && updated.length > 0) {
        const updatedRecord = { ...selectedRecord, patient_name: editedName };
        setSelectedRecord(updatedRecord);
        setResults(results.map(r => r.record_uuid === selectedRecord.record_uuid ? updatedRecord : r));
        setIsEditingName(false);
      } else {
        console.error("Update returned empty array or null");
        alert("No se pudo actualizar el nombre. Inténtelo de nuevo.");
      }
    } catch (error) {
      console.error("Error updating name:", error);
      alert("Error al actualizar el nombre");
    }
  };

  const handleStartEditingHistory = () => {
    if (selectedRecord) {
      setEditedHistory(selectedRecord.medical_history || '');
      setIsEditingHistory(true);
    }
  };


  // Autosave State
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const queueLearningCapture = useCallback((params: {
    source: 'search_history_save' | 'search_history_autosave' | 'report_save';
    artifactType: 'medical_history' | 'medical_report';
    aiText: string;
    doctorText: string;
    record: MedicalRecord;
  }) => {
    void processDoctorFeedbackV2({
      transcription: params.record.transcription || '',
      aiText: params.aiText || '',
      doctorText: params.doctorText || '',
      apiKey,
      recordId: params.record.record_uuid,
      auditId: params.record.audit_id,
      source: params.source,
      artifactType: params.artifactType,
      allowAutosaveLearn: true,
      specialty: normalizeClinicalSpecialty(params.record.specialty || params.record.consultation_type)
    }).then((learningResult) => {
      if (!learningResult?.candidate_ids?.length) return;
      void evaluateAndPersistRuleImpactV2({
        candidateIds: learningResult.candidate_ids,
        aiOutput: params.aiText || '',
        doctorOutput: params.doctorText || '',
        source: params.source,
        artifactType: params.artifactType,
        specialty: normalizeClinicalSpecialty(params.record.specialty || params.record.consultation_type),
        metadata: {
          record_id: params.record.record_uuid,
          audit_id: params.record.audit_id || null,
          learning_event_ids: learningResult.event_ids
        }
      });
    }).catch((error) => {
      console.warn('[SearchHistory] learning V2 failed:', error);
    });
  }, [apiKey]);

  // Autosave Effect
  useEffect(() => {
    if (!isEditingHistory || !selectedRecord) return;

    const timeoutId = setTimeout(async () => {
      if (editedHistory !== selectedRecord.medical_history) {
        setIsSaving(true);
        try {
          await updateMedicalRecord(selectedRecord.record_uuid, { medical_history: editedHistory });
          const updatedRecord = { ...selectedRecord, medical_history: editedHistory };
          setSelectedRecord(updatedRecord);
          setResults(prev => prev.map(r => r.record_uuid === selectedRecord.record_uuid ? updatedRecord : r));
          queueLearningCapture({
            source: 'search_history_autosave',
            artifactType: 'medical_history',
            aiText: selectedRecord.original_medical_history || selectedRecord.medical_history || '',
            doctorText: editedHistory,
            record: selectedRecord
          });
          setLastSaved(new Date());
        } catch (error) {
          console.error("Autosave failed:", error);
        } finally {
          setIsSaving(false);
        }
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
  }, [editedHistory, isEditingHistory, queueLearningCapture, selectedRecord]);

  const handleSaveHistory = async () => {
    // Manual save just triggers the update immediately if needed, 
    // but the effect might have already run. 
    // We'll keep it as a 'Force Save' button.
    if (!selectedRecord) return;
    setIsSaving(true);
    try {
      const updated = await updateMedicalRecord(selectedRecord.record_uuid, { medical_history: editedHistory });
      if (updated && updated.length > 0) {
        const updatedRecord = { ...selectedRecord, medical_history: editedHistory };
        setSelectedRecord(updatedRecord);
        setResults(results.map(r => r.record_uuid === selectedRecord.record_uuid ? updatedRecord : r));
        queueLearningCapture({
          source: 'search_history_save',
          artifactType: 'medical_history',
          aiText: selectedRecord.original_medical_history || selectedRecord.medical_history || '',
          doctorText: editedHistory,
          record: selectedRecord
        });
        setIsEditingHistory(false);
        setLastSaved(new Date());
      } else {
        alert("No se pudo guardar los cambios.");
      }
    } catch (error) {
      console.error("Error saving history:", error);
      alert("Error al guardar la historia");
    } finally {
      setIsSaving(false);
    }
  };


  const handleSaveReport = async () => {
    if (!selectedRecord) return;

    try {
      const updated = await updateMedicalRecord(selectedRecord.record_uuid, { medical_report: reportContent });
      if (updated && updated.length > 0) {
        setSelectedRecord({ ...selectedRecord, medical_report: reportContent });
        setResults(results.map(r => r.record_uuid === selectedRecord.record_uuid ? { ...r, medical_report: reportContent } : r));
        queueLearningCapture({
          source: 'report_save',
          artifactType: 'medical_report',
          aiText: selectedRecord.medical_report || '',
          doctorText: reportContent,
          record: selectedRecord
        });
        setIsEditingReport(false);
      } else {
        alert("No se pudo guardar el informe.");
      }
    } catch (error) {
      console.error("Error saving report:", error);
      alert("Error al guardar el informe");
    }
  };

  const handlePrintHistory = (content: string, patientName: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    {
      printWindow.document.write(buildPrintableDocument({
        specialty: normalizeClinicalSpecialty(selectedRecord?.specialty || selectedRecord?.consultation_type),
        kind: 'history',
        patientName,
        content,
        pageTitle: getClinicalSpecialtyConfig(selectedRecord?.specialty || selectedRecord?.consultation_type).historyTitle
      }));
      printWindow.document.close();
      return;

      const htmlContent = renderPrintableMarkdown(content);
      const safePatientName = escapeHtml(patientName);

      printWindow!.document.write(`
        <html>
          <head>
            <title>Historia Médica - ${patientName}</title>
            <style>
              body { font-family: 'Georgia', serif; padding: 40px; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
              .header-container { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
              .logo-img { width: 180px; height: auto; }
              .doctor-info { text-align: right; font-family: 'Arial', sans-serif; font-size: 14px; color: #000; }
              .doctor-name { font-weight: bold; font-size: 16px; margin-bottom: 4px; }
              .report-title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 18px; margin-bottom: 30px; text-transform: uppercase; }
              .patient-info { margin-bottom: 20px; font-size: 16px; }
              .content { font-size: 14px; }
              .footer { margin-top: 60px; text-align: center; font-size: 12px; color: #666; font-family: 'Arial', sans-serif; }
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

            <div class="report-title">HISTORIA CLÍNICA</div>

            <div class="patient-info">
              <strong>Paciente:</strong> ${safePatientName}
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
      printWindow!.document.close();
    }
  };

  const parseContent = (content: string) => {
    const [history, notes] = content.split('---MARIA_NOTES---');
    return { history: history?.trim(), notes: notes?.trim() };
  };

  const saveUiState = isSaving ? 'saving' : (lastSaved && isEditingHistory ? 'saved' : 'idle');

  return (
    <div className="history-container">
      <div className="search-section">
        <h2 className="section-title">Historial de Consultas</h2>
        <form onSubmit={handleSearch} className="search-bar-wrapper">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={20} className="search-icon" />
            <input
              type="text"
              placeholder="Buscar por paciente, diagnóstico..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="history-search-input"
            />
          </div>
          <button
            type="button"
            className={`refresh-btn ${isSyncing ? 'syncing' : ''}`}
            onClick={handleRefresh}
            title="Sincronizar con la nube"
            data-ui-state={isSyncing ? 'active' : 'idle'}
          >
            <RefreshCcw size={20} />
          </button>
        </form>
      </div>

      <div className="content-grid">
        <div className="list-column">
          {isLoading ? (
            <div className="search-history-loading-state">
              <div className="search-history-spinner"></div>
            </div>
          ) : results.length === 0 ? (
            <div className="empty-state">
              <p>No se encontraron consultas</p>
            </div>
          ) : (
            <div className="cards-list">
              {results.map((record) => (
                <motion.div
                  key={record.record_uuid}

                  className={`patient-card ${selectedRecord?.record_uuid === record.record_uuid ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedRecord(record);
                    if (onLoadRecord) onLoadRecord(record);
                  }}
                  initial={{ opacity: 0, y: 10 }}

                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -2, scale: 1.01, boxShadow: 'var(--shadow-md)', transition: motionTransitions.fast }}
                  whileTap={{ scale: 0.99, transition: motionTransitions.fast }}
                  transition={motionTransitions.normal}
                  data-ui-state={selectedRecord?.record_uuid === record.record_uuid ? 'active' : 'idle'}
                >
                  <div className="card-content">
                    <div className="card-top">
                      <div className="patient-avatar">
                        <User size={18} />
                      </div>
                      <span className="card-date">
                        {new Date(record.created_at || '').toLocaleDateString()}
                      </span>
                    </div>
                    <h3 className="card-name">{record.patient_name}</h3>
                    <div className="card-type">
                      {getClinicalSpecialtyConfig(record.specialty || record.consultation_type).displayName}
                    </div>
                  </div>

                  <div className="card-actions">
                    <button
                      className="search-icon-btn delete"
                      onClick={(e) => handleDelete(record.record_uuid, e)}
                      aria-label="Eliminar consulta"
                    >
                      <Trash2 size={14} />
                    </button>
                    <ChevronRight size={16} className="chevron" />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="detail-column">
          <AnimatePresence mode="wait">
            {selectedRecord ? (
              <motion.div
                key={selectedRecord.record_uuid}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={motionTransitions.normal}
                className="detail-view"
              >
                {(() => {
                  const { history, notes } = parseContent(selectedRecord.medical_history || '');
                  return (
                    <>
                      <div className="detail-header">
                        <div className="header-main">
                          <div className="patient-badge">
                            <User size={24} />
                          </div>
                          <div className="header-text">
                            {isEditingName ? (
                              <div className="name-edit-wrapper">
                                <input
                                  type="text"
                                  value={editedName}
                                  onChange={(e) => setEditedName(e.target.value)}
                                  className="name-edit-input"
                                  autoFocus
                                />
                                <button className="search-icon-btn save-name" onClick={handleSaveName} aria-label="Guardar nombre">
                                  <Save size={18} />
                                </button>
                                <button className="search-icon-btn cancel-name" onClick={() => setIsEditingName(false)} aria-label="Cancelar edicion de nombre">
                                  <X size={18} />
                                </button>
                              </div>
                            ) : (
                              <div className="name-display-wrapper">
                                <h1>{selectedRecord.patient_name}</h1>
                                <button className="search-icon-btn edit-name" onClick={handleStartEditingName} aria-label="Editar nombre">
                                  <Pencil size={16} />
                                </button>
                              </div>
                            )}
                            <div className="meta-row">
                              <span className="meta-item">
                                <Calendar size={14} />
                                {new Date(selectedRecord.created_at || '').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="header-actions">
                          <button className="search-history-btn-secondary" onClick={handleOpenReport}>
                            <FileOutput size={16} />
                            <span>Informe Formal</span>
                          </button>
                        </div>
                      </div>

                      <div className="detail-scroll-area">
                        <div className="paper-document">
                          <div className="document-header">
                            <span className="doc-label">Historia Médica</span>
                            <div className="doc-actions">
                              <AnimatePresence mode="wait" initial={false}>
                                {saveUiState !== 'idle' && (
                                  <motion.span
                                    key={saveUiState}
                                    className="history-save-indicator"
                                    data-ui-state={saveUiState}
                                    initial={{ opacity: 0, y: 3 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -2 }}
                                    transition={motionTransitions.fast}
                                  >
                                    {saveUiState === 'saving' ? 'Guardando...' : 'Guardado'}
                                  </motion.span>
                                )}
                              </AnimatePresence>
                              {!isEditingHistory && (
                                <>
                                  <button className="search-icon-btn copy-doc" onClick={() => void handleCopy(history || '')} title="Copiar" aria-label="Copiar historia" data-ui-state={copied ? 'success' : 'idle'}>
                                    {copied ? <Check size={16} /> : <Copy size={16} />}
                                  </button>
                                  <button className="search-icon-btn print-doc" onClick={() => handlePrintHistory(history || '', selectedRecord.patient_name)} title="Imprimir" aria-label="Imprimir historia" data-ui-state="idle">
                                    <Printer size={16} />
                                  </button>
                                </>
                              )}
                              {isEditingHistory ? (
                                <div className="edit-actions">
                                  <button className="search-icon-btn save-history" onClick={handleSaveHistory} aria-label="Guardar historia" data-ui-state="success">
                                    <Save size={16} />
                                  </button>
                                  <button className="search-icon-btn cancel-history" onClick={() => setIsEditingHistory(false)} aria-label="Cancelar edicion de historia" data-ui-state="idle">
                                    <X size={16} />
                                  </button>
                                </div>
                              ) : (
                                <button className="search-icon-btn edit-doc" onClick={handleStartEditingHistory} title="Editar" aria-label="Editar historia" data-ui-state="idle">
                                  <Pencil size={16} />
                                </button>
                              )}
                            </div>
                          </div>
                          {isEditingHistory ? (
                            <textarea
                              className="history-editor"
                              value={editedHistory}
                              onChange={(e) => setEditedHistory(e.target.value)}
                              placeholder="Editar historia médica..."
                            />
                          ) : (
                            <div className="document-content markdown-body">
                              <ReactMarkdown>{history}</ReactMarkdown>
                            </div>
                          )}
                        </div>

                        {notes && (
                          <div className="ai-notes-section">
                            <div className="ai-header">
                              <Sparkles size={16} className="ai-icon" />
                              <span>Maria AI Insights</span>
                            </div>
                            <div className="ai-card">
                              <ReactMarkdown>{notes}</ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </motion.div >
            ) : (
              <div className="empty-selection">
                <div className="empty-icon">
                  <FileText size={48} />
                </div>
                <h3>Selecciona una consulta</h3>
                <p>Los detalles aparecerán aquí</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Report Modal */}
      <AnimatePresence>
        {showReportModal && (
          <motion.div
            className="search-history-modal-overlay"
            variants={modalOverlayVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            <motion.div
              className="search-history-modal-content"
              variants={modalContentVariants}
              initial="initial"
              animate="enter"
              exit="exit"
            >
              <div className="search-history-modal-header">
                <h3>Informe Médico Formal</h3>
                <button className="search-history-close-btn" onClick={() => setShowReportModal(false)} aria-label="Cerrar modal de informe">
                  <X size={20} />
                </button>
              </div>

              <div className="search-history-modal-body">
                {isGeneratingReport ? (
                  <div className="loading-state premium-loading">
                    <div className="loading-visual">
                      <motion.div
                        className="brain-pulse"
                        animate={{
                          scale: [1, 1.1, 1],
                          opacity: [0.5, 1, 0.5],
                          boxShadow: [
                            "0 0 0 0px rgba(38, 166, 154, 0)",
                            "0 0 0 20px rgba(38, 166, 154, 0.1)",
                            "0 0 0 0px rgba(38, 166, 154, 0)"
                          ]
                        }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <Sparkles size={48} className="loading-icon" />
                      </motion.div>
                      <motion.div
                        className="orbit-ring"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      />
                    </div>

                    <motion.div
                      className="loading-text-container"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <h3 className="loading-title">Redactando Informe Médico</h3>
                      <LoadingMessages />
                    </motion.div>
                  </div>
                ) : (
                  isEditingReport ? (
                    <textarea
                      className="report-editor"
                      value={reportContent}
                      onChange={(e) => setReportContent(e.target.value)}
                      placeholder="Escribe aquí el informe..."
                    />
                  ) : (
                    <div className="report-preview markdown-body">
                      <ReactMarkdown>{reportContent}</ReactMarkdown>
                    </div>
                  )
                )}
              </div>

              <div className="search-history-modal-footer">
                {!isGeneratingReport && (
                  <>
                    {isEditingReport ? (
                      <button className="search-history-btn-primary" onClick={handleSaveReport}>
                        <Save size={16} />
                        <span>Guardar Cambios</span>
                      </button>
                    ) : (
                      <button className="search-history-btn-secondary" onClick={() => setIsEditingReport(true)}>
                        <Pencil size={16} />
                        <span>Editar</span>
                      </button>
                    )}
                    <button className="search-history-btn-secondary" onClick={() => void handleCopy(reportContent)}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      <span>{copied ? 'Copiado' : 'Copiar Texto'}</span>
                    </button>
                    <button className="search-history-btn-primary" onClick={handlePrintReport}>
                      <Printer size={16} />
                      <span>Imprimir PDF</span>
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

const LoadingMessages = () => {
  const messages = [
    "Analizando historial médico...",
    "Consultando base de conocimientos...",
    "Estructurando informe clínico...",
    "Redactando conclusiones...",
    "Aplicando formato profesional...",
    "Finalizando documento..."
  ];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % messages.length);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <motion.div
      key={index}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.5 }}
      className="loading-message"
    >
      {messages[index]}
    </motion.div>
  );
};


