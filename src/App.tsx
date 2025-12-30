import { useState, useRef } from 'react';
import { Layout } from './components/Layout';
import { Recorder } from './components/Recorder';
import { HistoryView } from './components/HistoryView';
import { Settings } from './components/Settings';
import { SearchHistory } from './components/SearchHistory';
import { ReportsView } from './components/ReportsView';
import { AIService } from './services/ai';
import { ExtractionResult } from './services/groq';
import { saveMedicalRecord, updateMedicalRecord, saveLabTestLog } from './services/storage';
import { AudioTestLab } from './components/AudioTestLab';
import LessonsPanel from './components/LessonsPanel';
import './App.css';

// API Key from environment variable
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';

function App() {
    const [apiKey, setApiKey] = useState<string>(GROQ_API_KEY);
    const [showSettings, setShowSettings] = useState(false);
    const [history, setHistory] = useState<string>('');
    const [transcription, setTranscription] = useState<string>('');
    const [currentPatientName, setCurrentPatientName] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [processingStatus, setProcessingStatus] = useState<string>('');
    const [currentView, setCurrentView] = useState<'record' | 'history' | 'reports' | 'result' | 'test-lab'>('record');
    const [savedRecordId, setSavedRecordId] = useState<number | null>(null);
    const [pipelineMetadata, setPipelineMetadata] = useState<{
        corrections: number;
        models: { generation: string; validation: string };
        errorsFixed: number;
        versionsCount: number;
        remainingErrors?: { type: string; field: string; reason: string }[];
        validationHistory?: { type: string; field: string; reason: string }[];
    } | undefined>(undefined);
    const [showLessons, setShowLessons] = useState(false);

    // ════════════════════════════════════════════════════════════════
    // BATCHING STATE: Store partial extractions for long consultations
    // ════════════════════════════════════════════════════════════════
    const extractionPartsRef = useRef<ExtractionResult[]>([]);
    const transcriptionPartsRef = useRef<string[]>([]);

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

        const aiService = new AIService(apiKey);

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
            // CASE 2: FINAL SEGMENT (User pressed Stop)
            // ─────────────────────────────────────────────────────────
            console.log('[App] Processing final segment...');
            setIsLoading(true);
            setHistory('');
            setSavedRecordId(null);
            setCurrentView('result');
            setCurrentPatientName(patientName);

            // Transcribe final segment
            setProcessingStatus('Transcribiendo audio final...');
            const base64Audio = await blobToBase64(blob);
            const finalTranscriptResult = await aiService.transcribeAudio(base64Audio, blob.type, blob);
            transcriptionPartsRef.current.push(finalTranscriptResult.data);

            // Combine all transcriptions
            const fullTranscription = transcriptionPartsRef.current.join(' ');
            setTranscription(fullTranscription);

            // Determine processing path
            const hasMultipleParts = extractionPartsRef.current.length > 0;

            let historyResult;

            if (hasMultipleParts) {
                // ═══════════════════════════════════════════════════════
                // MULTI-PART PATH: Merge extractions then generate
                // ═══════════════════════════════════════════════════════
                console.log(`[App] Multi-part consultation: ${extractionPartsRef.current.length + 1} parts`);

                // Extract final segment
                setProcessingStatus('Extrayendo datos del segmento final...');
                const finalExtraction = await aiService.extractOnly(finalTranscriptResult.data);
                extractionPartsRef.current.push(finalExtraction);

                // Merge and generate
                setProcessingStatus(`Fusionando ${extractionPartsRef.current.length} partes y generando historia...`);
                historyResult = await aiService.generateFromMergedExtractions(
                    extractionPartsRef.current,
                    fullTranscription,
                    patientName
                );
            } else {
                // ═══════════════════════════════════════════════════════
                // SINGLE-PART PATH: Standard pipeline
                // ═══════════════════════════════════════════════════════
                console.log('[App] Single-part consultation: standard pipeline');
                setProcessingStatus('Generando historia clínica...');
                historyResult = await aiService.generateMedicalHistory(fullTranscription, patientName);
            }

            setHistory(historyResult.data);
            setProcessingStatus('');

            // Map metadata for UI
            if (historyResult.validations) {
                // Flatten all errors from all validation rounds to show what was fixed
                const allFixedErrors = historyResult.validations.flatMap(v => v.errors || []);

                setPipelineMetadata({
                    corrections: historyResult.corrections_applied || 0,
                    models: {
                        generation: historyResult.model,
                        validation: 'Llama-4 / GPT-120B'
                    },
                    errorsFixed: allFixedErrors.length,
                    versionsCount: (historyResult.corrections_applied || 0) + 1,
                    remainingErrors: historyResult.remaining_errors,
                    validationHistory: allFixedErrors // New field for detailed log
                });
            }

            // Save to Supabase (only for regular consultations)
            if (!patientName.startsWith('TEST_LAB_')) {
                const savedData = await saveMedicalRecord({
                    patient_name: patientName || 'Paciente Sin Nombre',
                    consultation_type: hasMultipleParts ? 'Multi-part (merged)' : 'Single-part',
                    transcription: fullTranscription,
                    medical_history: historyResult.data,
                    original_medical_history: historyResult.data,
                    ai_model: historyResult.model
                });

                if (savedData && savedData[0]?.id) {
                    setSavedRecordId(savedData[0].id);
                    console.log('Record saved with ID:', savedData[0].id);
                }
            } else {
                // Save to Lab Test Logs
                await saveLabTestLog({
                    test_name: patientName,
                    input_type: 'audio',
                    transcription: fullTranscription,
                    medical_history: historyResult.data,
                    metadata: {
                        corrections: historyResult.corrections_applied || 0,
                        models: {
                            generation: historyResult.model,
                            validation: 'Llama-4 / GPT-120B'
                        },
                        errorsFixed: (historyResult.validations || []).reduce((acc, v) => acc + (v.errors?.length || 0), 0),
                        versionsCount: (historyResult.corrections_applied || 0) + 1,
                        validationHistory: historyResult.validations?.flatMap(v => v.errors || []),
                        remainingErrors: historyResult.remaining_errors
                    }
                });
                console.log('[App] Lab test results saved to history');
            }

            // Reset batching state for next recording
            extractionPartsRef.current = [];
            transcriptionPartsRef.current = [];

        } catch (error) {
            console.error('Error processing consultation:', error);
            setHistory(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
            setProcessingStatus('');
            // Reset on error too
            extractionPartsRef.current = [];
            transcriptionPartsRef.current = [];

            // CRITICAL: Switch to result view to show the error
            setCurrentView('result');
        } finally {
            setIsLoading(false);
        }
    };

    // ════════════════════════════════════════════════════════════════
    // NEW: Text-only pipeline for testing templates
    // ════════════════════════════════════════════════════════════════
    const handleTextPipeline = async (text: string, patientName: string) => {
        if (!apiKey) {
            alert('Please configure your API Key first.');
            return;
        }

        console.log('[App] Starting Text Simulation...');
        setIsLoading(true);
        setHistory('');
        setSavedRecordId(null);
        setCurrentView('result');
        setCurrentPatientName(patientName);
        setTranscription(text);

        try {
            const aiService = new AIService(apiKey);
            setProcessingStatus('Generando historia desde texto manual...');

            // Bypass transcription, go straight to generation (Extraction -> Gen -> Validation)
            const historyResult = await aiService.generateMedicalHistory(text, patientName);

            setHistory(historyResult.data);
            setProcessingStatus('');

            if (historyResult.validations) {
                setPipelineMetadata({
                    corrections: historyResult.corrections_applied || 0,
                    models: {
                        generation: historyResult.model,
                        validation: 'Llama-4 / GPT-120B'
                    },
                    errorsFixed: historyResult.validations.reduce((acc, v) => acc + (v.errors?.length || 0), 0),
                    versionsCount: (historyResult.corrections_applied || 0) + 1,
                    remainingErrors: historyResult.remaining_errors
                });
            }

            // Save as special "Text Simulation" record
            await saveMedicalRecord({
                patient_name: patientName,
                consultation_type: 'Text Simulation',
                transcription: text,
                medical_history: historyResult.data,
                original_medical_history: historyResult.data,
                ai_model: historyResult.model
            });

        } catch (error: any) {
            console.error('Text pipeline error:', error);
            setHistory(`Error: ${error.message}`);
        } finally {
            setIsLoading(false);
            setProcessingStatus('');
        }
    };

    return (
        <Layout
            onOpenSettings={() => setShowSettings(true)}
            currentView={currentView === 'result' ? 'record' : currentView}
            onNavigate={setCurrentView}
        >
            {currentView === 'record' ? (
                <div className="main-container">
                    <div className="recorder-section">
                        <Recorder onRecordingComplete={handleRecordingComplete} />
                    </div>
                </div>
            ) : currentView === 'result' ? (
                <div className="main-container">
                    <div className="content-section">
                        {processingStatus && (
                            <div className="processing-banner">
                                <div className="processing-spinner"></div>
                                {processingStatus}
                            </div>
                        )}
                        <HistoryView
                            content={history}
                            isLoading={isLoading}
                            patientName={currentPatientName}
                            metadata={pipelineMetadata}
                            onGenerateReport={async () => {
                                const aiService = new AIService(apiKey);
                                const reportResult = await aiService.generateMedicalReport(transcription, currentPatientName);

                                if (savedRecordId) {
                                    console.log('Saving report to record:', savedRecordId);
                                    await updateMedicalRecord(savedRecordId, { medical_report: reportResult.data });
                                } else {
                                    console.warn('No savedRecordId found, report will not be saved to DB');
                                }
                                return reportResult.data;
                            }}
                            onNewConsultation={() => {
                                setHistory('');
                                setTranscription('');
                                setCurrentPatientName('');
                                setSavedRecordId(null);
                                extractionPartsRef.current = [];
                                transcriptionPartsRef.current = [];
                                setCurrentView('record');
                            }}
                        />
                    </div>
                </div>
            ) : currentView === 'history' ? (
                <div className="main-container">
                    <SearchHistory apiKey={apiKey} />
                </div>
            ) : currentView === 'test-lab' ? (
                <div className="main-container">
                    <AudioTestLab
                        onClose={() => setCurrentView('record')}
                        onRunFullPipeline={handleRecordingComplete}
                        onRunTextPipeline={handleTextPipeline}
                    />
                </div>
            ) : (
                <div className="main-container">
                    <ReportsView />
                </div>
            )}

            {showSettings && (
                <Settings
                    apiKey={apiKey}
                    onSave={handleSaveSettings}
                    onClose={() => setShowSettings(false)}
                />
            )}

            {showLessons && (
                <div className="lessons-modal-overlay" onClick={() => setShowLessons(false)}>
                    <div className="lessons-modal" onClick={e => e.stopPropagation()}>
                        <LessonsPanel onClose={() => setShowLessons(false)} />
                    </div>
                </div>
            )}

            <style>{`
                .processing-banner {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 20px;
                    background: rgba(38, 166, 154, 0.1);
                    border-radius: 12px;
                    color: var(--brand-primary);
                    font-weight: 500;
                    margin-bottom: 16px;
                }
                
                .processing-spinner {
                    width: 18px;
                    height: 18px;
                    border: 2px solid rgba(38, 166, 154, 0.3);
                    border-top-color: var(--brand-primary);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                .lessons-modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0,0,0,0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                }
                .lessons-modal {
                    max-width: 90%;
                    max-height: 90%;
                    overflow: auto;
                }
            `}</style>
        </Layout>
    );
}

export default App;
