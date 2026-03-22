import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Brain,
    Clock3,
    ChevronRight,
    FileText,
    Mic,
    PlayCircle
} from 'lucide-react';

import type { ClinicalSpecialtyId } from '../clinical/specialties';
import './OnboardingModal.css';

interface OnboardingModalProps {
    specialty: ClinicalSpecialtyId;
    clinicianName?: string;
    onClose: () => void;
    onStartDemo: () => void;
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
        body: 'Escribes el nombre del paciente, pulsas grabar y te centras en la sesion. Maria te ayuda a dejar la historia preparada para revisarla con calma.',
        accent: 'sunrise'
    },
    {
        id: 'contexto',
        icon: Clock3,
        headline: 'Si el paciente ya existe, no empiezas de cero',
        body: 'Antes de grabar veras un resumen muy corto para retomar el caso rapido y entrar a la sesion con el contexto fresco.',
        accent: 'teal'
    },
    {
        icon: FileText,
        id: 'historial',
        headline: 'En Historial lo ves todo mas claro',
        body: 'Cada paciente tiene su propia vista, con una vision general del caso y una linea temporal para seguir la evolucion sin perderte.',
        accent: 'sunrise'
    },
    {
        id: 'aprende',
        icon: Brain,
        headline: 'Y cuando corriges, Maria se adapta a ti',
        body: 'Cada ajuste ayuda a que la app se acerque mas a tu forma real de escribir, revisar y cerrar la historia clinica.',
        accent: 'paper'
    }
];

const GENERIC_SLIDES: TunnelSlide[] = [
    {
        id: 'intro',
        icon: Mic,
        headline: 'Graba, revisa y documenta sin salir del flujo',
        body: 'Maria Notes captura la consulta, genera la historia y te deja cerrar el informe desde la misma interfaz.',
        accent: 'teal'
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
    clinicianName,
    onClose,
    onStartDemo
}: OnboardingModalProps) => {
    const slides = getSlidesForSpecialty(specialty);
    const [index, setIndex] = useState(0);
    const isLastSlide = index >= slides.length - 1;
    const slide = slides[index];
    const SlideIcon = slide.icon;
    const isPsychology = specialty === 'psicologia';
    const name = clinicianName || 'profesional';

    const handleNext = () => {
        if (isLastSlide) {
            onStartDemo();
            onClose();
        } else {
            setIndex((i) => i + 1);
        }
    };

    return (
        <div className="onboarding-tunnel-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className={`onboarding-tunnel-card tone-${slide.accent}`}
            >
                {/* Greeting */}
                <p className="onboarding-tunnel-kicker">
                    {isPsychology
                        ? `Hola ${name}, te acompano en los primeros pasos`
                        : 'Guia rapida de Maria Notes'}
                </p>

                {/* Animated slide */}
                <AnimatePresence mode="wait">
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
                </AnimatePresence>

                {/* Footer: progress dots + CTA */}
                <div className="onboarding-tunnel-footer">
                    <div className="onboarding-tunnel-dots" aria-label="Progreso">
                        {slides.map((s, i) => (
                            <span
                                key={s.id}
                                className={`onboarding-tunnel-dot ${i === index ? 'active' : ''} ${i < index ? 'done' : ''}`}
                            />
                        ))}
                    </div>

                    <button
                        type="button"
                        className="onboarding-tunnel-cta"
                        onClick={handleNext}
                    >
                        {isLastSlide ? (
                            <>
                                <PlayCircle size={18} />
                                Iniciar demo
                            </>
                        ) : (
                            <>
                                Siguiente
                                <ChevronRight size={18} />
                            </>
                        )}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};
