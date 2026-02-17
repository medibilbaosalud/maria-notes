import React, { useEffect, useId, useRef, useState } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { Mic, Square, Stethoscope, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { MBSLogo } from './MBSLogo';
import heroImage from '../assets/maria_notes_hero.png';
import { getPatientNameSuggestions, type PatientNameSuggestion } from '../services/storage';
import { fadeSlideInSmall, motionEase, motionTransitions, softScaleTap, statusPulseSoft } from '../features/ui/motion-tokens';
import './Recorder.css';

type ActiveEngine = 'whisper' | 'gemini' | 'groq' | 'llm' | 'storage' | 'idle';

interface RecorderProps {
  onRecordingComplete: (blob: Blob, patientName: string, isPartialBatch?: boolean, batchIndex?: number) => Promise<void> | void;
  onConsultationStart?: (sessionId: string, patientName: string) => void;
  canStart?: boolean;
  startBlockReason?: string;
  processingLabel?: string;
  activeEngine?: ActiveEngine;
  activeModel?: string;
  modelUpdatedAt?: number;
}

export const Recorder: React.FC<RecorderProps> = ({
  onRecordingComplete,
  onConsultationStart,
  canStart = true,
  startBlockReason = '',
  processingLabel = 'Listo para grabar',
  activeEngine = 'idle',
  activeModel = '',
  modelUpdatedAt
}) => {
  const turboBatchIntervalMs = Number(import.meta.env.VITE_TURBO_RECORDER_BATCH_INTERVAL_MS || 90_000);
  const listboxId = useId();
  const [patientName, setPatientName] = useState('');
  const [processedBatches, setProcessedBatches] = useState<number[]>([]);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [suggestions, setSuggestions] = useState<PatientNameSuggestion[]>([]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const [modelPulse, setModelPulse] = useState(false);
  const patientNameRef = useRef(patientName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const suggestionRequestRef = useRef(0);
  const isInputFocusedRef = useRef(false);

  useEffect(() => {
    patientNameRef.current = patientName;
  }, [patientName]);

  useEffect(() => {
    if (!modelUpdatedAt) return;
    setModelPulse(true);
    const timer = window.setTimeout(() => setModelPulse(false), 600);
    return () => window.clearTimeout(timer);
  }, [modelUpdatedAt]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const handleBatchReady = async ({ blob, batchIndex }: { blob: Blob; batchIndex: number }) => {
    console.log(`[RecorderUI] Batch ${batchIndex} ready (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
    setProcessedBatches((prev) => [...prev, batchIndex]);
    await onRecordingComplete(blob, patientNameRef.current, true, batchIndex);
  };

  const {
    isRecording,
    duration,
    startRecording,
    stopRecording
  } = useAudioRecorder({
    onBatchReady: handleBatchReady,
    onFinalReady: async ({ blob, lastBatchIndex }) => {
      console.log(`[RecorderUI] Final segment ready (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
      try {
        await onRecordingComplete(blob, patientNameRef.current, false, lastBatchIndex);
      } finally {
        setProcessedBatches([]);
        setIsFinalizing(false);
      }
    },
    batchIntervalMs: Math.max(60_000, turboBatchIntervalMs)
  });

  useEffect(() => {
    const currentRequest = ++suggestionRequestRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (isRecording) {
          setSuggestionsLoading(false);
          setIsSuggestionsOpen(false);
          return;
        }
        setSuggestionsLoading(true);
        const next = await getPatientNameSuggestions(patientName, 8);
        if (currentRequest !== suggestionRequestRef.current) return;
        setSuggestions(next);
        setSuggestionsLoading(false);
        setHighlightedSuggestion(next.length > 0 ? 0 : -1);
        if (isInputFocusedRef.current && next.length > 0) {
          setIsSuggestionsOpen(true);
        } else if (next.length === 0) {
          setIsSuggestionsOpen(false);
        }
      })();
    }, patientName.trim().length > 0 ? 90 : 40);

    return () => window.clearTimeout(timer);
  }, [patientName, isRecording]);

  const patientNameValid = patientNameRef.current.trim().length >= 2;
  const canStartRecording = canStart && patientNameValid && !isFinalizing;
  const isProcessing = isFinalizing
    || (!isRecording && !!processingLabel && processingLabel.toLowerCase() !== 'listo para grabar');

  const handleStart = async () => {
    if (!canStartRecording) return;
    setIsFinalizing(false);
    setIsSuggestionsOpen(false);
    const sessionId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    try {
      await startRecording();
      onConsultationStart?.(sessionId, patientNameRef.current);
    } catch (error) {
      console.error('[RecorderUI] Failed to start recording:', error);
    }
  };

  const handleStop = async () => {
    setIsFinalizing(true);
    setIsSuggestionsOpen(false);
    try {
      await Promise.resolve(stopRecording());
    } catch (error) {
      setIsFinalizing(false);
      throw error;
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const recorderUiState = isRecording ? 'recording' : isFinalizing ? 'finalizing' : 'ready';
  const statusMessage = isRecording
    ? 'Grabando consulta...'
    : isFinalizing
      ? (processingLabel || 'Procesando final...')
      : (processingLabel || 'Listo para grabar');

  const engineLabel = activeEngine === 'whisper'
    ? 'Whisper'
    : activeEngine === 'gemini'
      ? 'Gemini'
      : activeEngine === 'groq'
        ? 'Groq'
        : activeEngine === 'storage'
          ? 'Storage'
          : activeEngine === 'idle'
            ? 'Idle'
            : 'LLM';

  const suggestionTitle = patientName.trim().length > 0
    ? 'Sugerencias de pacientes'
    : 'Pacientes recientes';

  const selectSuggestion = (suggestion: PatientNameSuggestion) => {
    setPatientName(suggestion.name);
    setIsSuggestionsOpen(false);
    setHighlightedSuggestion(-1);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleInputKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (!isSuggestionsOpen || suggestions.length === 0) {
      if (event.key === 'ArrowDown' && suggestions.length > 0) {
        setIsSuggestionsOpen(true);
        setHighlightedSuggestion(0);
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedSuggestion((prev) => (prev + 1) % suggestions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedSuggestion((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      return;
    }

    if (event.key === 'Enter' && highlightedSuggestion >= 0 && highlightedSuggestion < suggestions.length) {
      event.preventDefault();
      selectSuggestion(suggestions[highlightedSuggestion]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsSuggestionsOpen(false);
      return;
    }
  };

  return (
    <motion.div
      className="recorder-card"
      variants={fadeSlideInSmall}
      initial="initial"
      animate="enter"
      exit="exit"
      data-ui-state={recorderUiState}
      data-model-engine={activeEngine}
      data-model-name={activeModel || ''}
      data-processing-stage={statusMessage}
    >
      <div className="recorder-grid">
        <div className="recorder-main-col">
          <div className="recorder-header">
            <div className="logo-wrapper-absolute">
              <MBSLogo size={48} />
            </div>

            <div className="hero-image-container">
              <img src={heroImage} alt="Maria Notes" className="hero-image" />
            </div>

            <div className="inputs-row">
              <div className="input-group recorder-input-group">
                <label>Nombre del Paciente</label>
                <div
                  className="input-wrapper"
                  data-ui-role="patient-suggest"
                  data-ui-state={isSuggestionsOpen ? 'open' : 'closed'}
                >
                  <Stethoscope size={20} className="input-icon input-icon-brand" />
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Nombre y apellidos..."
                    value={patientName}
                    onChange={(e) => {
                      setPatientName(e.target.value);
                      if (!isRecording) setIsSuggestionsOpen(true);
                    }}
                    onFocus={() => {
                      isInputFocusedRef.current = true;
                      if (suggestions.length > 0) setIsSuggestionsOpen(true);
                    }}
                    onBlur={() => {
                      isInputFocusedRef.current = false;
                      blurTimeoutRef.current = window.setTimeout(() => setIsSuggestionsOpen(false), 120);
                    }}
                    onKeyDown={handleInputKeyDown}
                    disabled={isRecording}
                    className="recorder-text-input"
                    aria-label="Nombre del paciente"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={isSuggestionsOpen}
                    aria-controls={listboxId}
                    aria-activedescendant={
                      highlightedSuggestion >= 0
                        ? `${listboxId}-option-${highlightedSuggestion}`
                        : undefined
                    }
                  />
                  <AnimatePresence>
                    {isSuggestionsOpen && suggestions.length > 0 && (
                      <motion.div
                        className="suggestions-panel"
                        id={listboxId}
                        role="listbox"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={motionTransitions.fast}
                        data-ui-state="open"
                      >
                        <div className="suggestions-title">{suggestionTitle}</div>
                        {suggestions.map((suggestion, index) => {
                          const isHighlighted = index === highlightedSuggestion;
                          const isSelected = suggestion.normalized === patientName.trim().toLowerCase();
                          return (
                            <button
                              type="button"
                              key={`${suggestion.normalized}-${index}`}
                              id={`${listboxId}-option-${index}`}
                              role="option"
                              aria-selected={isHighlighted}
                              className={`suggestion-item ${isHighlighted ? 'highlighted' : ''} ${isSelected ? 'selected' : ''}`}
                              data-ui-state={isHighlighted ? 'highlighted' : isSelected ? 'selected' : 'idle'}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                selectSuggestion(suggestion);
                              }}
                            >
                              <span>{suggestion.name}</span>
                              <span className="suggestion-meta">{suggestion.uses}x</span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                {suggestionsLoading && (
                  <small className="suggestions-loading">Actualizando sugerencias...</small>
                )}
                <div className="hint-row">
                  <span className={`hint-chip ${canStart ? 'ok' : 'warn'}`}>
                    {canStart ? 'Preflight listo' : 'Preflight pendiente'}
                  </span>
                </div>
                {!patientNameValid && !isRecording && (
                  <small className="warning-text">Introduce al menos 2 caracteres para iniciar.</small>
                )}
                {!canStart && !isRecording && (
                  <small className="error-text">{startBlockReason || 'Preflight incompleto: revisa configuracion.'}</small>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="recorder-side-col">
          <div className="visualization-area">
            <div className="status-indicator" data-ui-state={recorderUiState}>
              <motion.div
                className="status-dot"
                animate={statusPulseSoft(isRecording)}
                transition={{
                  duration: 1.2,
                  repeat: isRecording ? Infinity : 0,
                  ease: motionEase.base
                }}
              />
              <motion.span
                key={statusMessage}
                className="status-text"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={motionTransitions.fast}
              >
                {statusMessage}
              </motion.span>
            </div>

            <AnimatePresence>
              {isRecording && (
                <>
                  {[...Array(2)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="pulse-ring"
                      initial={{ opacity: 0.4, scale: 0.8 }}
                      animate={{ opacity: 0, scale: 1.8 }}
                      transition={{
                        duration: 2.5,
                        repeat: Infinity,
                        delay: i * 1.2,
                        ease: motionEase.out
                      }}
                    />
                  ))}
                </>
              )}
            </AnimatePresence>

            <motion.div className="timer-display" animate={{ scale: isRecording ? 1.05 : 1 }}>
              {formatTime(duration)}
            </motion.div>

            <motion.div
              className={`model-runtime-card ${modelPulse ? 'updated' : ''}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={motionTransitions.normal}
              data-ui-state={isProcessing ? 'active' : 'idle'}
              data-model-engine={activeEngine}
              data-model-name={activeModel || ''}
            >
              <div className="model-runtime-head">
                <span className={`engine-chip ${activeEngine}`}>{engineLabel}</span>
                {isProcessing && <span className="processing-spinner" aria-hidden="true" />}
              </div>
              <div className="model-runtime-text">
                {activeModel || 'Resolviendo ruta de modelo...'}
              </div>
            </motion.div>

            <AnimatePresence>
              {processedBatches.length > 0 && (
                <motion.div
                  className="batch-indicator"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={motionTransitions.normal}
                  data-ui-state={isFinalizing ? 'active' : 'success'}
                >
                  <CheckCircle size={14} />
                  <span>{processedBatches.length} parte{processedBatches.length > 1 ? 's' : ''} procesada{processedBatches.length > 1 ? 's' : ''}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="controls-area">
            <AnimatePresence mode="wait">
              {!isRecording ? (
                <motion.button
                  key="start"
                  className="action-btn start"
                  onClick={handleStart}
                  disabled={!canStartRecording}
                  title={!canStartRecording ? (startBlockReason || 'Completa el preflight antes de iniciar') : undefined}
                  aria-label="Iniciar consulta"
                  {...softScaleTap}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={motionTransitions.normal}
                  data-ui-state={!canStartRecording ? 'disabled' : 'ready'}
                >
                  <Mic size={24} />
                  <span>Iniciar Consulta</span>
                </motion.button>
              ) : (
                <motion.button
                  key="stop"
                  className="action-btn stop"
                  onClick={() => void handleStop()}
                  aria-label="Finalizar y generar historia"
                  {...softScaleTap}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={motionTransitions.normal}
                  data-ui-state={isFinalizing ? 'finalizing' : 'recording'}
                >
                  <Square size={24} fill="currentColor" />
                  <span>{isFinalizing ? 'Procesando...' : 'Finalizar y Generar'}</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
