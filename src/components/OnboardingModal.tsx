import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    BookOpen,
    Brain,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    FileText,
    FolderOpen,
    Mic,
    PlayCircle,
    Settings2,
    ShieldCheck,
    Sparkles
} from 'lucide-react';

import type { ClinicalSpecialtyId } from '../clinical/specialties';
import { getClinicalSpecialtyConfig } from '../clinical/specialties';
import './OnboardingModal.css';

type AppView = 'record' | 'history' | 'reports' | 'result' | 'test-lab';

interface OnboardingModalProps {
    specialty: ClinicalSpecialtyId;
    clinicianName?: string;
    onClose: () => void;
    onOpenSettings: () => void;
    onNavigate: (view: AppView) => void;
    onStartDemo: () => void;
}

interface GuideStep {
    id: string;
    eyebrow: string;
    title: string;
    description: string;
    bullets: string[];
    accent: string;
    icon: typeof Brain;
}

const buildGuideSteps = (specialty: ClinicalSpecialtyId): GuideStep[] => {
    if (specialty === 'psicologia') {
        return [
            {
                id: 'captura',
                eyebrow: 'Consulta viva',
                title: 'Tu sesion se convierte en historia sin romper el ritmo terapeutico',
                description: 'Puedes centrarte en la escucha. Maria Notes va estructurando la consulta mientras hablas y deja lista una base profesional para revisar al final.',
                bullets: [
                    'Empieza en Consulta, escribe el nombre del paciente y pulsa grabar.',
                    'Puedes mantener sesiones largas: el audio se procesa por bloques en segundo plano.',
                    'Al terminar, la historia psicologica aparece ya organizada por motivo, antecedentes, sintomatologia, observaciones, impresion clinica y plan.'
                ],
                accent: 'sunrise',
                icon: Mic
            },
            {
                id: 'revision',
                eyebrow: 'Criterio clinico',
                title: 'Lo importante no es solo editar, sino ensenar a la app como trabajas',
                description: 'Cada ajuste manual ayuda a que el sistema aprenda tu forma de redactar, priorizar y nombrar la informacion clinica en Psicologia.',
                bullets: [
                    'Revisa primero observaciones clinicas e impresion clinica: suelen concentrar el matiz profesional.',
                    'Si corriges una seccion relevante, la IA lo registra como preferencia de tu practica.',
                    'Los cambios pequenos de estilo no interrumpen el flujo; los cambios clinicos fortalecen el aprendizaje.'
                ],
                accent: 'teal',
                icon: Brain
            },
            {
                id: 'entrega',
                eyebrow: 'Historia e informe',
                title: 'De la sesion a un informe claro, exportable y reutilizable',
                description: 'Desde Resultado puedes validar la historia, generar el informe psicologico y volver a consultas anteriores cuando necesites continuidad clinica.',
                bullets: [
                    'Usa Informes cuando quieras una pieza mas presentable para derivacion, seguimiento o archivo.',
                    'En Historial puedes reabrir pacientes previos y recuperar rapidamente su contexto.',
                    'Si cambias a otro modo clinico, el selector discreto de la esquina te deja volver a Psicologia al instante.'
                ],
                accent: 'paper',
                icon: FileText
            },
            {
                id: 'confianza',
                eyebrow: 'Seguridad de uso',
                title: 'Que conviene confiar al sistema y que conviene validar siempre',
                description: 'La app acelera documentacion y continuidad, pero el criterio final sigue siendo tuyo. Ese equilibrio es justo lo que la hace util en consulta real.',
                bullets: [
                    'Confia en la estructura inicial y en la recuperacion de la sesion.',
                    'Valida siempre formulaciones sensibles, riesgo, hipotesis clinicas y plan terapeutico.',
                    'Si algo no queda bien, editarlo es parte del onboarding real: la app aprende contigo.'
                ],
                accent: 'sage',
                icon: ShieldCheck
            }
        ];
    }

    return [
        {
            id: 'consulta',
            eyebrow: 'Inicio rapido',
            title: 'Graba, revisa y documenta sin salir del flujo clinico',
            description: 'Maria Notes captura la consulta, genera la historia y te deja cerrar el informe desde la misma interfaz.',
            bullets: [
                'Empieza en Consulta con nombre de paciente y grabacion.',
                'Al terminar, revisa la historia antes de cerrar.',
                'Usa Historial e Informes para seguimiento y documentacion.'
            ],
            accent: 'teal',
            icon: BookOpen
        }
    ];
};

const accentLabelByTone: Record<string, string> = {
    sunrise: 'En directo',
    teal: 'Aprendizaje',
    paper: 'Entrega',
    sage: 'Criterio'
};

export const OnboardingModal = ({
    specialty,
    clinicianName,
    onClose,
    onOpenSettings,
    onNavigate,
    onStartDemo
}: OnboardingModalProps) => {
    const steps = useMemo(() => buildGuideSteps(specialty), [specialty]);
    const [activeStepIndex, setActiveStepIndex] = useState(0);
    const activeStep = steps[activeStepIndex];
    const ActiveStepIcon = activeStep.icon;
    const specialtyConfig = getClinicalSpecialtyConfig(specialty);
    const isPsychology = specialty === 'psicologia';
    const clinicianLabel = clinicianName || specialtyConfig.professionalLabel;

    return (
        <div className="onboarding-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
            <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className={`onboarding-modal-card onboarding-modal-card-${specialty}`}
            >
                <div className="onboarding-hero">
                    <div className="onboarding-hero-copy">
                        <p className="onboarding-modal-kicker">
                            {isPsychology ? `Onboarding de bienvenida para ${clinicianLabel}` : 'Guia de inicio'}
                        </p>
                        <h2 id="onboarding-title">
                            {isPsychology
                                ? `${clinicianLabel}, esta es la mejor forma de trabajar Psicologia con Maria Notes`
                                : `Asi se utiliza Maria Notes en ${specialtyConfig.displayName}`}
                        </h2>
                        <p className="onboarding-modal-subtitle">
                            {isPsychology
                                ? 'Pensado para consulta real: escuchar, registrar bien, revisar con criterio y convertir cada edicion en aprendizaje util.'
                                : 'Una guia corta para entrar rapido, entender el flujo y sacar partido a la documentacion automatica.'}
                        </p>

                        <div className="onboarding-hero-pills" aria-label="Puntos fuertes del onboarding">
                            <span><Sparkles size={14} /> Flujo clinico natural</span>
                            <span><Brain size={14} /> Aprendizaje segun tus ediciones</span>
                            <span><FolderOpen size={14} /> Continuidad entre sesiones</span>
                        </div>
                    </div>

                    <div className="onboarding-hero-panel">
                        <div className="onboarding-hero-badge">
                            <span>{specialtyConfig.shortLabel}</span>
                            <strong>{clinicianLabel}</strong>
                        </div>
                        <div className="onboarding-hero-stat">
                            <span className="label">Tu ruta recomendada</span>
                            <strong>Consulta - Revision - Informe</strong>
                        </div>
                        <div className="onboarding-hero-stat">
                            <span className="label">Modo de trabajo</span>
                            <strong>{isPsychology ? 'Escucha primero, estructura despues' : 'Registro clinico asistido'}</strong>
                        </div>
                    </div>
                </div>

                <div className="onboarding-journey">
                    <div className="onboarding-step-rail" aria-label="Pasos del onboarding">
                        {steps.map((step, index) => {
                            const Icon = step.icon;
                            const isActive = index === activeStepIndex;
                            return (
                                <button
                                    key={step.id}
                                    type="button"
                                    className={`onboarding-step-chip ${isActive ? 'active' : ''}`}
                                    onClick={() => setActiveStepIndex(index)}
                                    aria-pressed={isActive}
                                >
                                    <span className="onboarding-step-chip-icon"><Icon size={16} /></span>
                                    <span>{step.eyebrow}</span>
                                </button>
                            );
                        })}
                    </div>

                    <motion.article
                        key={activeStep.id}
                        className={`onboarding-spotlight tone-${activeStep.accent}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                        <div className="onboarding-spotlight-header">
                            <div className="onboarding-spotlight-badge">{accentLabelByTone[activeStep.accent] || 'Paso'}</div>
                            <ActiveStepIcon size={22} />
                        </div>
                        <h3>{activeStep.title}</h3>
                        <p>{activeStep.description}</p>
                        <div className="onboarding-spotlight-list">
                            {activeStep.bullets.map((bullet) => (
                                <div key={bullet} className="onboarding-bullet-row">
                                    <CheckCircle2 size={16} />
                                    <span>{bullet}</span>
                                </div>
                            ))}
                        </div>
                    </motion.article>

                    <aside className="onboarding-checklist">
                        <h3>Primera toma de contacto ideal</h3>
                        <div className="onboarding-checklist-grid">
                            <article>
                                <strong>1. Entra en Consulta</strong>
                                <p>Abre una sesion real o simulada y comprueba como se genera la historia.</p>
                            </article>
                            <article>
                                <strong>2. Edita con calma</strong>
                                <p>Haz una correccion clinica de prueba para que la app empiece a aprender tu criterio.</p>
                            </article>
                            <article>
                                <strong>3. Genera informe</strong>
                                <p>Verifica que el resultado final te sirve para seguimiento o entrega profesional.</p>
                            </article>
                        </div>
                    </aside>
                </div>

                <div className="onboarding-modal-actions">
                    <div className="onboarding-progress" aria-label="Progreso del onboarding">
                        {steps.map((step, index) => (
                            <button
                                key={step.id}
                                type="button"
                                className={`onboarding-progress-dot ${index === activeStepIndex ? 'active' : ''}`}
                                aria-label={`Ir al paso ${index + 1}`}
                                onClick={() => setActiveStepIndex(index)}
                            />
                        ))}
                    </div>

                    <div className="onboarding-modal-buttons">
                        <button
                            type="button"
                            className="onboarding-btn onboarding-btn-secondary"
                            onClick={() => setActiveStepIndex((current) => Math.max(0, current - 1))}
                            disabled={activeStepIndex === 0}
                        >
                            <ChevronLeft size={16} />
                            Paso anterior
                        </button>
                        <button
                            type="button"
                            className="onboarding-btn onboarding-btn-secondary"
                            onClick={() => {
                                onOpenSettings();
                                onClose();
                            }}
                        >
                            <Settings2 size={16} />
                            Ajustes
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
                            Ver demo
                        </button>
                        <button
                            type="button"
                            className="onboarding-btn onboarding-btn-secondary"
                            onClick={() => {
                                onNavigate('history');
                                onClose();
                            }}
                        >
                            <FolderOpen size={16} />
                            Abrir historial
                        </button>
                        {activeStepIndex < steps.length - 1 ? (
                            <button
                                type="button"
                                className="onboarding-btn onboarding-btn-primary"
                                onClick={() => setActiveStepIndex((current) => Math.min(steps.length - 1, current + 1))}
                            >
                                Siguiente idea
                                <ChevronRight size={16} />
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="onboarding-btn onboarding-btn-primary"
                                onClick={() => {
                                    onNavigate('record');
                                    onClose();
                                }}
                            >
                                <BookOpen size={16} />
                                Entrar en Consulta
                            </button>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    );
};
