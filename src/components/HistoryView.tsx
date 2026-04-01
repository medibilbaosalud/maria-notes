import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, FileText, Sparkles, FileOutput, X, Printer, Plus, AlertTriangle, Edit2, Brain, Wand2, ThumbsDown, MoreHorizontal, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { MBSLogo } from './MBSLogo';
import { AIAuditWidget } from './AIAuditWidget';
import { processDoctorFeedbackV2 } from '../services/doctor-feedback';
import type { ExtractionMeta, ConsultationClassification, UncertaintyFlag, FieldEvidence } from '../services/groq';
import {
  saveFieldConfirmation,
  logQualityEvent,
  saveDoctorSatisfactionEvent,
  saveClinicalGenerationDiagnosticEdit,
  upsertClinicalGenerationDiagnostic
} from '../services/supabase';
import { evaluateAndPersistRuleImpactV2 } from '../services/learning/rule-evaluator';
import { motionTransitions } from '../features/ui/motion-tokens';
import { safeCopyToClipboard } from '../utils/safeBrowser';
import { downloadRecordAsJson } from '../utils/export';
import type { PipelineUiError } from '../types/pipeline';
import type { ClinicalSpecialtyId } from '../clinical/specialties';
import { getClinicalSpecialtyConfig } from '../clinical/specialties';
import { buildPrintableDocument } from '../utils/printTemplates';
import './HistoryView.css';

interface HistoryViewProps {
  content: string;
  isLoading: boolean;
  patientName?: string;
  specialty?: ClinicalSpecialtyId;
  clinicianProfile?: string;
  clinicianName?: string;
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
  sessionId?: string;
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

const detectSectionDeltaCount = (beforeText: string, afterText: string): number => {
  const sectionRegex = /^##\s+(.+)$/gim;
  const parse = (value: string) => {
    const sections = new Map<string, string>();
    const lines = String(value || '').split('\n');
    let current = 'HEADER';
    let buffer: string[] = [];
    const flush = () => {
      sections.set(current, buffer.join('\n').trim());
      buffer = [];
    };
    for (const line of lines) {
      const match = line.trim().match(/^##\s+(.+)$/);
      if (match) {
        flush();
        current = match[1].trim().toUpperCase();
        continue;
      }
      buffer.push(line);
    }
    flush();
    return sections;
  };
  void sectionRegex;
  const before = parse(beforeText);
  const after = parse(afterText);
  const keys = new Set([...before.keys(), ...after.keys()]);
  let changes = 0;
  keys.forEach((key) => {
    if ((before.get(key) || '') !== (after.get(key) || '')) changes += 1;
  });
  return changes;
};

const mapDoctorReasonToEditType = (
  reason: 'terminologia' | 'omision' | 'error_clinico' | 'redaccion' | 'formato' | 'otro' | '',
  beforeText: string,
  afterText: string
): 'added' | 'removed' | 'rewritten' | 'terminology' | 'style' | 'formatting' | 'clinical_precision' | 'omission' => {
  if (reason === 'terminologia') return 'terminology';
  if (reason === 'omision') return 'omission';
  if (reason === 'error_clinico') return 'clinical_precision';
  if (reason === 'redaccion') return 'style';
  if (reason === 'formato') return 'formatting';
  if (!beforeText.trim() && afterText.trim()) return 'added';
  if (beforeText.trim() && !afterText.trim()) return 'removed';
  return 'rewritten';
};

const estimateEditImportance = (beforeText: string, afterText: string): 'low' | 'medium' | 'high' => {
  const delta = Math.abs((afterText || '').length - (beforeText || '').length);
  const sectionDelta = detectSectionDeltaCount(beforeText, afterText);
  if (delta >= 180 || sectionDelta >= 3) return 'high';
  if (delta >= 40 || sectionDelta >= 1) return 'medium';
  return 'low';
};

const LOADING_STEPS = [
  { label: "Audio", messages: ["Analizando audio...", "Identificando hablantes..."] },
  { label: "Transcripción", messages: ["Transcribiendo consulta...", "Detectando síntomas..."] },
  { label: "Estructura", messages: ["Estructurando historia clínica..."] },
  { label: "Redacción", messages: ["Redactando informe preliminar...", "Finalizando..."] },
];

const LoadingMessages = () => {
  const allMessages = LOADING_STEPS.flatMap(s => s.messages);
  const [index, setIndex] = useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % allMessages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  // Determine which step we're on
  let stepIdx = 0;
  let count = 0;
  for (let i = 0; i < LOADING_STEPS.length; i++) {
    count += LOADING_STEPS[i].messages.length;
    if (index < count) { stepIdx = i; break; }
  }
  const progress = Math.round(((index + 1) / allMessages.length) * 100);

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
            {allMessages[index]}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="loading-progress-wrapper">
        <div className="loading-progress-track">
          <motion.div
            className="loading-progress-bar"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
          />
        </div>
        <div className="loading-step-indicators">
          {LOADING_STEPS.map((step, i) => (
            <span key={i} className={`loading-step ${i === stepIdx ? 'active' : ''} ${i < stepIdx ? 'done' : ''}`}>
              <span className="step-index">{i < stepIdx ? '✓' : i + 1}</span>
              <span className="step-label">{step.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};

export const HistoryView: React.FC<HistoryViewProps> = ({
  content,
  isLoading,
  patientName,
  specialty = 'otorrino',
  clinicianProfile,
  clinicianName,
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
  sessionId,
  onPersistMedicalHistory,
  onRegenerateSection
}) => {
  const doctorScoreEnabled = String(import.meta.env.VITE_DOCTOR_SCORE_ENABLED || 'true').toLowerCase() === 'true';
  const specialtyConfig = getClinicalSpecialtyConfig(specialty);
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
  const [doctorFeedbackScore, setDoctorFeedbackScore] = useState<number | null>(null);
  const [doctorFeedbackText, setDoctorFeedbackText] = useState('');
  const [doctorFeedbackSubmitting, setDoctorFeedbackSubmitting] = useState(false);
  const [doctorFeedbackSubmitted, setDoctorFeedbackSubmitted] = useState(false);
  const [doctorFeedbackDismissed, setDoctorFeedbackDismissed] = useState(false);
  const [doctorFeedbackError, setDoctorFeedbackError] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string>('ENFERMEDAD ACTUAL');
  const [doctorReasonCode, setDoctorReasonCode] = useState<'terminologia' | 'omision' | 'error_clinico' | 'redaccion' | 'formato' | 'otro' | ''>('');
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const moreActionsRef = useRef<HTMLDetailsElement | null>(null);
  const quickCommands = ['Niega', 'Sin cambios', 'Sin hallazgos relevantes'];

  const originalHistoryRef = useRef<string>('');
  const lastSavedValueRef = useRef<string>('');
  const lastRecordIdRef = useRef<string | null>(null);
  const diagnosticIdRef = useRef<string | null>(null);
  const lastDiagnosticSnapshotRef = useRef<string>('');

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
  const isSignificantHistoryEdit = useMemo(() => {
    if (!isEditing) return false;
    const baseline = (originalHistoryRef.current || historyText || '').trim();
    const current = (editValue || '').trim();
    if (!baseline || !current || baseline === current) return false;
    const delta = Math.abs(current.length - baseline.length);
    const sectionDelta = detectSectionDeltaCount(baseline, current);
    return delta >= 24 || sectionDelta >= 2;
  }, [editValue, historyText, isEditing]);
  const feedbackAnchorId = `${metadata?.auditId || 'no-audit'}:${recordId || 'no-record'}:${specialty}:${clinicianProfile || 'default'}`;
  const showDoctorFeedbackWidget = doctorScoreEnabled
    && !isLoading
    && Boolean(metadata?.auditId || recordId)
    && !doctorFeedbackSubmitted
    && !doctorFeedbackDismissed;

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
      setDoctorFeedbackScore(null);
      setDoctorFeedbackText('');
      setDoctorFeedbackSubmitted(false);
      setDoctorFeedbackDismissed(false);
      setDoctorFeedbackError(null);
      diagnosticIdRef.current = null;
      lastDiagnosticSnapshotRef.current = '';
    }
  }, [recordId, historyText]);

  useEffect(() => {
    setDoctorFeedbackScore(null);
    setDoctorFeedbackText('');
    setDoctorFeedbackSubmitted(false);
    setDoctorFeedbackDismissed(false);
    setDoctorFeedbackError(null);
  }, [feedbackAnchorId]);

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
      record_id: recordId,
      field_path: flag.field_path,
      suggested_value: flag.value,
      confirmed
    });

    await logQualityEvent({
      record_id: recordId,
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

  const handleDoctorFeedbackSubmit = async () => {
    if (!doctorFeedbackScore || doctorFeedbackSubmitting) return;
    setDoctorFeedbackSubmitting(true);
    setDoctorFeedbackError(null);
    try {
      await saveDoctorSatisfactionEvent({
        score: doctorFeedbackScore,
        record_id: recordId,
        audit_id: metadata?.auditId,
        session_id: sessionId,
        specialty,
        clinician_profile: clinicianProfile || undefined,
        artifact_type: 'medical_history',
        feedback_stage: 'generated',
        feedback_text: doctorFeedbackText.trim() || undefined,
        context: {
          quality_score: metadata?.qualityScore || null,
          uncertainty_flags: metadata?.uncertaintyFlags?.length || 0,
          result_status: metadata?.resultStatus || null,
          logical_calls_used: metadata?.logicalCallsUsed || null,
          physical_calls_used: metadata?.physicalCallsUsed || null,
          fallback_hops: metadata?.fallbackHops || 0
        }
      });
      await syncDiagnosticSnapshot(historyText, {
        reviewStatus: hasEdited ? 'reviewed' : 'pending',
        doctorFeedbackText: doctorFeedbackText.trim() || undefined,
        doctorScore: doctorFeedbackScore
      });
      setDoctorFeedbackSubmitted(true);
    } catch (error) {
      setDoctorFeedbackError((error as Error)?.message || 'No se pudo guardar la valoración');
    } finally {
      setDoctorFeedbackSubmitting(false);
    }
  };

  const handleEditClick = () => {
    setEditValue(historyText);
    setDoctorReasonCode('');
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

  const syncDiagnosticSnapshot = useCallback(async (
    doctorFinalText: string,
    options?: {
      reviewStatus?: 'pending' | 'reviewed' | 'audited' | 'locked';
      doctorFeedbackText?: string;
      doctorScore?: number | null;
    }
  ) => {
    const aiDraftText = (originalHistoryRef.current || historyText || '').trim();
    const finalText = (doctorFinalText || '').trim();
    const transcriptionText = (transcription || '').trim();
    const dedupeKey = `${metadata?.auditId || sessionId || recordId || patientName || 'history'}:medical_history:${clinicianProfile || 'default'}`;
    if (!dedupeKey || (!aiDraftText && !finalText && !transcriptionText)) return;

    const snapshotSignature = JSON.stringify({
      dedupeKey,
      aiDraftText,
      finalText,
      transcriptionText,
      reviewStatus: options?.reviewStatus || 'pending',
      doctorFeedbackText: options?.doctorFeedbackText || '',
      doctorScore: options?.doctorScore || null,
      auditId: metadata?.auditId || null,
      recordId: recordId || null,
      sessionId: sessionId || null
    });

    if (snapshotSignature === lastDiagnosticSnapshotRef.current) return;

    const diagnosticId = await upsertClinicalGenerationDiagnostic({
      dedupe_key: dedupeKey,
      record_id: recordId,
      audit_id: metadata?.auditId,
      session_id: sessionId,
      specialty,
      clinician_profile: clinicianProfile || undefined,
      artifact_type: 'medical_history',
      patient_name_snapshot: patientName || undefined,
      transcription_text: transcriptionText,
      ai_draft_text: aiDraftText,
      doctor_final_text: finalText || aiDraftText,
      doctor_feedback_text: options?.doctorFeedbackText || undefined,
      doctor_score: options?.doctorScore ?? null,
      review_status: options?.reviewStatus || 'pending',
      model_used: metadata?.models?.generation || null,
      provider_used: generationProviderLabel,
      prompt_version: specialty === 'psicologia'
        ? `psychology-${String(clinicianProfile || 'ainhoa')}-v1`
        : `otorrino-${String(clinicianProfile || 'gotxi')}-v1`,
      rule_pack_version: metadata?.rulePackVersion || null,
      rule_ids_used: metadata?.ruleIdsUsed || [],
      pipeline_status: metadata?.resultStatus || null,
      result_status: metadata?.resultStatus || null,
      quality_score: metadata?.qualityScore ?? null,
      metadata: {
        uncertainty_flags: metadata?.uncertaintyFlags?.length || 0,
        remaining_errors: metadata?.remainingErrors || [],
        critical_gaps: metadata?.criticalGaps || [],
        logical_calls_used: metadata?.logicalCallsUsed || null,
        physical_calls_used: metadata?.physicalCallsUsed || null,
        fallback_hops: metadata?.fallbackHops || 0
      }
    });

    if (diagnosticId) {
      diagnosticIdRef.current = diagnosticId;
      lastDiagnosticSnapshotRef.current = snapshotSignature;
    }
  }, [
    clinicianProfile,
    generationProviderLabel,
    historyText,
    metadata,
    patientName,
    recordId,
    sessionId,
    specialty,
    transcription
  ]);

  useEffect(() => {
    if (isLoading) return;
    if (!historyText.trim()) return;
    void syncDiagnosticSnapshot(historyText, {
      reviewStatus: hasEdited ? 'reviewed' : 'pending'
    });
  }, [hasEdited, historyText, isLoading, syncDiagnosticSnapshot]);

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
          allowAutosaveLearn: true,
          specialty,
          clinicianProfile,
          doctorReasonCode: doctorReasonCode || undefined,
          doctorFeedbackText: doctorFeedbackText.trim() || undefined,
          doctorScore: doctorFeedbackScore
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
              specialty,
              clinicianProfile,
              targetSection: selectedSection,
              doctorReasonCode: doctorReasonCode || undefined,
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
        record_id: recordId,
        event_type: 'doctor_edit',
        payload: {
          length_diff: Math.abs(editValue.length - historyText.length),
          sections_changed: 1
        }
      });
    }

    await persistContent(editValue, { autosave: false });
    const previousSavedText = lastSavedValueRef.current || historyText;
    await syncDiagnosticSnapshot(editValue, {
      reviewStatus: 'reviewed'
    });
    if (diagnosticIdRef.current && previousSavedText.trim() !== editValue.trim()) {
      await saveClinicalGenerationDiagnosticEdit({
        diagnostic_id: diagnosticIdRef.current,
        clinician_profile: clinicianProfile || undefined,
        section_name: selectedSection || null,
        edit_type: mapDoctorReasonToEditType(doctorReasonCode, previousSavedText, editValue),
        importance: estimateEditImportance(previousSavedText, editValue),
        edit_source: 'manual_save',
        before_text: previousSavedText,
        after_text: editValue,
        edit_distance_chars: Math.abs(editValue.length - previousSavedText.length),
        metadata: {
          doctor_reason_code: doctorReasonCode || null,
          record_id: recordId || null,
          audit_id: metadata?.auditId || null,
          clinician_profile: clinicianProfile || null,
          clinician_name: clinicianName || null
        }
      });
    }
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
    setDoctorReasonCode('');
    setIsEditing(false);
  }, [apiKey, clinicianName, clinicianProfile, doctorReasonCode, editValue, historyText, metadata, persistContent, recordId, selectedSection, specialty, transcription]);

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue('');
    setDoctorReasonCode('');
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
      printWindow.document.write(buildPrintableDocument({
        specialty,
        kind: 'report',
        patientName: patientName || 'Paciente',
        content: reportContent,
        pageTitle: specialtyConfig.reportTitle
      }));
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
      const safeFieldId = match.fieldPath.replace(/[^a-zA-Z0-9_-]/g, '-');
      parts.push(
        <button
          key={`${match.fieldPath}-${match.start}-${idx}`}
          id={`uncertainty-highlight-${safeFieldId}-${idx}`}
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
          allowAutosaveLearn: true,
          specialty,
          clinicianProfile
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
            specialty,
            clinicianProfile,
            targetSection: selectedSection,
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
        const previousSavedText = lastSavedValueRef.current || historyText;
        await syncDiagnosticSnapshot(editValue, {
          reviewStatus: 'reviewed'
        });
        if (diagnosticIdRef.current && previousSavedText.trim() !== editValue.trim()) {
          await saveClinicalGenerationDiagnosticEdit({
            diagnostic_id: diagnosticIdRef.current,
            clinician_profile: clinicianProfile || undefined,
            section_name: selectedSection || null,
            edit_type: mapDoctorReasonToEditType('', previousSavedText, editValue),
            importance: estimateEditImportance(previousSavedText, editValue),
            edit_source: 'autosave',
            before_text: previousSavedText,
            after_text: editValue,
            edit_distance_chars: Math.abs(editValue.length - previousSavedText.length),
            metadata: {
              record_id: recordId || null,
              audit_id: metadata?.auditId || null,
              clinician_profile: clinicianProfile || null,
              clinician_name: clinicianName || null
            }
          });
        }
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
  }, [apiKey, clinicianName, clinicianProfile, editValue, historyText, isEditing, metadata, persistContent, recordId, selectedSection, specialty, transcription]);

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
    setDoctorReasonCode('');
    setIsEditing(true);
    setHasEdited(true);
    setShowVersionsModal(false);
  };

  if (isLoading) {
    return <LoadingMessages />;
  }

  if (!content) {
    return (
      <div className="history-view-container">
        <motion.div
          className="empty-state"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        >
          {processingError ? (
            <>
              <div className="empty-icon-wrap empty-icon-wrap--error">
                <AlertTriangle size={32} strokeWidth={1.5} />
              </div>
              <p>{processingError.message || 'No se pudo completar el procesamiento.'}</p>
              <p className="empty-hint">Código: {processingError.code}</p>
            </>
          ) : (
            <>
              <div className="empty-icon-wrap">
                <Sparkles size={28} strokeWidth={1.5} />
              </div>
              <p>Aún no hay historia para esta consulta</p>
              <p className="empty-hint">Graba la sesión y la historia clínica se generará automáticamente</p>
            </>
          )}
          <div className="doc-actions" style={{ marginTop: '0.75rem' }}>
            {processingError?.retryable && onRetryProcessing && (
              <button className="action-button secondary" onClick={onRetryProcessing}>
                Reintentar
              </button>
            )}
            {onNewConsultation && (
              <button className="action-button new-consultation" onClick={onNewConsultation}>
                <Plus size={18} />
                Nueva Consulta
              </button>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="history-view-container">
      <div className="history-layout">
        {/* Main Document Column */}
        <div className="document-column">
          <motion.div
            className={`document-card${hasFinalized ? ' verified-lift' : ''}`}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="document-header">
              <div className="doc-title">
                <FileText size={20} className="doc-icon" />
                <span>Historia Clínica</span>
                {typeof metadata?.qualityScore === 'number' && (
                  <div
                    className="confidence-meter"
                    data-level={metadata.qualityScore >= 80 ? 'high' : metadata.qualityScore >= 50 ? 'medium' : 'low'}
                    title={`Confianza IA: ${metadata.qualityScore}/100`}
                  >
                    <span className="confidence-meter-fill" style={{ width: `${metadata.qualityScore}%` }} />
                    <span className="confidence-meter-label">{metadata.qualityScore}%</span>
                  </div>
                )}
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
                            className="action-button secondary menu-item"
                            onClick={() => {
                              moreActionsRef.current?.removeAttribute('open');
                              downloadRecordAsJson({
                                patientName: patientName,
                                content: historyText,
                                metadata: metadata,
                                date: new Date().toISOString()
                              });
                              setHasExported(true);
                            }}
                            title="Descargar copia JSON (Plan B)"
                            data-ui-state="idle"
                          >
                            <Download size={16} />
                            <span>Descargar copia local</span>
                          </button>
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
                <div>
                  <span>
                    Revisión obligatoria antes de finalizar.
                    {metadata.provisionalReason ? ` ${({
                      'high_risk_detected_requires_manual_review': 'Se han detectado datos de alto riesgo clínico.',
                      'quality_gate_blocked': 'No superó el control de calidad automático.',
                    } as Record<string, string>)[metadata.provisionalReason] || metadata.provisionalReason.replace(/_/g, ' ') + '.'}` : ''}
                  </span>
                  {(metadata.criticalGaps?.length || 0) > 0 && (
                    <div className="provisional-gaps-chips">
                      {metadata.criticalGaps!.slice(0, 4).map((gap, i) => (
                        <span key={i} className="provisional-gap-chip">{gap.field}: {gap.reason}</span>
                      ))}
                    </div>
                  )}
                </div>
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
                  />
                  {isSignificantHistoryEdit && (
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

            {showDoctorFeedbackWidget && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                id="feedback-card"
                className="doctor-feedback-card"
              >
                <div className="feedback-header">
                  <div className="brain-icon-wrapper">
                    <Brain size={18} />
                  </div>
                  <div className="feedback-title">
                    <h4>Valora esta historia</h4>
                    <p>Tu feedback se guarda como señal interna para {specialty === 'psicologia' ? 'Psicología' : 'Otorrino'}.</p>
                  </div>
                </div>
                <div className="feedback-content">
                  <div className="improvement-preview">
                    <Wand2 size={18} className="improvement-icon" />
                    <span>Puntúa el borrador del 1 al 10 y añade un comentario solo si aporta contexto clínico o de redacción.</span>
                  </div>
                  <div className="feedback-score-row">
                    {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                      <button
                        key={score}
                        type="button"
                        id={`feedback-score-${score}`}
                        className={`feedback-score-chip ${doctorFeedbackScore === score ? 'active' : ''}`}
                        onClick={() => setDoctorFeedbackScore(score)}
                      >
                        {score}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="doctor-feedback-textarea"
                    placeholder="Feedback opcional: omisiones, terminología, tono, errores clínicos, etc."
                    value={doctorFeedbackText}
                    onChange={(event) => setDoctorFeedbackText(event.target.value)}
                  />
                  {doctorFeedbackError && (
                    <div className="doctor-feedback-error">{doctorFeedbackError}</div>
                  )}
                </div>
                <div className="feedback-actions">
                  <button
                    type="button"
                    className="action-button secondary"
                    onClick={() => setDoctorFeedbackDismissed(true)}
                  >
                    Omitir
                  </button>
                  <button
                    type="button"
                    id="feedback-submit-btn"
                    className={`action-button primary ${doctorFeedbackSubmitted ? 'success' : ''}`}
                    onClick={() => void handleDoctorFeedbackSubmit()}
                    disabled={!doctorFeedbackScore || doctorFeedbackSubmitting}
                  >
                    {doctorFeedbackSubmitting ? 'Enviando...' : 'Enviar valoración'}
                  </button>
                </div>
              </motion.div>
            )}

            {doctorFeedbackSubmitted && (
              <div className="doctor-feedback-toast">
                Valoración guardada. Gracias, esto solo se utilizará para aprendizaje interno.
              </div>
            )}

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
              <div className="uncertainty-panel attention-glow">
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
                <button
                  id="evidence-modal-close-btn"
                  className="close-btn"
                  onClick={() => setShowEvidenceModal(false)}
                  aria-label="Cerrar evidencia"
                >
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

      <div className="keyboard-shortcuts-overlay">
        <div className="shortcut-item">
          <kbd>Ctrl/⌘</kbd> + <kbd>S</kbd>
          <span>Guardar cambios</span>
        </div>
        <div className="shortcut-item">
          <kbd>Shift</kbd> + <kbd>R</kbd>
          <span>Ver informe</span>
        </div>
        <div className="shortcut-item">
          <kbd>Shift</kbd> + <kbd>E</kbd>
          <span>Validación</span>
        </div>
      </div>
    </div>
  );
};

export default HistoryView;



