import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, FileText, Brain, ChevronRight, Check, ShieldCheck, Layers, Cpu } from 'lucide-react';
import './WhatsNewModal.css';

interface WhatsNewModalProps {
    onClose: () => void;
}

const FeatureSlide = ({
    icon: Icon,
    title,
    description,
    visual,
    color
}: {
    icon: any,
    title: string,
    description: string,
    visual: React.ReactNode,
    color: string
}) => (
    <motion.div
        className="feature-slide"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
    >
        <div className="slide-content">
            <div className="icon-badge" style={{ backgroundColor: `${color}20`, color: color }}>
                <Icon size={32} />
            </div>
            <h2>{title}</h2>
            <p>{description}</p>
        </div>
        <div className="slide-visual">
            {visual}
        </div>
    </motion.div>
);

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ onClose }) => {
    const [currentSlide, setCurrentSlide] = useState(0);

    const features = [
        {
            icon: Layers,
            color: '#3b82f6',
            title: "Arquitectura Multi-Fase",
            description: "Hemos reemplazado la transcripción simple por un proceso de 4 fases: 1) Escucha, 2) Extrae datos puros, 3) Reconstruye la historia y 4) Verifica lógica. Esto permite consultas de +1 hora sin perder el hilo.",
            visual: (
                <div className="mock-pipeline-ui">
                    <div className="pipeline-step step-1">
                        <div className="step-dot"></div>
                        <span>Audio</span>
                    </div>
                    <div className="pipeline-line"></div>
                    <div className="pipeline-step step-2">
                        <div className="step-dot"></div>
                        <span>Extracción</span>
                    </div>
                    <div className="pipeline-line"></div>
                    <div className="pipeline-step step-3">
                        <div className="step-dot"></div>
                        <span>Redacción</span>
                    </div>
                    {/* Active phase visual */}
                </div>
            )
        },
        {
            icon: Cpu,
            color: '#6366f1',
            title: "Orquestación de Modelos",
            description: "El sistema ya no depende de una sola IA. Actúa como un director de orquesta, eligiendo el 'cerebro' ideal para cada tarea: Modelos rápidos para escribir, y modelos de alto razonamiento (como GPT-OSS-120b) para el análisis clínico.",
            visual: (
                <div className="mock-models-ui">
                    <div className="model-card">
                        <div className="model-icon speed">⚡</div>
                        <div className="model-info">
                            <span className="model-name">Flash Model</span>
                            <span className="model-task">Transcripción</span>
                        </div>
                    </div>
                    <div className="connector-line"></div>
                    <div className="model-card highlight">
                        <div className="model-icon brain">🧠</div>
                        <div className="model-info">
                            <span className="model-name">Reasoning Engine</span>
                            <span className="model-task">Diagnóstico</span>
                        </div>
                    </div>
                    <div className="connector-line"></div>
                    <div className="model-card">
                        <div className="model-icon shield">🛡️</div>
                        <div className="model-info">
                            <span className="model-name">Guard Model</span>
                            <span className="model-task">Validación</span>
                        </div>
                    </div>
                </div>
            )
        },
        {
            icon: ShieldCheck,
            color: '#10b981',
            title: "Protección y Validación",
            description: "Incorporamos un 'Abogado del Diablo'. Una segunda IA revisa cada historia buscando datos inventados (alucinaciones) y contradicciones antes de que tú la veas. Es tu escudo de seguridad.",
            visual: (
                <div className="mock-shield-ui">
                    <div className="shield-icon-large">
                        <ShieldCheck size={64} color="#10b981" />
                    </div>
                    <div className="shield-status">
                        <Check size={16} /> 0 Alucinaciones detectadas
                    </div>
                </div>
            )
        },
        {
            icon: AlertTriangle,
            color: '#f59e0b',
            title: "Semáforo de Confianza",
            description: "Si la IA escucha algo confuso (ruido de fondo, murmullo), no lo adivina. Lo marca en amarillo y te pregunta. Tú decides: 'Confirmar' o 'Rechazar'.",
            visual: (
                <div className="mock-uncertainty-panel">
                    <div className="mock-uncertainty-item">
                        <div className="mock-warning-icon"><AlertTriangle size={14} /></div>
                        <div className="mock-text">
                            <strong>Posible Alergia</strong>
                            <span>¿Dijo "Penicilina" o "Insulina"?</span>
                        </div>
                        <div className="mock-actions">
                            <button className="mock-btn-confirm">Confirmar</button>
                            <button className="mock-btn-reject">Corregir</button>
                        </div>
                    </div>
                </div>
            )
        },
        {
            icon: Brain,
            color: '#ec4899',
            title: "Machine Learning (Aprendizaje)",
            description: "¿Cómo funciona? Simple: Cuando corriges una nota o confirmas una duda, el sistema guarda esa lección. Mañana, la IA recordará tu estilo y no cometerá el mismo error.",
            visual: (
                <div className="mock-learning-ui">
                    <div className="mock-graph">
                        <div className="bar" style={{ height: '40%' }}></div>
                        <div className="bar" style={{ height: '60%' }}></div>
                        <div className="bar" style={{ height: '85%' }}></div>
                        <div className="bar active" style={{ height: '100%' }}></div>
                    </div>
                    <div className="mock-learning-status">
                        <Check size={14} /> Entrenando con tus correcciones
                    </div>
                </div>
            )
        },
        {
            icon: FileText,
            color: '#8b5cf6',
            title: "Evidencia y Trazabilidad",
            description: "Transparencia total. Ahora, al ver un dato extraído, puedes consultar la 'Fuente Original'. El sistema te mostrará exactamente qué palabras del paciente justifican ese diagnóstico.",
            visual: (
                <div className="mock-sources-ui">
                    <div className="mock-field-group">
                        <label>Diagnóstico (Extraído)</label>
                        <div className="mock-value">Otitis Media Aguda</div>
                    </div>
                    <div className="mock-connector"></div>
                    <div className="mock-evidence-box">
                        <div className="mock-evidence-label">Evidencia original:</div>
                        <div className="mock-evidence-text">"...veo el tímpano <span className="highlight">rojo y abombado</span>..."</div>
                    </div>
                </div>
            )
        }
    ];

    const nextSlide = () => {
        if (currentSlide < features.length - 1) {
            setCurrentSlide(prev => prev + 1);
        } else {
            onClose();
        }
    };

    return (
        <AnimatePresence>
            <motion.div
                className="whats-new-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            >
                <motion.div
                    className="whats-new-card"
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                >
                    <button className="close-btn-absolute" onClick={onClose}><X size={20} /></button>

                    <div className="whats-new-content">
                        <FeatureSlide
                            {...features[currentSlide]}
                        />
                    </div>

                    <div className="whats-new-footer">
                        <div className="dots-indicator">
                            {features.map((_, idx) => (
                                <div
                                    key={idx}
                                    className={`dot ${idx === currentSlide ? 'active' : ''}`}
                                    onClick={() => setCurrentSlide(idx)}
                                />
                            ))}
                        </div>
                        <button className="next-btn" onClick={nextSlide} style={{ backgroundColor: features[currentSlide].color }}>
                            <span>{currentSlide === features.length - 1 ? 'Empezar a usar' : 'Siguiente'}</span>
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
