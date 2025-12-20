import { useState } from 'react';
import { Layout } from './components/Layout';
import { Recorder } from './components/Recorder';
import { HistoryView } from './components/HistoryView';
import { Settings } from './components/Settings';
import { SearchHistory } from './components/SearchHistory';
import { ReportsView } from './components/ReportsView';
import { AIService } from './services/ai';
import { saveMedicalRecord } from './services/supabase';
import './App.css';

// Fallback notification component
const FallbackNotification = ({ show, onClose }: { show: boolean; onClose: () => void }) => {
    if (!show) return null;

    return (
        <div className="fallback-notification">
            <span className="fallback-icon">⚡</span>
            <span>Usando Groq como respaldo</span>
            <button onClick={onClose} className="fallback-close">×</button>
            <style>{`
                .fallback-notification {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    color: #e0e0e0;
                    padding: 12px 20px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 0.9rem;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                    z-index: 9999;
                    animation: slideIn 0.3s ease-out;
                    border: 1px solid rgba(255,255,255,0.1);
                }
                .fallback-icon {
                    font-size: 1.1rem;
                }
                .fallback-close {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 1.2rem;
                    cursor: pointer;
                    padding: 0 0 0 8px;
                    margin-left: 4px;
                }
                .fallback-close:hover {
                    color: #fff;
                }
                @keyframes slideIn {
                    from { transform: translateX(100px); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

// API Keys from environment variables
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';

function App() {
    const [apiKey, setApiKey] = useState<string>(GEMINI_API_KEY);
    const [showSettings, setShowSettings] = useState(false);
    const [history, setHistory] = useState<string>('');
    const [transcription, setTranscription] = useState<string>('');
    const [currentPatientName, setCurrentPatientName] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [currentView, setCurrentView] = useState<'record' | 'history' | 'reports' | 'result'>('record');
    const [savedRecordId, setSavedRecordId] = useState<string | null>(null);

    // Fallback notification state
    const [showFallbackNotice, setShowFallbackNotice] = useState(false);

    const handleSaveSettings = (key: string) => {
        setApiKey(key);
        localStorage.setItem('gemini_api_key', key);
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

    const handleRecordingComplete = async (blob: Blob, patientName: string) => {
        if (!apiKey) {
            alert('Please configure your API Key in settings first.');
            setShowSettings(true);
            return;
        }

        setIsLoading(true);
        setHistory('');
        setSavedRecordId(null);
        setShowFallbackNotice(false);
        setCurrentView('result');

        try {
            const aiService = new AIService(apiKey, GROQ_API_KEY);
            const base64Audio = await blobToBase64(blob);

            console.log('Transcribing audio...');
            const transcriptResult = await aiService.transcribeAudio(base64Audio, blob.type, blob);

            if (transcriptResult.fallbackUsed) {
                setShowFallbackNotice(true);
                // Auto-hide after 5 seconds
                setTimeout(() => setShowFallbackNotice(false), 5000);
            }

            setTranscription(transcriptResult.data);
            setCurrentPatientName(patientName);

            console.log('Generating history (auto-detecting type)...');
            const historyResult = await aiService.generateMedicalHistory(transcriptResult.data, patientName);

            if (historyResult.fallbackUsed && !showFallbackNotice) {
                setShowFallbackNotice(true);
                setTimeout(() => setShowFallbackNotice(false), 5000);
            }

            setHistory(historyResult.data);

            // Save to Supabase
            const savedData = await saveMedicalRecord({
                patient_name: patientName || 'Paciente Sin Nombre',
                consultation_type: 'Auto-detected',
                transcription: transcriptResult.data,
                medical_history: historyResult.data
            });

            if (savedData && savedData[0]?.id) {
                setSavedRecordId(savedData[0].id);
                console.log('Record saved with ID:', savedData[0].id);
            }

        } catch (error) {
            console.error('Error processing consultation:', error);
            setHistory(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
        } finally {
            setIsLoading(false);
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
                        <HistoryView
                            content={history}
                            isLoading={isLoading}
                            patientName={currentPatientName}
                            onGenerateReport={async () => {
                                const aiService = new AIService(apiKey, GROQ_API_KEY);
                                const reportResult = await aiService.generateMedicalReport(transcription, currentPatientName);

                                if (reportResult.fallbackUsed) {
                                    setShowFallbackNotice(true);
                                    setTimeout(() => setShowFallbackNotice(false), 5000);
                                }

                                if (savedRecordId) {
                                    console.log('Saving report to record:', savedRecordId);
                                    await import('./services/supabase').then(mod =>
                                        mod.updateMedicalRecord(savedRecordId, { medical_report: reportResult.data })
                                    );
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
                                setCurrentView('record');
                            }}
                        />
                    </div>
                </div>
            ) : currentView === 'history' ? (
                <div className="main-container">
                    <SearchHistory apiKey={apiKey} />
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

            {/* Fallback notification */}
            <FallbackNotification
                show={showFallbackNotice}
                onClose={() => setShowFallbackNotice(false)}
            />
        </Layout>
    );
}

export default App;
