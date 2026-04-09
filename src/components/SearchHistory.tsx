import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Command,
  Copy,
  FileText,
  Layers3,
  Printer,
  RefreshCcw,
  Search,
  Shield,
  Sparkles,
  User,
  X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { AIService } from '../services/ai';
import {
  buildPsychologyCaseSummary,
  ensurePatientBriefing,
  getMedicalRecordByUuid,
  getPatientTimeline,
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
import { getClinicalSpecialtyConfig, normalizeClinicalSpecialty, type ClinicalSpecialtyId } from '../clinical/specialties';
import { useSimulation } from './Simulation/SimulationContext';
import { PatientBriefingCard } from './PatientBriefingCard';
import './SearchHistory.css';

interface SearchHistoryProps {
  apiKey: string;
  focusedPatientName?: string;
  activeSpecialty: ClinicalSpecialtyId;
  clinicianProfile?: string;
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

const getLocalDateKey = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTodayDateKey = (): string => getLocalDateKey(new Date());
const getRelativeDateKey = (daysOffset: number): string => {
  const next = new Date();
  next.setDate(next.getDate() + daysOffset);
  return getLocalDateKey(next);
};

type HistoryViewMode = 'day' | 'patient';

const selectBestItem = (group: PatientTimelineGroup): PatientTimelineItem | null => {
  return group.items[0] || null;
};

const filterGroupByDate = (
  group: PatientTimelineGroup,
  selectedDateKey: string
): PatientTimelineGroup | null => {
  if (!selectedDateKey) return group;
  const filteredItems = group.items.filter((item) => getLocalDateKey(item.consultationAt) === selectedDateKey);
  if (filteredItems.length === 0) return null;

  const clinicians = Array.from(new Set(
    filteredItems
      .map((item) => item.clinicianName || item.clinicianProfile || '')
      .filter(Boolean)
  ));
  const specialties = Array.from(new Set(filteredItems.map((item) => item.specialty)));
  const sourceCounts = filteredItems.reduce(
    (acc, item) => {
      acc[item.source] += 1;
      return acc;
    },
    { current: 0, legacy: 0 }
  );

  return {
    ...group,
    latestConsultationAt: filteredItems[0]?.consultationAt || group.latestConsultationAt,
    sessionCount: filteredItems.length,
    clinicians,
    specialties,
    sourceCounts,
    items: filteredItems
  };
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
  activeSpecialty,
  clinicianProfile,
  onFocusedPatientNameConsumed,
  onLoadRecord,
  onUseAsContext
}) => {
  const [query, setQuery] = useState('');
  const [allResults, setAllResults] = useState<PatientTimelineGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<PatientTimelineGroup | null>(null);
  const [selectedItem, setSelectedItem] = useState<PatientTimelineItem | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [patientTimeline, setPatientTimeline] = useState<PatientTimelineItem[]>([]);
  const [patientTimelineLoading, setPatientTimelineLoading] = useState(false);
  const [caseSummary, setCaseSummary] = useState<PatientCaseSummary | null>(null);
  const [caseSummaryLoading, setCaseSummaryLoading] = useState(false);
  const [briefing, setBriefing] = useState<PatientBriefing | null>(null);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const [historyViewMode, setHistoryViewMode] = useState<HistoryViewMode>(
    activeSpecialty === 'psicologia' ? 'patient' : 'day'
  );
  const [selectedDateKey, setSelectedDateKey] = useState<string>(getTodayDateKey);
  const [lastRefreshAt, setLastRefreshAt] = useState<string>('');
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
  const activeClinicianProfile = clinicianProfile;
  const isDemoSelectedGroup = Boolean(
    demoContinuity
    && selectedGroupNormalizedName
    && selectedGroupNormalizedName === normalizedDemoPatientName
  );
  const effectiveCaseSummary = isDemoSelectedGroup ? demoContinuity?.caseSummary ?? null : caseSummary;
  const effectiveCaseSummaryLoading = isDemoSelectedGroup ? false : caseSummaryLoading;

  const selectedSpecialty = normalizeClinicalSpecialty(selectedItem?.specialty || activeSpecialty);
  const selectedSpecialtyConfig = getClinicalSpecialtyConfig(selectedSpecialty);
  const isPatientMode = historyViewMode === 'patient';
  const selectedPatientTimeline = React.useMemo(
    () => {
      if (isPatientMode) return patientTimeline;
      return selectedSpecialty === 'psicologia' ? patientTimeline : selectedGroup?.items || [];
    },
    [isPatientMode, patientTimeline, selectedGroup?.items, selectedSpecialty]
  );
  const selectedPatientSessionCount = selectedPatientTimeline.length || selectedGroup?.sessionCount || 0;
  const activeContent = selectedItem?.medicalHistory || '';
  const { history: activeHistory, notes: activeNotes } = parseContent(activeContent);
  const canOpenCurrent = selectedItem?.source === 'current' && Boolean(onLoadRecord) && Boolean(selectedItem?.recordUuid);
  const dayResults = React.useMemo(
    () => allResults
      .map((group) => filterGroupByDate(group, selectedDateKey))
      .filter((group): group is PatientTimelineGroup => Boolean(group)),
    [allResults, selectedDateKey]
  );
  const results = isPatientMode ? allResults : dayResults;
  const visibleResults = React.useMemo(() => results.slice(0, visibleCount), [results, visibleCount]);
  const hasMoreResults = visibleCount < results.length;
  const selectedDateLabel = React.useMemo(() => {
    if (!selectedDateKey) return 'todas las fechas';
    const parsed = new Date(`${selectedDateKey}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return selectedDateKey;
    return parsed.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }, [selectedDateKey]);
  const refreshLabel = lastRefreshAt
    ? new Date(lastRefreshAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'pendiente';
  const cloudStatusLabel = !isCloudEnabled
    ? 'Solo guardado local'
    : cloudAccessMode === 'session'
      ? 'Nube conectada'
      : 'Nube interna activa';
  const cloudStatusHint = !isCloudEnabled
    ? 'La app trabaja en este equipo sin nube.'
    : cloudAccessMode === 'session'
      ? 'Sincronizas con una sesión autenticada.'
      : 'Sincronizas con el acceso interno configurado.';
  const visibilityLabel = activeSpecialty === 'psicologia'
    ? 'Psico sin legacy ni briefings'
    : 'ORL con histórico operativo';
  const resultsSummaryLabel = isPatientMode
    ? `${results.length} pacientes con continuidad disponible`
    : `${results.length} pacientes en ${selectedDateLabel}`;
  const patientModeCopy = activeSpecialty === 'psicologia'
    ? 'Piensa esta vista como continuidad terapéutica: eliges un paciente y revisas su recorrido completo sin depender del calendario.'
    : 'Piensa esta vista como continuidad clínica: eliges un paciente y revisas consultas previas, informes y evolución sin depender del calendario.';
  const listPanelTitle = isPatientMode
    ? (activeSpecialty === 'psicologia' ? 'Pacientes en continuidad' : 'Pacientes con historial')
    : 'Agenda clínica del día';
  const listPanelDescription = isPatientMode
    ? (activeSpecialty === 'psicologia'
      ? 'Ideal para situarte antes de una sesión y cambiar de paciente sin perder contexto.'
      : 'Útil cuando quieres revisar evolución o volver a una consulta previa del mismo paciente.')
    : (activeSpecialty === 'psicologia'
      ? 'Úsalo cuando quieres ver quién pasó por consulta en una fecha concreta.'
      : 'Úsalo para trabajar la jornada como agenda: eliges un día y entras a cada consulta desde ahí.');
  const selectedGroupCurrentCount = selectedGroup?.sourceCounts.current || 0;
  const selectedGroupLegacyCount = selectedGroup?.sourceCounts.legacy || 0;
  const detailGuideTitle = isPatientMode ? 'Vista centrada en el paciente' : 'Vista centrada en el día';
  const detailGuideBody = isPatientMode
    ? (selectedSpecialty === 'psicologia'
      ? 'Tienes la continuidad del caso abierta para moverte entre sesiones anteriores con un clic.'
      : 'Tienes acceso a la continuidad clínica del paciente para comparar consultas y abrir resultados previos.')
    : (selectedSpecialty === 'psicologia'
      ? 'Estás viendo la selección del día, pero puedes saltar al historial completo del paciente desde la continuidad.'
      : 'Estás viendo la agenda del día. La lista te deja entrar rápido en cada consulta y su documentación asociada.');
  const detailActionBody = canOpenCurrent
    ? 'Puedes usar esta sesión como contexto, abrir el resultado editable o generar informe formal desde aquí.'
    : 'Esta sesión es importada y queda en solo lectura, pero sigue disponible para revisar continuidad y contexto.';
  const documentLabel = selectedSpecialty === 'psicologia' ? 'Historia psicológica' : 'Historia médica';
  const breadcrumbs = [
    selectedSpecialtyConfig.shortLabel,
    selectedGroup?.patientName || 'Sin paciente',
    selectedItem?.consultationAt
      ? `sesión del ${new Date(selectedItem.consultationAt).toLocaleDateString()}`
      : 'sin sesión'
  ];

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

  useEffect(() => {
    setHistoryViewMode(activeSpecialty === 'psicologia' ? 'patient' : 'day');
  }, [activeSpecialty]);

  useEffect(() => {
    if (historyViewMode === 'patient' || activeSpecialty === 'psicologia') {
      setTimelineExpanded(true);
    }
  }, [activeSpecialty, historyViewMode]);

  useEffect(() => {
    setVisibleCount(40);
  }, [query, results.length, activeSpecialty, activeClinicianProfile, selectedDateKey]);

  const loadResults = useCallback(async (nextQuery?: string, preferredPatientName?: string) => {
    setIsLoading(true);
    try {
      const effectiveQuery = typeof nextQuery === 'string' ? nextQuery : queryRef.current;
      const groups = demoContinuity
        ? getDemoGroups(effectiveQuery)
        : await searchPatientTimeline(effectiveQuery, activeSpecialty, activeClinicianProfile);
      const nextDayResults = groups
        .map((group) => filterGroupByDate(group, selectedDateKey))
        .filter((group): group is PatientTimelineGroup => Boolean(group));
      const nextResults = historyViewMode === 'patient' ? groups : nextDayResults;
      setAllResults(groups);
      const normalizedPreferredPatient = preferredPatientName?.trim().toLowerCase();
      const previousSelectedGroup = selectedGroupRef.current;
      const nextGroup = nextResults.find((group) => group.patientName.trim().toLowerCase() === normalizedPreferredPatient)
        || nextResults.find((group) => group.normalizedPatientName === previousSelectedGroup?.normalizedPatientName)
        || nextResults[0]
        || null;
      selectedGroupRef.current = nextGroup;
      setSelectedGroup(nextGroup);
      const nextItem = nextGroup ? selectBestItem(nextGroup) : null;
      setSelectedItem(nextItem);
      setSelectedRecord(null);
      setLastRefreshAt(new Date().toISOString());
    } finally {
      setIsLoading(false);
    }
  }, [activeClinicianProfile, activeSpecialty, demoContinuity, getDemoGroups, historyViewMode, selectedDateKey]);

  useEffect(() => {
    const previousSelectedGroup = selectedGroupRef.current;
    const nextGroup = results.find((group) => group.normalizedPatientName === previousSelectedGroup?.normalizedPatientName)
      || results[0]
      || null;

    selectedGroupRef.current = nextGroup;
    setSelectedGroup(nextGroup);

    if (!nextGroup) {
      setSelectedItem(null);
      setSelectedRecord(null);
      return;
    }

    const nextItem = nextGroup.items.find((item) => item.id === selectedItem?.id)
      || selectBestItem(nextGroup);
    setSelectedItem(nextItem);
    if (!nextItem || nextItem.id !== selectedItem?.id) {
      setSelectedRecord(null);
    }
  }, [results, selectedItem?.id]);

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
        setPatientTimeline([]);
        setPatientTimelineLoading(false);
        return;
      }
      if (demoContinuity && selectedGroupNormalizedName === normalizedDemoPatientName) {
        setPatientTimeline(demoContinuity.timelineGroup.items);
        setPatientTimelineLoading(false);
        return;
      }

      setPatientTimelineLoading(true);
      try {
        const timeline = await getPatientTimeline(selectedGroupName, selectedSpecialty, activeClinicianProfile);
        if (!cancelled) {
          setPatientTimeline(timeline);
        }
      } finally {
        if (!cancelled) {
          setPatientTimelineLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    activeClinicianProfile,
    demoContinuity,
    normalizedDemoPatientName,
    selectedGroupName,
    selectedGroupNormalizedName,
    selectedSpecialty
  ]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selectedGroupName || selectedSpecialty !== 'psicologia') {
        setCaseSummary(null);
        return;
      }
      if (demoContinuity && selectedGroupNormalizedName === normalizedDemoPatientName) {
        setCaseSummary(demoContinuity.caseSummary ?? null);
        setCaseSummaryLoading(false);
        return;
      }
      setCaseSummaryLoading(true);
      setCaseSummary(null);
      try {
        const summary = await buildPsychologyCaseSummary(selectedGroupName, activeClinicianProfile);
        if (!cancelled) setCaseSummary(summary);
      } finally {
        if (!cancelled) setCaseSummaryLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [activeClinicianProfile, demoContinuity, normalizedDemoPatientName, selectedGroupName, selectedGroupNormalizedName, selectedSpecialty]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selectedGroupName || selectedSpecialty !== 'otorrino') {
        setBriefing(null);
        return;
      }
      if (demoContinuity && selectedGroupNormalizedName === normalizedDemoPatientName) {
        setBriefing(demoContinuity.briefing ?? null);
        return;
      }

      const currentRequest = ++briefingRequestRef.current;
      setBriefing(null);
      try {
        const existing = await getPatientBriefing(selectedGroupName, selectedSpecialty, activeClinicianProfile);
        if (cancelled || currentRequest !== briefingRequestRef.current) return;
        if (existing) {
          setBriefing(existing);
          return;
        }

        const generated = await ensurePatientBriefing(selectedGroupName, selectedSpecialty, activeClinicianProfile);
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
    activeClinicianProfile,
    demoContinuity,
    normalizedDemoPatientName,
    selectedGroupName,
    selectedGroupNormalizedName,
    selectedSpecialty
  ]);

  const selectGroup = useCallback((group: PatientTimelineGroup) => {
    setSelectedGroup(group);
    setTimelineExpanded(historyViewMode === 'patient' || group.specialties.includes('psicologia'));
    const nextItem = selectBestItem(group);
    setSelectedItem(nextItem);
    setSelectedRecord(null);
  }, [historyViewMode]);

  const selectTimelineItem = useCallback((item: PatientTimelineItem) => {
    setSelectedItem(item);
    setSelectedRecord(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget = Boolean(
        target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable)
      );

      if (event.key === '/' && !isEditableTarget) {
        event.preventDefault();
        const searchInput = document.getElementById('history-search-input') as HTMLInputElement | null;
        searchInput?.focus();
        searchInput?.select();
        return;
      }

      if (isEditableTarget) return;

      if (event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setHistoryViewMode('day');
        return;
      }

      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setHistoryViewMode('patient');
        return;
      }

      if (event.key.toLowerCase() === 't' && historyViewMode === 'day') {
        event.preventDefault();
        setSelectedDateKey(getTodayDateKey());
        return;
      }

      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length > 0) {
        event.preventDefault();
        const currentIndex = results.findIndex(
          (group) => group.normalizedPatientName === selectedGroup?.normalizedPatientName
        );
        const nextIndex = event.key === 'ArrowDown'
          ? Math.min(currentIndex + 1, results.length - 1)
          : Math.max(currentIndex - 1, 0);
        const nextGroup = results[nextIndex] || results[0];
        if (nextGroup) {
          selectGroup(nextGroup);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [historyViewMode, results, selectGroup, selectedGroup?.normalizedPatientName]);

  const handleLoadCurrentRecord = useCallback(async (item: PatientTimelineItem) => {
    if (!onLoadRecord || item.source !== 'current' || !item.recordUuid) return;
    const record = await getMedicalRecordByUuid(item.recordUuid);
    if (record) {
      onLoadRecord(record);
    }
  }, [onLoadRecord]);

  const handleUseAsContext = useCallback(() => {
    if (!onUseAsContext || !selectedItem || !selectedGroup) return;
    onUseAsContext({
      patientName: selectedGroup.patientName,
      specialty: selectedItem.specialty,
      clinicianProfile: selectedItem.clinicianProfile,
      clinicianName: selectedItem.clinicianName
    });
  }, [onUseAsContext, selectedGroup, selectedItem]);

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
  }, [apiKey, selectedItem, selectedRecord, selectedSpecialty]);

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

  const renderTimelineSnippet = (item: PatientTimelineItem) => {
    const value = item.medicalHistory.replace(/\s+/g, ' ').trim();
    return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  };

  const handleListScroll: React.UIEventHandler<HTMLDivElement> = useCallback((event) => {
    if (!hasMoreResults) return;
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom <= 320) {
      setVisibleCount((current) => Math.min(current + 30, results.length));
    }
  }, [hasMoreResults, results.length]);

  const selectedContent = activeHistory || activeContent;
  const emptyStateMessage = !isCloudEnabled
    ? 'No hay nube configurada y no existen pacientes guardados en local.'
    : cloudAccessMode === 'session'
      ? 'No se han encontrado pacientes. Pulsa sincronizar para actualizar el historial desde la nube.'
      : 'No se han encontrado pacientes. Pulsa sincronizar para traer el historial interno desde Supabase.';
  const selectedSourceLabel = selectedItem?.source === 'legacy'
    ? 'Histórico importado · solo lectura'
    : 'Consulta actual · editable';
  const timelinePanelTitle = isPatientMode
    ? `Continuidad del paciente (${selectedPatientSessionCount})`
    : selectedSpecialty === 'psicologia'
      ? `Sesiones del paciente (${selectedPatientSessionCount})`
      : `Consultas del día (${selectedGroup?.items.length || 0})`;

  return (
    <div className="history-container">
      <div className="search-section">
        <h2 className="section-title">Historial de pacientes</h2>
        <div className="history-status-strip">
          <div className="history-status-card">
            <span className="history-status-card__label">Estado de guardado</span>
            <strong>{cloudStatusLabel}</strong>
            <span>{cloudStatusHint}</span>
          </div>
          <div className="history-status-card">
            <span className="history-status-card__label">Visibilidad actual</span>
            <strong>{visibilityLabel}</strong>
            <span>{activeSpecialty === 'psicologia' ? 'Solo continuidad útil para sesión.' : 'Sin cambios respecto al flujo ORL.'}</span>
          </div>
          <div className="history-status-card">
            <span className="history-status-card__label">Última actualización</span>
            <strong>{refreshLabel === 'pendiente' ? 'Pendiente' : `Actualizado ${refreshLabel}`}</strong>
            <span>{isSyncing ? 'Sincronizando ahora mismo...' : 'Pulsa refrescar si quieres traer cambios de nube.'}</span>
          </div>
        </div>
        <div className="history-mode-bar">
          <div className="history-mode-toggle" role="tablist" aria-label="Modo de historial">
            <button
              type="button"
              className={`history-mode-toggle__btn ${historyViewMode === 'day' ? 'active' : ''}`}
              onClick={() => setHistoryViewMode('day')}
              aria-pressed={historyViewMode === 'day'}
            >
              <Calendar size={15} />
              <span>Día</span>
            </button>
            <button
              type="button"
              className={`history-mode-toggle__btn ${historyViewMode === 'patient' ? 'active' : ''}`}
              onClick={() => setHistoryViewMode('patient')}
              aria-pressed={historyViewMode === 'patient'}
            >
              <User size={15} />
              <span>Paciente</span>
            </button>
          </div>
          <div className="history-shortcuts-hint">
            <Command size={14} />
            <span>`/` buscar · `D` día · `P` paciente · `T` hoy</span>
          </div>
        </div>
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
        {historyViewMode === 'day' ? (
          <div className="history-day-toolbar">
            <label className="history-day-picker" htmlFor="history-date-input">
              <span className="history-day-picker__label">Día del historial</span>
              <input
                id="history-date-input"
                type="date"
                value={selectedDateKey}
                onChange={(event) => setSelectedDateKey(event.target.value || getTodayDateKey())}
                className="history-day-picker__input"
              />
            </label>
            <div className="history-day-actions">
              <button
                type="button"
                className="history-day-today-btn"
                onClick={() => setSelectedDateKey(getTodayDateKey())}
              >
                Hoy
              </button>
              <button
                type="button"
                className="history-day-ghost-btn"
                onClick={() => setSelectedDateKey(getRelativeDateKey(-1))}
              >
                Ayer
              </button>
            </div>
            <div className="history-day-summary">
              <Calendar size={15} />
              <span>{resultsSummaryLabel}</span>
            </div>
          </div>
        ) : (
          <div className="history-day-toolbar history-day-toolbar--patient">
            <div className="history-day-summary history-day-summary--patient">
              <CheckCircle2 size={15} />
              <span>{resultsSummaryLabel}</span>
            </div>
            <div className="history-patient-mode-copy">
              {patientModeCopy}
            </div>
          </div>
        )}
      </div>

      <div className="content-grid timeline-grid">
        <div className="list-column" onScroll={handleListScroll}>
          <div className="history-list-panel-intro">
            <div>
              <div className="history-list-panel-kicker">{historyViewMode === 'patient' ? 'Continuidad' : 'Agenda'}</div>
              <h3>{listPanelTitle}</h3>
            </div>
            <p>{listPanelDescription}</p>
          </div>
          {isLoading ? (
            <div className="history-list-skeletons" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`history-skeleton-${index}`} className="history-card-skeleton">
                  <div className="history-card-skeleton__top">
                    <div className="history-card-skeleton__avatar" />
                    <div className="history-card-skeleton__date" />
                  </div>
                  <div className="history-card-skeleton__line history-card-skeleton__line--title" />
                  <div className="history-card-skeleton__line history-card-skeleton__line--short" />
                  <div className="history-card-skeleton__chips">
                    <span />
                    <span />
                  </div>
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon-wrap">
                <User size={24} strokeWidth={1.5} />
              </div>
              <p>{emptyStateMessage}</p>
            </div>
          ) : (
            <div className="cards-list">
              {visibleResults.map((group, index) => (
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
                      {group.sessionCount} sesiones
                    </div>
                    <div className="card-tags">
                      {group.clinicians.slice(0, 2).map((clinician) => (
                        <span key={clinician} className="card-tag">{clinician}</span>
                      ))}
                    </div>
                    <div className="card-footer-meta">
                      {group.sourceCounts.current > 0 && (
                        <span className="card-mini-stat current">{group.sourceCounts.current} actuales</span>
                      )}
                      {group.sourceCounts.legacy > 0 && (
                        <span className="card-mini-stat legacy">{group.sourceCounts.legacy} importadas</span>
                      )}
                    </div>
                  </div>
                  <div className="card-actions">
                    <ChevronRight size={16} className="chevron" />
                  </div>
                </motion.button>
              ))}
              {hasMoreResults && (
                <div className="history-list-loading-more">Cargando más pacientes...</div>
              )}
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
                      <div className="history-breadcrumbs" aria-label="Ubicación actual">
                        {breadcrumbs.map((segment, index) => (
                          <span key={`${segment}-${index}`} className="history-breadcrumbs__item">
                            {segment}
                          </span>
                        ))}
                      </div>
                      <div className="name-display-wrapper">
                        <h1>{selectedGroup.patientName}</h1>
                      </div>
                      <div className="meta-row">
                        <span className="meta-item">
                          <Calendar size={14} />
                          {new Date(selectedItem.consultationAt || selectedGroup.latestConsultationAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                        <span className="meta-item">
                          <Layers3 size={14} />
                          {selectedPatientSessionCount} sesiones
                        </span>
                        <span className="meta-item">
                          <Clock3 size={14} />
                          {selectedItem.clinicianName || selectedItem.clinicianProfile || 'Sin profesional'}
                        </span>
                      </div>
                      <div className="history-detail-status-row">
                        <span className={`history-detail-status-pill ${selectedItem.source}`}>
                          {selectedSourceLabel}
                        </span>
                        <span className="history-detail-status-pill neutral">
                          {historyViewMode === 'patient' ? 'Vista paciente' : `Vista día · ${selectedDateLabel}`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="header-actions">
                    {onUseAsContext && (
                      <button className="search-history-btn-primary" onClick={handleUseAsContext}>
                        <Sparkles size={16} />
                        <span>Usar como contexto</span>
                      </button>
                    )}
                    {canOpenCurrent && (
                      <button className="search-history-btn-secondary" onClick={() => void handleLoadCurrentRecord(selectedItem)}>
                        <ArrowRight size={16} />
                        <span>Abrir resultado</span>
                      </button>
                    )}
                    {canOpenCurrent && (
                      <button className="search-history-btn-secondary" onClick={handleOpenReport}>
                        <FileText size={16} />
                        <span>Informe</span>
                      </button>
                    )}
                  </div>
                </div>

                {selectedSpecialty === 'otorrino' && briefing && (
                  <PatientBriefingCard briefing={briefing} variant="full" />
                )}

                <div className="history-detail-guide-grid">
                  <div className="history-detail-guide-card">
                    <span className="history-detail-guide-card__label">Qué estás viendo</span>
                    <strong>{detailGuideTitle}</strong>
                    <p>{detailGuideBody}</p>
                  </div>
                  <div className="history-detail-guide-card">
                    <span className="history-detail-guide-card__label">Qué puedes hacer aquí</span>
                    <strong>{selectedSourceLabel}</strong>
                    <p>{detailActionBody}</p>
                  </div>
                </div>

                <div id="history-case-hub" className="case-hub-card">
                  <div className="case-hub-header">
                    <div>
                      <div className="case-hub-kicker">Vista general</div>
                      <h2>{isPatientMode ? 'Continuidad del caso' : 'Resumen para situarte rápido'}</h2>
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
                  <div className="case-hub-footer-stats">
                    {selectedGroupCurrentCount > 0 && (
                      <span className="case-hub-footer-pill current">{selectedGroupCurrentCount} consultas actuales</span>
                    )}
                    {selectedGroupLegacyCount > 0 && (
                      <span className="case-hub-footer-pill legacy">{selectedGroupLegacyCount} importadas</span>
                    )}
                  </div>
                </div>

                <div id="history-timeline-panel" className="timeline-panel">
                  <button
                    type="button"
                    className="timeline-panel-header timeline-panel-toggle"
                    onClick={() => setTimelineExpanded((prev) => !prev)}
                    aria-expanded={timelineExpanded}
                  >
                    <h3>{timelinePanelTitle}</h3>
                    <ChevronRight size={16} className={`timeline-chevron ${timelineExpanded ? 'expanded' : ''}`} />
                  </button>
                  {timelineExpanded && (
                  <div className="timeline-list">
                    {patientTimelineLoading && (selectedSpecialty === 'psicologia' || isPatientMode) ? (
                      <div className="case-hub-loading">Cargando sesiones previas...</div>
                    ) : selectedPatientTimeline.map((item, index) => {
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
                      <div className="document-header-copy">
                        <span className="doc-label">{documentLabel}</span>
                        <span className="document-sub-label">
                          {selectedItem.source === 'current' ? 'Sesión editable' : 'Registro importado en solo lectura'}
                        </span>
                      </div>
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
