import React, { useState, useEffect } from 'react';
import { Search, FileText, ChevronRight, Copy, Check, Sparkles, Trash2, FileOutput, Printer, X, Calendar, User, Pencil, Save, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { searchMedicalRecords, type MedicalRecord, deleteMedicalRecord, updateMedicalRecord, syncFromCloud } from '../services/storage';
import { isCloudSyncEnabled } from '../hooks/useCloudSync';
import { AIService } from '../services/ai';
import ReactMarkdown from 'react-markdown';
import { motionTransitions } from '../features/ui/motion-tokens';
import { safeCopyToClipboard } from '../utils/safeBrowser';


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
        selectedRecord.patient_name
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
    if (printWindow) {
      const htmlContent = reportContent
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

      printWindow.document.write(`
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
              <strong>Paciente:</strong> ${selectedRecord?.patient_name}
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
          setLastSaved(new Date());
        } catch (error) {
          console.error("Autosave failed:", error);
        } finally {
          setIsSaving(false);
        }
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
  }, [editedHistory, isEditingHistory, selectedRecord]);

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
    if (printWindow) {
      const htmlContent = content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

      printWindow.document.write(`
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
                      {record.consultation_type}
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
                    <div
                      className="report-preview markdown-body"
                      dangerouslySetInnerHTML={{
                        __html: reportContent
                          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                          .replace(/\n/g, '<br />')
                      }}
                    />
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

      <style>{`
        .history-container {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 2rem;
          overflow: hidden; /* Ensure container doesn't overflow */
        }

        .section-title {
          font-family: var(--font-display);
          font-size: 1.75rem;
          font-weight: 500;
          color: var(--text-primary);
          margin: 0 0 1.5rem 0;
          letter-spacing: -0.01em;
        }

        .search-bar-wrapper {
          position: relative;
          max-width: 520px;
          display: flex;
          gap: 0.75rem;
          align-items: center;
        }

        .refresh-btn {
          background: white;
          border: 1px solid rgba(0,0,0,0.08);
          color: var(--text-secondary);
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: border-color var(--motion-duration-fast) var(--motion-ease-base),
            color var(--motion-duration-fast) var(--motion-ease-base),
            background-color var(--motion-duration-fast) var(--motion-ease-base),
            transform var(--motion-duration-fast) var(--motion-ease-base),
            box-shadow var(--motion-duration-fast) var(--motion-ease-base);
          box-shadow: var(--shadow-sm);
        }

        .refresh-btn:hover {
          border-color: var(--brand-primary);
          color: var(--brand-primary);
          background: #F0FDF4;
          transform: translateY(-1px);
        }

        .refresh-btn.syncing {
          color: var(--brand-primary);
        }

        .refresh-btn.syncing svg {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .history-search-input {
          width: 100%;
          padding: 1rem 1rem 1rem 3rem;
          border-radius: var(--radius-full);
          border: 1px solid rgba(0,0,0,0.08); /* Slightly darker border */
          background: white;
          font-family: var(--font-body);
          font-size: 1rem;
          color: var(--text-primary);
          box-shadow: var(--shadow-sm);
          transition: border-color var(--motion-duration-fast) var(--motion-ease-base),
            box-shadow var(--motion-duration-fast) var(--motion-ease-base),
            background-color var(--motion-duration-fast) var(--motion-ease-base);
        }

        .history-search-input:focus {
          outline: none;
          box-shadow: var(--shadow-glow);
          border-color: var(--brand-primary);
        }

        .search-icon {
          position: absolute;
          left: 1rem;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-secondary);
        }

        .content-grid {
          display: grid;
          grid-template-columns: 350px 1fr;
          gap: 2rem;
          flex: 1;
          overflow: hidden; /* Crucial for scrolling */
          min-height: 0; /* Crucial for flex/grid scrolling */
        }

        .list-column {
          overflow-y: auto;
          padding-right: 0.5rem;
          padding-bottom: 2rem;
          /* Custom Scrollbar for list */
          scrollbar-width: thin;
          scrollbar-color: rgba(148, 163, 184, 0.5) transparent;
        }

        .cards-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .patient-card {
          background: white;
          padding: 1.25rem;
          border-radius: var(--radius-lg);
          cursor: pointer;
          position: relative;
          border: 1px solid rgba(0,0,0,0.05);
          transition: border-color var(--motion-duration-fast) var(--motion-ease-base),
            background-color var(--motion-duration-fast) var(--motion-ease-base),
            box-shadow var(--motion-duration-fast) var(--motion-ease-base),
            transform var(--motion-duration-fast) var(--motion-ease-base);
          box-shadow: var(--shadow-sm);
        }

        .patient-card:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-md);
            border-color: var(--brand-secondary);
        }

        .patient-card.active {
          background: #F0FDF4; /* Very light green background */
          border-color: var(--brand-primary);
          box-shadow: var(--shadow-md);
        }
        
        .patient-card.active::before {
            content: '';
            position: absolute;
            left: 0;
            top: 15%;
            bottom: 15%;
            width: 4px;
            background: var(--brand-primary);
            border-radius: 0 4px 4px 0;
        }

        .card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .patient-avatar {
          width: 36px;
          height: 36px;
          background: #F1F5F9;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          transition: all 0.2s;
        }
        
        .patient-card.active .patient-avatar {
            background: var(--brand-primary);
            color: white;
            box-shadow: 0 4px 10px rgba(38, 166, 154, 0.3);
        }

        .card-date {
          font-size: 0.75rem;
          color: var(--text-tertiary);
          font-weight: 600;
          background: #F8FAFC;
          padding: 4px 8px;
          border-radius: 6px;
        }

        .card-name {
          font-family: var(--font-display);
          font-size: 1rem;
          font-weight: 500;
          color: var(--text-primary);
          margin: 0 0 0.25rem 0;
          letter-spacing: 0;
        }

        .card-type {
          font-size: 0.8rem;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .card-actions {
          position: absolute;
          right: 1rem;
          bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          opacity: 0;
          transition: opacity var(--motion-duration-fast) var(--motion-ease-base);
        }

        .patient-card:hover .card-actions,
        .patient-card.active .card-actions {
          opacity: 1;
        }

        .search-icon-btn {
          background: white;
          border: 1px solid rgba(0,0,0,0.1);
          padding: 6px;
          border-radius: 8px;
          cursor: pointer;
          color: var(--text-secondary);
          transition: border-color var(--motion-duration-fast) var(--motion-ease-base),
            background-color var(--motion-duration-fast) var(--motion-ease-base),
            color var(--motion-duration-fast) var(--motion-ease-base),
            transform var(--motion-duration-fast) var(--motion-ease-base);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .search-icon-btn:hover {
            background: #F8FAFC;
            color: var(--text-primary);
            border-color: rgba(0,0,0,0.2);
        }
        
        .search-icon-btn.delete:hover {
            color: #ef4444;
            background: #FEF2F2;
            border-color: #FECACA;
        }

        .chevron {
          color: var(--text-tertiary);
        }

        /* Detail View */
        .detail-column {
            overflow: hidden; /* Ensure column itself doesn't scroll, but child does */
            display: flex;
            flex-direction: column;
            min-height: 0;
        }

        .detail-view {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          overflow: hidden; /* Crucial */
          min-height: 0; /* Fix for nested flex scrolling */
        }

        .detail-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: 1.5rem;
          border-bottom: 1px solid rgba(0,0,0,0.05);
          flex-shrink: 0; /* Don't shrink header */
        }

        .header-main {
          display: flex;
          gap: 1rem;
          align-items: flex-start;
        }

        .patient-badge {
          width: 44px;
          height: 44px;
          background: linear-gradient(135deg, #e0f7f5 0%, #d4f0ed 100%);
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--brand-primary);
          box-shadow: 0 2px 8px rgba(38, 166, 154, 0.1);
        }

        .header-text h1 {
          font-family: var(--font-display);
          font-size: 1.5rem;
          font-weight: 500;
          color: var(--text-primary);
          margin: 0;
          letter-spacing: 0;
        }

        .name-display-wrapper {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 0.25rem;
        }

        .name-edit-wrapper {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 0.25rem;
        }

        .name-edit-input {
            font-family: var(--font-display);
            font-size: 1.75rem;
            font-weight: 800;
            color: var(--text-primary);
            padding: 0.25rem 0.5rem;
            border: 1px solid var(--brand-primary);
            border-radius: 8px;
            outline: none;
            width: 300px;
        }

        .edit-name {
            opacity: 0;
            transition: opacity 0.2s;
        }

        .header-text:hover .edit-name {
            opacity: 1;
        }

        .meta-row {
          display: flex;
          gap: 1rem;
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        .meta-item {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .detail-scroll-area {
          flex: 1;
          overflow-y: auto; /* Enable scrolling here */
          padding-right: 1rem;
          display: flex;
          flex-direction: column;
          gap: 2rem;
          padding-bottom: 3rem; /* Extra padding at bottom */
          min-height: 0; /* Fix for nested flex scrolling */
        }

        .paper-document {
          background: white;
          padding: 3rem;
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          min-height: 400px;
          height: auto; /* Allow it to grow naturally */
          flex-shrink: 0; /* Prevent shrinking */
          border: 1px solid rgba(0,0,0,0.05);
          display: flex;
          flex-direction: column;
        }

        .document-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid #f1f5f9;
        }

        .doc-label {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-tertiary);
        }

        .edit-actions {
          display: flex;
          gap: 0.5rem;
        }

        .edit-doc {
          opacity: 0.5;
          transition: opacity 0.2s;
        }

        .paper-document:hover .edit-doc {
          opacity: 1;
        }

        .save-history {
          color: var(--brand-primary) !important;
          border-color: var(--brand-primary) !important;
        }

        .cancel-history {
          color: #ef4444 !important;
        }

        .history-editor {
          flex: 1;
          width: 100%;
          min-height: 300px;
          padding: 1rem;
          border: 1px solid #e2e8f0;
          border-radius: var(--radius-md);
          font-family: 'Georgia', serif;
          font-size: 1.1rem;
          line-height: 1.7;
          color: #374151;
          resize: vertical;
          outline: none;
          transition: border-color 0.2s;
        }

        .history-editor:focus {
          border-color: var(--brand-primary);
          box-shadow: 0 0 0 3px rgba(38, 166, 154, 0.1);
        }

        .report-editor {
          flex: 1;
          width: 100%;
          min-height: 300px;
          padding: 1.5rem;
          border: 1px solid #e2e8f0;
          border-radius: var(--radius-md);
          font-family: var(--font-body);
          font-size: 1rem;
          line-height: 1.6;
          color: #374151;
          resize: vertical;
          outline: none;
        }

        .report-editor:focus {
          border-color: var(--brand-primary);
          box-shadow: 0 0 0 3px rgba(38, 166, 154, 0.1);
        }

        .document-content {
          font-family: 'Georgia', serif;
          font-size: 1.15rem;
          line-height: 1.8;
          color: #374151;
          /* Prevent overflow */
          overflow-wrap: break-word;
          word-wrap: break-word;
          word-break: break-word;
          max-width: 100%;
        }
        
        /* Ensure code blocks or preformatted text also wrap */
        .markdown-body pre {
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-x: auto;
        }
        
        .markdown-body code {
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        .ai-notes-section {
          background: linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%);
          border-radius: var(--radius-lg);
          padding: 2rem;
          border: 1px solid rgba(38, 166, 154, 0.2);
          box-shadow: 0 4px 15px rgba(38, 166, 154, 0.05);
        }

        .ai-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--brand-primary);
          font-weight: 500;
          margin-bottom: 1rem;
          font-size: 0.875rem;
          text-transform: none;
          letter-spacing: 0;
          border-bottom: 1px solid rgba(38, 166, 154, 0.15);
          padding-bottom: 0.5rem;
        }

        .ai-card {
          font-size: 1.05rem;
          color: #004D40;
          line-height: 1.7;
        }

        .search-history-btn-primary {
          background: linear-gradient(135deg, #e0f7f5 0%, #d4f0ed 100%);
          color: var(--brand-primary);
          border: 1px solid rgba(38, 166, 154, 0.25);
          padding: 0.625rem 1.25rem;
          border-radius: var(--radius-full);
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: none;
        }

        .search-history-btn-primary:hover {
          background: linear-gradient(135deg, #d4f0ed 0%, #c8ebe8 100%);
          border-color: var(--brand-primary);
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(38, 166, 154, 0.15);
        }

        .search-history-btn-secondary {
          background: white;
          color: var(--text-secondary);
          border: 1px solid rgba(0,0,0,0.08);
          padding: 0.625rem 1.25rem;
          border-radius: var(--radius-full);
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .search-history-btn-secondary:hover {
          background: #f8fafb;
          border-color: rgba(38, 166, 154, 0.3);
          color: var(--brand-primary);
        }

        .empty-selection {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: var(--text-tertiary);
          text-align: center;
          background: rgba(255,255,255,0.5);
          border-radius: var(--radius-lg);
          border: 2px dashed rgba(0,0,0,0.05);
        }

        .empty-icon {
          margin-bottom: 1.5rem;
          opacity: 0.5;
          color: var(--text-secondary);
        }

        /* Modal */
        .search-history-modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(4px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .search-history-modal-content {
          background: white;
          width: 90%;
          max-width: 800px;
          height: 85vh;
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-lg);
        }

        .search-history-modal-header {
          padding: 1.5rem 2rem;
          border-bottom: 1px solid rgba(0,0,0,0.05);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .search-history-modal-header h3 {
          margin: 0;
          font-family: var(--font-display);
          font-weight: 700;
        }

        .search-history-close-btn {
          background: transparent;
          border: none;
          cursor: pointer;
        }

        .search-history-modal-body {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          padding: 1.25rem 1.5rem;
        }

        .search-history-modal-footer {
          padding: 1.5rem 2rem;
          border-top: 1px solid rgba(0,0,0,0.05);
          display: flex;
          justify-content: flex-end;
          gap: 1rem;
          background: white;
          border-radius: 0 0 var(--radius-lg) var(--radius-lg);
        }

        .search-history-loading-state {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          color: var(--text-secondary);
        }

        .search-history-spinner {
          width: 24px;
          height: 24px;
          border: 3px solid rgba(0, 105, 92, 0.1);
          border-top-color: var(--brand-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        /* Premium Loading Styles */
        .premium-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            gap: 2rem;
            background: linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(38, 166, 154, 0.03) 100%);
        }

        .loading-visual {
            position: relative;
            width: 120px;
            height: 120px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .brain-pulse {
            width: 80px;
            height: 80px;
            background: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2;
            color: var(--brand-primary);
            box-shadow: 0 10px 30px rgba(38, 166, 154, 0.2);
        }

        .orbit-ring {
            position: absolute;
            width: 100%;
            height: 100%;
            border: 2px dashed rgba(38, 166, 154, 0.3);
            border-radius: 50%;
            z-index: 1;
        }

        .loading-text-container {
            text-align: center;
            max-width: 300px;
        }

        .loading-title {
            font-family: var(--font-display);
            font-size: 1.5rem;
            color: var(--brand-dark);
            margin: 0 0 0.5rem 0;
        }

        .loading-message {
            color: var(--text-secondary);
            font-size: 1rem;
            min-height: 1.5em;
        }

        .doc-actions {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .history-save-indicator {
          font-size: 0.8rem;
          margin-right: 1rem;
          align-self: center;
          color: #64748b;
          transition: color var(--motion-duration-fast) var(--motion-ease-base),
            opacity var(--motion-duration-fast) var(--motion-ease-base);
        }

        .history-save-indicator[data-ui-state="saving"] {
          color: #64748b;
        }

        .history-save-indicator[data-ui-state="saved"] {
          color: #16a34a;
        }

        .search-icon-btn.copy-doc,
        .search-icon-btn.print-doc {
            background: #f8fafc;
            color: var(--brand-primary);
        }

        .search-icon-btn.copy-doc:hover,
        .search-icon-btn.print-doc:hover {
            background: var(--brand-primary);
            color: white;
        }

        @media (max-width: 1200px) {
          .content-grid {
            grid-template-columns: 300px 1fr;
            gap: 1rem;
          }

          .paper-document {
            padding: 1.6rem;
          }
        }

        @media (max-width: 1024px) {
          .history-container {
            gap: 1rem;
          }

          .content-grid {
            grid-template-columns: 1fr;
            overflow: auto;
          }

          .list-column {
            max-height: 260px;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border-soft);
          }

          .detail-header {
            position: sticky;
            top: 0;
            z-index: 5;
            background: var(--bg-app);
            padding-top: 0.5rem;
          }

          .detail-scroll-area {
            padding-right: 0;
          }

          .name-edit-input {
            width: 220px;
            font-size: 1.25rem;
          }

          .search-history-modal-content {
            width: 96%;
            height: 92vh;
          }
        }
      `}</style>
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


