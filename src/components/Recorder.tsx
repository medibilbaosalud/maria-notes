import React, { useEffect, useId, useRef, useState } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { Mic, Square, Stethoscope } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { MBSLogo } from './MBSLogo';
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
}

export const Recorder: React.FC<RecorderProps> = ({
  onRecordingComplete,
  onConsultationStart,
  canStart = true,
  startBlockReason = '',
  processingLabel = 'Listo para grabar',
  activeEngine = 'idle',
  activeModel = ''
}) => {
  const turboBatchIntervalMs = Number(import.meta.env.VITE_TURBO_RECORDER_BATCH_INTERVAL_MS || 60_000);
  const listboxId = useId();
  const [patientName, setPatientName] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [suggestions, setSuggestions] = useState<PatientNameSuggestion[]>([]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const patientNameRef = useRef(patientName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const suggestionRequestRef = useRef(0);
  const isInputFocusedRef = useRef(false);

  useEffect(() => {
    patientNameRef.current = patientName;
  }, [patientName]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const handleBatchReady = async ({ blob, batchIndex }: { blob: Blob; batchIndex: number }) => {
    console.log(`[RecorderUI] Batch ${batchIndex} ready (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
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
          setIsSuggestionsOpen(false);
          return;
        }
        const next = await getPatientNameSuggestions(patientName, 8);
        if (currentRequest !== suggestionRequestRef.current) return;
        setSuggestions(next);
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
      <div className="recorder-centered-layout">
        <div className="recorder-header-centered">
          <MBSLogo size={56} />
          <h2 className="recorder-title">Maria Notes</h2>
        </div>

        <div className="recorder-status-area">
          <div className="status-indicator-pill" data-ui-state={recorderUiState}>
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
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {statusMessage}
            </motion.span>
          </div>

          <motion.div className="timer-display-large" animate={{ scale: isRecording ? 1.02 : 1 }}>
            {formatTime(duration)}
          </motion.div>
        </div>

        <div className="recorder-input-area">
          <div className="input-group recorder-input-group-centered">
            <div
              className="input-wrapper-large"
              data-ui-role="patient-suggest"
              data-ui-state={isSuggestionsOpen ? 'open' : 'closed'}
            >
              <Stethoscope size={24} className="input-icon-large" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Nombre del paciente..."
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
                className="recorder-text-input-large"
              />
              <AnimatePresence>
                {isSuggestionsOpen && suggestions.length > 0 && (
                  <motion.div
                    className="suggestions-panel-large"
                    id={listboxId}
                    role="listbox"
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={motionTransitions.fast}
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
                          className={`suggestion-item-large ${isHighlighted ? 'highlighted' : ''} ${isSelected ? 'selected' : ''}`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            selectSuggestion(suggestion);
                          }}
                        >
                          <span className="suggestion-name">{suggestion.name}</span>
                          <span className="suggestion-meta">{suggestion.uses} consultas</span>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="recorder-actions-area">
          <AnimatePresence mode="wait">
            {!isRecording ? (
              <motion.button
                key="start"
                className="action-btn-large start"
                onClick={handleStart}
                disabled={!canStartRecording}
                title={!canStartRecording ? (startBlockReason || 'Completa el preflight antes de iniciar') : undefined}
                {...softScaleTap}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={motionTransitions.normal}
              >
                <div className="btn-icon-bg"><Mic size={28} /></div>
                <div className="btn-content">
                  <span className="btn-label">Iniciar Consulta</span>
                  <span className="btn-sublabel">Grabar y procesar con AI</span>
                </div>
              </motion.button>
            ) : (
              <motion.button
                key="stop"
                className="action-btn-large stop"
                onClick={() => void handleStop()}
                {...softScaleTap}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={motionTransitions.normal}
              >
                <div className="btn-icon-bg stop"><Square size={28} fill="currentColor" /></div>
                <div className="btn-content">
                  <span className="btn-label">{isFinalizing ? 'Procesando...' : 'Finalizar Consulta'}</span>
                  <span className="btn-sublabel">Generar historia clínica</span>
                </div>
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {(isRecording || isProcessing) && (
            <motion.div
              className="active-model-badge"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <span className={`model-dot ${activeEngine}`}></span>
              <span className="model-name">{activeModel || 'Inicializando motor AI...'}</span>
              {isProcessing && <span className="processing-spinner-small" />}
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.div>
  );
};
