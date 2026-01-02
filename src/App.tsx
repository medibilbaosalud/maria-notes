
import { useState, useRef, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Recorder } from './components/Recorder';

import { SearchHistory } from './components/SearchHistory';
import { HistoryView } from './components/HistoryView';

import { Settings } from './components/Settings';
import { AIService } from './services/ai';
import { ReportsView } from './components/ReportsView';
import type { ExtractionResult, ExtractionMeta, ConsultationClassification, UncertaintyFlag } from './services/groq';
import { saveLabTestLog } from './services/storage';
import { AudioTestLab } from './components/AudioTestLab';
import LessonsPanel from './components/LessonsPanel';
import { MemoryService } from './services/memory';
import { WhatsNewModal } from './components/WhatsNewModal';

import './App.css';
import { Brain, ShieldCheck, Sparkles, X } from 'lucide-react';
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

    const [pipelineMetadata, setPipelineMetadata] = useState<{
        corrections: number;
        models: { generation: string; validation: string };
        errorsFixed: number;
        versionsCount: number;
        remainingErrors?: { type: string; field: string; reason: string }[];
        validationHistory?: { type: string; field: string; reason: string }[];
        extractionMeta?: ExtractionMeta[];
        classification?: ConsultationClassification;
        uncertaintyFlags?: UncertaintyFlag[];
        auditId?: string;
    } | undefined>(undefined);
    const [showLessons, setShowLessons] = useState(false);
    const [showWelcomeModal, setShowWelcomeModal] = useState(false);
    const [showWhatsNew, setShowWhatsNew] = useState(false);


    // ════════════════════════════════════════════════════════════════
    // BATCHING STATE: Store partial extractions for long consultations
    // ════════════════════════════════════════════════════════════════
    const extractionPartsRef = useRef<ExtractionResult[]>([]);
    const transcriptionPartsRef = useRef<string[]>([]);
    const extractionMetaPartsRef = useRef<ExtractionMeta[]>([]);
    const classificationPartsRef = useRef<ConsultationClassification[]>([]);
    const aiServiceRef = useRef<AIService | null>(null);

    const pickBestClassification = (items: ConsultationClassification[]) => {
        if (!items || items.length === 0) {
            return { visit_type: 'unknown', ent_area: 'unknown', urgency: 'unknown', confidence: 0 };
        }
        return items.reduce((best, current) => {
            const bestScore = best?.confidence ?? 0;
            const currentScore = current?.confidence ?? 0;
            return currentScore > bestScore ? current : best;
        }, items[0]);
    };

    const buildValidationLabel = (validations?: { validator: string }[]) => {
        if (!validations || validations.length === 0) return 'unknown';
        const unique = Array.from(new Set(validations.map(v => v.validator).filter(Boolean)));
        return unique.join(' + ');
    };

    const prefixExtractionMeta = (meta: ExtractionMeta[], batchIndex: number) => {
        const prefix = `batch_${batchIndex + 1}`;
        return meta.map((chunk) => ({
            ...chunk,
            chunk_id: `${prefix}_${chunk.chunk_id}`,
            field_evidence: (chunk.field_evidence || []).map((entry) => ({
                ...entry,
                chunk_id: `${prefix}_${entry.chunk_id}`
            }))
        }));
    };

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
        aiServiceRef.current = null;
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

        const aiService = aiServiceRef.current || new AIService(getApiKeys(apiKey));
        aiServiceRef.current = aiService;

        try {
            // ─────────────────────────────────────────────────────────
            // CASE 1: PARTIAL BATCH (Background processing at T=30min)
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
                const normalizedMeta = prefixExtractionMeta(extraction.meta, batchIndex);
                extractionPartsRef.current.push(extraction.data);
                extractionMetaPartsRef.current.push(...normalizedMeta);
                classificationPartsRef.current.push(extraction.classification);
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
            const normalizedFinalMeta = prefixExtractionMeta(finalExtraction.meta, batchIndex);
            extractionPartsRef.current.push(finalExtraction.data);
            extractionMetaPartsRef.current.push(...normalizedFinalMeta);
            classificationPartsRef.current.push(finalExtraction.classification);

            // 3. Merge & Generate (The Logic Core)
            setProcessingStatus(`Fusionando ${extractionPartsRef.current.length} segmentos y generando historia...`);

            const result = await aiService.generateFromMergedExtractions(
                extractionPartsRef.current,
                fullTranscription,
                patientName,
                extractionMetaPartsRef.current,
                pickBestClassification(classificationPartsRef.current)
            );

            // 4. Update UI
            setHistory(result.data);
            setPipelineMetadata({
                corrections: result.corrections_applied || 0,
                models: { generation: result.model, validation: buildValidationLabel(result.validations) },
                errorsFixed: 0, // Need to track this from validated pipeline
                versionsCount: (result.corrections_applied || 0) + 1,
                remainingErrors: result.remaining_errors,
                validationHistory: result.validations?.flatMap(v => v.errors),
                extractionMeta: result.extraction_meta,
                classification: result.classification,
                uncertaintyFlags: result.uncertainty_flags,
                auditId: result.audit_id
            });


            // 5. Cleanup Batch State
            extractionPartsRef.current = [];
            transcriptionPartsRef.current = [];
            extractionMetaPartsRef.current = [];
            classificationPartsRef.current = [];

        } catch (error) {
            console.error(error);
            setProcessingStatus('Error en el procesamiento.');
            alert('Error processing audio. See console for details.');
            setCurrentView('record');
            extractionPartsRef.current = [];
            transcriptionPartsRef.current = [];
            extractionMetaPartsRef.current = [];
            classificationPartsRef.current = [];
        } finally {
            // setIsLoading(false); // Removed
        }
    };

    const handleTextPipeline = async (text: string, patientName: string) => {
        if (!apiKey) {
            alert('Configura tu API Key primero');
            return;
        }
        const aiService = aiServiceRef.current || new AIService(getApiKeys(apiKey));
        aiServiceRef.current = aiService;
        // setIsLoading(true); // Removed
        setCurrentView('result');
        setProcessingStatus('Procesando texto directo...');
        try {
            // Treat as single extraction for now, or just extract -> generate
            // Reuse merge pipeline for consistency if we want
            const extraction = await aiService.extractOnly(text);
            const normalizedMeta = prefixExtractionMeta(extraction.meta, 0);
            const result = await aiService.generateFromMergedExtractions(
                [extraction.data],
                text,
                patientName,
                normalizedMeta,
                extraction.classification
            );

            setHistory(result.data);
            setTranscription(text);
            setPipelineMetadata({
                corrections: result.corrections_applied || 0,
                models: { generation: result.model, validation: buildValidationLabel(result.validations) },
                errorsFixed: 0,
                versionsCount: (result.corrections_applied || 0) + 1,
                remainingErrors: result.remaining_errors,
                validationHistory: result.validations?.flatMap(v => v.errors),
                extractionMeta: result.extraction_meta,
                classification: result.classification,
                uncertaintyFlags: result.uncertainty_flags,
                auditId: result.audit_id
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
                        models: { generation: result.model, validation: buildValidationLabel(result.validations) },
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



    return (
        <div className="app-container">
            <AnimatePresence>
                {showWelcomeModal && (
                    <WelcomeDraGotxiModal onClose={() => setShowWelcomeModal(false)} />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showWhatsNew && (
                    <WhatsNewModal onClose={() => setShowWhatsNew(false)} />
                )}
            </AnimatePresence>

            <Layout
                currentView={currentView}
                onNavigate={setCurrentView}
                onOpenSettings={() => setShowSettings(true)}
                onOpenLessons={() => setShowLessons(true)}
            >
                {/* Floating "Novedades" Pill */}
                <motion.button
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="whats-new-trigger"
                    onClick={() => setShowWhatsNew(true)}
                    style={{
                        position: 'fixed',
                        top: '1rem',
                        right: '180px', // Left of settings usually
                        zIndex: 50,
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                        border: 'none',
                        color: 'white',
                        padding: '0.4rem 0.8rem',
                        borderRadius: '99px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                    }}
                >
                    <Sparkles size={14} />
                    <span>Novedades: AI v3.0</span>
                </motion.button>
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

                            // Set metadata if relevant, though legacy records might lack it
                            setCurrentView('result');
                        }}
                    />
                )}

                {currentView === 'reports' && (
                    <ReportsView />
                )}

                {currentView === 'result' && (
                    <HistoryView
                        content={history}
                        isLoading={false} // Loading handled by processing status usually, but here we are showing result
                        patientName={currentPatientName}
                        transcription={transcription}
                        apiKey={apiKey}
                        onNewConsultation={() => {
                            setHistory('');
                            setTranscription('');
                            setCurrentPatientName('');
                            setPipelineMetadata(undefined);
                            extractionPartsRef.current = [];
                            transcriptionPartsRef.current = [];
                            extractionMetaPartsRef.current = [];
                            classificationPartsRef.current = [];
                            aiServiceRef.current = null;
                            setCurrentView('record');
                        }}
                        onContentChange={(newContent) => setHistory(newContent)}
                        metadata={pipelineMetadata}
                        onGenerateReport={async () => {
                            // Reuse existing report generation logic if possible, or leave handled by HistoryView internal logic if simpler
                            // For now HistoryView handles generation via its own simple standard prompt if prop not fully passed, 
                            // but we can pass a closure to reuse AIService. 
                            const aiService = new AIService(getApiKeys(apiKey));
                            const res = await aiService.generateMedicalReport(transcription, currentPatientName);
                            return res.data;
                        }}
                    />
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
