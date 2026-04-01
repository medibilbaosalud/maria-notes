import React, { useEffect, useId, useRef, useState } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { Mic, Square, Stethoscope } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { MBSLogo } from './MBSLogo';
import { buildPsychologyCaseSummary, getPatientBriefing, getPatientNameSuggestions, type PatientNameSuggestion, type PatientCaseSummary, type PatientBriefing } from '../services/storage';
import { fadeSlideInSmall, motionEase, motionTransitions, softScaleTap, statusPulseSoft } from '../features/ui/motion-tokens';
import type { ClinicalSpecialtyId } from '../clinical/specialties';
import { useSimulation } from './Simulation/SimulationContext';
import { PatientBriefingCard } from './PatientBriefingCard';
import './Recorder.css';

type ActiveEngine = 'whisper' | 'gemini' | 'groq' | 'llm' | 'storage' | 'idle';

interface RecorderProps {
  onRecordingComplete: (blob: Blob, patientName: string, specialty: ClinicalSpecialtyId, isPartialBatch?: boolean, batchIndex?: number) => Promise<void> | void;
  onConsultationStart?: (sessionId: string, patientName: string, specialty: ClinicalSpecialtyId) => void;
  initialPatientName?: string;
  onOpenHistory?: () => void;
  canStart?: boolean;
  startBlockReason?: string;
  processingLabel?: string;
  activeEngine?: ActiveEngine;
  activeModel?: string;
  selectedSpecialty: ClinicalSpecialtyId;
  psychologyClinicianName?: 'Ainhoa' | 'June';
}

export const Recorder: React.FC<RecorderProps> = ({
  onRecordingComplete,
  onConsultationStart,
  initialPatientName = '',
  onOpenHistory,
  canStart = true,
  startBlockReason = '',
  processingLabel = 'Listo para grabar',
  activeEngine = 'idle',
  activeModel = '',
  selectedSpecialty
}) => {
  const turboBatchIntervalMs = Number(import.meta.env.VITE_TURBO_RECORDER_BATCH_INTERVAL_MS || 600_000);
  const listboxId = useId();
  const [patientName, setPatientName] = useState(initialPatientName);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [suggestions, setSuggestions] = useState<PatientNameSuggestion[]>([]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const [briefing, setBriefing] = useState<PatientBriefing | null>(null);
  const [caseSummary, setCaseSummary] = useState<PatientCaseSummary | null>(null);
  const [caseSummaryLoading, setCaseSummaryLoading] = useState(false);
  const patientNameRef = useRef(patientName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const suggestionRequestRef = useRef(0);
  const isInputFocusedRef = useRef(false);
  const briefingRequestRef = useRef(0);
  const caseSummaryRequestRef = useRef(0);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewAudioContextRef = useRef<AudioContext | null>(null);
  const previewAnalyserRef = useRef<AnalyserNode | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const previewSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [micState, setMicState] = useState<'requesting' | 'ready' | 'detecting' | 'error'>('requesting');
  const [micErrorMessage, setMicErrorMessage] = useState('');
  const { isPlaying, demoData } = useSimulation();
  const normalizedDemoPatientName = demoData?.patientName?.trim().toLowerCase() || '';

  useEffect(() => {
    patientNameRef.current = patientName;
  }, [patientName]);

  useEffect(() => {
    setPatientName(initialPatientName);
  }, [initialPatientName]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const handleBatchReady = async ({ blob, batchIndex }: { blob: Blob; batchIndex: number }) => {
    console.log(`[RecorderUI] Batch ${batchIndex} ready (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
    await onRecordingComplete(blob, patientNameRef.current, selectedSpecialty, true, batchIndex);
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
        await onRecordingComplete(blob, patientNameRef.current, selectedSpecialty, false, lastBatchIndex);
      } finally {
        setIsFinalizing(false);
      }
    },
    batchIntervalMs: Math.max(60_000, turboBatchIntervalMs)
  });

  useEffect(() => {
    let cancelled = false;

    const stopPreview = async () => {
      if (previewFrameRef.current !== null) {
        window.cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
      }
      previewSourceRef.current?.disconnect();
      previewSourceRef.current = null;
      previewAnalyserRef.current?.disconnect();
      previewAnalyserRef.current = null;
      previewStreamRef.current?.getTracks().forEach((track) => track.stop());
      previewStreamRef.current = null;
      if (previewAudioContextRef.current) {
        try {
          await previewAudioContextRef.current.close();
        } catch (error) {
          console.warn('[RecorderUI] Failed to close microphone preview context:', error);
        }
        previewAudioContextRef.current = null;
      }
      if (!cancelled) {
        setMicLevel(0);
      }
    };

    const startPreview = async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setMicState('error');
        setMicErrorMessage('No se puede acceder al microfono desde este navegador.');
        return;
      }

      setMicState('requesting');
      setMicErrorMessage('');

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) {
          stream.getTracks().forEach((track) => track.stop());
          setMicState('error');
          setMicErrorMessage('No se pudo crear el monitor del microfono.');
          return;
        }

        const context = new AudioContextCtor();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.85;

        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);

        previewStreamRef.current = stream;
        previewAudioContextRef.current = context;
        previewAnalyserRef.current = analyser;
        previewSourceRef.current = source;

        const samples = new Uint8Array(analyser.frequencyBinCount);
        let smoothedLevel = 0;
        const tick = () => {
          if (cancelled || !previewAnalyserRef.current) return;
          previewAnalyserRef.current.getByteFrequencyData(samples);
          const avg = samples.reduce((acc, value) => acc + value, 0) / Math.max(1, samples.length);
          const normalized = Math.min(1, avg / 96);
          smoothedLevel = smoothedLevel * 0.78 + normalized * 0.22;
          setMicLevel(smoothedLevel);
          setMicState(smoothedLevel >= 0.16 ? 'detecting' : 'ready');
          previewFrameRef.current = window.requestAnimationFrame(tick);
        };

        if (context.state === 'suspended') {
          await context.resume();
        }
        tick();
      } catch (error) {
        if (cancelled) return;
        console.error('[RecorderUI] Microphone preview failed:', error);
        setMicState('error');
        const domName = (error as DOMException)?.name;
        setMicErrorMessage(
          domName === 'NotAllowedError' ? 'Permiso de micrófono denegado. Actívalo en los ajustes del navegador.'
          : domName === 'NotFoundError' ? 'No se detectó ningún micrófono. Conecta uno e inténtalo de nuevo.'
          : domName === 'NotReadableError' ? 'El micrófono está ocupado por otra aplicación. Ciérrala e inténtalo de nuevo.'
          : 'No se pudo activar el micrófono. Revisa los permisos del navegador.'
        );
      }
    };

    if (isRecording || isFinalizing) {
      void stopPreview();
    } else {
      void startPreview();
    }

    return () => {
      cancelled = true;
      void stopPreview();
    };
  }, [isFinalizing, isRecording]);

  useEffect(() => {
    const currentRequest = ++suggestionRequestRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (isRecording) {
          setIsSuggestionsOpen(false);
          return;
        }
        const next = await getPatientNameSuggestions(
          patientName,
          8,
          selectedSpecialty,
          undefined,
          { includeLegacy: false }
        );
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
  }, [patientName, isRecording, selectedSpecialty]);

  useEffect(() => {
    let cancelled = false;
    const trimmed = patientName.trim();
    if (selectedSpecialty !== 'psicologia' || trimmed.length < 2) {
      setCaseSummary(null);
      setCaseSummaryLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (isPlaying && demoData?.specialty === 'psicologia' && demoData.caseSummary && trimmed.toLowerCase() === normalizedDemoPatientName) {
      setCaseSummaryLoading(false);
      setCaseSummary(demoData.caseSummary);
      return () => {
        cancelled = true;
      };
    }

    const currentRequest = ++caseSummaryRequestRef.current;
    setCaseSummaryLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const summary = await buildPsychologyCaseSummary(trimmed, undefined, { includeLegacy: false });
          if (cancelled || currentRequest !== caseSummaryRequestRef.current) return;
          setCaseSummary(summary);
        } catch (error) {
          console.warn('[RecorderUI] Failed to load case summary:', error);
          if (!cancelled && currentRequest === caseSummaryRequestRef.current) {
            setCaseSummary(null);
          }
        } finally {
          if (!cancelled && currentRequest === caseSummaryRequestRef.current) {
            setCaseSummaryLoading(false);
          }
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [demoData, isPlaying, normalizedDemoPatientName, patientName, selectedSpecialty]);

  useEffect(() => {
    let cancelled = false;
    const trimmed = patientName.trim();
    if (selectedSpecialty !== 'psicologia' || trimmed.length < 2) {
      setBriefing(null);
      return () => {
        cancelled = true;
      };
    }

    if (isPlaying && demoData?.specialty === 'psicologia' && demoData.briefing && trimmed.toLowerCase() === normalizedDemoPatientName) {
      setBriefing(demoData.briefing);
      return () => {
        cancelled = true;
      };
    }

    const currentRequest = ++briefingRequestRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const timeoutMs = 8000;
          const existing = await Promise.race([
            getPatientBriefing(trimmed, 'psicologia'),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
          ]);
          if (cancelled || currentRequest !== briefingRequestRef.current) return;
          setBriefing(existing);
        } catch (error) {
          console.warn('[RecorderUI] Failed to load briefing:', error);
          if (!cancelled && currentRequest === briefingRequestRef.current) {
            setBriefing(null);
          }
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [demoData, isPlaying, normalizedDemoPatientName, patientName, selectedSpecialty]);

  const patientNameValid = patientNameRef.current.trim().length >= 2;
  const canStartRecording = canStart && patientNameValid && !isFinalizing;
  const isProcessing = isFinalizing
    || (!isRecording && !!processingLabel && processingLabel.toLowerCase() !== 'listo para grabar');

  const handleStart = async () => {
    if (!canStartRecording) return;
    setIsFinalizing(false);
    setIsSuggestionsOpen(false);
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
    const sessionId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    try {
      await startRecording();
      onConsultationStart?.(sessionId, patientNameRef.current, selectedSpecialty);
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
  const micBars = Array.from({ length: 14 }, (_, index) => index);
  const micStatusMessage = micState === 'detecting'
    ? 'Microfono funcionando. Voz detectada correctamente.'
    : micState === 'ready'
      ? 'Microfono preparado. Habla para comprobar el nivel.'
      : micState === 'error'
        ? micErrorMessage || 'No se pudo acceder al microfono.'
        : 'Activando comprobacion del microfono...';

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
      className="recorder-card glass-surface"
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
                id="patient-name-input"
                type="text"
                role="combobox"
                aria-expanded={isSuggestionsOpen && suggestions.length > 0}
                aria-controls={listboxId}
                aria-activedescendant={highlightedSuggestion >= 0 ? `${listboxId}-option-${highlightedSuggestion}` : undefined}
                aria-autocomplete="list"
                aria-label="Nombre del paciente"
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
                title={isRecording ? 'El nombre no se puede cambiar durante la grabación' : undefined}
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

        {selectedSpecialty === 'psicologia' && patientName.trim().length >= 2 && (
          <motion.div
            id="recorder-context-card"
            className="recorder-context-card"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTransitions.normal}
            data-context-kind={briefing ? 'briefing' : caseSummary ? 'summary' : 'empty'}
          >
            {briefing ? (
              <PatientBriefingCard
                briefing={briefing}
                variant="compact"
                onOpenHistory={onOpenHistory}
                onDismiss={() => {
                  setBriefing(null);
                  setCaseSummary(null);
                }}
              />
            ) : caseSummaryLoading && !caseSummary ? (
              <div className="recorder-context-loading-skeleton">
                <div className="skeleton-header">
                  <div className="skeleton-kicker"></div>
                  <div className="skeleton-title"></div>
                </div>
                <div className="skeleton-line full"></div>
                <div className="skeleton-line medium"></div>
                <div className="skeleton-line short"></div>
              </div>
            ) : caseSummary ? (
              <>
                <div className="recorder-context-header">
                  <div>
                    <div className="recorder-context-kicker">Antes de empezar</div>
                    <h3>Contexto del caso</h3>
                  </div>
                  <div className="recorder-context-meta">{caseSummary.sessionCount} sesiones</div>
                </div>
                <div className="recorder-context-main">
                  <p>Última sesión: {new Date(caseSummary.latestConsultationAt).toLocaleDateString()}</p>
                  <p>Foco: {caseSummary.mainFocus}</p>
                </div>
                {caseSummary.recurringTopics.length > 0 && (
                  <div className="recorder-context-bullets">
                    {caseSummary.recurringTopics.slice(0, 3).map((topic) => (
                      <span key={topic} className="recorder-context-chip">{topic}</span>
                    ))}
                  </div>
                )}
                <div className="recorder-context-actions">
                  {onOpenHistory && (
                    <button id="recorder-open-history-btn" type="button" className="recorder-context-link" onClick={onOpenHistory}>
                      Ver historial completo
                    </button>
                  )}
                  <button
                    type="button"
                    className="recorder-context-link secondary"
                    onClick={() => setCaseSummary(null)}
                  >
                    Ocultar
                  </button>
                </div>
              </>
            ) : null}
          </motion.div>
        )}

        {!isRecording && (
          <motion.div
            className={`microphone-health-card ${micState === 'detecting' || micState === 'ready' ? 'compact' : ''}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTransitions.normal}
            data-mic-state={micState}
          >
            <div className="microphone-health-header">
              <span className="microphone-health-title">
                {micState === 'detecting' ? 'Micrófono listo' : micState === 'ready' ? 'Micrófono' : micState === 'error' ? 'Problema con el micrófono' : 'Activando micrófono...'}
              </span>
              <span className={`microphone-health-badge ${micState}`}>
                {micState === 'detecting' ? 'OK' : micState === 'ready' ? 'Listo' : micState === 'error' ? 'Revisar' : 'Activando'}
              </span>
            </div>
            {(micState === 'error' || micState === 'requesting') && (
              <>
                <div className="microphone-visualizer" aria-hidden="true">
                  {micBars.map((bar) => {
                    const threshold = (bar + 1) / micBars.length;
                    const active = micLevel >= threshold * 0.92;
                    const scaledHeight = 12 + Math.max(0, micLevel * 54 - bar * 1.8);
                    return (
                      <span
                        key={bar}
                        className={`microphone-bar ${active ? 'active' : ''}`}
                        style={{
                          height: `${Math.max(10, Math.min(60, scaledHeight))}px`,
                          opacity: active ? 1 : 0.35
                        }}
                      />
                    );
                  })}
                </div>
                <p className={`microphone-health-message ${micState === 'error' ? 'error' : ''}`}>
                  {micStatusMessage}
                </p>
              </>
            )}
          </motion.div>
        )}

        <div className="recorder-actions-area">
          <AnimatePresence mode="wait">
            {!isRecording ? (
              <motion.button
                key="start"
                id="main-record-btn"
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
          <AnimatePresence>
            {!isRecording && !canStartRecording && !isFinalizing && (
              <motion.p
                className="recorder-start-hint"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                {!patientNameValid ? 'Escribe el nombre del paciente para empezar' : startBlockReason || 'Esperando preflight...'}
              </motion.p>
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
