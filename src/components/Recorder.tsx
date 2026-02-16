import React, { useEffect, useState, useRef } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { Mic, Square, Stethoscope, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { MBSLogo } from './MBSLogo';
import heroImage from '../assets/maria_notes_hero.png';
import { fadeSlideInSmall, motionEase, motionTransitions, softScaleTap, statusPulseSoft } from '../features/ui/motion-tokens';
import './Recorder.css';

interface RecorderProps {
  onRecordingComplete: (blob: Blob, patientName: string, isPartialBatch?: boolean, batchIndex?: number) => Promise<void> | void;
  onConsultationStart?: (sessionId: string, patientName: string) => void;
  canStart?: boolean;
  startBlockReason?: string;
}

export const Recorder: React.FC<RecorderProps> = ({ onRecordingComplete, onConsultationStart, canStart = true, startBlockReason = '' }) => {
  const turboBatchIntervalMs = Number(import.meta.env.VITE_TURBO_RECORDER_BATCH_INTERVAL_MS || 90_000);
  const [patientName, setPatientName] = useState('');
  const [processedBatches, setProcessedBatches] = useState<number[]>([]);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const patientNameRef = useRef(patientName);

  useEffect(() => {
    patientNameRef.current = patientName;
  }, [patientName]);

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

  const patientNameValid = patientNameRef.current.trim().length >= 2;
  const canStartRecording = canStart && patientNameValid && !isFinalizing;

  const handleStart = async () => {
    if (!canStartRecording) return;
    setIsFinalizing(false);
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
      ? 'Procesando final...'
      : 'Listo para grabar';

  return (
    <motion.div
      className="recorder-card"
      variants={fadeSlideInSmall}
      initial="initial"
      animate="enter"
      exit="exit"
    >
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
            <div className="input-wrapper">
              <Stethoscope size={20} className="input-icon input-icon-brand" />
              <input
                type="text"
                placeholder="Nombre y apellidos..."
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                disabled={isRecording}
                className="recorder-text-input"
                aria-label="Nombre del paciente"
              />
            </div>
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
    </motion.div>
  );
};
