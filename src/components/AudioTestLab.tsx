import React, { useMemo, useRef, useState } from 'react';
import { Mic, Upload, Square, Activity, FileAudio, FileText, Brain, ChevronRight, ClipboardList, Download } from 'lucide-react';
import { TestLogDetailModal } from './TestLogDetailModal';
import { AnimatePresence } from 'framer-motion';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { normalizeAndChunkAudio } from '../utils/audioProcessing';
import type { LabTestLog } from '../services/db';

interface AudioTestLabProps {
  onClose: () => void;
  onRunFullPipeline: (blob: Blob, patientName: string, isPartialBatch?: boolean, batchIndex?: number) => Promise<void>;
  onRunTextPipeline: (text: string, patientName: string) => Promise<void>;
}

type TestMode = 'mic' | 'upload' | 'text' | 'diagnostic' | 'history';
type DiagnosticExecutionMode = 'deterministic' | 'real';

type DiagnosticScenario = {
  id: string;
  label: string;
  source: 'text' | 'audio';
  transcript?: string;
  audioDurationsSec?: number[];
  audioFrequenciesHz?: number[];
  injectCorruptedMiddleChunk?: boolean;
};

const DIAGNOSTIC_SCENARIOS = [
  {
    id: 'single_chunk_clean',
    label: 'Single Chunk Limpio',
    source: 'text',
    transcript: 'Paciente refiere dolor de garganta de 3 dias, sin fiebre. Niega alergias. Exploracion faringea con hiperemia leve. Diagnostico de faringitis catarral. Plan: hidratacion, analgesia y control evolutivo en 48 horas.'
  },
  {
    id: 'multi_chunk_clean',
    label: 'Multi Chunk Limpio',
    source: 'audio',
    transcript: 'Paciente con obstruccion nasal cronica y rinorrea acuosa intermitente. Antecedentes de rinitis alergica estacional. Exploracion con cornetes hipertroficos bilaterales y sin datos de complicacion. Se pauta corticoide intranasal diario y lavado con suero salino. Se explica seguimiento clinico y signos de alarma.',
    audioDurationsSec: [4, 4, 4],
    audioFrequenciesHz: [330, 392, 440]
  },
  {
    id: 'chunk_failure_in_middle',
    label: 'Fallo Chunk Intermedio',
    source: 'audio',
    audioDurationsSec: [4, 3, 4],
    audioFrequenciesHz: [330, 196, 440],
    injectCorruptedMiddleChunk: true
  },
  {
    id: 'final_stage_failure',
    label: 'Final Stage Failure',
    source: 'text',
    transcript: 'Texto de prueba deliberadamente incompleto para estresar validaciones y forzar gaps criticos en secciones clinicas. Sin datos suficientes de plan ni diagnostico definitivo.'
  }
] as const satisfies readonly DiagnosticScenario[];

const createSyntheticWavBlob = (durationSec: number, frequencyHz: number, sampleRate = 16_000): Blob => {
  const totalSamples = Math.max(1, Math.floor(durationSec * sampleRate));
  const dataSize = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const amplitude = 0.2 * Math.sin(2 * Math.PI * frequencyHz * t);
    const sample = Math.max(-1, Math.min(1, amplitude));
    view.setInt16(44 + (i * 2), Math.round(sample * 32767), true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

const buildScenarioAudioChunks = (scenario: DiagnosticScenario): Blob[] => {
  const durations = scenario.audioDurationsSec || [4];
  const frequencies = scenario.audioFrequenciesHz || [330];
  const chunks = durations.map((duration, idx) => {
    const frequency = frequencies[idx] || frequencies[frequencies.length - 1] || 330;
    return createSyntheticWavBlob(duration, frequency);
  });
  if (scenario.injectCorruptedMiddleChunk && chunks.length >= 3) {
    const middle = Math.floor(chunks.length / 2);
    chunks[middle] = new Blob(['corrupted-audio-payload'], { type: 'audio/webm' });
  }
  return chunks;
};

const isDiagnosticLog = (log: LabTestLog) => Boolean(log.metadata?.diagnostics);

export const AudioTestLab: React.FC<AudioTestLabProps> = ({ onClose, onRunFullPipeline, onRunTextPipeline }) => {
  const [mode, setMode] = useState<TestMode>('mic');
  const [historyLogs, setHistoryLogs] = useState<LabTestLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<LabTestLog | null>(null);
  const [uploadChunks, setUploadChunks] = useState<Blob[]>([]);
  const [fileName, setFileName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [normalizationStatus, setNormalizationStatus] = useState('');
  const [processingStep, setProcessingStep] = useState('');
  const [manualText, setManualText] = useState('');
  const [diagnosticScenarioId, setDiagnosticScenarioId] = useState<string>(DIAGNOSTIC_SCENARIOS[0].id);
  const [diagnosticExecutionMode, setDiagnosticExecutionMode] = useState<DiagnosticExecutionMode>('deterministic');
  const [latestDiagnostic, setLatestDiagnostic] = useState<LabTestLog | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isRecording, startRecording, stopRecording, audioBlob: micBlob, duration } = useAudioRecorder({
    batchIntervalMs: 0
  });

  const selectedScenario = useMemo(
    () => DIAGNOSTIC_SCENARIOS.find((scenario) => scenario.id === diagnosticScenarioId) || DIAGNOSTIC_SCENARIOS[0],
    [diagnosticScenarioId]
  );

  const loadLogs = React.useCallback(async () => {
    const { getLabTestLogs } = await import('../services/storage');
    const logs = await getLabTestLogs();
    setHistoryLogs(logs);
    const latest = logs.find((log) => isDiagnosticLog(log)) || null;
    setLatestDiagnostic(latest);
  }, []);

  React.useEffect(() => {
    if (mode === 'history' || mode === 'diagnostic') {
      void loadLogs();
    }
  }, [mode, loadLogs]);

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
      await loadLogs();
    } catch (error) {
      console.error(error);
      setProcessingStep('Error durante la simulacion');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRunDiagnostic = async () => {
    const diagName = `DIAG_${diagnosticExecutionMode === 'deterministic' ? 'det' : 'real'}_${selectedScenario.id}_${Date.now()}`;
    setIsProcessing(true);
    setProcessingStep('Preparando escenario de diagnostico...');
    try {
      const useDeterministicText = diagnosticExecutionMode === 'deterministic' && selectedScenario.id === 'multi_chunk_clean';
      if (useDeterministicText) {
        await onRunTextPipeline(selectedScenario.transcript || '', diagName);
      } else if (selectedScenario.source === 'audio') {
        const chunks = buildScenarioAudioChunks(selectedScenario);
        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          setProcessingStep(`Ejecutando diagnostico audio: chunk ${i + 1}/${chunks.length}...`);
          await onRunFullPipeline(chunks[i], diagName, !isLast, i);
          if (!isLast) await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } else {
        await onRunTextPipeline(selectedScenario.transcript || '', diagName);
      }
      setProcessingStep('Diagnostico completado');
      await loadLogs();
    } catch (error) {
      console.error(error);
      setProcessingStep('Diagnostico fallido');
    } finally {
      setIsProcessing(false);
    }
  };

  const exportDiagnostics = (log: LabTestLog | null) => {
    if (!log?.metadata?.diagnostics) return;
    const payload = {
      exported_at: new Date().toISOString(),
      test_name: log.test_name,
      created_at: log.created_at,
      diagnostics: log.metadata.diagnostics
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lab-diagnostics-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="audio-lab-container" data-testid="audio-test-lab">
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
        <button className={`audio-lab-tab ${mode === 'diagnostic' ? 'active' : ''}`} onClick={() => setMode('diagnostic')}>
          <ClipboardList size={18} /> Diagnostico E2E
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
        ) : mode === 'diagnostic' ? (
          <div className="audio-lab-mode-block" data-testid="diagnostic-mode">
            <div className="audio-lab-config-card">
              <p><strong>Diagnostico E2E (simulacion deterministica):</strong></p>
              <p className="audio-lab-helper">Ejecuta pipeline completo y genera insights de salud por etapa.</p>
            </div>
            <label className="audio-lab-label">Escenario</label>
            <select
              value={diagnosticScenarioId}
              onChange={(e) => setDiagnosticScenarioId(e.target.value)}
              className="audio-lab-select"
              aria-label="Escenario de diagnostico"
              data-testid="diagnostic-scenario"
            >
              {DIAGNOSTIC_SCENARIOS.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>{scenario.label}</option>
              ))}
            </select>
            <label className="audio-lab-label">Modo de ejecucion</label>
            <select
              value={diagnosticExecutionMode}
              onChange={(e) => setDiagnosticExecutionMode(e.target.value as DiagnosticExecutionMode)}
              className="audio-lab-select"
              aria-label="Modo de ejecucion diagnostico"
              data-testid="diagnostic-execution-mode"
            >
              <option value="deterministic">Determinista</option>
              <option value="real">Real (STT/API)</option>
            </select>
            <button className="audio-lab-run-btn" onClick={handleRunDiagnostic} disabled={isProcessing} data-testid="run-diagnostic-btn">
              <ClipboardList size={18} />
              {isProcessing ? processingStep : 'Ejecutar diagnostico'}
            </button>

            {latestDiagnostic?.metadata?.diagnostics && (
              <div className="audio-lab-diagnostic-summary" data-testid="diagnostic-summary">
                <h3>Ultimo diagnostico</h3>
              <p><strong>Estado:</strong> {latestDiagnostic.metadata.diagnostics.status}</p>
              <p><strong>Fuente:</strong> {latestDiagnostic.metadata.diagnostics.input_source || latestDiagnostic.input_type}</p>
              <p><strong>Modo ejecucion:</strong> {latestDiagnostic.metadata.diagnostics.execution_mode || 'n/a'}</p>
              <p><strong>Escenario:</strong> {latestDiagnostic.metadata.diagnostics.scenario_id || 'n/a'}</p>
              <p><strong>Etapas:</strong> {latestDiagnostic.metadata.diagnostics.stage_results.length}</p>
                <p><strong>Insights:</strong> {(latestDiagnostic.metadata.diagnostics.insights || []).join(' | ') || 'Sin observaciones'}</p>
                <div className="audio-lab-diagnostic-actions">
                  <button className="audio-lab-export-btn" onClick={() => exportDiagnostics(latestDiagnostic)}>
                    <Download size={16} /> Exportar JSON
                  </button>
                  <button className="audio-lab-export-btn" onClick={() => setSelectedLog(latestDiagnostic)}>
                    Ver detalle
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="audio-lab-history-area">
            <div className="audio-lab-history-header">
              <h3>Historial de pruebas de auditoria</h3>
              <div className="audio-lab-history-actions">
                <button
                  className="audio-lab-export-btn"
                  onClick={() => exportDiagnostics(selectedLog || latestDiagnostic)}
                  disabled={!(selectedLog?.metadata?.diagnostics || latestDiagnostic?.metadata?.diagnostics)}
                >
                  <Download size={16} /> Exportar diagnostico
                </button>
                <button
                  className="audio-lab-clear-btn"
                  onClick={async () => {
                    if (confirm('Borrar todo el historial de pruebas?')) {
                      const { clearLabTestLogs } = await import('../services/storage');
                      await clearLabTestLogs();
                      setHistoryLogs([]);
                      setLatestDiagnostic(null);
                    }
                  }}
                >
                  Limpiar Historial
                </button>
              </div>
            </div>
            <div className="audio-lab-table-wrap">
              <table className="audio-lab-table" data-testid="diagnostic-history-table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Prueba</th>
                    <th>Estado</th>
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
                      <td title={log.test_name}>{log.test_name.replace('TEST_LAB_', '').replace('DIAG_', '')}</td>
                      <td>
                        <span className={`audio-lab-badge-status ${(log.metadata.diagnostics?.status || 'legacy').toLowerCase()}`}>
                          {log.metadata.diagnostics?.status || 'legacy'}
                        </span>
                      </td>
                      <td><span className="audio-lab-badge-cycles">{log.metadata.versionsCount}</span></td>
                      <td><span className="audio-lab-badge-errors">{log.metadata.errorsFixed}</span></td>
                      <td><code className="audio-lab-model-code">{`${log.input_type}:${log.metadata.models.generation}`}</code></td>
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
                      <td colSpan={7} className="audio-lab-no-logs">No hay pruebas registradas aun.</td>
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

        .audio-lab-label {
          font-size: 0.85rem;
          font-weight: 700;
          color: #334155;
        }

        .audio-lab-select {
          height: 42px;
          border-radius: 10px;
          border: 1px solid #cbd5e1;
          padding: 0 0.7rem;
          font-size: 0.95rem;
        }

        .audio-lab-config-card ul {
          margin-top: 0.65rem;
          margin-left: 1rem;
          display: grid;
          gap: 0.3rem;
        }

        .tag-on { color: #16a34a; font-weight: bold; }
        .tag-off { color: #dc2626; font-weight: bold; }

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

        .audio-lab-record-btn { background: #0f766e; color: white; }
        .audio-lab-stop-btn { background: #ef4444; color: white; }
        .audio-lab-run-btn { background: #2563eb; color: white; }
        .audio-lab-run-btn:disabled { background: #94a3b8; cursor: not-allowed; }

        .audio-lab-playback-area {
          margin-top: 0.3rem;
          padding-top: 1rem;
          border-top: 1px solid #e2e8f0;
        }

        .audio-lab-playback-area audio { width: 100%; margin: 0.7rem 0; }

        .audio-lab-upload-box {
          border: 2px dashed #cbd5e1;
          border-radius: 12px;
          padding: 2rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: #fdfefe;
        }

        .audio-lab-upload-box:hover { border-color: #0f766e; background: #f0fdfa; }

        .audio-lab-upload-icon { color: #64748b; margin-bottom: 1rem; }
        .audio-lab-subtext { font-size: 0.85rem; color: #94a3b8; display: block; margin-top: 0.5rem; }
        .audio-lab-file-info .filename { font-weight: 700; color: #0f172a; }
        .audio-lab-file-info .status { font-size: 0.9rem; color: #475569; }
        .audio-lab-helper { font-size: 0.9rem; color: #64748b; margin-top: 0.35rem; }

        .audio-lab-text-input {
          width: 100%;
          padding: 1rem;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          margin-bottom: 0.2rem;
          font-family: var(--font-sans);
          resize: vertical;
        }

        .audio-lab-text-input:focus { outline: 2px solid #0f766e; border-color: transparent; }

        .audio-lab-diagnostic-summary {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 1rem;
          display: grid;
          gap: 0.35rem;
        }

        .audio-lab-diagnostic-summary h3 { margin: 0; }

        .audio-lab-diagnostic-actions,
        .audio-lab-history-actions {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .audio-lab-export-btn,
        .audio-lab-clear-btn {
          padding: 0.45rem 0.8rem;
          border-radius: 8px;
          font-size: 0.84rem;
          cursor: pointer;
          border: 1px solid #cbd5e1;
          background: white;
          color: #1e293b;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }

        .audio-lab-clear-btn {
          background: #fee2e2;
          color: #991b1b;
          border-color: #fecaca;
        }

        .audio-lab-history-area { margin-top: 0.35rem; display: grid; gap: 0.9rem; }

        .audio-lab-history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
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

        .audio-lab-log-row { cursor: pointer; }
        .audio-lab-log-row:hover { background: #f1f5f9; }

        .audio-lab-badge-status,
        .audio-lab-badge-cycles,
        .audio-lab-badge-errors {
          padding: 2px 6px;
          border-radius: 10px;
          font-weight: 600;
        }

        .audio-lab-badge-status { background: #e2e8f0; color: #334155; }
        .audio-lab-badge-status.passed { background: #dcfce7; color: #166534; }
        .audio-lab-badge-status.failed { background: #fee2e2; color: #991b1b; }
        .audio-lab-badge-status.degraded { background: #fef3c7; color: #92400e; }

        .audio-lab-badge-cycles { background: #e0f2fe; color: #0369a1; }
        .audio-lab-badge-errors { background: #ecfdf5; color: #047857; }

        .audio-lab-model-code {
          background: #f1f5f9;
          padding: 2px 4px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 0.75rem;
        }

        .audio-lab-memory-flag { color: #ca8a04; margin-right: 0.25rem; }

        .audio-lab-no-logs {
          text-align: center;
          padding: 2rem !important;
          color: #94a3b8;
          font-style: italic;
        }

        @media (max-width: 1024px) {
          .audio-lab-container { padding: 1rem; }
          .audio-lab-history-header { flex-direction: column; align-items: flex-start; }
        }
      `}</style>
    </div>
  );
};
