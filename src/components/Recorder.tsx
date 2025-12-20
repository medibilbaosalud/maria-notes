import React, { useEffect, useState, useRef } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { Mic, Square, Stethoscope } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { MBSLogo } from './MBSLogo';
import heroImage from '../assets/maria_notes_hero.png';

interface RecorderProps {
  onRecordingComplete: (blob: Blob, patientName: string) => void;
}

export const Recorder: React.FC<RecorderProps> = ({ onRecordingComplete }) => {
  const { isRecording, duration, startRecording, stopRecording, audioBlob } = useAudioRecorder();
  const [patientName, setPatientName] = useState('');

  // Guard to prevent infinite loops if parent re-renders
  const lastSubmittedBlob = useRef<Blob | null>(null);

  useEffect(() => {
    if (audioBlob && audioBlob !== lastSubmittedBlob.current) {
      lastSubmittedBlob.current = audioBlob;
      onRecordingComplete(audioBlob, patientName);
    }
  }, [audioBlob, onRecordingComplete, patientName]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      className="recorder-card"
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="recorder-header">
        <div className="logo-wrapper-absolute">
          <MBSLogo size={48} />
        </div>

        <div className="hero-image-container">
          <img src={heroImage} alt="Maria Notes" className="hero-image" />
        </div>

        <div className="inputs-row">
          <div className="input-group" style={{ width: '100%' }}>
            <label>Nombre del Paciente</label>
            <div className="input-wrapper">
              <Stethoscope size={20} className="input-icon" style={{ color: 'var(--brand-primary)' }} />
              <input
                type="text"
                placeholder="Nombre y Apellidos..."
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                disabled={isRecording}
                className="text-input"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="visualization-area">
        <div className="status-indicator">
          <motion.div
            className="status-dot"
            animate={{
              scale: isRecording ? [1, 1.2, 1] : 1,
              opacity: isRecording ? 1 : 0.5
            }}
            transition={{ repeat: isRecording ? Infinity : 0, duration: 2 }}
          />
          <span className="status-text">{isRecording ? "Grabando Consulta..." : "Listo para grabar"}</span>
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
                    ease: "easeOut"
                  }}
                />
              ))}
            </>
          )}
        </AnimatePresence>

        <motion.div
          className="timer-display"
          animate={{ scale: isRecording ? 1.05 : 1 }}
        >
          {formatTime(duration)}
        </motion.div>
      </div>

      <div className="controls-area">
        <AnimatePresence mode="wait">
          {!isRecording ? (
            <motion.button
              key="start"
              className="action-btn start"
              onClick={startRecording}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
            >
              <Mic size={24} />
              <span>Iniciar Consulta</span>
            </motion.button>
          ) : (
            <motion.button
              key="stop"
              className="action-btn stop"
              onClick={stopRecording}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
            >
              <Square size={24} fill="currentColor" />
              <span>Finalizar y Generar</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <style>{`
        .recorder-card {
          background: rgba(255, 255, 255, 0.7);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 24px;
          padding: 2rem;
          box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07);
          border: 1px solid rgba(255, 255, 255, 0.4);
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-width: 720px;
          margin: 0 auto;
          position: relative;
        }

        .recorder-header {
          width: 100%;
          margin-bottom: 2rem;
          position: relative;
          z-index: 20;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.5rem;
        }
        
        .logo-wrapper-absolute {
            position: absolute;
            top: -1rem;
            left: 0;
            opacity: 0.8;
        }

        .hero-image-container {
            width: 180px;
            height: 180px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 1rem;
            margin-bottom: 1rem;
        }
        
        .hero-image {
            width: 100%;
            height: 100%;
            object-fit: contain;
            filter: drop-shadow(0 10px 15px rgba(38, 166, 154, 0.2));
        }

        .inputs-row {
          display: flex;
          justify-content: center;
          width: 100%;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          max-width: 400px;
          width: 100%;
        }

        .input-group label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 1rem;
          color: var(--text-secondary);
          pointer-events: none;
        }

        .text-input {
          width: 100%;
          padding: 0.75rem 1rem 0.75rem 2.5rem;
          border-radius: 8px;
          border: none;
          background: #F1F5F9; /* Lighter gray background */
          color: var(--text-primary);
          font-size: 0.95rem;
          transition: all 0.2s;
          box-sizing: border-box;
          font-family: var(--font-sans);
        }

        .text-input:focus {
          outline: none;
          background: white;
          box-shadow: 0 0 0 2px var(--brand-primary);
        }

        .visualization-area {
          position: relative;
          width: 260px;
          height: 220px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          z-index: 10;
        }

        .status-indicator {
          position: absolute;
          top: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 1rem;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: var(--brand-primary);
        }

        .status-text {
          font-size: 0.85rem;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .timer-display {
          font-size: 4rem;
          font-weight: 300;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
          z-index: 2;
          letter-spacing: -1px;
        }

        .pulse-ring {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 100%;
          height: 100%;
          border-radius: 50%;
          border: 1px solid var(--brand-primary);
          pointer-events: none;
        }

        .controls-area {
          width: 100%;
          display: flex;
          justify-content: center;
          z-index: 10;
        }

        .action-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 40px;
          border-radius: 16px;
          border: none;
          font-size: 1.1rem;
          font-weight: 600;
          cursor: pointer;
          box-shadow: var(--shadow-md);
          font-family: var(--font-sans);
          transition: all 0.2s;
        }

        .action-btn.start {
          background: var(--brand-vibrant);
          color: white;
        }

        .action-btn.stop {
          background-color: #26A69A !important;
          color: white;
        }
      `}</style>
    </motion.div>
  );
};
