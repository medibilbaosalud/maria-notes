import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Brain,
    Clock3,
    ChevronRight,
    FileText,
    Mic,
    PlayCircle,
    Sparkles
} from 'lucide-react';

import type { ClinicalSpecialtyId } from '../clinical/specialties';
import { buildEditableTemplateFromReferenceStory } from '../services/clinical-style-profile';
import './OnboardingModal.css';

interface OnboardingModalProps {
    specialty: ClinicalSpecialtyId;
    clinicianName?: string;
    referenceStory?: string;
    generatedTemplate?: string;
    isProfileLoading?: boolean;
    onClose: () => void;
    onStartDemo: () => void;
    onSaveStyleProfile: (referenceStory: string, generatedTemplate: string) => Promise<void>;
}

interface TunnelSlide {
    id: string;
    icon: typeof Brain;
    headline: string;
    body: string;
    accent: string;
}

const PSYCHOLOGY_SLIDES: TunnelSlide[] = [
    {
        id: 'consulta',
        icon: Mic,
        headline: 'Siempre empiezas en Consulta',
        body: 'Escribes el nombre del paciente, pulsas grabar y te centras en la sesion. Maria prepara la nota para que luego la revises con calma.',
        accent: 'sunrise'
    },
    {
        id: 'contexto',
        icon: Clock3,
        headline: 'Si el paciente ya existe, no empiezas de cero',
        body: 'Antes de grabar ves un resumen muy corto para volver a situarte rapido y entrar en la sesion sin empezar en frio.',
        accent: 'teal'
    },
    {
        id: 'historial',
        icon: FileText,
        headline: 'En Historial lo ves todo mas claro',
        body: 'Cada paciente tiene su propio espacio, con lo importante del caso a mano y la evolucion lista para consultarla cuando la necesites.',
        accent: 'sunrise'
    }
];

const GENERIC_SLIDES: TunnelSlide[] = [
    {
        id: 'intro',
        icon: Mic,
        headline: 'Graba, revisa y documenta sin salir del flujo',
        body: 'Maria Notes captura la consulta, genera la historia y te deja cerrar el informe desde la misma interfaz.',
        accent: 'teal'
    },
    {
        id: 'history',
        icon: FileText,
        headline: 'Todo queda ordenado por paciente',
        body: 'Desde Historial puedes volver a cualquier consulta actual sin mezclar trabajo antiguo que no quieras ver.',
        accent: 'paper'
    }
];

const getSlidesForSpecialty = (specialty: ClinicalSpecialtyId): TunnelSlide[] =>
    specialty === 'psicologia' ? PSYCHOLOGY_SLIDES : GENERIC_SLIDES;

const slideVariants = {
    enter: { opacity: 0, x: 60 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -60 }
};

export const OnboardingModal = ({
    specialty,
    referenceStory = '',
    generatedTemplate = '',
    isProfileLoading = false,
    onClose,
    onStartDemo,
    onSaveStyleProfile
}: OnboardingModalProps) => {
    const slides = getSlidesForSpecialty(specialty);
    const setupIndex = slides.length;
    const totalSteps = slides.length + 1;
    const [index, setIndex] = useState(0);
    const [referenceValue, setReferenceValue] = useState(referenceStory);
    const [templateValue, setTemplateValue] = useState(generatedTemplate);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasSaved, setHasSaved] = useState(false);
    const isSetupStep = index === setupIndex;
    const isLastInfoStep = index === slides.length - 1;
    const slide = slides[Math.min(index, slides.length - 1)];
    const SlideIcon = slide.icon;
    const isPsychology = specialty === 'psicologia';

    useEffect(() => {
        setReferenceValue(referenceStory);
    }, [referenceStory]);

    useEffect(() => {
        setTemplateValue(generatedTemplate);
    }, [generatedTemplate]);

    const currentAccent = isSetupStep ? 'paper' : slide.accent;
    const canSave = referenceValue.trim().length >= 40 && templateValue.trim().length >= 20 && !isSaving;
    const generatedPreview = useMemo(() => {
        return buildEditableTemplateFromReferenceStory(specialty, referenceValue);
    }, [referenceValue, specialty]);

    const handleNext = () => {
        if (isSetupStep) return;
        setIndex((current) => Math.min(current + 1, setupIndex));
    };

    const handleGenerateTemplate = () => {
        setTemplateValue(generatedPreview);
        setError(null);
    };

    const handleSave = async (startDemoAfterSave = false) => {
        if (!canSave) return;
        setIsSaving(true);
        setError(null);
        try {
            await onSaveStyleProfile(referenceValue, templateValue);
            setHasSaved(true);
            if (startDemoAfterSave) {
                onStartDemo();
            }
            onClose();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar la referencia');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="onboarding-tunnel-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className={`onboarding-tunnel-card tone-${currentAccent} ${isSetupStep ? 'is-setup-step' : ''}`}
            >
                <p className="onboarding-tunnel-kicker">
                    {isSetupStep
                        ? 'Configura una historia de referencia'
                        : isPsychology
                            ? 'Vamos a dejar esto listo'
                            : 'Guia rapida de Maria Notes'}
                </p>

                <AnimatePresence mode="wait">
                    {!isSetupStep ? (
                        <motion.div
                            key={slide.id}
                            className="onboarding-tunnel-slide"
                            variants={slideVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                        >
                            <div className="onboarding-tunnel-icon-ring">
                                <SlideIcon size={28} />
                            </div>
                            <h2 id="onboarding-title">{slide.headline}</h2>
                            <p>{slide.body}</p>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="style-setup"
                            className="onboarding-style-setup"
                            variants={slideVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                        >
                            <div className="onboarding-tunnel-icon-ring">
                                <Sparkles size={28} />
                            </div>
                            <h2 id="onboarding-title">Pega una historia real como referencia</h2>
                            <p className="onboarding-style-copy">
                                Maria sacara de aqui una estructura editable para escribir como tu. Guardamos la muestra y la plantilla en Supabase para reutilizarla despues.
                            </p>

                            <label className="onboarding-style-field">
                                <span>Historia de referencia</span>
                                <textarea
                                    value={referenceValue}
                                    onChange={(event) => {
                                        setReferenceValue(event.target.value);
                                        setHasSaved(false);
                                    }}
                                    placeholder="Pega aqui una historia ya escrita por vosotras..."
                                    disabled={isProfileLoading || isSaving}
                                />
                            </label>

                            <div className="onboarding-style-actions">
                                <button
                                    type="button"
                                    className="onboarding-style-secondary"
                                    onClick={handleGenerateTemplate}
                                    disabled={referenceValue.trim().length < 20 || isProfileLoading || isSaving}
                                >
                                    Sacar estructura
                                </button>
                                <span className="onboarding-style-hint">
                                    {isProfileLoading ? 'Cargando estilo guardado...' : 'Puedes editar la estructura antes de guardarla.'}
                                </span>
                            </div>

                            <label className="onboarding-style-field">
                                <span>Estructura editable</span>
                                <textarea
                                    value={templateValue}
                                    onChange={(event) => {
                                        setTemplateValue(event.target.value);
                                        setHasSaved(false);
                                    }}
                                    placeholder="Aqui aparecera la estructura base que usare despues."
                                    disabled={isProfileLoading || isSaving}
                                />
                            </label>

                            {error && <div className="onboarding-style-error">{error}</div>}
                            {hasSaved && !error && <div className="onboarding-style-success">Referencia guardada correctamente.</div>}
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="onboarding-tunnel-footer">
                    <div className="onboarding-tunnel-dots" aria-label="Progreso">
                        {Array.from({ length: totalSteps }).map((_, stepIndex) => (
                            <span
                                key={`step-${stepIndex}`}
                                className={`onboarding-tunnel-dot ${stepIndex === index ? 'active' : ''} ${stepIndex < index ? 'done' : ''}`}
                            />
                        ))}
                    </div>

                    {!isSetupStep ? (
                        <button
                            type="button"
                            className="onboarding-tunnel-cta"
                            onClick={handleNext}
                        >
                            {isLastInfoStep ? (
                                <>
                                    Configurar estilo
                                    <ChevronRight size={18} />
                                </>
                            ) : (
                                <>
                                    Siguiente
                                    <ChevronRight size={18} />
                                </>
                            )}
                        </button>
                    ) : (
                        <div className="onboarding-style-footer">
                            <button
                                type="button"
                                className="onboarding-style-secondary"
                                onClick={() => {
                                    onStartDemo();
                                    onClose();
                                }}
                                disabled={isSaving}
                            >
                                <PlayCircle size={18} />
                                Entrar sin guardar
                            </button>
                            <button
                                type="button"
                                className="onboarding-tunnel-cta"
                                onClick={() => void handleSave(true)}
                                disabled={!canSave}
                            >
                                <Sparkles size={18} />
                                {isSaving ? 'Guardando...' : 'Guardar y entrar'}
                            </button>
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
};
