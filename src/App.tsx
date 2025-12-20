import { useState } from 'react';
import { Layout } from './components/Layout';
import { Recorder } from './components/Recorder';
import { HistoryView } from './components/HistoryView';
import { Settings } from './components/Settings';
import { SearchHistory } from './components/SearchHistory';
import { ReportsView } from './components/ReportsView';
import { GeminiService } from './services/gemini';
import { saveMedicalRecord } from './services/supabase';
import './App.css';

function App() {
    const [apiKey, setApiKey] = useState<string>('AIzaSyDWN02_VcDS5hCqlM2M3sM4xMjaEu3me1E');
    const [showSettings, setShowSettings] = useState(false);
    const [history, setHistory] = useState<string>('');
    const [transcription, setTranscription] = useState<string>('');
    const [currentPatientName, setCurrentPatientName] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [currentView, setCurrentView] = useState<'record' | 'history' | 'reports' | 'result'>('record');

    const [savedRecordId, setSavedRecordId] = useState<string | null>(null);

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
        setCurrentView('result'); // Switch to result view immediately

        try {
            const geminiService = new GeminiService(apiKey);
            const base64Audio = await blobToBase64(blob);

            console.log('Transcribing audio...');
            const transcript = await geminiService.transcribeAudio(base64Audio, blob.type);
            setTranscription(transcript);
            setCurrentPatientName(patientName);

            console.log('Generating history (auto-detecting type)...');
            const medicalHistory = await geminiService.generateMedicalHistory(transcript, patientName);

            setHistory(medicalHistory);

            // Save to Supabase
            const savedData = await saveMedicalRecord({
                patient_name: patientName || 'Paciente Sin Nombre',
                consultation_type: 'Auto-detected',
                transcription: transcript,
                medical_history: medicalHistory
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
            currentView={currentView === 'result' ? 'record' : currentView} // Highlight 'Consulta' even in result mode
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
                                const geminiService = new GeminiService(apiKey);
                                const report = await geminiService.generateMedicalReport(transcription, currentPatientName);

                                if (savedRecordId) {
                                    console.log('Saving report to record:', savedRecordId);
                                    await import('./services/supabase').then(mod =>
                                        mod.updateMedicalRecord(savedRecordId, { medical_report: report })
                                    );
                                } else {
                                    console.warn('No savedRecordId found, report will not be saved to DB');
                                }
                                return report;
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
        </Layout>
    );
}

export default App;
