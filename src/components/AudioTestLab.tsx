import React, { useState, useRef } from 'react';
import { Mic, Upload, Square, Activity, FileAudio } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { normalizeAudio } from '../utils/audioProcessing';

interface AudioTestLabProps {
    onClose: () => void;
    onRunFullPipeline: (blob: Blob, patientName: string) => Promise<void>;
}

export const AudioTestLab: React.FC<AudioTestLabProps> = ({ onClose, onRunFullPipeline }) => {
    const [mode, setMode] = useState<'mic' | 'upload'>('mic');
    const [uploadBlob, setUploadBlob] = useState<Blob | null>(null);
    const [fileName, setFileName] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [normalizationStatus, setNormalizationStatus] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Use our actual hook to test REAL constraints
    const { isRecording, startRecording, stopRecording, audioBlob: micBlob, duration } = useAudioRecorder({
        batchIntervalMs: 0 // Disable batching for simple test
    });

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setFileName(file.name);
            setNormalizationStatus('Normalizando volumen...');
            setIsProcessing(true);
            try {
                // Apply normalization immediately upon upload
                const normalized = await normalizeAudio(file);
                setUploadBlob(normalized);
                setNormalizationStatus('✓ Normalización completada');
            } catch (e) {
                console.error('Normalization failed:', e);
                setUploadBlob(file); // Fallback to original
                setNormalizationStatus('⚠ Fallo al normalizar (usando original)');
            } finally {
                setIsProcessing(false);
            }
        }
    };

    const handleRunSimulation = () => {
        const blobToProcess = mode === 'mic' ? micBlob : uploadBlob;
        if (!blobToProcess) return;

        // Use a dummy name for test
        onRunFullPipeline(blobToProcess, `TEST_LAB_${new Date().toLocaleTimeString()}`);
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
                                <button className="run-pipeline-btn" onClick={handleRunSimulation}>
                                    <Activity size={18} /> Procesar este audio
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
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

                        {uploadBlob && !isProcessing && (
                            <div className="playback-area">
                                <h3>Audio Normalizado:</h3>
                                <audio controls src={URL.createObjectURL(uploadBlob)} />
                                <button className="run-pipeline-btn" onClick={handleRunSimulation}>
                                    <Activity size={18} /> Procesar este audio
                                </button>
                            </div>
                        )}
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
                
                .playback-area {
                    margin-top: 1.5rem;
                    padding-top: 1.5rem;
                    border-top: 1px solid #e2e8f0;
                }
                audio { width: 100%; margin-bottom: 1rem; }
            `}</style>
        </div>
    );
};
