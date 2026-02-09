import { motion } from 'framer-motion';
import { BookOpen, FolderOpen, Mic, PlayCircle, Settings2, TestTube2 } from 'lucide-react';
import './OnboardingModal.css';

type AppView = 'record' | 'history' | 'reports' | 'result' | 'test-lab';

interface OnboardingModalProps {
    onClose: () => void;
    onOpenSettings: () => void;
    onNavigate: (view: AppView) => void;
    onStartDemo: () => void;
}

const FEATURE_GUIDE = [
    {
        title: 'Consulta',
        icon: Mic,
        description: 'Empieza grabando. El sistema transcribe, extrae datos clinicos y genera la historia con validacion.'
    },
    {
        title: 'Resultado',
        icon: BookOpen,
        description: 'Revisa la historia final, corrige si hace falta y genera informe medico desde el mismo flujo.'
    },
    {
        title: 'Historial',
        icon: FolderOpen,
        description: 'Busca consultas previas por paciente o contenido y reabre cualquier historia en segundos.'
    },
    {
        title: 'Zona Test',
        icon: TestTube2,
        description: 'Pega transcripciones antiguas para probar el pipeline y guardar el resultado en Historias.'
    }
] as const;

export const OnboardingModal = ({
    onClose,
    onOpenSettings,
    onNavigate,
    onStartDemo
}: OnboardingModalProps) => {
    return (
        <div className="onboarding-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="onboarding-modal-card"
            >
                <div className="onboarding-modal-header">
                    <p className="onboarding-modal-kicker">Bienvenida de nuevo</p>
                    <h2 id="onboarding-title">Dra. Gotxi, asi funciona toda la app</h2>
                    <p className="onboarding-modal-subtitle">
                        Este resumen aparece al entrar para que tengas siempre claro el flujo de trabajo y no pierdas tiempo.
                    </p>
                </div>

                <div className="onboarding-modal-grid">
                    {FEATURE_GUIDE.map((item) => {
                        const Icon = item.icon;
                        return (
                            <article key={item.title} className="onboarding-feature">
                                <span className="onboarding-feature-icon" aria-hidden="true">
                                    <Icon size={18} />
                                </span>
                                <div>
                                    <h3>{item.title}</h3>
                                    <p>{item.description}</p>
                                </div>
                            </article>
                        );
                    })}
                </div>

                <div className="onboarding-workflow">
                    <h3>Flujo recomendado (1 minuto)</h3>
                    <p>1. Configura API keys en Configuracion.</p>
                    <p>2. Ve a Consulta, indica paciente y graba.</p>
                    <p>3. Revisa Resultado, ajusta y finaliza.</p>
                    <p>4. Si quieres validar casos antiguos, usa Zona Test con transcripcion pegada.</p>
                </div>

                <div className="onboarding-modal-actions">
                    <button
                        type="button"
                        className="onboarding-btn onboarding-btn-secondary"
                        onClick={() => {
                            onOpenSettings();
                            onClose();
                        }}
                    >
                        <Settings2 size={16} />
                        Configuracion
                    </button>
                    <button
                        type="button"
                        className="onboarding-btn onboarding-btn-secondary"
                        onClick={() => {
                            onNavigate('test-lab');
                            onClose();
                        }}
                    >
                        <TestTube2 size={16} />
                        Abrir Zona Test
                    </button>
                    <button
                        type="button"
                        className="onboarding-btn onboarding-btn-secondary"
                        onClick={() => {
                            onStartDemo();
                            onClose();
                        }}
                    >
                        <PlayCircle size={16} />
                        Demo guiada
                    </button>
                    <button
                        type="button"
                        className="onboarding-btn onboarding-btn-primary"
                        onClick={() => {
                            onNavigate('record');
                            onClose();
                        }}
                    >
                        Empezar consulta
                    </button>
                </div>
            </motion.div>
        </div>
    );
};
