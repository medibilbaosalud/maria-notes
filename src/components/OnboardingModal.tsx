import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Brain,
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
        id: 'captura',
        icon: Mic,
        headline: 'Habla con tu paciente, Maria Notes escucha por ti',
        body: 'Pulsa grabar, centra tu atencion en la sesion y al terminar tendras la historia psicologica organizada y lista para revisar.',
        accent: 'sunrise'
    },
    {
        id: 'aprende',
        icon: Brain,
        headline: 'Cada correccion que haces ensena a la app',
        body: 'Si editas una seccion, la IA aprende tu estilo y criterio clinico. La proxima nota se parecera mas a tu forma de trabajar.',
        accent: 'teal'
    },
    {
        id: 'entrega',
        icon: FileText,
        headline: 'Historial, informes y continuidad clinica',
        body: 'Recupera sesiones anteriores, genera informes exportables y mantiene la continuidad entre consultas sin esfuerzo.',
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
                        ? `Hola ${name}, bienvenida a Maria Notes`
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
