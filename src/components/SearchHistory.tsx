import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Calendar,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  Layers3,
  Printer,
  RefreshCcw,
  Search,
  Shield,
  Sparkles,
  Trash2,
  User,
  X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { AIService } from '../services/ai';
import {
  buildPsychologyCaseSummary,
  deleteMedicalRecord,
  ensurePatientBriefing,
  getMedicalRecordByUuid,
  getPatientBriefing,
  searchPatientTimeline,
  syncFromCloud,
  type MedicalRecord,
  type PatientCaseSummary,
  type PatientBriefing,
  type PatientTimelineGroup,
  type PatientTimelineItem,
  updateMedicalRecord
} from '../services/storage';
import { isCloudSyncEnabled, useCloudSync } from '../hooks/useCloudSync';
import { motionTransitions } from '../features/ui/motion-tokens';
import { safeCopyToClipboard } from '../utils/safeBrowser';
import { buildPrintableDocument } from '../utils/printTemplates';
import { getClinicalSpecialtyConfig, normalizeClinicalSpecialty } from '../clinical/specialties';
import { useSimulation } from './Simulation/SimulationContext';
import './SearchHistory.css';

interface SearchHistoryProps {
  apiKey: string;
  focusedPatientName?: string;
  psychologyClinicianName?: 'Ainhoa' | 'June';
  onFocusedPatientNameConsumed?: () => void;
  onLoadRecord?: (record: MedicalRecord) => void;
  onUseAsContext?: (payload: {
    patientName: string;
    specialty: string;
    clinicianProfile?: string;
    clinicianName?: string;
  }) => void;
}

const parseContent = (content: string) => {
  const [history, notes] = String(content || '').split('---MARIA_NOTES---');
  return { history: history?.trim(), notes: notes?.trim() };
};

const selectBestItem = (group: PatientTimelineGroup): PatientTimelineItem | null => {
  return group.items[0] || null;
};

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

export const SearchHistory: React.FC<SearchHistoryProps> = ({
  apiKey,
  focusedPatientName = '',
  psychologyClinicianName,
  onFocusedPatientNameConsumed,
  onLoadRecord,
  onUseAsContext
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientTimelineGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<PatientTimelineGroup | null>(null);
  const [selectedItem, setSelectedItem] = useState<PatientTimelineItem | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [caseSummary, setCaseSummary] = useState<PatientCaseSummary | null>(null);
  const [caseSummaryLoading, setCaseSummaryLoading] = useState(false);
  const [briefing, setBriefing] = useState<PatientBriefing | null>(null);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isDeletingRecord, setIsDeletingRecord] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const briefingRequestRef = useRef(0);
  const selectedGroupRef = useRef<PatientTimelineGroup | null>(null);
  const queryRef = useRef('');
  const syncingRef = useRef(false);
  const cloudReadyRef = useRef(false);
  const { isCloudEnabled, isCloudAuthenticated, cloudAccessMode } = useCloudSync();
  const { isPlaying, demoData } = useSimulation();
  const demoContinuity = isPlaying
    && demoData?.specialty === 'psicologia'
    && demoData.timelineGroup
    && demoData.caseSummary
    && demoData.briefing
    ? {
      timelineGroup: demoData.timelineGroup,
      caseSummary: demoData.caseSummary,
      briefing: demoData.briefing
    }
    : null;
  const normalizedDemoPatientName = demoData?.patientName?.trim().toLowerCase() || '';
  const selectedGroupName = selectedGroup?.patientName || '';
  const selectedGroupNormalizedName = selectedGroup?.normalizedPatientName || '';
  const selectedGroupLegacyCount = selectedGroup?.sourceCounts.legacy || 0;
  const selectedGroupCurrentCount = selectedGroup?.sourceCounts.current || 0;
  const isDemoSelectedGroup = Boolean(
    demoContinuity
    && selectedGroupNormalizedName
    && selectedGroupNormalizedName === normalizedDemoPatientName
  );
  const effectiveCaseSummary = isDemoSelectedGroup ? demoContinuity?.caseSummary ?? null : caseSummary;
  const effectiveCaseSummaryLoading = isDemoSelectedGroup ? false : caseSummaryLoading;

  const selectedSpecialty = normalizeClinicalSpecialty(selectedItem?.specialty || 'psicologia');
  const selectedBriefingClinician = selectedItem?.clinicianProfile || selectedItem?.clinicianName || selectedGroup?.clinicians[0];
  const activeContent = selectedItem?.medicalHistory || '';
  const { history: activeHistory, notes: activeNotes } = parseContent(activeContent);
  const isLegacySelection = selectedItem?.source === 'legacy';
  const canOpenCurrent = selectedItem?.source === 'current' && Boolean(onLoadRecord) && Boolean(selectedItem?.recordUuid);

  const getDemoGroups = useCallback((searchTerm: string) => {
    if (!demoContinuity?.timelineGroup) return [] as PatientTimelineGroup[];
    const trimmed = searchTerm.trim().toLowerCase();
    const groups = [demoContinuity.timelineGroup];
    if (!trimmed) return groups;
    return groups.filter((group) =>
      group.patientName.toLowerCase().includes(trimmed)
    );
  }, [demoContinuity]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const loadResults = useCallback(async (nextQuery?: string, preferredPatientName?: string) => {
    setIsLoading(true);
    try {
      const effectiveQuery = typeof nextQuery === 'string' ? nextQuery : queryRef.current;
      const groups = demoContinuity
        ? getDemoGroups(effectiveQuery)
        : await searchPatientTimeline(effectiveQuery, 'psicologia', psychologyClinicianName);
      setResults(groups);
      const normalizedPreferredPatient = preferredPatientName?.trim().toLowerCase();
      const previousSelectedGroup = selectedGroupRef.current;
      const nextGroup = groups.find((group) => group.patientName.trim().toLowerCase() === normalizedPreferredPatient)
        || groups.find((group) => group.normalizedPatientName === previousSelectedGroup?.normalizedPatientName)
        || groups[0]
        || null;
      selectedGroupRef.current = nextGroup;
      setSelectedGroup(nextGroup);
      const nextItem = nextGroup ? selectBestItem(nextGroup) : null;
      setSelectedItem(nextItem);
      setSelectedRecord(null);
    } finally {
      setIsLoading(false);
    }
  }, [demoContinuity, getDemoGroups, psychologyClinicianName]);

  const refreshResults = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      if (!demoContinuity && isCloudSyncEnabled()) {
        await syncFromCloud();
      }
      await loadResults();
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [demoContinuity, loadResults]);

  useEffect(() => {
    void refreshResults();
  }, [refreshResults]);

  useEffect(() => {
    const cloudReady = isCloudEnabled && isCloudAuthenticated && !demoContinuity;
    if (!cloudReady || cloudReadyRef.current) {
      cloudReadyRef.current = cloudReady;
      return;
    }
    cloudReadyRef.current = true;
    void refreshResults();
  }, [demoContinuity, isCloudAuthenticated, isCloudEnabled, refreshResults]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadResults(query);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [query, loadResults]);

  useEffect(() => {
    if (!focusedPatientName) return;
    setQuery(focusedPatientName);
    void loadResults(focusedPatientName, focusedPatientName);
    onFocusedPatientNameConsumed?.();
  }, [focusedPatientName, loadResults, onFocusedPatientNameConsumed]);

  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
  }, [selectedGroup]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selectedItem || selectedItem.source !== 'current' || !selectedItem.recordUuid) {
        setSelectedRecord(null);
        return;
      }
      const record = await getMedicalRecordByUuid(selectedItem.recordUuid);
      if (!cancelled) {
        setSelectedRecord(record);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedItem]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selectedGroupName) {
        setCaseSummary(null);
        return;
      }
      if (demoContinuity && selectedGroupNormalizedName === normalizedDemoPatientName) {
        setCaseSummary(demoContinuity.caseSummary ?? null);
        setCaseSummaryLoading(false);
        return;
      }
      setCaseSummaryLoading(true);
      try {
        const summary = await buildPsychologyCaseSummary(selectedGroupName, selectedBriefingClinician);
        if (!cancelled) setCaseSummary(summary);
      } finally {
        if (!cancelled) setCaseSummaryLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [demoContinuity, normalizedDemoPatientName, selectedBriefingClinician, selectedGroupName, selectedGroupNormalizedName]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selectedGroupName || selectedSpecialty !== 'psicologia') {
        setBriefing(null);
        return;
      }
      if (demoContinuity && selectedGroupNormalizedName === normalizedDemoPatientName) {
        setBriefing(demoContinuity.briefing ?? null);
        return;
      }

      const currentRequest = ++briefingRequestRef.current;
      try {
        const existing = await getPatientBriefing(selectedGroupName, 'psicologia', selectedBriefingClinician);
        if (cancelled || currentRequest !== briefingRequestRef.current) return;
        if (existing) {
          setBriefing(existing);
          return;
        }

        const shouldGenerate = selectedGroupLegacyCount > 0 && selectedGroupCurrentCount === 0;
        if (!shouldGenerate) {
          setBriefing(null);
          return;
        }

        const generated = await ensurePatientBriefing(selectedGroupName, 'psicologia', selectedBriefingClinician);
        if (cancelled || currentRequest !== briefingRequestRef.current) return;
        setBriefing(generated);
      } catch (error) {
        if (!cancelled && currentRequest === briefingRequestRef.current) {
          console.warn('[SearchHistory] briefing loading failed:', error);
          setBriefing(null);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    demoContinuity,
    normalizedDemoPatientName,
    selectedBriefingClinician,
    selectedGroupCurrentCount,
    selectedGroupLegacyCount,
    selectedGroupName,
    selectedGroupNormalizedName,
    selectedSpecialty
  ]);

  const selectGroup = useCallback((group: PatientTimelineGroup) => {
    setSelectedGroup(group);
    setTimelineExpanded(false);
    const nextItem = selectBestItem(group);
    setSelectedItem(nextItem);
    setSelectedRecord(null);
  }, []);

  const selectTimelineItem = useCallback((item: PatientTimelineItem) => {
    setSelectedItem(item);
    setSelectedRecord(null);
  }, []);

  const handleLoadCurrentRecord = useCallback(async (item: PatientTimelineItem) => {
    if (!onLoadRecord || item.source !== 'current' || !item.recordUuid) return;
    const record = await getMedicalRecordByUuid(item.recordUuid);
    if (record) {
      onLoadRecord(record);
    }
  }, [onLoadRecord]);

  const handleCopy = useCallback(async (text: string) => {
    const copiedOk = await safeCopyToClipboard(text);
    if (!copiedOk) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleOpenReport = useCallback(async () => {
    if (!selectedItem) return;
    setShowReportModal(true);
    if (selectedItem.source !== 'current') {
      setReportContent('Este historial es importado y no genera informe editable.');
      return;
    }
    const currentRecord = selectedRecord || (selectedItem.recordUuid ? await getMedicalRecordByUuid(selectedItem.recordUuid) : null);
    if (!currentRecord) {
      setReportContent('No se pudo cargar la consulta original.');
      return;
    }
    setIsGeneratingReport(true);
    try {
      const aiService = new AIService(apiKey);
      const reportResult = await aiService.generateMedicalReport(
        currentRecord.medical_history,
        currentRecord.patient_name,
        selectedSpecialty
      );
      setReportContent(reportResult.data);
    } catch (error) {
      console.error('[SearchHistory] report generation failed:', error);
      setReportContent('Error al generar el informe.');
    } finally {
      setIsGeneratingReport(false);
    }
  }, [apiKey, selectedItem, selectedSpecialty]);

  const handleSaveReport = useCallback(async () => {
    const currentRecord = selectedRecord || (selectedItem?.source === 'current' && selectedItem.recordUuid
      ? await getMedicalRecordByUuid(selectedItem.recordUuid)
      : null);
    if (!currentRecord) return;
    await updateMedicalRecord(currentRecord.record_uuid, { medical_report: reportContent });
    setShowReportModal(false);
  }, [reportContent, selectedItem, selectedRecord]);

  const handlePrintHistory = useCallback((content: string, patientName: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(buildPrintableDocument({
      specialty: selectedSpecialty,
      kind: 'history',
      patientName,
      content,
      pageTitle: getClinicalSpecialtyConfig(selectedSpecialty).historyTitle
    }));
    printWindow.document.close();
  }, [selectedSpecialty]);

  const handleDeleteSelectedRecord = useCallback(async () => {
    if (!selectedItem || selectedItem.source !== 'current' || !selectedItem.recordUuid || isDeletingRecord) return;
    const confirmed = window.confirm(`¿Quieres borrar la consulta actual de "${selectedGroup?.patientName || selectedItem.patientName}"? Esta acción también la eliminará de Supabase.`);
    if (!confirmed) return;

    setIsDeletingRecord(true);
    try {
      const deleted = await deleteMedicalRecord(selectedItem.recordUuid);
      if (!deleted) {
        window.alert('No se pudo borrar la consulta.');
        return;
      }

      setSelectedRecord(null);
      await loadResults(queryRef.current, selectedGroup?.patientName || selectedItem.patientName);
    } catch (error) {
      console.error('[SearchHistory] record deletion failed:', error);
      window.alert('Ha fallado el borrado de la consulta.');
    } finally {
      setIsDeletingRecord(false);
    }
  }, [isDeletingRecord, loadResults, selectedGroup?.patientName, selectedItem]);

  const renderTimelineSnippet = (item: PatientTimelineItem) => {
    const value = item.medicalHistory.replace(/\s+/g, ' ').trim();
    return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  };

  const selectedContent = activeHistory || activeContent;
  const emptyStateMessage = !isCloudEnabled
    ? 'No hay nube configurada y no existen pacientes guardados en local.'
    : cloudAccessMode === 'session'
      ? 'No se han encontrado pacientes. Pulsa sincronizar para actualizar el historial desde la nube.'
      : 'No se han encontrado pacientes. Pulsa sincronizar para traer el historial interno desde Supabase.';

  return (
    <div className="history-container">
      <div className="search-section">
        <h2 className="section-title">Historial de pacientes</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadResults();
          }}
          className="search-bar-wrapper"
        >
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={20} className="search-icon" />
            <input
              id="history-search-input"
              type="text"
              placeholder="Buscar por paciente o nota clinica..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="history-search-input"
            />
          </div>
          <button
            type="button"
            className={`refresh-btn ${isSyncing ? 'syncing' : ''}`}
            onClick={() => void refreshResults()}
            title="Sincronizar con la nube"
            data-ui-state={isSyncing ? 'active' : 'idle'}
          >
            <RefreshCcw size={20} />
          </button>
        </form>
      </div>

      <div className="content-grid timeline-grid">
        <div className="list-column">
          {isLoading ? (
            <div className="search-history-loading-state">
              <div className="search-history-spinner" />
            </div>
          ) : results.length === 0 ? (
            <div className="empty-state">
              <p>{emptyStateMessage}</p>
            </div>
          ) : (
            <div className="cards-list">
              {results.map((group, index) => (
                <motion.button
                  type="button"
                  key={group.normalizedPatientName}
                  id={`history-patient-card-${index}`}
                  className={`patient-card ${selectedGroup?.normalizedPatientName === group.normalizedPatientName ? 'active' : ''}`}
                  onClick={() => selectGroup(group)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -2, scale: 1.01, boxShadow: 'var(--shadow-md)', transition: motionTransitions.fast }}
                  whileTap={{ scale: 0.99, transition: motionTransitions.fast }}
                  transition={motionTransitions.normal}
                  data-ui-state={selectedGroup?.normalizedPatientName === group.normalizedPatientName ? 'active' : 'idle'}
                  data-patient-name={group.patientName}
                >
                  <div className="card-content">
                    <div className="card-top">
                      <div className="patient-avatar">
                        <User size={18} />
                      </div>
                      <span className="card-date">{new Date(group.latestConsultationAt).toLocaleDateString()}</span>
                    </div>
                    <h3 className="card-name">{group.patientName}</h3>
                    <div className="card-type">
                      {group.sessionCount} sesiones · {group.sourceCounts.current} actual · {group.sourceCounts.legacy} legado
                    </div>
                    <div className="card-tags">
                      {group.clinicians.slice(0, 2).map((clinician) => (
                        <span key={clinician} className="card-tag">{clinician}</span>
                      ))}
                    </div>
                  </div>
                  <div className="card-actions">
                    <ChevronRight size={16} className="chevron" />
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>

        <div className="detail-column">
          <AnimatePresence mode="wait">
            {selectedGroup && selectedItem ? (
              <motion.div
                key={selectedGroup.normalizedPatientName}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={motionTransitions.normal}
                className="detail-view timeline-detail-view"
              >
                <div className="detail-header">
                  <div className="header-main">
                    <div className="patient-badge"><User size={24} /></div>
                    <div className="header-text">
                      <div className="name-display-wrapper">
                        <h1>{selectedGroup.patientName}</h1>
                      </div>
                      <div className="meta-row">
                        <span className="meta-item">
                          <Calendar size={14} />
                          {new Date(selectedGroup.latestConsultationAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                        <span className="meta-item">
                          <Layers3 size={14} />
                          {selectedGroup.sessionCount} sesiones
                        </span>
                        <span className="meta-item">
                          <Clock3 size={14} />
                          {selectedItem.clinicianName || selectedItem.clinicianProfile || 'Sin profesional'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="header-actions">
                    {canOpenCurrent && (
                      <button className="search-history-btn-secondary" onClick={() => void handleLoadCurrentRecord(selectedItem)}>
                        <ArrowRight size={16} />
                        <span>Abrir resultado</span>
                      </button>
                    )}
                    {isLegacySelection && onUseAsContext && (
                      <button
                        id="history-use-context-btn"
                        className="search-history-btn-secondary"
                        onClick={() => onUseAsContext({
                          patientName: selectedGroup.patientName,
                          specialty: selectedSpecialty,
                          clinicianProfile: selectedItem.clinicianProfile,
                          clinicianName: selectedItem.clinicianName
                        })}
                      >
                        <span>Usar como contexto para nueva consulta</span>
                      </button>
                    )}
                    {canOpenCurrent && (
                      <button className="search-history-btn-secondary" onClick={handleOpenReport}>
                        <FileText size={16} />
                        <span>Informe</span>
                      </button>
                    )}
                    {canOpenCurrent && (
                      <button
                        className="search-history-btn-secondary search-history-btn-danger"
                        onClick={() => void handleDeleteSelectedRecord()}
                        disabled={isDeletingRecord}
                      >
                        <Trash2 size={16} />
                        <span>{isDeletingRecord ? 'Borrando...' : 'Borrar'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {briefing && (
                  <div id="history-briefing-card" className="briefing-card">
                    <div className="case-hub-header">
                      <div>
                        <div className="case-hub-kicker">Contexto del caso</div>
                        <h2>Antes de la sesión</h2>
                      </div>
                    </div>
                    <div className="briefing-lines">
                      {briefing.summary_text.split('\n').filter(l => l.trim()).map((line, index) => (
                        <p key={`${index}-${line}`} className="briefing-line">{line}</p>
                      ))}
                    </div>
                  </div>
                )}

                <div id="history-case-hub" className="case-hub-card">
                  <div className="case-hub-header">
                    <div>
                      <div className="case-hub-kicker">Vista general</div>
                      <h2>Continuidad del caso</h2>
                    </div>
                  <div className="case-hub-meta">
                    <Shield size={14} />
                      {effectiveCaseSummaryLoading ? 'Preparando contexto...' : `${selectedGroup.clinicians.length} profesionales`}
                  </div>
                </div>

                  {effectiveCaseSummaryLoading && !effectiveCaseSummary ? (
                    <div className="case-hub-loading">Preparando el contexto del caso...</div>
                  ) : effectiveCaseSummary ? (
                    <div className="case-hub-grid">
                      <div>
                        <span className="case-hub-label">Ultima sesion</span>
                        <p>{effectiveCaseSummary.latestConsultationAt ? new Date(effectiveCaseSummary.latestConsultationAt).toLocaleDateString() : 'Sin dato'}</p>
                      </div>
                      <div>
                        <span className="case-hub-label">Profesionales</span>
                        <p>{effectiveCaseSummary.clinicians.length > 0 ? effectiveCaseSummary.clinicians.join(', ') : 'Sin dato'}</p>
                      </div>
                      <div className="case-hub-span">
                        <span className="case-hub-label">Motivo / foco principal</span>
                        <p>{effectiveCaseSummary.mainFocus}</p>
                      </div>
                      {effectiveCaseSummary.recurringTopics.length > 0 && (
                        <div className="case-hub-span">
                          <span className="case-hub-label">Temas recurrentes</span>
                          <div className="case-hub-chips">
                            {effectiveCaseSummary.recurringTopics.map((topic) => (
                              <span key={topic} className="case-hub-chip">{topic}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {effectiveCaseSummary.openItems.length > 0 && (
                        <div className="case-hub-span">
                          <span className="case-hub-label">Ultimas tareas o acuerdos</span>
                          <ul className="case-hub-list">
                            {effectiveCaseSummary.openItems.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                      )}
                      {effectiveCaseSummary.sensitiveFlags.length > 0 && (
                        <div className="case-hub-span">
                          <span className="case-hub-label">Riesgos o senales sensibles</span>
                          <div className="case-hub-chips sensitive">
                            {effectiveCaseSummary.sensitiveFlags.map((flag) => (
                              <span key={flag} className="case-hub-chip sensitive">{flag}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="case-hub-loading">Todavía no hay suficiente contexto histórico para resumir el caso.</div>
                  )}
                </div>

                <div id="history-timeline-panel" className="timeline-panel">
                  <button
                    type="button"
                    className="timeline-panel-header timeline-panel-toggle"
                    onClick={() => setTimelineExpanded((prev) => !prev)}
                    aria-expanded={timelineExpanded}
                  >
                    <h3>Sesiones anteriores ({selectedGroup.items.length})</h3>
                    <ChevronRight size={16} className={`timeline-chevron ${timelineExpanded ? 'expanded' : ''}`} />
                  </button>
                  {timelineExpanded && (
                  <div className="timeline-list">
                    {selectedGroup.items.map((item, index) => {
                      const active = selectedItem.id === item.id;
                      return (
                        <div
                          key={item.id}
                          id={`history-timeline-item-${index}`}
                          className={`timeline-entry ${active ? 'active' : ''}`}
                          onClick={() => {
                            selectTimelineItem(item);
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              selectTimelineItem(item);
                            }
                          }}
                          data-timeline-index={String(index)}
                          data-source={item.source}
                          data-clinician={item.clinicianName || item.clinicianProfile || 'Sin profesional'}
                        >
                          <div className="timeline-entry-main">
                            <div className="timeline-entry-top">
                              <span className="timeline-entry-date">{new Date(item.consultationAt).toLocaleDateString()}</span>
                              <span className={`timeline-entry-badge ${item.source}`}>{item.sourceLabel}</span>
                            </div>
                            <div className="timeline-entry-title">{item.clinicianName || item.clinicianProfile || 'Sin profesional'}</div>
                            <div className="timeline-entry-snippet">{renderTimelineSnippet(item)}</div>
                          </div>
                          {item.source === 'current' && onLoadRecord && (
                            <button
                              type="button"
                              className="timeline-entry-action"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleLoadCurrentRecord(item);
                              }}
                            >
                              Abrir
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>

                <div className="detail-scroll-area">
                  <div className="paper-document">
                    <div className="document-header">
                      <span className="doc-label">{isLegacySelection ? 'Historial importado' : 'Historia Medica'}</span>
                      <div className="doc-actions">
                        <button className="search-icon-btn copy-doc" onClick={() => void handleCopy(selectedContent)} title="Copiar" aria-label="Copiar historia" data-ui-state={copied ? 'success' : 'idle'}>
                          {copied ? <Copy size={16} /> : <Copy size={16} />}
                        </button>
                        <button className="search-icon-btn print-doc" onClick={() => handlePrintHistory(selectedContent, selectedGroup.patientName)} title="Imprimir" aria-label="Imprimir historia" data-ui-state="idle">
                          <Printer size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="document-content markdown-body">
                      <ReactMarkdown>{activeHistory || selectedContent}</ReactMarkdown>
                    </div>
                  </div>

                  {activeNotes && (
                    <div className="ai-notes-section">
                      <div className="ai-header">
                        <Sparkles size={16} className="ai-icon" />
                        <span>Maria AI Insights</span>
                      </div>
                      <div className="ai-card">
                        <ReactMarkdown>{activeNotes}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <div className="empty-selection">
                <div className="empty-icon">
                  <FileText size={48} />
                </div>
                <h3>Selecciona un paciente</h3>
                <p>Su historial y contexto aparecerán aquí</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {showReportModal && (
          <motion.div className="search-history-modal-overlay" variants={modalOverlayVariants} initial="initial" animate="enter" exit="exit">
            <motion.div className="search-history-modal-content" variants={modalContentVariants} initial="initial" animate="enter" exit="exit">
              <div className="search-history-modal-header">
                <h3>Informe Medico Formal</h3>
                <button className="search-history-close-btn" onClick={() => setShowReportModal(false)} aria-label="Cerrar modal de informe">
                  <X size={20} />
                </button>
              </div>

              <div className="search-history-modal-body">
                {isGeneratingReport ? (
                  <div className="loading-state premium-loading">
                    <div className="search-history-spinner"></div>
                    <p>Generando informe...</p>
                  </div>
                ) : (
                  <textarea className="history-editor" value={reportContent} onChange={(e) => setReportContent(e.target.value)} />
                )}
              </div>

              <div className="search-history-modal-footer">
                <button className="search-history-btn-secondary" onClick={() => setShowReportModal(false)}>
                  Cancelar
                </button>
                <button className="search-history-btn-primary" onClick={() => void handleSaveReport()}>
                  Guardar informe
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SearchHistory;
