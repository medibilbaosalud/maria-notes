import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, FileText, Sparkles, FileOutput, X, Printer, Plus, AlertTriangle, Edit2, Brain, Wand2, ThumbsDown, MoreHorizontal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { MBSLogo } from './MBSLogo';
import { AIAuditWidget } from './AIAuditWidget';
import { processDoctorFeedbackV2 } from '../services/doctor-feedback';
import type { ExtractionMeta, ConsultationClassification, UncertaintyFlag, FieldEvidence } from '../services/groq';
import { saveFieldConfirmation, logQualityEvent, saveDoctorSatisfactionEvent } from '../services/supabase';
import { evaluateAndPersistRuleImpactV2 } from '../services/learning/rule-evaluator';
import { motionTransitions } from '../features/ui/motion-tokens';
import { safeCopyToClipboard } from '../utils/safeBrowser';
import type { PipelineUiError } from '../types/pipeline';

interface HistoryViewProps {
  content: string;
  isLoading: boolean;
  patientName?: string;
  originalContent?: string; // Raw AI output (baseline) if available
  transcription?: string; // Needed for learning context
  apiKey?: string; // Needed for Qwen3 analysis call
  onGenerateReport?: () => Promise<string>;
  onNewConsultation?: () => void;
  onRetryProcessing?: () => void;
  onContentChange?: (newContent: string) => void;
  processingError?: PipelineUiError;
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
    rulePackVersion?: number;
    ruleIdsUsed?: string[];
    learningApplied?: boolean;
    qualityScore?: number;
    criticalGaps?: { field: string; reason: string; severity: 'critical' | 'major' | 'minor' }[];
    doctorNextActions?: string[];
    qualityTriageModel?: string;
    resultStatus?: 'completed' | 'provisional' | 'failed_recoverable' | 'failed_final';
    provisionalReason?: string;
    logicalCallsUsed?: number;
    physicalCallsUsed?: number;
    fallbackHops?: number;
  };
  recordId?: string;
  onPersistMedicalHistory?: (newContent: string, options?: { autosave?: boolean }) => Promise<void> | void;
  onRegenerateSection?: (sectionTitle: string, currentContent: string) => Promise<string>;
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
  originalContent,
  transcription,
  apiKey,
  onGenerateReport,
  onNewConsultation,
  onRetryProcessing,
  onContentChange,
  processingError,
  metadata,
  recordId,
  onPersistMedicalHistory,
  onRegenerateSection
}) => {
  const doctorScoreEnabled = String(import.meta.env.VITE_DOCTOR_SCORE_ENABLED || 'true').toLowerCase() === 'true';
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
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [selectedEvidenceField, setSelectedEvidenceField] = useState<string | null>(null);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showVersionsModal, setShowVersionsModal] = useState(false);
  const [hasEdited, setHasEdited] = useState(false);
  const [hasFinalized, setHasFinalized] = useState(false);
  const [hasGeneratedReport, setHasGeneratedReport] = useState(false);
  const [hasExported, setHasExported] = useState(false);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isRegeneratingSection, setIsRegeneratingSection] = useState(false);
  const [selectedSection, setSelectedSection] = useState<string>('ENFERMEDAD ACTUAL');
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const moreActionsRef = useRef<HTMLDetailsElement | null>(null);
  const quickCommands = ['Niega', 'Sin cambios', 'Sin hallazgos relevantes'];

  const originalHistoryRef = useRef<string>('');
  const lastSavedValueRef = useRef<string>('');
  const lastRecordIdRef = useRef<string | null>(null);

  type HistoryVersion = {
    id: string;
    label: string;
    content: string;
    createdAt: Date;
    source: 'ai' | 'edit' | 'autosave';
  };

  const [versions, setVersions] = useState<HistoryVersion[]>([]);

  // Split content into History and Maria Notes
  const [historyText, mariaNotes] = content ? content.split('---MARIA_NOTES---') : ['', ''];

  useEffect(() => {
    if (recordId !== lastRecordIdRef.current) {
      lastRecordIdRef.current = recordId || null;
      const baseline = (originalContent || historyText || '').trim();
      originalHistoryRef.current = baseline;
      lastSavedValueRef.current = historyText;
      setVersions(
        baseline
          ? [{
            id: `ai-${Date.now()}`,
            label: 'IA (original)',
            content: baseline,
            createdAt: new Date(),
            source: 'ai'
          }]
          : []
      );
      setHasEdited(Boolean(historyText.trim()) && historyText.trim() !== baseline);
      setHasFinalized(false);
      setHasGeneratedReport(false);
      setHasExported(false);
      setLastSavedAt(null);
      setFlagDecisions({});
    }
  }, [recordId, historyText]);

  useEffect(() => {
    if (!originalHistoryRef.current && (originalContent || historyText)) {
      const baseline = (originalContent || historyText || '').trim();
      originalHistoryRef.current = baseline;
      lastSavedValueRef.current = historyText;
      setVersions([{
        id: `ai-${Date.now()}`,
        label: 'IA (original)',
        content: baseline,
        createdAt: new Date(),
        source: 'ai'
      }]);
    }
  }, [historyText, originalContent]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isEditingRef = useRef(isEditing);
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

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

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;

      if (key === 's' && !event.shiftKey) {
        event.preventDefault();
        if (isEditingRef.current) {
          saveEditRef.current();
        }
      }

      if (event.shiftKey && key === 'r') {
        event.preventDefault();
        openReportRef.current();
      }

      if (event.shiftKey && key === 'e') {
        event.preventDefault();
        const field = metadata?.uncertaintyFlags?.[0]?.field_path || evidenceByField[0]?.[0];
        if (field) {
          openEvidenceRef.current(field);
        }
      }

      if (event.shiftKey && key === 'm') {
        event.preventDefault();
        setShowSourcesModal(true);
      }

      if (event.shiftKey && key === 'c') {
        event.preventDefault();
        setShowCompareModal(true);
      }

      if (event.shiftKey && key === 'v') {
        event.preventDefault();
        setShowVersionsModal(true);
      }

      if (key === 'escape') {
        moreActionsRef.current?.removeAttribute('open');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [metadata, evidenceByField]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const node = moreActionsRef.current;
      if (!node?.hasAttribute('open')) return;
      if (node.contains(event.target as Node)) return;
      node.removeAttribute('open');
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const evidenceMap = useMemo(() => {
    const map = new Map<string, FieldEvidence[]>();
    evidenceByField.forEach(([fieldPath, entries]) => {
      map.set(fieldPath, entries);
    });
    return map;
  }, [evidenceByField]);

  const uncertaintyEntries = useMemo(() => {
    return (metadata?.uncertaintyFlags || [])
      .filter((flag) => flag.value && flag.value.trim().length >= 2)
      .map((flag) => ({
        fieldPath: flag.field_path,
        value: flag.value?.trim() || '',
        reason: flag.reason
      }));
  }, [metadata]);

  const sectionHeadings = useMemo(() => {
    const matches = Array.from(historyText.matchAll(/^##\s+(.+)$/gim));
    const sections = matches.map((match) => (match[1] || '').trim()).filter(Boolean);
    return sections.length > 0 ? sections : ['ENFERMEDAD ACTUAL'];
  }, [historyText]);

  useEffect(() => {
    if (!sectionHeadings.includes(selectedSection)) {
      setSelectedSection(sectionHeadings[0] || 'ENFERMEDAD ACTUAL');
    }
  }, [sectionHeadings, selectedSection]);

  const fieldPathToSection = useCallback((fieldPath: string) => {
    const value = (fieldPath || '').toLowerCase();
    if (value.includes('antecedentes')) return 'ANTECEDENTES';
    if (value.includes('enfermedad_actual') || value.includes('motivo') || value.includes('sintomas')) return 'ENFERMEDAD ACTUAL';
    if (value.includes('exploraciones') || value.includes('pruebas')) return 'EXPLORACION / PRUEBAS';
    if (value.includes('diagnostico')) return 'DIAGNOSTICO';
    if (value.includes('plan')) return 'PLAN';
    return 'OTROS';
  }, []);

  const uncertaintyBySection = useMemo(() => {
    const groups = new Map<string, UncertaintyFlag[]>();
    for (const flag of metadata?.uncertaintyFlags || []) {
      const section = fieldPathToSection(flag.field_path);
      const list = groups.get(section) || [];
      list.push(flag);
      groups.set(section, list);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [fieldPathToSection, metadata]);

  const topDoctorActions = useMemo(() => {
    return (metadata?.doctorNextActions || []).filter(Boolean).slice(0, 3);
  }, [metadata]);

  const generationProviderLabel = useMemo(() => {
    const generation = metadata?.models?.generation || '';
    if (generation.startsWith('gemini:')) return 'Gemini';
    if (generation.startsWith('groq:')) return 'Groq';
    return 'Desconocido';
  }, [metadata]);

  const openEvidence = useCallback((fieldPath: string) => {
    setSelectedEvidenceField(fieldPath);
    setShowEvidenceModal(true);
  }, []);
  const openEvidenceRef = useRef(openEvidence);
  useEffect(() => {
    openEvidenceRef.current = openEvidence;
  }, [openEvidence]);

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

  const handleConfirmSection = async (section: string) => {
    const flags = (metadata?.uncertaintyFlags || []).filter((flag) => fieldPathToSection(flag.field_path) === section);
    for (const flag of flags) {
      if (flagDecisions[flag.field_path]) continue;
      await handleFlagDecision(flag, true);
    }
  };

  const handleRegenerateSelectedSection = async () => {
    if (!onRegenerateSection || !selectedSection) return;
    setIsRegeneratingSection(true);
    try {
      const nextContent = await onRegenerateSection(selectedSection, historyText);
      await persistContent(nextContent, { autosave: false });
      setHasEdited(nextContent !== originalHistoryRef.current);
      setLastSavedAt(new Date());
    } finally {
      setIsRegeneratingSection(false);
    }
  };

  const handleDoctorScore = async (score: number) => {
    await saveDoctorSatisfactionEvent({
      score,
      record_id: recordId,
      context: {
        quality_score: metadata?.qualityScore || null,
        uncertainty_flags: metadata?.uncertaintyFlags?.length || 0
      }
    });
  };

  const handleEditClick = () => {
    setEditValue(historyText);
    setIsEditing(true);
  };

  const handleCommandInsert = (command: string) => {
    setHasEdited(true);
    setIsEditing(true);
    const textarea = editTextareaRef.current;
    const baseValue = textarea ? textarea.value : editValue;
    const selectionStart = textarea?.selectionStart ?? baseValue.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const prefix = baseValue.slice(0, selectionStart);
    const suffix = baseValue.slice(selectionEnd);
    const needsLeadingSpace = prefix && !/\s$/.test(prefix);
    const needsTrailingSpace = suffix && !/^\s/.test(suffix);
    const insertValue = `${prefix}${needsLeadingSpace ? ' ' : ''}${command}${needsTrailingSpace ? ' ' : ''}${suffix}`;
    setEditValue(insertValue);
    setTimeout(() => {
      if (textarea) {
        const cursorPos = prefix.length + (needsLeadingSpace ? 1 : 0) + command.length + (needsTrailingSpace ? 1 : 0);
        textarea.focus();
        textarea.setSelectionRange(cursorPos, cursorPos);
      }
    }, 0);
  };

  const persistContent = useCallback(async (newText: string, options?: { autosave?: boolean }) => {
    if (onContentChange) {
      const fullContent = newText + (mariaNotes ? '\n---MARIA_NOTES---\n' + mariaNotes : '');
      onContentChange(fullContent);
    }
    if (onPersistMedicalHistory) {
      await onPersistMedicalHistory(newText, options);
    }
  }, [mariaNotes, onContentChange, onPersistMedicalHistory]);

  const handleSaveEdit = useCallback(async () => {
    // TRIGGER LEARNING: If content changed, analyze why
    if (editValue !== historyText) {
      if (transcription && apiKey) {
        const baselineAiText = originalHistoryRef.current || historyText;
        void processDoctorFeedbackV2({
          transcription,
          aiText: baselineAiText,
          doctorText: editValue,
          apiKey,
          recordId,
          auditId: metadata?.auditId,
          source: 'history_save',
          artifactType: 'medical_history',
          allowAutosaveLearn: true
        }).then((learningResult) => {
          if (learningResult?.candidate_ids?.length) {
            console.log('[HistoryView] Learning event registrado:', learningResult.event_ids.length);
            const hallucinationCount = (metadata?.remainingErrors || []).filter((err) => err.type === 'hallucination').length;
            const inconsistencyCount = (metadata?.remainingErrors || []).filter((err) => err.type === 'inconsistency').length;

            void evaluateAndPersistRuleImpactV2({
              candidateIds: learningResult.candidate_ids,
              aiOutput: baselineAiText,
              doctorOutput: editValue,
              source: 'history_save',
              artifactType: 'medical_history',
              hallucinationDelta: hallucinationCount > 0 ? 0.005 : 0,
              inconsistencyDelta: inconsistencyCount > 0 ? 0.005 : 0,
              metadata: {
                record_id: recordId || null,
                audit_id: metadata?.auditId || null,
                learning_event_ids: learningResult.event_ids
              }
            });
          }
        }).catch((error) => {
          console.warn('[HistoryView] learning V2 failed on manual save:', error);
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

    await persistContent(editValue, { autosave: false });
    lastSavedValueRef.current = editValue;
    setLastSavedAt(new Date());
    setHasEdited(editValue !== originalHistoryRef.current);
    setVersions((prev) => [
      ...prev,
      {
        id: `edit-${Date.now()}`,
        label: `Edición ${prev.filter((item) => item.source === 'edit').length + 1}`,
        content: editValue,
        createdAt: new Date(),
        source: 'edit'
      }
    ]);
    setIsEditing(false);
  }, [apiKey, editValue, historyText, metadata, persistContent, recordId, transcription]);

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const saveEditRef = useRef(handleSaveEdit);
  useEffect(() => {
    saveEditRef.current = handleSaveEdit;
  }, [handleSaveEdit]);

  const handleCopy = async (text: string) => {
    const copiedOk = await safeCopyToClipboard(text.trim());
    if (!copiedOk) return;
    setCopied(true);
    setHasExported(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenReport = async () => {
    setShowReportModal(true);
    if (!reportContent && onGenerateReport) {
      setIsGeneratingReport(true);
      try {
        const report = await onGenerateReport();
        setReportContent(report);
        setHasGeneratedReport(true);
      } catch (error) {
        console.error("Error generating report:", error);
        setReportContent("Error al generar el informe. Inténtelo de nuevo.");
      } finally {
        setIsGeneratingReport(false);
      }
    }
  };

  const openReportRef = useRef(handleOpenReport);
  useEffect(() => {
    openReportRef.current = handleOpenReport;
  }, [handleOpenReport]);

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

  const normalizeText = (value: string) => value.toLowerCase();

  const findMatches = (text: string) => {
    const matches: { start: number; end: number; fieldPath: string; value: string; reason: string }[] = [];
    const lowerText = normalizeText(text);

    uncertaintyEntries.forEach((entry) => {
      const needle = normalizeText(entry.value);
      if (!needle) return;
      let index = lowerText.indexOf(needle);
      while (index !== -1) {
        matches.push({
          start: index,
          end: index + needle.length,
          fieldPath: entry.fieldPath,
          value: entry.value,
          reason: entry.reason
        });
        index = lowerText.indexOf(needle, index + needle.length);
      }
    });

    matches.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.end - a.end;
    });

    const filtered: typeof matches = [];
    let lastEnd = -1;
    matches.forEach((match) => {
      if (match.start >= lastEnd) {
        filtered.push(match);
        lastEnd = match.end;
      }
    });

    return filtered;
  };

  const renderHighlightedText = (text: string) => {
    const matches = findMatches(text);
    if (matches.length === 0) return text;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    matches.forEach((match, idx) => {
      if (cursor < match.start) {
        parts.push(text.slice(cursor, match.start));
      }
      const snippet = text.slice(match.start, match.end);
      parts.push(
        <button
          key={`${match.fieldPath}-${match.start}-${idx}`}
          id={`uncertainty-highlight-${idx}`}
          type="button"
          className="uncertainty-highlight"
          onClick={() => openEvidence(match.fieldPath)}
          title={`Revisar: ${match.reason}`}
        >
          {snippet}
        </button>
      );
      cursor = match.end;
    });
    if (cursor < text.length) {
      parts.push(text.slice(cursor));
    }
    return parts;
  };

  const highlightChildren = (children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, (child) => {
      if (typeof child === 'string') {
        return renderHighlightedText(child);
      }
      if (React.isValidElement(child) && child.props?.children) {
        return React.cloneElement(child, {
          ...child.props,
          children: highlightChildren(child.props.children)
        });
      }
      return child;
    });
  };

  useEffect(() => {
    if (!isEditing) return;
    const timeout = setTimeout(async () => {
      if (editValue === lastSavedValueRef.current) return;
      setIsAutosaving(true);
      try {
        await persistContent(editValue, { autosave: true });
        const baselineAiText = originalHistoryRef.current || historyText;
        void processDoctorFeedbackV2({
          transcription,
          aiText: baselineAiText,
          doctorText: editValue,
          apiKey,
          recordId,
          auditId: metadata?.auditId,
          source: 'history_autosave',
          artifactType: 'medical_history',
          allowAutosaveLearn: true
        }).then((learningResult) => {
          if (!learningResult?.candidate_ids?.length) return;
          const hallucinationCount = (metadata?.remainingErrors || []).filter((err) => err.type === 'hallucination').length;
          const inconsistencyCount = (metadata?.remainingErrors || []).filter((err) => err.type === 'inconsistency').length;
          void evaluateAndPersistRuleImpactV2({
            candidateIds: learningResult.candidate_ids,
            aiOutput: baselineAiText,
            doctorOutput: editValue,
            source: 'history_autosave',
            artifactType: 'medical_history',
            hallucinationDelta: hallucinationCount > 0 ? 0.005 : 0,
            inconsistencyDelta: inconsistencyCount > 0 ? 0.005 : 0,
            metadata: {
              record_id: recordId || null,
              audit_id: metadata?.auditId || null,
              learning_event_ids: learningResult.event_ids
            }
          });
        }).catch((error) => {
          console.warn('[HistoryView] learning V2 failed on autosave:', error);
        });
        lastSavedValueRef.current = editValue;
        setLastSavedAt(new Date());
        setVersions((prev) => [
          ...prev,
          {
            id: `autosave-${Date.now()}`,
            label: `Autosave ${prev.filter((item) => item.source === 'autosave').length + 1}`,
            content: editValue,
            createdAt: new Date(),
            source: 'autosave'
          }
        ]);
      } finally {
        setIsAutosaving(false);
      }
    }, 1200);
    return () => clearTimeout(timeout);
  }, [apiKey, editValue, historyText, isEditing, metadata, persistContent, recordId, transcription]);

  const reviewCompleted = (metadata?.uncertaintyFlags?.length || 0) === 0
    || (metadata?.uncertaintyFlags || []).every((flag) => flagDecisions[flag.field_path]);

  const steps = [
    { key: 'record', label: 'Grabar', completed: Boolean(historyText) },
    { key: 'review', label: 'Revisar alertas', completed: reviewCompleted },
    { key: 'edit', label: 'Editar', completed: hasEdited || !isEditing },
    { key: 'finalize', label: 'Finalizar', completed: hasFinalized },
    { key: 'report', label: 'Informe', completed: hasGeneratedReport },
    { key: 'export', label: 'Exportar', completed: hasExported }
  ];

  const selectedEvidenceEntries = selectedEvidenceField ? evidenceMap.get(selectedEvidenceField) || [] : [];
  const selectedUncertaintyFlag = selectedEvidenceField
    ? metadata?.uncertaintyFlags?.find((flag) => flag.field_path === selectedEvidenceField)
    : undefined;
  const aiBaseline = versions.find((item) => item.source === 'ai')?.content || originalHistoryRef.current;
  const autosaveUiState = isAutosaving ? 'active' : lastSavedAt ? 'success' : 'idle';
  const autosaveLabel = isAutosaving
    ? 'Guardando...'
    : lastSavedAt
      ? `Guardado ${lastSavedAt.toLocaleTimeString()}`
      : 'Sin guardar';
  const handleLoadVersion = (version: HistoryVersion) => {
    setEditValue(version.content);
    setIsEditing(true);
    setHasEdited(true);
    setShowVersionsModal(false);
  };

  if (isLoading) {
    return <LoadingMessages />;
  }

  if (!content) {
    return (
      <div className="empty-state">
        <FileText size={48} className="empty-icon" />
        {processingError && (
          <p>{`No se pudo completar el procesamiento (${processingError.code}). ${processingError.message}`}</p>
        )}
        <div className="doc-actions">
          {processingError?.retryable && onRetryProcessing && (
            <button className="action-button secondary" onClick={onRetryProcessing}>
              Reintentar
            </button>
          )}
          {onNewConsultation && (
            <button className="action-button new-consultation" onClick={onNewConsultation}>
              Nueva Consulta
            </button>
          )}
        </div>
        {!processingError && <p>No hay historia clínica generada aún.</p>}
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
                    logicalCallsUsed={metadata.logicalCallsUsed}
                    physicalCallsUsed={metadata.physicalCallsUsed}
                    fallbackHops={metadata.fallbackHops}
                    providerLabel={generationProviderLabel}
                  />
                )}
                <div className="action-buttons-group">

                  {!isEditing ? (
                    <>
                      {onNewConsultation && (
                        <button
                          className="action-button new-consultation"
                          onClick={onNewConsultation}
                          data-ui-state="idle"
                        >
                          <Plus size={18} />
                          <span>Nueva Consulta</span>
                        </button>
                      )}
                      <button
                        className="action-button secondary"
                        id="edit-mode-btn"
                        onClick={handleEditClick}
                        title="Editar texto"
                        data-ui-state="idle"
                      >
                        <Edit2 size={16} />
                        <span>Editar</span>
                      </button>
                      <button
                        className="action-button secondary"
                        onClick={handleOpenReport}
                        title="Generar informe medico formal"
                        data-ui-state={hasGeneratedReport ? 'success' : 'idle'}
                      >
                        <FileOutput size={16} />
                        <span>Informe</span>
                      </button>
                      <details className="more-actions-menu" ref={moreActionsRef}>
                        <summary className="action-button secondary more-actions-trigger" aria-label="Abrir mas acciones" data-ui-state="idle">
                          <MoreHorizontal size={16} />
                          <span>Mas acciones</span>
                        </summary>
                        <div className="more-actions-popover">
                          {metadata?.extractionMeta && metadata.extractionMeta.length > 0 && (
                            <button
                              className="action-button secondary menu-item"
                              onClick={() => {
                                moreActionsRef.current?.removeAttribute('open');
                                setShowSourcesModal(true);
                              }}
                              title="Ver fuentes"
                              data-ui-state="idle"
                            >
                              <FileText size={16} />
                              <span>Fuentes</span>
                            </button>
                          )}
                          <button
                            className="action-button secondary menu-item"
                            onClick={() => {
                              moreActionsRef.current?.removeAttribute('open');
                              setShowCompareModal(true);
                            }}
                            title="Comparar IA vs editado"
                            data-ui-state="idle"
                          >
                            <FileText size={16} />
                            <span>Comparar</span>
                          </button>
                          <button
                            className="action-button secondary menu-item"
                            onClick={() => {
                              moreActionsRef.current?.removeAttribute('open');
                              setShowVersionsModal(true);
                            }}
                            title="Ver versiones"
                            data-ui-state="idle"
                          >
                            <FileText size={16} />
                            <span>Versiones</span>
                          </button>
                          {onRegenerateSection && (
                            <div className="menu-item section-regen-item">
                              <select
                                className="section-regen-select"
                                value={selectedSection}
                                onChange={(event) => setSelectedSection(event.target.value)}
                              >
                                {sectionHeadings.map((section) => (
                                  <option key={section} value={section}>{section}</option>
                                ))}
                              </select>
                              <button
                                className="action-button secondary menu-item"
                                onClick={() => {
                                  moreActionsRef.current?.removeAttribute('open');
                                  void handleRegenerateSelectedSection();
                                }}
                                disabled={isRegeneratingSection}
                                title="Regenerar solo la seccion seleccionada"
                                data-ui-state={isRegeneratingSection ? 'active' : 'idle'}
                              >
                                <Sparkles size={16} />
                                <span>{isRegeneratingSection ? 'Regenerando...' : 'Regenerar seccion'}</span>
                              </button>
                            </div>
                          )}
                          <button
                            className={`action-button copy-btn menu-item ${copied ? 'success' : ''}`}
                            onClick={() => {
                              moreActionsRef.current?.removeAttribute('open');
                              void handleCopy(historyText);
                            }}
                            data-ui-state={copied ? 'success' : 'idle'}
                          >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                            <span>{copied ? 'Copiado' : 'Copiar'}</span>
                          </button>
                        </div>
                      </details>
                      <button
                        className={`action-button primary ${hasFinalized ? 'success' : ''}`}
                        onClick={() => {
                          setHasFinalized(true);
                          if (doctorScoreEnabled && metadata?.qualityScore) {
                            const score10 = Math.max(1, Math.min(10, Math.round(metadata.qualityScore / 10)));
                            void handleDoctorScore(score10);
                          }
                        }}
                        title="Finalizar historia"
                        id="finalize-btn"
                        data-ui-state={hasFinalized ? 'success' : 'idle'}
                      >
                        <Check size={16} />
                        <span>{hasFinalized ? 'Finalizado' : 'Finalizar'}</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="action-button secondary" onClick={handleCancelEdit} data-ui-state="idle">
                        <X size={16} />
                        <span>Cancelar</span>
                      </button>
                      <button className="action-button primary success" id="save-edit-btn" onClick={handleSaveEdit} data-ui-state="success">
                        <Check size={16} />
                        <span>Guardar</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="workflow-bar">
              <div className="workflow-steps">
                {steps.map((step, idx) => (
                  <div key={step.key} className={`workflow-step ${step.completed ? 'done' : ''}`}>
                    <span className="step-index">{idx + 1}</span>
                    <span className="step-label">{step.label}</span>
                  </div>
                ))}
              </div>
              <div className={`sync-status ${isOnline ? 'online' : 'offline'}`} data-ui-state={isOnline ? 'online' : 'offline'}>
                <span>{isOnline ? 'Online' : 'Sin conexión'}</span>
                {isEditing && (
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={`${autosaveUiState}-${autosaveLabel}`}
                      className="sync-detail"
                      data-ui-state={autosaveUiState}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -2 }}
                      transition={motionTransitions.fast}
                    >
                      {autosaveLabel}
                    </motion.span>
                  </AnimatePresence>
                )}
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

            {metadata?.resultStatus === 'provisional' && (
              <div className="provisional-review-banner" role="alert" aria-live="polite">
                <AlertTriangle size={16} />
                <span>
                  Revision obligatoria antes de finalizar.
                  {metadata.provisionalReason ? ` Motivo: ${metadata.provisionalReason.replace(/_/g, ' ')}` : ''}
                </span>
              </div>
            )}
            {processingError && (
              <div className="provisional-review-banner" role="alert" aria-live="assertive">
                <AlertTriangle size={16} />
                <span>
                  Error de procesamiento ({processingError.code}): {processingError.message}
                </span>
                {processingError.retryable && onRetryProcessing && (
                  <button className="action-button secondary" onClick={onRetryProcessing}>
                    Reintentar
                  </button>
                )}
              </div>
            )}

            {(metadata?.qualityScore || topDoctorActions.length > 0 || (metadata?.criticalGaps?.length || 0) > 0) && (
              <div className="quality-triage-panel">
                <div className="quality-triage-header">
                  <span className="quality-title">Acciones recomendadas</span>
                  {typeof metadata?.qualityScore === 'number' && (
                    <span className="quality-score">Calidad: {metadata.qualityScore}/100</span>
                  )}
                </div>
                {topDoctorActions.length > 0 && (
                  <ul className="quality-actions-list">
                    {topDoctorActions.map((action, index) => (
                      <li key={`${action}-${index}`}>{action}</li>
                    ))}
                  </ul>
                )}
                {(metadata?.criticalGaps?.length || 0) > 0 && (
                  <div className="critical-gaps-row">
                    {(metadata?.criticalGaps || []).slice(0, 3).map((gap, index) => (
                      <span key={`${gap.field}-${index}`} className={`gap-chip ${gap.severity}`}>
                        {gap.severity}: {gap.field.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="document-content markdown-body">
              {isEditing ? (
                <>
                  <textarea
                    ref={editTextareaRef}
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

                  <div className="command-bar">
                    <span>Comandos rápidos:</span>
                    {quickCommands.map((command) => (
                      <button
                        key={command}
                        type="button"
                        className="command-chip"
                        onClick={() => handleCommandInsert(command)}
                      >
                        {command}
                      </button>
                    ))}
                  </div>

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
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p>{highlightChildren(children)}</p>,
                    li: ({ children }) => <li>{highlightChildren(children)}</li>,
                    h1: ({ children }) => <h1>{highlightChildren(children)}</h1>,
                    h2: ({ children }) => <h2>{highlightChildren(children)}</h2>,
                    h3: ({ children }) => <h3>{highlightChildren(children)}</h3>,
                    h4: ({ children }) => <h4>{highlightChildren(children)}</h4>,
                    strong: ({ children }) => <strong>{highlightChildren(children)}</strong>,
                    em: ({ children }) => <em>{highlightChildren(children)}</em>
                  }}
                >
                  {historyText}
                </ReactMarkdown>
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
                  <span>Revisión recomendada</span>
                </div>
                <p className="uncertainty-intro">
                  La IA no encontró en la transcripción evidencia directa de los siguientes datos. Por favor, confirma si son correctos o corrígelos.
                </p>
                {uncertaintyBySection.length > 0 && (
                  <div className="uncertainty-bulk-actions">
                    {uncertaintyBySection.map(([section, flags]) => (
                      <button
                        key={section}
                        type="button"
                        className="flag-action ghost"
                        onClick={() => void handleConfirmSection(section)}
                      >
                        Confirmar todo {section} ({flags.length})
                      </button>
                    ))}
                  </div>
                )}
                <ul className="uncertainty-list">
                  {metadata.uncertaintyFlags.map((flag, i) => {
                    const decision = flagDecisions[flag.field_path];
                    // Humanize field path
                    const fieldLabel = flag.field_path.replace(/_/g, ' ').replace(/\./g, ' → ');
                    return (
                      <li key={`${flag.field_path}-${i}`} className="uncertainty-item">
                        <div className="uncertainty-details">
                          <strong>{fieldLabel}</strong>
                          {flag.value && <span className="uncertainty-value">"{flag.value}"</span>}
                          <span className="uncertainty-reason">⚠ {flag.reason}</span>
                        </div>
                        <div className="uncertainty-actions">
                          <button
                            className="flag-action ghost"
                            type="button"
                            onClick={() => openEvidence(flag.field_path)}
                          >
                            Ver evidencia
                          </button>
                          <button
                            className="flag-action confirm"
                            disabled={Boolean(decision)}
                            onClick={() => handleFlagDecision(flag, true)}
                          >
                            {decision === 'confirmed' ? '✓ Correcto' : 'Es correcto'}
                          </button>
                          <button
                            className="flag-action reject"
                            disabled={Boolean(decision)}
                            onClick={() => handleFlagDecision(flag, false)}
                          >
                            {decision === 'rejected' ? '✗ A corregir' : 'Necesita corrección'}
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
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p>{highlightChildren(children)}</p>,
                    li: ({ children }) => <li>{highlightChildren(children)}</li>,
                    strong: ({ children }) => <strong>{highlightChildren(children)}</strong>,
                    em: ({ children }) => <em>{highlightChildren(children)}</em>
                  }}
                >
                  {mariaNotes}
                </ReactMarkdown>
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
            variants={modalOverlayVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            <motion.div
              className="modal-content"
              variants={modalContentVariants}
              initial="initial"
              animate="enter"
              exit="exit"
            >
              <div className="modal-header">
                <h3>Informe Médico Formal</h3>
                <button className="close-btn" onClick={() => setShowReportModal(false)} aria-label="Cerrar informe">
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
                    <button className="action-button primary" onClick={() => void handleCopy(reportContent)}>
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
            variants={modalOverlayVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            <motion.div
              className="modal-content sources-modal"
              variants={modalContentVariants}
              initial="initial"
              animate="enter"
              exit="exit"
            >
              <div className="modal-header">
                <h3>Fuentes y evidencia</h3>
                <button className="close-btn" onClick={() => setShowSourcesModal(false)} aria-label="Cerrar fuentes">
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

      {/* Evidence Modal */}
      <AnimatePresence>
        {showEvidenceModal && (
          <motion.div
            className="modal-overlay"
            variants={modalOverlayVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            <motion.div
              className="modal-content evidence-modal"
              variants={modalContentVariants}
              initial="initial"
              animate="enter"
              exit="exit"
            >
              <div className="modal-header">
                <h3>Evidencia guiada</h3>
                <button className="close-btn" onClick={() => setShowEvidenceModal(false)} aria-label="Cerrar evidencia">
                  <X size={20} />
                </button>
              </div>

              <div className="modal-body evidence-body">
                {selectedEvidenceField ? (
                  <>
                    <p className="modal-subtitle">{selectedEvidenceField.replace(/_/g, ' → ')}</p>
                    {selectedEvidenceEntries.length === 0 ? (
                      <p className="empty-message">No hay evidencia asociada a este campo.</p>
                    ) : (
                      selectedEvidenceEntries.map((entry, idx) => (
                        <div key={`${entry.chunk_id}-${idx}`} className="evidence-entry">
                          <div className="evidence-meta">
                            <span className="source-label">Chunk:</span>
                            <span>{entry.chunk_id}</span>
                            <span className="source-label">Valor:</span>
                            <span>{entry.value || '—'}</span>
                          </div>
                          <p className="source-snippet">
                            {entry.evidence_snippet || 'Sin fragmento literal disponible.'}
                          </p>
                        </div>
                      ))
                    )}
                    {selectedUncertaintyFlag && (
                      <div className="modal-actions">
                        <button
                          className="flag-action confirm"
                          id="evidence-modal-confirm-btn"
                          type="button"
                          onClick={() => {
                            handleFlagDecision(selectedUncertaintyFlag, true);
                            setShowEvidenceModal(false);
                          }}
                        >
                          Confirmar como correcto
                        </button>
                        <button
                          className="flag-action reject"
                          type="button"
                          onClick={() => {
                            handleFlagDecision(selectedUncertaintyFlag, false);
                            setShowEvidenceModal(false);
                          }}
                        >
                          Marcar corrección
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p>Selecciona un campo en revisión para ver la evidencia correspondiente.</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compare Modal */}
      <AnimatePresence>
        {showCompareModal && (
          <motion.div
            className="modal-overlay"
            variants={modalOverlayVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            <motion.div
              className="modal-content compare-modal"
              variants={modalContentVariants}
              initial="initial"
              animate="enter"
              exit="exit"
            >
              <div className="modal-header">
                <h3>Comparar IA vs editado</h3>
                <button className="close-btn" onClick={() => setShowCompareModal(false)} aria-label="Cerrar comparativa">
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body compare-body">
                <div className="compare-grid">
                  <div className="compare-column">
                    <h4>IA original</h4>
                    <textarea
                      readOnly
                      className="compare-textarea"
                      value={aiBaseline || ''}
                    />
                  </div>
                  <div className="compare-column">
                    <h4>Versión actual</h4>
                    <textarea
                      readOnly
                      className="compare-textarea"
                      value={historyText}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="action-button primary"
                  onClick={() => {
                    setEditValue(aiBaseline);
                    setIsEditing(true);
                    setHasEdited(true);
                    setShowCompareModal(false);
                  }}
                >
                  Cargar versión IA
                </button>
                <button className="action-button secondary" onClick={() => setShowCompareModal(false)}>
                  Cerrar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Versions Modal */}
      <AnimatePresence>
        {showVersionsModal && (
          <motion.div
            className="modal-overlay"
            variants={modalOverlayVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            <motion.div
              className="modal-content versions-modal"
              variants={modalContentVariants}
              initial="initial"
              animate="enter"
              exit="exit"
            >
              <div className="modal-header">
                <h3>Versiones guardadas</h3>
                <button className="close-btn" onClick={() => setShowVersionsModal(false)} aria-label="Cerrar versiones">
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body versions-body">
                {versions.length === 0 ? (
                  <p>No hay versiones guardadas aún.</p>
                ) : (
                  <ul className="versions-list">
                    {versions.map((version) => (
                      <li key={version.id} className="versions-item">
                        <div className="versions-meta">
                          <strong>{version.label}</strong>
                          <span>{`${version.source.toUpperCase()} · ${version.createdAt.toLocaleString()}`}</span>
                        </div>
                        <div className="versions-actions">
                          <button className="action-button secondary" onClick={() => handleLoadVersion(version)}>
                            Abrir
                          </button>
                          <button
                            className="action-button primary"
                            onClick={() => void safeCopyToClipboard(version.content)}
                          >
                            Copiar
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .history-view-container {
          height: 100%;
          width: 100%;
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
          border: 1px solid var(--glass-border);
          position: relative;
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
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

        .provisional-review-banner {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin: 0.75rem 2rem 0;
          padding: 0.7rem 0.9rem;
          border: 1px solid #fdba74;
          background: #fff7ed;
          color: #9a3412;
          border-radius: 10px;
          font-size: 0.86rem;
          font-weight: 600;
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

        .history-view-container .action-buttons-group {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }

        .history-view-container .action-button {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.6rem 1.2rem;
          border-radius: 12px;
          border: none;
          font-size: 0.95rem;
          font-weight: 500;
          cursor: pointer;
          transition: background-color var(--motion-duration-fast) var(--motion-ease-base),
            border-color var(--motion-duration-fast) var(--motion-ease-base),
            color var(--motion-duration-fast) var(--motion-ease-base),
            transform var(--motion-duration-fast) var(--motion-ease-base),
            box-shadow var(--motion-duration-fast) var(--motion-ease-base),
            opacity var(--motion-duration-fast) var(--motion-ease-base);
        }

        .history-view-container .action-button:hover {
          transform: translateY(-1px);
        }

        .history-view-container .action-button:active {
          transform: scale(0.98);
        }

        .history-view-container .action-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .history-view-container .action-button.new-consultation {
          background: var(--brand-gradient);
          color: white;
          box-shadow: 0 4px 12px rgba(38, 166, 154, 0.3);
          font-weight: 600;
        }
        
        .history-view-container .action-button.new-consultation:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(38, 166, 154, 0.4);
        }

        .history-view-container .action-button.copy-btn {
          background: white;
          color: var(--text-secondary);
          border: 1px solid var(--glass-border);
          box-shadow: var(--shadow-sm);
        }
        
        .history-view-container .action-button.copy-btn:hover {
          border-color: var(--brand-primary);
          color: var(--brand-primary);
          background: #f0fdfa;
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .history-view-container .action-button.primary {
          background: var(--bg-secondary);
          color: var(--text-primary);
          border: 1px solid var(--glass-border);
        }

        .history-view-container .action-button.primary:hover {
          background: var(--bg-tertiary);
        }

        .history-view-container .action-button.secondary {
          background: transparent;
          color: var(--brand-primary);
          border: 1px solid var(--brand-primary);
        }
        
        .history-view-container .action-button.secondary:hover {
          background: rgba(38, 166, 154, 0.05);
        }

        .history-view-container .action-button.success {
          background: #10b981;
          color: white;
        }

        .more-actions-menu {
          position: relative;
        }

        .more-actions-trigger {
          list-style: none;
          user-select: none;
          cursor: pointer;
        }

        .more-actions-trigger::-webkit-details-marker {
          display: none;
        }

        .more-actions-trigger:focus-visible {
          box-shadow: var(--focus-ring);
        }

        .more-actions-popover {
          position: absolute;
          right: 0;
          top: calc(100% + 0.35rem);
          min-width: 190px;
          border: 1px solid var(--border-soft);
          background: white;
          border-radius: 12px;
          box-shadow: var(--shadow-lg);
          padding: 0.45rem;
          display: grid;
          gap: 0.35rem;
          z-index: 12;
        }

        .menu-item {
          width: 100%;
          justify-content: flex-start;
        }

        .section-regen-item {
          display: grid;
          gap: 0.5rem;
          padding: 0.25rem 0;
        }

        .section-regen-select {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font-size: 0.8rem;
          padding: 0.35rem 0.5rem;
          background: #ffffff;
          color: #0f172a;
        }

        .document-content {
          padding: 2rem;
          font-size: 1rem;
          line-height: 1.7;
          color: var(--text-primary);
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }

        /* Markdown Styles */
        .history-view-container .markdown-body h1, .history-view-container .markdown-body h2, .history-view-container .markdown-body h3 {
          margin-top: 1.5em;
          margin-bottom: 0.75em;
          color: #1e293b;
          font-family: var(--font-sans);
        }
        
        .history-view-container .markdown-body h1 { font-size: 1.5em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
        .history-view-container .markdown-body h2 { font-size: 1.25em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--brand-primary); margin-top: 2em; }
        .history-view-container .markdown-body p { margin-bottom: 1em; }
        .history-view-container .markdown-body ul { padding-left: 1.5em; margin-bottom: 1em; }

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

        .quality-triage-panel {
          margin: 1rem 2rem 0;
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          border-radius: 12px;
          padding: 0.9rem 1rem;
          display: grid;
          gap: 0.65rem;
        }

        .quality-triage-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.75rem;
        }

        .quality-title {
          font-weight: 700;
          color: #1e3a8a;
          font-size: 0.9rem;
        }

        .quality-score {
          font-size: 0.8rem;
          color: #1d4ed8;
          background: #dbeafe;
          border-radius: 999px;
          padding: 4px 10px;
          font-weight: 600;
        }

        .quality-actions-list {
          margin: 0;
          padding-left: 1rem;
          color: #1e3a8a;
          font-size: 0.85rem;
          display: grid;
          gap: 0.35rem;
        }

        .critical-gaps-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .gap-chip {
          font-size: 0.75rem;
          border-radius: 999px;
          padding: 0.3rem 0.55rem;
          border: 1px solid transparent;
          font-weight: 600;
        }

        .gap-chip.critical {
          background: #fee2e2;
          color: #b91c1c;
          border-color: #fecaca;
        }

        .gap-chip.major {
          background: #ffedd5;
          color: #c2410c;
          border-color: #fed7aa;
        }

        .gap-chip.minor {
          background: #fef9c3;
          color: #854d0e;
          border-color: #fde68a;
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

        .uncertainty-intro {
          font-size: 0.9rem;
          color: #92400e;
          margin: 0 0 1rem 0;
          line-height: 1.5;
        }

        .uncertainty-value {
          font-weight: 600;
          color: #c2410c;
          background: #ffedd5;
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 0.85rem;
        }

        .uncertainty-reason {
          font-size: 0.8rem;
          color: #9a3412;
          font-style: italic;
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

        .uncertainty-bulk-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
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
        .history-view-container .modal-overlay {
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
          transition: opacity var(--motion-duration-fast) var(--motion-ease-base);
        }

        .history-view-container .modal-content {
          background: white;
          width: 90%;
          max-width: 800px;
          height: 85vh;
          border-radius: 20px;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-lg);
          transform-origin: center top;
        }

        .history-view-container .modal-header {
          padding: 1.5rem;
          border-bottom: 1px solid var(--glass-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .history-view-container .modal-header h3 {
          margin: 0;
          font-family: var(--font-display);
          color: var(--text-primary);
        }

        .history-view-container .close-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
        }

        .history-view-container .modal-body {
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

        .history-view-container .modal-footer {
          padding: 1.5rem;
          border-top: 1px solid var(--glass-border);
          display: flex;
          justify-content: flex-end;
          gap: 1rem;
        }

        .history-view-container .modal-content.evidence-modal,
        .history-view-container .modal-content.compare-modal,
        .history-view-container .modal-content.versions-modal {
          max-width: 880px;
        }

        .history-view-container .modal-body.evidence-body,
        .history-view-container .modal-body.versions-body {
          max-height: 60vh;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .modal-subtitle {
          font-size: 0.85rem;
          color: #475569;
          margin-bottom: 0.25rem;
        }

        .evidence-entry {
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          padding: 0.75rem;
          background: #f8fafc;
        }

        .evidence-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: #475569;
          margin-bottom: 0.5rem;
        }

        .source-label {
          font-weight: 600;
          color: #0f172a;
        }

        .compare-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1rem;
        }

        .compare-column h4 {
          margin-top: 0;
          margin-bottom: 0.5rem;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #0f172a;
        }

        .compare-textarea {
          width: 100%;
          min-height: 220px;
          border-radius: 12px;
          border: 1px solid #cbd5f5;
          padding: 1rem;
          font-family: 'Georgia', serif;
          font-size: 1rem;
          line-height: 1.6;
          background: #f8fafc;
          resize: none;
        }

        .versions-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .versions-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
          background: #fff;
        }

        .versions-meta {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .versions-meta span {
          font-size: 0.8rem;
          color: #64748b;
        }

        .versions-actions {
          display: flex;
          gap: 0.5rem;
        }

        .command-bar {
          margin-top: 0.75rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          font-size: 0.85rem;
          color: #475569;
        }

        .command-chip {
          border: 1px solid #bae6fd;
          background: #e0f2fe;
          color: #0f172a;
          padding: 0.35rem 0.9rem;
          border-radius: 999px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .command-chip:hover {
          transform: translateY(-1px);
          box-shadow: 0 3px 8px rgba(15, 118, 110, 0.2);
        }

        .workflow-bar {
          margin-top: 1rem;
          padding: 0 2rem 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }

        .workflow-steps {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .workflow-step {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.35rem 0.75rem;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          font-size: 0.75rem;
          color: #475569;
          transition: border-color var(--motion-duration-fast) var(--motion-ease-base),
          background-color var(--motion-duration-fast) var(--motion-ease-base),
          color var(--motion-duration-fast) var(--motion-ease-base);
        }

        .workflow-step.done {
          background: #dcfce7;
          border-color: #86efac;
          color: #15803d;
        }

        .sync-status {
          display: flex;
          flex-direction: column;
          font-size: 0.75rem;
          color: #64748b;
          text-align: right;
          transition: color var(--motion-duration-fast) var(--motion-ease-base);
        }

        .sync-status.online span:first-child {
          color: #15803d;
        }

        .sync-status.offline span:first-child {
          color: #dc2626;
        }

        .sync-detail {
          font-size: 0.7rem;
          color: #475569;
          transition: color var(--motion-duration-fast) var(--motion-ease-base),
          opacity var(--motion-duration-fast) var(--motion-ease-base);
        }

        .sync-detail[data-ui-state="active"] {
          color: #0f766e;
        }

        .sync-detail[data-ui-state="success"] {
          color: #15803d;
        }

        .uncertainty-highlight {
          background: #fef3c7;
          border: 1px dashed #f59e0b;
          color: #92400e;
          padding: 0 4px;
          border-radius: 4px;
          font-weight: 600;
          cursor: pointer;
        }

        .uncertainty-highlight:hover {
          background: #fef08a;
        }

        .flag-action.ghost {
          border: 1px solid #cbd5f5;
          background: #f8fafc;
          color: #0f172a;
        }

        .history-view-container .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 1rem;
          color: var(--text-secondary);
        }

        .history-view-container .spinner {
          width: 30px;
          height: 30px;
          border: 3px solid var(--bg-tertiary);
          border-top-color: var(--brand-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {transform: rotate(360deg); }
        }

        /* Markdown Styles for Medical Report */
        .history-view-container .markdown-body {
          color: #334155;
          line-height: 1.7;
          font-size: 1rem;
        }

        .history-view-container .markdown-body h2 {
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

        .history-view-container .markdown-body h3 {
          font-size: 1rem;
          font-weight: 600;
          color: #475569;
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
        }

        .history-view-container .markdown-body p {
          margin-bottom: 1rem;
          text-align: justify;
        }

        .history-view-container .markdown-body ul {
          list-style-type: none; /* Removed bullets for clean "Form" look */
          padding-left: 0;       /* Align with headers */
          margin-bottom: 1rem;
        }

        .history-view-container .markdown-body li {
          margin-bottom: 0.5rem;
          border-bottom: 1px dashed #f1f5f9; /* Subtle separator line */
          padding-bottom: 0.25rem;
        }

        .history-view-container .markdown-body li:last-child {
          border-bottom: none;
        }

        .history-view-container .markdown-body strong {
          color: #1e293b;
          font-weight: 600;
        }

        @media (max-width: 1200px) {
          .history-layout {
            gap: 1rem;
            max-width: 100%;
          }

          .history-view-container .action-buttons-group {
            gap: 0.4rem;
            flex-wrap: wrap;
            justify-content: flex-end;
          }

          .history-view-container .action-button {
            padding: 0.5rem 0.85rem;
            font-size: 0.85rem;
          }
        }

        @media (max-width: 1024px) {
          .history-layout {
            flex-direction: column;
          }

          .notes-column {
            min-width: 0;
            width: 100%;
            position: static;
          }

          .history-view-container .document-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.8rem;
          }

          .history-view-container .action-buttons-group {
            width: 100%;
            justify-content: flex-start;
          }

          .document-content {
            padding: 1.25rem;
          }

          .workflow-bar {
            padding: 0 1.25rem 1rem;
            flex-direction: column;
            align-items: flex-start;
          }

          .classification-banner {
            padding: 0.75rem 1.25rem;
            flex-wrap: wrap;
          }

          .uncertainty-item {
            flex-direction: column;
            align-items: flex-start;
          }

          .more-actions-popover {
            left: 0;
            right: auto;
          }
        }
      `}</style>
    </div>
  );
};

export default HistoryView;



