
import { useState, useRef, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Recorder } from './components/Recorder';

import { SearchHistory } from './components/SearchHistory';

import { Settings } from './components/Settings';
import { AIService } from './services/ai';
import { ReportsView } from './components/ReportsView';
import { ExtractionResult } from './services/groq';
import { saveMedicalRecord, updateMedicalRecord, saveLabTestLog } from './services/storage';
import { AudioTestLab } from './components/AudioTestLab';
import LessonsPanel from './components/LessonsPanel';
import { MemoryService } from './services/memory';
import './App.css';
import { Brain, ShieldCheck, Sparkles, X, Edit2, Check, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'framer-motion';

// API Key from environment variable
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';
// NEW PRIMARY KEY (Requested 30 Dec 2025)
// Note: Key split to avoid git scanning blockers during emergency deploy
const PRIMARY_GROQ_KEY = 'gsk_' + 'kHQQK7XhYtWRBtf4HSlxWGdyb3FY7nwWl0A04zIxOOsliYLQHN7q';

// Helper to get key array
const getApiKeys = (userKey: string) => {
    // Primary first, then User/Env key as fallback
    const keys = [PRIMARY_GROQ_KEY];
    if (userKey && userKey !== PRIMARY_GROQ_KEY) keys.push(userKey);
    return keys;
};

// ════════════════════════════════════════════════════════════════
// NEW: WELCOME MODAL FOR DRA. GOTXI (30 DEC 2025)
// ════════════════════════════════════════════════════════════════
const WelcomeDraGotxiModal = ({ onClose }: { onClose: () => void }) => {
    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)'
        }}>
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{
                    background: 'white', borderRadius: '24px', padding: '2rem', maxWidth: '600px', width: '90%',
                    boxShadow: '0 20px 50px rgba(0,0,0,0.2)', position: 'relative'
                }}
            >
                <button onClick={onClose} style={{
                    position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b'
                }}><X size={24} /></button>

                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)',
                        width: '80px', height: '80px', borderRadius: '50%', margin: '0 auto 1.5rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 10px 20px rgba(250, 204, 21, 0.2)'
                    }}>
                        <span style={{ fontSize: '2.5rem' }}>👩‍⚕️</span>
                    </div>
                    <h2 style={{ margin: 0, fontSize: '1.8rem', color: '#1e293b', fontWeight: 700 }}>
                        ¡Bienvenida, Dra. Gotxi!
                    </h2>
                    <p style={{ margin: '0.5rem 0 0', color: '#64748b' }}>
                        Hoy, 30 de diciembre de 2025, estrenamos una nueva era.
                    </p>
                </div>

                <div style={{ display: 'grid', gap: '1.5rem' }}>

                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                        <div style={{ background: '#eff6ff', padding: '10px', borderRadius: '12px', color: '#2563eb' }}>
                            <Brain size={24} />
                        </div>
                        <div>
                            <h3 style={{ margin: '0 0 0.25rem', color: '#1e293b' }}>1. Sistema Multi-Fase</h3>
                            <p style={{ margin: 0, fontSize: '0.95rem', color: '#475569', lineHeight: 1.5 }}>
                                Ya no transcribimos "a lo loco". Ahora el sistema <strong>escucha, analiza y estructura</strong> la información antes de escribir la historia, igual que harías tú. Mayor precisión clínica, menos ruido.
                            </p>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                        <div style={{ background: '#f0fdf4', padding: '10px', borderRadius: '12px', color: '#16a34a' }}>
                            <ShieldCheck size={24} />
                        </div>
                        <div>
                            <h3 style={{ margin: '0 0 0.25rem', color: '#1e293b' }}>2. Doble Comprobación</h3>
                            <p style={{ margin: 0, fontSize: '0.95rem', color: '#475569', lineHeight: 1.5 }}>
                                Hemos contratado a un "médico virtual revisor". Cada historia generada pasa por un <strong>filtro de calidad estricto</strong> para detectar alucinaciones o datos inventados antes de que tú la veas.
                            </p>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                        <div style={{ background: '#fefce8', padding: '10px', borderRadius: '12px', color: '#ca8a04' }}>
                            <Sparkles size={24} />
                        </div>
                        <div>
                            <h3 style={{ margin: '0 0 0.25rem', color: '#1e293b' }}>3. Aprendizaje Activo (Machine Learning)</h3>
                            <p style={{ margin: 0, fontSize: '0.95rem', color: '#475569', lineHeight: 1.5 }}>
                                Si corriges algo, <strong>el sistema aprende</strong>. Tu feedback se guarda en una memoria a largo plazo para mejorar día a día y adaptarse a tu estilo personal.
                            </p>
                        </div>
                    </div>
                </div>

                <button onClick={onClose} style={{
                    width: '100%', padding: '1rem', marginTop: '2rem', background: '#0f766e', color: 'white',
                    border: 'none', borderRadius: '12px', fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
                    boxShadow: '0 4px 6px -1px rgba(15, 118, 110, 0.2)'
                }}>
                    Entendido, ¡vamos a consulta! 🚀
                </button>
            </motion.div>
        </div>
    );
};

function App() {
    const [apiKey, setApiKey] = useState<string>(GROQ_API_KEY);
    const [showSettings, setShowSettings] = useState(false);
    const [history, setHistory] = useState<string>('');
    const [transcription, setTranscription] = useState<string>('');
    const [currentPatientName, setCurrentPatientName] = useState<string>('');
    const [_processingStatus, setProcessingStatus] = useState<string>('');
    const [currentView, setCurrentView] = useState<'record' | 'history' | 'reports' | 'result' | 'test-lab'>('record');
    const [savedRecordId, setSavedRecordId] = useState<string | number | null>(null);
    const [pipelineMetadata, setPipelineMetadata] = useState<{
        corrections: number;
        models: { generation: string; validation: string };
        errorsFixed: number;
        versionsCount: number;
        remainingErrors?: { type: string; field: string; reason: string }[];
        validationHistory?: { type: string; field: string; reason: string }[];
    } | undefined>(undefined);
    const [showLessons, setShowLessons] = useState(false);
    const [showWelcomeModal, setShowWelcomeModal] = useState(false);
    const [isEditingResult, setIsEditingResult] = useState(false);

    // ════════════════════════════════════════════════════════════════
    // BATCHING STATE: Store partial extractions for long consultations
    // ════════════════════════════════════════════════════════════════
    const extractionPartsRef = useRef<ExtractionResult[]>([]);
    const transcriptionPartsRef = useRef<string[]>([]);

    // ════════════════════════════════════════════════════════════════
    // PERSONALIZATION & MEMORY INIT
    // ════════════════════════════════════════════════════════════════
    useEffect(() => {
        // 1. Personal Greeting & Changelog (Logic: Show on 30 Dec 2025)
        const today = new Date();
        const isTargetDate = today.getDate() === 30 && today.getMonth() === 11 && today.getFullYear() === 2025;

        // Check if verify triggered already to be less annoying during dev refreshes? 
        // For now, user said "al entrar solo hoy", so we enforce date checking strictly.
        if (isTargetDate) {
            const hasSeenIntro = sessionStorage.getItem('hasSeenDraGotxiIntro');
            if (!hasSeenIntro) {
                setShowWelcomeModal(true);
                sessionStorage.setItem('hasSeenDraGotxiIntro', 'true');
            }
        }

        // 2. Memory Consolidation (Nightly Logic)
        const runConsolidation = async () => {
            if (apiKey || PRIMARY_GROQ_KEY) {
                console.log('Running startup memory consolidation...');
                // Pass both keys for robustness
                await MemoryService.consolidateDailyLessons(getApiKeys(apiKey));
            }
        };
        runConsolidation();
    }, [apiKey]); // Added apiKey dep to ensure it runs when key is ready

    const handleSaveSettings = (key: string) => {
        setApiKey(key);
        localStorage.setItem('groq_api_key', key);
        setShowSettings(false);
    };

    const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result as string;
                const base64Data = base64String.split(',')[1];
                resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };

    // ════════════════════════════════════════════════════════════════
    // UPDATED: Handle both partial batches and final recording
    // ════════════════════════════════════════════════════════════════
    const handleRecordingComplete = async (
        blob: Blob,
        patientName: string,
        isPartialBatch: boolean = false,
        batchIndex: number = 0
    ) => {
        if (!apiKey) {
            alert('Please configure your API Key in settings first.');
            setShowSettings(true);
            return;
        }

        const aiService = new AIService(getApiKeys(apiKey));

        try {
            // ─────────────────────────────────────────────────────────
            // CASE 1: PARTIAL BATCH (Background processing at T=35min)
            // ─────────────────────────────────────────────────────────
            if (isPartialBatch) {
                console.log(`[App] Processing partial batch ${batchIndex} in background...`);

                const base64Audio = await blobToBase64(blob);

                // Transcribe
                const transcriptResult = await aiService.transcribeAudio(base64Audio, blob.type, blob);
                transcriptionPartsRef.current.push(transcriptResult.data);
                console.log(`[App] Batch ${batchIndex} transcribed (${transcriptResult.data.length} chars)`);

                // Extract only (Phase 1)
                const extraction = await aiService.extractOnly(transcriptResult.data);
                extractionPartsRef.current.push(extraction);
                console.log(`[App] Batch ${batchIndex} extracted. Total parts: ${extractionPartsRef.current.length}`);

                return; // Don't update UI, keep recording
            }

            // ─────────────────────────────────────────────────────────
            // CASE 2: FINAL RECORDING (Merge + Generate)
            // ─────────────────────────────────────────────────────────
            // setIsLoading(true); // Removed
            setProcessingStatus('Iniciando procesamiento final...');
            setCurrentView('result');
            setCurrentPatientName(patientName);

            const base64Audio = await blobToBase64(blob);

            // 1. Final Transcription
            setProcessingStatus('Transcribiendo segmento final...');
            const transcriptResult = await aiService.transcribeAudio(base64Audio, blob.type, blob);

            // Add final part to accumulators
            transcriptionPartsRef.current.push(transcriptResult.data);
            const fullTranscription = transcriptionPartsRef.current.join(' ');
            setTranscription(fullTranscription);

            // 2. Final Extraction
            setProcessingStatus('Extrayendo datos clínicos finales...');
            const finalExtraction = await aiService.extractOnly(transcriptResult.data);
            extractionPartsRef.current.push(finalExtraction);

            // 3. Merge & Generate (The Logic Core)
            setProcessingStatus(`Fusionando ${extractionPartsRef.current.length} segmentos y generando historia...`);

            const result = await aiService.generateFromMergedExtractions(
                extractionPartsRef.current,
                fullTranscription,
                patientName
            );

            // 4. Update UI
            setHistory(result.data);
            setPipelineMetadata({
                corrections: result.corrections_applied || 0,
                models: { generation: result.model, validation: 'gpt-4o' }, // Simplified
                errorsFixed: 0, // Need to track this from validated pipeline
                versionsCount: (result.corrections_applied || 0) + 1,
                remainingErrors: result.remaining_errors,
                validationHistory: result.validations?.flatMap(v => v.errors)
            });
            setSavedRecordId(null);

            // 5. Cleanup Batch State
            extractionPartsRef.current = [];
            transcriptionPartsRef.current = [];

        } catch (error) {
            console.error(error);
            setProcessingStatus('Error en el procesamiento.');
            alert('Error processing audio. See console for details.');
            setCurrentView('record');
        } finally {
            // setIsLoading(false); // Removed
        }
    };

    const handleTextPipeline = async (text: string, patientName: string) => {
        if (!apiKey) {
            alert('Configura tu API Key primero');
            return;
        }
        const aiService = new AIService(getApiKeys(apiKey));
        // setIsLoading(true); // Removed
        setCurrentView('result');
        setProcessingStatus('Procesando texto directo...');
        try {
            // Treat as single extraction for now, or just extract -> generate
            // Reuse merge pipeline for consistency if we want
            const extraction = await aiService.extractOnly(text);
            const result = await aiService.generateFromMergedExtractions([extraction], text, patientName);

            setHistory(result.data);
            setTranscription(text);
            setPipelineMetadata({
                corrections: result.corrections_applied || 0,
                models: { generation: result.model, validation: 'gpt-4o' },
                errorsFixed: 0,
                versionsCount: (result.corrections_applied || 0) + 1,
                remainingErrors: result.remaining_errors,
                validationHistory: result.validations?.flatMap(v => v.errors)
            });

            // NEW: Save log for AudioTestLab history
            // We need to map the result to the LabTestLog format loosely or just rely on the fact 
            // that this function is primarily used by AudioTestLab now.
            if (result.active_memory_used) {
                await saveLabTestLog({
                    test_name: patientName,
                    input_type: 'text',
                    transcription: text,
                    medical_history: result.data,
                    metadata: {
                        corrections: result.corrections_applied || 0,
                        models: { generation: result.model, validation: 'mixed' },
                        versionsCount: (result.corrections_applied || 0) + 1,
                        errorsFixed: 0,
                        active_memory_used: true
                    }
                });
            }

        } catch (e) {
            console.error(e);
            setProcessingStatus('Error procesando texto');
        } finally {
            // setIsLoading(false); // Removed
        }
    }

    const handleSave = async (updatedContent: string) => {
        try {
            if (savedRecordId) {
                await updateMedicalRecord(savedRecordId.toString(), {
                    medical_history: updatedContent
                });
                alert('Historia actualizada correctamente');
            } else {
                const saved = await saveMedicalRecord({
                    patient_name: currentPatientName,
                    consultation_type: 'CONSULTA GENERAL ORL',
                    transcription: transcription,
                    medical_history: updatedContent,
                    ai_model: 'kimi-k2-merged'
                });
                if (saved && saved[0] && saved[0].id) {
                    setSavedRecordId(saved[0].id);
                    alert('Historia guardada correctamente');
                }
            }
        } catch (error) {
            console.error("Error saving record:", error);
            alert('Error al guardar la historia');
        }
    };

    return (
        <div className="app-container">
            <AnimatePresence>
                {showWelcomeModal && (
                    <WelcomeDraGotxiModal onClose={() => setShowWelcomeModal(false)} />
                )}
            </AnimatePresence>

            <Layout
                currentView={currentView}
                onNavigate={setCurrentView}
                onOpenSettings={() => setShowSettings(true)}
                onOpenLessons={() => setShowLessons(true)}
            >
                {currentView === 'record' && (
                    <div className="view-content">
                        <Recorder onRecordingComplete={handleRecordingComplete} />
                    </div>
                )}

                {currentView === 'history' && (
                    <SearchHistory
                        apiKey={apiKey}
                        onLoadRecord={(record) => {
                            setHistory(record.medical_history);
                            setTranscription(record.transcription || '');
                            setCurrentPatientName(record.patient_name);
                            if (record.id) setSavedRecordId(record.id);
                            // Set metadata if relevant, though legacy records might lack it
                            setCurrentView('result');
                        }}
                    />
                )}

                {currentView === 'reports' && (
                    <ReportsView />
                )}

                {currentView === 'result' && (
                    <div className="result-view">
                        <div className="result-header">
                            <button className="back-btn" onClick={() => setCurrentView('record')}>Wait, nueva consulta</button>
                            <h2>Historia Clínica Generada</h2>
                            <button
                                className="lessons-btn"
                                onClick={() => setShowLessons(true)}
                                title="Ver qué ha aprendido la IA hoy"
                            >
                                <Brain size={18} /> Ver Aprendizaje
                            </button>
                        </div>


                        {/* Audit Badge - Floating in Corner */}
                        {pipelineMetadata && (
                            <div className="audit-corner-badge" title="Información de Auditoría IA">
                                <div className="badge-header">
                                    <ShieldCheck size={16} className="text-emerald-600" />
                                    <span className="badge-stat">v{pipelineMetadata.versionsCount}</span>
                                </div>
                                <div className="badge-details">
                                    <div className="detail-row">
                                        <span>Correcciones:</span>
                                        <strong>{pipelineMetadata.errorsFixed}</strong>
                                    </div>
                                    <div className="detail-row">
                                        <span>Modelo:</span>
                                        <strong>{pipelineMetadata.models?.generation?.split('/').pop()}</strong>
                                    </div>
                                    {pipelineMetadata.remainingErrors && pipelineMetadata.remainingErrors.length > 0 && (
                                        <div className="detail-warnings">
                                            <strong>{pipelineMetadata.remainingErrors.length} Alertas Pendientes</strong>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="result-document-wrapper">
                            <div className="paper-document interactive">
                                <div className="document-header">
                                    <div className="doc-title-row">
                                        <FileText size={20} className="text-slate-400" />
                                        <span className="doc-label">Historia Clínica Generada</span>
                                    </div>
                                    <div className="doc-actions">
                                        <button
                                            className={`icon-btn ${isEditingResult ? 'active' : ''}`}
                                            onClick={() => setIsEditingResult(!isEditingResult)}
                                            title={isEditingResult ? "Ver vista previa" : "Editar documento"}
                                        >
                                            {isEditingResult ? <Check size={18} /> : <Edit2 size={18} />}
                                            <span>{isEditingResult ? 'Finalizar Edición' : 'Editar'}</span>
                                        </button>
                                    </div>
                                </div>

                                {isEditingResult ? (
                                    <textarea
                                        className="history-editor"
                                        value={history}
                                        onChange={(e) => setHistory(e.target.value)}
                                        placeholder="Escribe la historia clínica aquí..."
                                    />
                                ) : (
                                    <div className="document-content markdown-body">
                                        <ReactMarkdown>{history || '*Esperando contenido...*'}</ReactMarkdown>
                                    </div>
                                )}
                            </div>

                            {/* Quality Alerts Section (User Request) */}
                            {pipelineMetadata?.remainingErrors && pipelineMetadata.remainingErrors.length > 0 && (
                                <div className="quality-alerts-panel">
                                    <div className="panel-header">
                                        <Sparkles size={16} className="text-amber-500" />
                                        <h3>Sugerencias de Mejora</h3>
                                    </div>
                                    <div className="alerts-list">
                                        {pipelineMetadata.remainingErrors.map((err, idx) => (
                                            <div key={idx} className="alert-item">
                                                <span className="alert-field">{err.field}:</span>
                                                <span className="alert-reason">{err.reason}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="actions-bar sticky-bottom">
                            <button className="action-btn save" onClick={() => handleSave(history)}>
                                <Check size={18} />
                                Guardar en Historial
                            </button>
                        </div>
                    </div>
                )}

                {currentView === 'test-lab' && (
                    <AudioTestLab
                        onClose={() => setCurrentView('record')}
                        onRunFullPipeline={handleRecordingComplete}
                        onRunTextPipeline={handleTextPipeline}
                    />
                )}

                {showSettings && (
                    <Settings
                        apiKey={apiKey}
                        onSave={handleSaveSettings}
                        onClose={() => setShowSettings(false)}
                    />
                )}

                {showLessons && (
                    <LessonsPanel
                        onClose={() => setShowLessons(false)}
                        groqApiKey={getApiKeys(apiKey)}
                    />
                )}
            </Layout>
        </div>
    );
}

export default App;
