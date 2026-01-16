import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  recordId?: string;
  onPersistMedicalHistory?: (newContent: string, options?: { autosave?: boolean }) => Promise<void> | void;
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
  metadata,
  recordId,
  onPersistMedicalHistory
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
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
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
      originalHistoryRef.current = historyText;
      lastSavedValueRef.current = historyText;
      setVersions(
        historyText
          ? [{
            id: `ai-${Date.now()}`,
            label: 'IA (original)',
            content: historyText,
            createdAt: new Date(),
            source: 'ai'
          }]
          : []
      );
      setHasEdited(false);
      setHasFinalized(false);
      setHasGeneratedReport(false);
      setHasExported(false);
      setLastSavedAt(null);
      setFlagDecisions({});
    }
  }, [recordId, historyText]);

  useEffect(() => {
    if (!originalHistoryRef.current && historyText) {
      originalHistoryRef.current = historyText;
      lastSavedValueRef.current = historyText;
      setVersions([{
        id: `ai-${Date.now()}`,
        label: 'IA (original)',
        content: historyText,
        createdAt: new Date(),
        source: 'ai'
      }]);
    }
  }, [historyText]);

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
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [metadata, evidenceByField]);

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
  }, [apiKey, editValue, historyText, metadata, persistContent, transcription]);

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const saveEditRef = useRef(handleSaveEdit);
  useEffect(() => {
    saveEditRef.current = handleSaveEdit;
  }, [handleSaveEdit]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text.trim());
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
  }, [editValue, isEditing]);

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
                        id="edit-mode-btn"
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
                        onClick={() => setShowCompareModal(true)}
                        title="Comparar IA vs editado"
                      >
                        <FileText size={16} />
                        <span>Comparar</span>
                      </button>
                      <button
                        className="action-button secondary"
                        onClick={() => setShowVersionsModal(true)}
                        title="Ver versiones"
                      >
                        <FileText size={16} />
                        <span>Versiones</span>
                      </button>
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
                      <button
                        className={`action-button primary ${hasFinalized ? 'success' : ''}`}
                        onClick={() => setHasFinalized(true)}
                        title="Finalizar historia"
                        id="finalize-btn"
                      >
                        <Check size={16} />
                        <span>{hasFinalized ? 'Finalizado' : 'Finalizar'}</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="action-button secondary" onClick={handleCancelEdit}>
                        <X size={16} />
                        <span>Cancelar</span>
                      </button>
                      <button className="action-button primary success" id="save-edit-btn" onClick={handleSaveEdit}>
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
              <div className={`sync-status ${isOnline ? 'online' : 'offline'}`}>
                <span>{isOnline ? 'Online' : 'Sin conexión'}</span>
                {isEditing && (
                  <span className="sync-detail">
                    {isAutosaving ? 'Autosave...' : lastSavedAt ? `Guardado ${lastSavedAt.toLocaleTimeString()}` : 'Sin guardar'}
                  </span>
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

      {/* Evidence Modal */}
      <AnimatePresence>
        {showEvidenceModal && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content evidence-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="modal-header">
                <h3>Evidencia guiada</h3>
                <button className="close-btn" onClick={() => setShowEvidenceModal(false)}>
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content compare-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="modal-header">
                <h3>Comparar IA vs editado</h3>
                <button className="close-btn" onClick={() => setShowCompareModal(false)}>
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content versions-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="modal-header">
                <h3>Versiones guardadas</h3>
                <button className="close-btn" onClick={() => setShowVersionsModal(false)}>
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
                            onClick={() => navigator.clipboard.writeText(version.content)}
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

        .modal-content.evidence-modal,
        .modal-content.compare-modal,
        .modal-content.versions-modal {
          max-width: 880px;
        }

        .modal-body.evidence-body,
        .modal-body.versions-body {
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
