import React, { useState, useRef } from 'react';
import { Mic, Upload, Square, Activity, FileAudio, FileText, Brain, ChevronRight } from 'lucide-react';
import { TestLogDetailModal } from './TestLogDetailModal';
import { AnimatePresence } from 'framer-motion';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { normalizeAndChunkAudio } from '../utils/audioProcessing';

interface AudioTestLabProps {
  onClose: () => void;
  onRunFullPipeline: (blob: Blob, patientName: string, isPartialBatch?: boolean, batchIndex?: number) => Promise<void>;
  onRunTextPipeline: (text: string, patientName: string) => Promise<void>;
}

export const AudioTestLab: React.FC<AudioTestLabProps> = ({ onClose, onRunFullPipeline, onRunTextPipeline }) => {
  const [mode, setMode] = useState<'mic' | 'upload' | 'text' | 'history'>('mic');
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  const [uploadChunks, setUploadChunks] = useState<Blob[]>([]);
  const [fileName, setFileName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [normalizationStatus, setNormalizationStatus] = useState('');
  const [processingStep, setProcessingStep] = useState('');
  const [manualText, setManualText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isRecording, startRecording, stopRecording, audioBlob: micBlob, duration } = useAudioRecorder({
    batchIntervalMs: 0
  });

  React.useEffect(() => {
    if (mode === 'history') {
      const fetchLogs = async () => {
        const { getLabTestLogs } = await import('../services/storage');
        const logs = await getLabTestLogs();
        setHistoryLogs(logs);
      };
      void fetchLogs();
    }
  }, [mode]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setNormalizationStatus('Procesando y dividiendo audio...');
      setIsProcessing(true);
      try {
        const chunks = await normalizeAndChunkAudio(file);
        setUploadChunks(chunks);
        setNormalizationStatus(`Normalizado y dividido en ${chunks.length} partes`);
      } catch (e) {
        console.error('Normalization failed:', e);
        setUploadChunks([file]);
        setNormalizationStatus('Fallo al normalizar (usando original)');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleRunSimulation = async () => {
    const dummyName = `TEST_LAB_${new Date().toLocaleTimeString()}`;

    setIsProcessing(true);
    try {
      if (mode === 'mic' && micBlob) {
        setProcessingStep('Enviando audio del microfono...');
        await onRunFullPipeline(micBlob, dummyName, false, 0);
      } else if (mode === 'upload' && uploadChunks.length > 0) {
        for (let i = 0; i < uploadChunks.length; i++) {
          const isLast = i === uploadChunks.length - 1;
          const partNum = i + 1;
          const total = uploadChunks.length;

          setProcessingStep(`Enviando parte ${partNum} de ${total}...`);
          await onRunFullPipeline(uploadChunks[i], dummyName, !isLast, i);

          if (!isLast) await new Promise((r) => setTimeout(r, 500));
        }
        setProcessingStep('Proceso completado');
      } else if (mode === 'text' && manualText.trim()) {
        setProcessingStep('Ejecutando pipeline clinico y guardando...');
        await onRunTextPipeline(manualText, dummyName);
        setProcessingStep('Proceso completado');
      }
    } catch (error) {
      console.error(error);
      setProcessingStep('Error durante la simulacion');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="audio-lab-container">
      <div className="audio-lab-header">
        <h2>Laboratorio de Pruebas</h2>
        <button onClick={onClose} className="audio-lab-close-btn" aria-label="Cerrar zona test">Cerrar</button>
      </div>

      <div className="audio-lab-tabs" role="tablist" aria-label="Modos de prueba">
        <button className={`audio-lab-tab ${mode === 'mic' ? 'active' : ''}`} onClick={() => setMode('mic')}>
          <Mic size={18} /> Prueba Microfono
        </button>
        <button className={`audio-lab-tab ${mode === 'upload' ? 'active' : ''}`} onClick={() => setMode('upload')}>
          <Upload size={18} /> Subir Archivo
        </button>
        <button className={`audio-lab-tab ${mode === 'text' ? 'active' : ''}`} onClick={() => setMode('text')}>
          <FileText size={18} /> Transcripcion Pasada
        </button>
        <button className={`audio-lab-tab ${mode === 'history' ? 'active' : ''}`} onClick={() => setMode('history')}>
          <Activity size={18} /> Historial Auditoria
        </button>
      </div>

      <div className="audio-lab-content">
        {mode === 'mic' ? (
          <div className="audio-lab-mode-block">
            <div className="audio-lab-config-card">
              <p><strong>Configuracion Actual:</strong></p>
              <ul>
                <li>Auto Gain Control: <span className="tag-on">ON</span></li>
                <li>Noise Suppression: <span className="tag-off">OFF</span></li>
                <li>Echo Cancellation: <span className="tag-off">OFF</span></li>
              </ul>
            </div>

            {!isRecording ? (
              <button className="audio-lab-record-btn" onClick={startRecording}>
                <Mic size={24} /> Grabar Test
              </button>
            ) : (
              <button className="audio-lab-stop-btn" onClick={stopRecording}>
                <Square size={24} /> Parar ({duration}s)
              </button>
            )}

            {micBlob && (
              <div className="audio-lab-playback-area">
                <h3>Audio capturado</h3>
                <audio controls src={URL.createObjectURL(micBlob)} />
                <button className="audio-lab-run-btn" onClick={handleRunSimulation} disabled={isProcessing}>
                  <Activity size={18} /> {isProcessing ? 'Procesando...' : 'Procesar Audio'}
                </button>
              </div>
            )}
          </div>
        ) : mode === 'upload' ? (
          <div className="audio-lab-mode-block">
            <div className="audio-lab-upload-box" onClick={() => fileInputRef.current?.click()}>
              <FileAudio size={46} className="audio-lab-upload-icon" />
              <p>Click para subir audio (.mp3, .wav, .m4a)</p>
              <span className="audio-lab-subtext">Se aplicara normalizacion automatica</span>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="audio/*" hidden />
            </div>

            {fileName && (
              <div className="audio-lab-file-info">
                <p className="filename">{fileName}</p>
                <p className="status">{normalizationStatus}</p>
              </div>
            )}

            {uploadChunks.length > 0 && (
              <div className="audio-lab-playback-area">
                <h3>Audio normalizado (Parte 1/{uploadChunks.length})</h3>
                <audio controls src={URL.createObjectURL(uploadChunks[0])} />
                <button className="audio-lab-run-btn" onClick={handleRunSimulation} disabled={isProcessing}>
                  <Activity size={18} />
                  {isProcessing ? processingStep : `Procesar (${uploadChunks.length} partes)`}
                </button>
              </div>
            )}
          </div>
        ) : mode === 'text' ? (
          <div className="audio-lab-mode-block">
            <div className="audio-lab-config-card">
              <p><strong>Pipeline clinico desde transcripcion:</strong></p>
              <p className="audio-lab-helper">Pega una transcripcion real. Se ejecuta extraccion + generacion + validacion y se guarda en Historias.</p>
            </div>
            <textarea
              className="audio-lab-text-input"
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="Pega aqui la transcripcion de una consulta pasada..."
              rows={10}
              aria-label="Transcripcion para ejecutar prueba"
            />
            <button className="audio-lab-run-btn" onClick={handleRunSimulation} disabled={!manualText.trim() || isProcessing}>
              <Activity size={18} />
              {isProcessing ? processingStep : 'Procesar y Guardar en Historias'}
            </button>
          </div>
        ) : (
          <div className="audio-lab-history-area">
            <div className="audio-lab-history-header">
              <h3>Historial de pruebas de auditoria</h3>
              <button
                className="audio-lab-clear-btn"
                onClick={async () => {
                  if (confirm('Borrar todo el historial de pruebas?')) {
                    const { clearLabTestLogs } = await import('../services/storage');
                    await clearLabTestLogs();
                    setHistoryLogs([]);
                  }
                }}
              >
                Limpiar Historial
              </button>
            </div>
            <div className="audio-lab-table-wrap">
              <table className="audio-lab-table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Prueba</th>
                    <th>Ciclos</th>
                    <th>Errores</th>
                    <th>Modelo</th>
                    <th title="Memoria Activa"><Brain size={16} /></th>
                  </tr>
                </thead>
                <tbody>
                  {historyLogs.map((log) => (
                    <tr key={log.id} className="audio-lab-log-row" onClick={() => setSelectedLog(log)}>
                      <td>{new Date(log.created_at).toLocaleTimeString()}</td>
                      <td title={log.test_name}>{log.test_name.replace('TEST_LAB_', '')}</td>
                      <td><span className="audio-lab-badge-cycles">{log.metadata.versionsCount}</span></td>
                      <td><span className="audio-lab-badge-errors">{log.metadata.errorsFixed}</span></td>
                      <td><code className="audio-lab-model-code">{log.metadata.models.generation}</code></td>
                      <td>
                        {log.metadata.active_memory_used && (
                          <span title="Uso memoria activa" className="audio-lab-memory-flag">
                            <Brain size={16} fill="#fef08a" />
                          </span>
                        )}
                        <ChevronRight size={14} />
                      </td>
                    </tr>
                  ))}
                  {historyLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="audio-lab-no-logs">No hay pruebas registradas aun.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedLog && (
          <TestLogDetailModal
            log={selectedLog}
            onClose={() => setSelectedLog(null)}
          />
        )}
      </AnimatePresence>

      <style>{`
        .audio-lab-container {
          background: white;
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
          max-width: 980px;
          margin: 0 auto;
          font-family: var(--font-sans);
          border: 1px solid var(--border-soft);
        }

        .audio-lab-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.4rem;
          gap: 1rem;
        }

        .audio-lab-header h2 {
          margin: 0;
          color: #1e293b;
        }

        .audio-lab-close-btn {
          padding: 0.5rem 1rem;
          border: 1px solid #e2e8f0;
          background: white;
          border-radius: 10px;
          cursor: pointer;
        }

        .audio-lab-close-btn:hover {
          background: #f8fafc;
        }

        .audio-lab-tabs {
          display: flex;
          gap: 0.55rem;
          margin-bottom: 1.25rem;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 0.85rem;
          overflow-x: auto;
        }

        .audio-lab-tab {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          padding: 0.55rem 0.9rem;
          border: none;
          background: transparent;
          color: #64748b;
          font-weight: 500;
          cursor: pointer;
          border-radius: 10px;
          white-space: nowrap;
        }

        .audio-lab-tab.active {
          background: #f0fdfa;
          color: #0f766e;
        }

        .audio-lab-content {
          min-height: 360px;
        }

        .audio-lab-mode-block {
          max-width: 700px;
          display: grid;
          gap: 1rem;
        }

        .audio-lab-config-card {
          background: #f8fafc;
          padding: 1rem;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
        }

        .audio-lab-config-card ul {
          margin-top: 0.65rem;
          margin-left: 1rem;
          display: grid;
          gap: 0.3rem;
        }

        .tag-on {
          color: #16a34a;
          font-weight: bold;
        }

        .tag-off {
          color: #dc2626;
          font-weight: bold;
        }

        .audio-lab-record-btn,
        .audio-lab-stop-btn,
        .audio-lab-run-btn {
          width: 100%;
          min-height: 44px;
          padding: 0.9rem 1rem;
          border-radius: 12px;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          font-size: 1rem;
          font-weight: 700;
        }

        .audio-lab-record-btn {
          background: #0f766e;
          color: white;
        }

        .audio-lab-stop-btn {
          background: #ef4444;
          color: white;
        }

        .audio-lab-run-btn {
          background: #2563eb;
          color: white;
        }

        .audio-lab-run-btn:disabled {
          background: #94a3b8;
          cursor: not-allowed;
        }

        .audio-lab-playback-area {
          margin-top: 0.3rem;
          padding-top: 1rem;
          border-top: 1px solid #e2e8f0;
        }

        .audio-lab-playback-area audio {
          width: 100%;
          margin: 0.7rem 0;
        }

        .audio-lab-upload-box {
          border: 2px dashed #cbd5e1;
          border-radius: 12px;
          padding: 2rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: #fdfefe;
        }

        .audio-lab-upload-box:hover {
          border-color: #0f766e;
          background: #f0fdfa;
        }

        .audio-lab-upload-icon {
          color: #64748b;
          margin-bottom: 1rem;
        }

        .audio-lab-subtext {
          font-size: 0.85rem;
          color: #94a3b8;
          display: block;
          margin-top: 0.5rem;
        }

        .audio-lab-file-info .filename {
          font-weight: 700;
          color: #0f172a;
        }

        .audio-lab-file-info .status {
          font-size: 0.9rem;
          color: #475569;
        }

        .audio-lab-helper {
          font-size: 0.9rem;
          color: #64748b;
          margin-top: 0.35rem;
        }

        .audio-lab-text-input {
          width: 100%;
          padding: 1rem;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          margin-bottom: 0.2rem;
          font-family: var(--font-sans);
          resize: vertical;
        }

        .audio-lab-text-input:focus {
          outline: 2px solid #0f766e;
          border-color: transparent;
        }

        .audio-lab-history-area {
          margin-top: 0.35rem;
          display: grid;
          gap: 0.9rem;
        }

        .audio-lab-history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }

        .audio-lab-clear-btn {
          padding: 0.45rem 0.8rem;
          background: #fee2e2;
          color: #991b1b;
          border: 1px solid #fecaca;
          border-radius: 8px;
          font-size: 0.84rem;
          cursor: pointer;
        }

        .audio-lab-table-wrap {
          background: #f8fafc;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          overflow: auto;
          max-height: 420px;
        }

        .audio-lab-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
        }

        .audio-lab-table th {
          text-align: left;
          padding: 0.75rem 1rem;
          background: #f1f5f9;
          color: #475569;
          font-weight: 600;
          position: sticky;
          top: 0;
        }

        .audio-lab-table td {
          padding: 0.75rem 1rem;
          border-top: 1px solid #e2e8f0;
          color: #1e293b;
          vertical-align: middle;
        }

        .audio-lab-log-row {
          cursor: pointer;
        }

        .audio-lab-log-row:hover {
          background: #f1f5f9;
        }

        .audio-lab-badge-cycles {
          background: #e0f2fe;
          color: #0369a1;
          padding: 2px 6px;
          border-radius: 10px;
          font-weight: 600;
        }

        .audio-lab-badge-errors {
          background: #ecfdf5;
          color: #047857;
          padding: 2px 6px;
          border-radius: 10px;
          font-weight: 600;
        }

        .audio-lab-model-code {
          background: #f1f5f9;
          padding: 2px 4px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 0.75rem;
        }

        .audio-lab-memory-flag {
          color: #ca8a04;
          margin-right: 0.25rem;
        }

        .audio-lab-no-logs {
          text-align: center;
          padding: 2rem !important;
          color: #94a3b8;
          font-style: italic;
        }

        @media (max-width: 1024px) {
          .audio-lab-container {
            padding: 1rem;
          }

          .audio-lab-history-header {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </div>
  );
};
