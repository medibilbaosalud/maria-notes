import React, { useState, useRef } from 'react';
import { Mic, Upload, Square, Activity, FileAudio, FileText } from 'lucide-react';
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
    const [uploadChunks, setUploadChunks] = useState<Blob[]>([]);
    const [fileName, setFileName] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [normalizationStatus, setNormalizationStatus] = useState('');
    const [processingStep, setProcessingStep] = useState('');
    const [manualText, setManualText] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Use our actual hook to test REAL constraints
    const { isRecording, startRecording, stopRecording, audioBlob: micBlob, duration } = useAudioRecorder({
        batchIntervalMs: 0 // Disable batching for simple test
    });

    React.useEffect(() => {
        if (mode === 'history') {
            const fetchLogs = async () => {
                const { getLabTestLogs } = await import('../services/storage');
                const logs = await getLabTestLogs();
                setHistoryLogs(logs);
            };
            fetchLogs();
        }
    }, [mode]);

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setFileName(file.name);
            setNormalizationStatus('Procesando y dividiendo audio...');
            setIsProcessing(true);
            try {
                // Apply normalization and chunking
                const chunks = await normalizeAndChunkAudio(file);
                setUploadChunks(chunks);
                setNormalizationStatus(`✓ Normalizado y dividido en ${chunks.length} partes`);
            } catch (e) {
                console.error('Normalization failed:', e);
                setUploadChunks([file]); // Fallback to original as single chunk
                setNormalizationStatus('⚠ Fallo al normalizar (usando original)');
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
                await onRunFullPipeline(micBlob, dummyName, false, 0);
            } else if (mode === 'upload' && uploadChunks.length > 0) {
                // Process chunks sequentially
                for (let i = 0; i < uploadChunks.length; i++) {
                    const isLast = i === uploadChunks.length - 1;
                    const partNum = i + 1;
                    const total = uploadChunks.length;

                    setProcessingStep(`Enviando parte ${partNum} de ${total} al servidor...`);
                    console.log(`[AudioLab] Sending chunk ${partNum}/${total}`);

                    // If not last, it's a partial batch. If last, it's the final segment.
                    await onRunFullPipeline(uploadChunks[i], dummyName, !isLast, i);

                    // Small delay to prevent race conditions in state updates
                    if (!isLast) await new Promise(r => setTimeout(r, 500));
                }
                setProcessingStep('¡Proceso completado!');
            } else if (mode === 'text' && manualText.trim()) {
                setProcessingStep('Procesando texto manual...');
                await onRunTextPipeline(manualText, dummyName);
                setProcessingStep('¡Proceso completado!');
            }
        } catch (error) {
            console.error(error);
            setProcessingStep('Error durante la simulación');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="audio-lab-container">
            <div className="lab-header">
                <h2>🧪 Laboratorio de Audio</h2>
                <button onClick={onClose} className="close-btn">Cerrar</button>
            </div>

            <div className="lab-tabs">
                <button
                    className={`tab ${mode === 'mic' ? 'active' : ''}`}
                    onClick={() => setMode('mic')}
                >
                    <Mic size={18} /> Prueba Micrófono
                </button>
                <button
                    className={`tab ${mode === 'upload' ? 'active' : ''}`}
                    onClick={() => setMode('upload')}
                >
                    <Upload size={18} /> Subir Archivo
                </button>
                <button
                    className={`tab ${mode === 'text' ? 'active' : ''}`}
                    onClick={() => setMode('text')}
                >
                    <FileText size={18} /> Pegar Transcripción
                </button>
                <button
                    className={`tab ${mode === 'history' ? 'active' : ''}`}
                    onClick={() => setMode('history')}
                >
                    <Activity size={18} /> Historial de Auditorías
                </button>
            </div>

            <div className="lab-content">
                {mode === 'mic' ? (
                    <div className="mic-test-area">
                        <div className="config-info">
                            <p><strong>Configuración Actual:</strong></p>
                            <ul>
                                <li>Auto Gain Control: <span className="tag-on">ON</span></li>
                                <li>Noise Suppression: <span className="tag-off">OFF</span></li>
                                <li>Echo Cancellation: <span className="tag-off">OFF</span></li>
                            </ul>
                        </div>

                        <div className="recorder-controls">
                            {!isRecording ? (
                                <button className="record-btn" onClick={startRecording}>
                                    <Mic size={24} /> Grabar Test
                                </button>
                            ) : (
                                <button className="stop-btn" onClick={stopRecording}>
                                    <Square size={24} /> Parar ({duration}s)
                                </button>
                            )}
                        </div>

                        {micBlob && (
                            <div className="playback-area">
                                <h3>Audio Capturado:</h3>
                                <audio controls src={URL.createObjectURL(micBlob)} />
                                <button className="run-pipeline-btn" onClick={handleRunSimulation} disabled={isProcessing}>
                                    <Activity size={18} /> {isProcessing ? 'Procesando...' : 'Procesar Audio'}
                                </button>
                            </div>
                        )}
                    </div>
                ) : mode === 'upload' ? (
                    <div className="upload-test-area">
                        <div className="upload-box" onClick={() => fileInputRef.current?.click()}>
                            <FileAudio size={48} className="upload-icon" />
                            <p>Click para subir audio (.mp3, .wav, .m4a)</p>
                            <span className="subtext">Se aplicará normalización de volumen automática</span>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileUpload}
                                accept="audio/*"
                                hidden
                            />
                        </div>

                        {fileName && (
                            <div className="file-info">
                                <p className="filename">{fileName}</p>
                                <p className="status">{normalizationStatus}</p>
                            </div>
                        )}

                        {uploadChunks.length > 0 && (
                            <div className="playback-area">
                                <h3>Audio Normalizado (Parte 1/{uploadChunks.length}):</h3>
                                <audio controls src={URL.createObjectURL(uploadChunks[0])} />
                                <button
                                    className="run-pipeline-btn"
                                    onClick={handleRunSimulation}
                                    disabled={isProcessing}
                                    style={{ opacity: isProcessing ? 0.7 : 1 }}
                                >
                                    <Activity size={18} />
                                    {isProcessing ? processingStep : `Procesar (${uploadChunks.length} partes)`}
                                </button>
                            </div>
                        )}
                    </div>
                ) : mode === 'text' ? (
                    <div className="text-test-area">
                        <div className="config-info">
                            <p><strong>Simulación Directa:</strong></p>
                            <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Pega aquí una transcripción real para probar la extracción y generación sin esperar a Whisper.</p>
                        </div>
                        <textarea
                            className="text-input"
                            value={manualText}
                            onChange={(e) => setManualText(e.target.value)}
                            placeholder="Pega aquí la transcripción..."
                            rows={10}
                        />
                        <button
                            className="run-pipeline-btn"
                            onClick={handleRunSimulation}
                            disabled={!manualText.trim() || isProcessing}
                        >
                            <Activity size={18} />
                            {isProcessing ? processingStep : 'Simular desde Texto'}
                        </button>
                    </div>
                ) : (
                    <div className="history-test-area">
                        {/* History view content already added partially, fixing structure here */}
                        <div className="history-header">
                            <h3>Historial de Pruebas de Auditoría</h3>
                            <button className="clear-logs-btn" onClick={async () => {
                                if (confirm('¿Borrar todo el historial de pruebas?')) {
                                    const { clearLabTestLogs } = await import('../services/storage');
                                    await clearLabTestLogs();
                                    setHistoryLogs([]);
                                }
                            }}>Limpiar Historial</button>
                        </div>
                        <div className="logs-table-container">
                            <table className="logs-table">
                                <thead>
                                    <tr>
                                        <th>Fecha</th>
                                        <th>Prueba</th>
                                        <th>Ciclos</th>
                                        <th>Errores Prev.</th>
                                        <th>Modelo Gen</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {historyLogs.map(log => (
                                        <tr key={log.id} className="log-row">
                                            <td>{new Date(log.created_at).toLocaleTimeString()}</td>
                                            <td title={log.test_name}>{log.test_name.replace('TEST_LAB_', '')}</td>
                                            <td><span className="badge-cycles">{log.metadata.versionsCount}</span></td>
                                            <td><span className="badge-errors">{log.metadata.errorsFixed}</span></td>
                                            <td><code className="model-code">{log.metadata.models.generation}</code></td>
                                        </tr>
                                    ))}
                                    {historyLogs.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="no-logs">No hay pruebas registradas aún.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                .audio-lab-container {
                    background: white;
                    border-radius: 16px;
                    padding: 2rem;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                    max-width: 600px;
                    margin: 2rem auto;
                    font-family: 'Inter', sans-serif;
                }
                .lab-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 2rem;
                }
                .lab-header h2 { margin: 0; color: #1e293b; }
                .close-btn {
                    padding: 0.5rem 1rem;
                    border: 1px solid #e2e8f0;
                    background: white;
                    border-radius: 8px;
                    cursor: pointer;
                }
                .lab-tabs {
                    display: flex;
                    gap: 1rem;
                    margin-bottom: 2rem;
                    border-bottom: 1px solid #e2e8f0;
                    padding-bottom: 1rem;
                    overflow-x: auto;
                }
                .tab {
                    display: flex;
                    gap: 0.5rem;
                    align-items: center;
                    padding: 0.5rem 1rem;
                    border: none;
                    background: transparent;
                    color: #64748b;
                    font-weight: 500;
                    cursor: pointer;
                    border-radius: 8px;
                    white-space: nowrap;
                }
                .tab.active {
                    background: #f0fdfa;
                    color: #0f766e;
                }
                .config-info {
                    background: #f8fafc;
                    padding: 1rem;
                    border-radius: 8px;
                    margin-bottom: 1.5rem;
                }
                .tag-on { color: #16a34a; font-weight: bold; }
                .tag-off { color: #dc2626; font-weight: bold; }
                
                .record-btn, .stop-btn {
                    width: 100%;
                    padding: 1rem;
                    border-radius: 12px;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 0.5rem;
                    font-size: 1.1rem;
                    font-weight: 600;
                    margin-bottom: 1.5rem;
                }
                .record-btn { background: #0f766e; color: white; }
                .stop-btn { background: #ef4444; color: white; }
                
                .upload-box {
                    border: 2px dashed #cbd5e1;
                    border-radius: 12px;
                    padding: 2rem;
                    text-align: center;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .upload-box:hover { border-color: #0f766e; background: #f0fdfa; }
                .upload-icon { color: #64748b; margin-bottom: 1rem; }
                .subtext { font-size: 0.85rem; color: #94a3b8; display: block; margin-top: 0.5rem; }
                
                .text-input {
                    width: 100%;
                    padding: 1rem;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    margin-bottom: 1rem;
                    font-family: 'Inter', sans-serif;
                    resize: vertical;
                }
                .text-input:focus { outline: 2px solid #0f766e; border-color: transparent; }

                .run-pipeline-btn {
                    width: 100%;
                    margin-top: 1rem;
                    padding: 1rem;
                    background: #2563eb;
                    color: white;
                    border: none;
                    border-radius: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    justify-content: center;
                    gap: 0.5rem;
                }
                .run-pipeline-btn:disabled { background: #94a3b8; cursor: not-allowed; }
                
                .playback-area {
                    margin-top: 1.5rem;
                    padding-top: 1.5rem;
                    border-top: 1px solid #e2e8f0;
                }
                audio { width: 100%; margin-bottom: 1rem; }
                .history-test-area {
                    margin-top: 1rem;
                }
                .history-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 1rem;
                }
                .clear-logs-btn {
                    padding: 0.4rem 0.8rem;
                    background: #fee2e2;
                    color: #991b1b;
                    border: 1px solid #fecaca;
                    border-radius: 6px;
                    font-size: 0.85rem;
                    cursor: pointer;
                }
                .logs-table-container {
                    background: #f8fafc;
                    border-radius: 12px;
                    border: 1px solid #e2e8f0;
                    overflow: auto;
                    max-height: 400px;
                }
                .logs-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.85rem;
                }
                .logs-table th {
                    text-align: left;
                    padding: 0.75rem 1rem;
                    background: #f1f5f9;
                    color: #475569;
                    font-weight: 600;
                    position: sticky;
                    top: 0;
                }
                .logs-table td {
                    padding: 0.75rem 1rem;
                    border-top: 1px solid #e2e8f0;
                    color: #1e293b;
                }
                .log-row:hover { background: #f1f5f9; }
                .badge-cycles {
                    background: #e0f2fe;
                    color: #0369a1;
                    padding: 2px 6px;
                    border-radius: 10px;
                    font-weight: 600;
                }
                .badge-errors {
                    background: #ecfdf5;
                    color: #047857;
                    padding: 2px 6px;
                    border-radius: 10px;
                    font-weight: 600;
                }
                .model-code {
                    background: #f1f5f9;
                    padding: 2px 4px;
                    border-radius: 4px;
                    font-family: monospace;
                    font-size: 0.75rem;
                }
                .no-logs {
                    text-align: center;
                    padding: 2rem !important;
                    color: #94a3b8;
                    font-style: italic;
                }
            `}</style>
        </div>
    );
};
