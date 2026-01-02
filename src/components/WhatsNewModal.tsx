import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Brain, ChevronRight, Check, ShieldCheck, Layers, Cpu, Scale, MessageSquare, BarChart2, Clock, Sparkles, Zap, Star } from 'lucide-react';
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

const CoverSlide = ({ onStart }: { onStart: () => void }) => (
    <motion.div
        className="cover-slide"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, y: -20 }}
    >
        <div className="cover-badge">
            <Sparkles size={12} style={{ display: 'inline', marginRight: '6px' }} />
            Nueva Versión 3.0
        </div>

        <div className="cover-visual">
            <div className="cover-blob"></div>
            <div className="cover-emoji">👩‍⚕️</div>
            <div className="cover-sparkle s1"><Sparkles size={24} /></div>
            <div className="cover-sparkle s2"><Sparkles size={20} /></div>
            <div className="cover-sparkle s3"><Sparkles size={16} /></div>
        </div>

        <h1 className="cover-title">Bienvenida,<br />Dra. Gotxi</h1>
        <p className="cover-subtitle">
            Descubre la nueva generación de Inteligencia Artificial Médica.<br />
            Más inteligente. Más segura. Diseñada exclusivamente para ti.
        </p>

        <button className="cover-cta-btn" onClick={onStart}>
            Ver Novedades <ChevronRight size={20} />
        </button>
    </motion.div>
);

const FinalSlide = ({ onFinish }: { onFinish: () => void }) => (
    <motion.div
        className="final-slide"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, y: -20 }}
    >
        <div className="final-content">
            <div className="final-icon-large">
                <Star size={48} color="white" fill="white" />
            </div>

            <h1 className="final-title">Tu Nuevo Superpoder</h1>
            <p className="final-text">
                El sistema médico más avanzado que hemos creado jamás, ahora es tuyo.
                <br /><br />
                Disfruta de la tranquilidad de tener un equipo de IAs<br />cuidando cada detalle de tu consulta.
            </p>

            <button className="final-cta" onClick={onFinish}>
                Empezar la Experiencia <Sparkles size={20} />
            </button>
        </div>
    </motion.div>
);

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ onClose }) => {
    const [currentSlide, setCurrentSlide] = useState(0); // 0 = Cover, 1..N = Features, N+1 = Final

    const features = [
        {
            icon: BarChart2,
            color: '#10b981',
            title: "1. Impacto en Cifras",
            description: "Hemos medido el rendimiento del nuevo sistema comparado con la versión anterior. Los resultados son drásticos: una reducción masiva en errores y una capacidad de memoria triplicada.",
            visual: (
                <div className="mock-stats-grid">
                    <div className="stat-card">
                        <span className="stat-label">Alucinaciones</span>
                        <div className="stat-value-group">
                            <span className="stat-old">30%</span>
                            <span className="stat-new">0.1%</span>
                        </div>
                        <span className="stat-change positive">-99.7% Errores</span>
                    </div>
                    <div className="stat-card highlight">
                        <span className="stat-label">Memoria Contex.</span>
                        <div className="stat-value-group">
                            <span className="stat-old">15m</span>
                            <span className="stat-new">60m+</span>
                        </div>
                        <span className="stat-change positive">4x Duración</span>
                    </div>
                    <div className="stat-card">
                        <span className="stat-label">Precisión Datos</span>
                        <div className="stat-value-group">
                            <span className="stat-old">~75%</span>
                            <span className="stat-new">98%</span>
                        </div>
                    </div>
                    <div className="stat-card">
                        <span className="stat-label">Tasa Rechazo</span>
                        <div className="stat-value-group">
                            <span className="stat-old">Alta</span>
                            <span className="stat-new">Baja</span>
                        </div>
                    </div>
                </div>
            )
        },
        {
            icon: Brain,
            color: '#ec4899',
            title: "2. Machine Learning Profundo",
            description: "Hemos dotado a tu asistente de un ciclo de sueño biológico. 1) Durante el día, aprende correcciones rápidas. 2) Por la noche, mientras 'descansa', consolida esas lecciones para aplicarlas siempre a futuro.",
            visual: (
                <div className="mock-memory-arch">
                    <div className="memory-layer short">
                        <div className="memory-icon"><Brain size={20} color="#f59e0b" /></div>
                        <div className="memory-details">
                            <div className="memory-title">Memoria de Sesión (Día)</div>
                            <div className="memory-desc">Aprende al momento: "Ah, hoy prefieres 'mm/hg' en minúsculas".</div>
                        </div>
                    </div>

                    <div className="memory-arrow">
                        <Clock size={16} />
                        <span>Consolidación Nocturna</span>
                    </div>

                    <div className="memory-layer long">
                        <div className="memory-icon"><Brain size={20} color="#8b5cf6" /></div>
                        <div className="memory-details">
                            <div className="memory-title">Reglas Maestras (Noche)</div>
                            <div className="memory-desc">Generaliza: "La Dra. siempre usa minúsculas para unidades de presión".</div>
                        </div>
                    </div>
                </div>
            )
        },
        {
            icon: Layers,
            color: '#3b82f6',
            title: "3. La Nueva Arquitectura",
            description: "Antes, una sola IA intentaba hacerlo todo (audio a texto, y luego resumen) y se saturaba. Ahora, hemos dividido el trabajo en 4 especialistas: Escucha perfecta, Extracción quirúgica, Redacción clínica y Verificación. Divide y vencerás.",
            visual: (
                <div className="mock-pipeline-comparison">
                    <div className="pipeline-row old">
                        <span className="pipeline-label">Antes</span>
                        <div className="pipeline-step">
                            <div className="step-dot"></div>
                            <span>Audio</span>
                        </div>
                        <div className="pipeline-line"></div>
                        <div className="pipeline-step">
                            <div className="step-dot"></div>
                            <span>Texto</span>
                        </div>
                        <div className="pipeline-line"></div>
                        <div className="pipeline-step">
                            <div className="step-dot"></div>
                            <span>Resumen</span>
                        </div>
                    </div>
                    <div className="pipeline-row new">
                        <span className="pipeline-label">Ahora</span>
                        <div className="pipeline-step">
                            <div className="step-dot"></div>
                            <span>Audio</span>
                        </div>
                        <div className="pipeline-line"></div>
                        <div className="pipeline-step">
                            <div className="step-dot"></div>
                            <span>Extracción</span>
                        </div>
                        <div className="pipeline-line"></div>
                        <div className="pipeline-step">
                            <div className="step-dot"></div>
                            <span>Redacción</span>
                        </div>
                        <div className="pipeline-line"></div>
                        <div className="pipeline-step highlight">
                            <div className="step-dot"></div>
                            <span>Verificación</span>
                        </div>
                    </div>
                </div>
            )
        },
        {
            icon: Scale,
            color: '#64748b',
            title: "4. Comparativa Técnica",
            description: "ANTES: Usábamos 'Llama-8b', un modelo pequeño y rápido pero olvidadizo. AHORA: Usamos 'Orquestación'. Combinamos Llama para velocidad con modelos gigantes (GPT-120b) para pensar. Es como cambiar un becario por un equipo de consultores.",
            visual: (
                <div className="mock-comparison-ui">
                    <div className="comparison-col before">
                        <div className="comparison-title">Antes</div>
                        <div className="comparison-icon">🛵</div>
                        <div className="comparison-desc">Modelo Único (Llama)<br />Rápido pero simple<br />Se pierde fácil</div>
                    </div>
                    <div className="comparison-col after">
                        <div className="comparison-title">Ahora</div>
                        <div className="comparison-icon">🚀</div>
                        <div className="comparison-desc">Enjambre de IAs<br />Potencia Industrial<br />Razonamiento Profundo</div>
                    </div>
                </div>
            )
        },
        {
            icon: Cpu,
            color: '#6366f1',
            title: "5. Flujo Multifase & Auto-Corrección",
            description: "¿Router? No, es algo mejor: un Flujo Continuo con Bucle de Calidad. 1) Whisper Turbo escucha. 2) Llama 3.3 (el modelo más potente) piensa y estructura. 3) Si la Verificación final detecta el más mínimo error, el sistema repite el proceso automáticamente hasta garantizar el 100%.",
            visual: (
                <div className="mock-swarm-flow">
                    <div className="swarm-stage">
                        <div className="swarm-box input">
                            <span className="box-title"><MessageSquare size={14} /> Input</span>
                            <span className="box-desc">Audio / Notas</span>
                        </div>
                        <div className="swarm-arrow">↓</div>
                    </div>

                    <div className="swarm-grid">
                        <div className="swarm-agent-card flash">
                            <div className="agent-header"><Zap size={14} color="#d97706" /> Oído</div>
                            <span className="agent-task">Transcripción</span>
                            <span className="agent-model">Whisper V3 Turbo</span>
                            <span style={{ fontSize: '0.6rem', color: '#cbd5e1' }}>(Backup: V3)</span>
                        </div>
                        <div className="swarm-agent-card reasoning">
                            <div className="agent-header"><Brain size={14} color="#7c3aed" /> Cerebro</div>
                            <span className="agent-task">Razonamiento</span>
                            <span className="agent-model">Llama 3.3 70B</span>
                        </div>
                        <div className="swarm-agent-card extract">
                            <div className="agent-header"><BarChart2 size={14} color="#2563eb" /> Datos</div>
                            <span className="agent-task">Extracción JSON</span>
                            <span className="agent-model">Llama 3.1 8B</span>
                        </div>
                    </div>

                    <div className="swarm-stage">
                        <div className="swarm-arrow">↓</div>
                        <div className="swarm-box output">
                            <span className="box-title"><ShieldCheck size={14} color="#059669" /> Verificación</span>
                            <span className="box-desc">Cross-Check & Validación Final</span>
                        </div>
                        <div className="loop-container">
                            <div className="loop-line"></div>
                            <div className="loop-label">
                                <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', display: 'block' }}>REINTENTO</span>
                            </div>
                        </div>
                    </div>
                </div>
            )
        },
        {
            icon: MessageSquare,
            color: '#8b5cf6',
            title: "6. Comprensión Semántica",
            description: "Adiós a las correcciones tontas. El sistema antiguo marcaba error si decías 'cefalea' y él escribía 'dolor de cabeza'. El nuevo sistema entiende que significan lo mismo y respeta el contexto clínico.",
            visual: (
                <div className="mock-semantic-ui">
                    <div className="chat-bubble doc">"Refiere cefalea tensional..."</div>
                    <div className="chat-bubble ai">IA: Escribe "Dolor de cabeza tipo tensión" <Check size={14} /></div>
                    <div className="semantic-match">
                        <span className="match-text">Validación Semántica: OK</span>
                        <span className="icon-equals">≈</span>
                        <Check size={16} color="#10b981" />
                    </div>
                </div>
            )
        },
        {
            icon: ShieldCheck,
            color: '#10b981',
            title: "7. Seguridad 'Abogado del Diablo'",
            description: "Para tu tranquilidad, hemos integrado un sistema de validación adversarial. UNA IA escribe la historia, y OTRA IA intenta atacarla buscando fallos. Solo si sobrevive al ataque, te la mostramos.",
            visual: (
                <div className="mock-shield-ui">
                    <div className="shield-icon-large">
                        <ShieldCheck size={64} color="#10b981" />
                    </div>
                    <div className="shield-status">
                        <Check size={16} /> 0 Alucinaciones (Garantizado)
                    </div>
                </div>
            )
        },
        {
            icon: AlertTriangle,
            color: '#f59e0b',
            title: "8. Transparencia Total",
            description: "Si el sistema duda, te lo dice. Verás alertas amarillas para confirmar datos confusos. Además, puedes hacer clic en cualquier dato (Fuentes) para ver qué dijo exactamente el paciente. Cero cajas negras.",
            visual: (
                <div className="mock-uncertainty-panel">
                    <div className="mock-uncertainty-item">
                        <div className="mock-warning-icon"><AlertTriangle size={14} /></div>
                        <div className="mock-text">
                            <strong>Duda: Dosis</strong>
                            <span>¿500mg o 800mg? (Audio confuso)</span>
                        </div>
                        <div className="mock-actions">
                            <button className="mock-btn-confirm">500mg</button>
                            <button className="mock-btn-reject">800mg</button>
                        </div>
                    </div>
                </div>
            )
        }
    ];

    const totalSlides = features.length + 2; // Cover + Features + Final

    const nextSlide = () => {
        if (currentSlide < totalSlides - 1) {
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
                        {currentSlide === 0 ? (
                            <CoverSlide onStart={() => setCurrentSlide(1)} />
                        ) : currentSlide === totalSlides - 1 ? (
                            <FinalSlide onFinish={onClose} />
                        ) : (
                            <FeatureSlide
                                {...features[currentSlide - 1]}
                            />
                        )}
                    </div>

                    {currentSlide > 0 && currentSlide < totalSlides - 1 && (
                        <div className="whats-new-footer">
                            <div className="dots-indicator">
                                {features.map((_, idx) => (
                                    <div
                                        key={idx}
                                        className={`dot ${idx === currentSlide - 1 ? 'active' : ''}`}
                                        onClick={() => setCurrentSlide(idx + 1)}
                                    />
                                ))}
                            </div>
                            <button className="next-btn" onClick={nextSlide} style={{ backgroundColor: features[currentSlide - 1].color }}>
                                <span>Siguiente</span>
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
