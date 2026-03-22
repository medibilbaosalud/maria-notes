import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getSimulationDataForSpecialty, simulationData, type SimulationPayload } from './simulationData';
import type { ClinicalSpecialtyId } from '../../clinical/specialties';

type SimulationStepId =
    | 'intro'
    | 'move_to_input'
    | 'type_patient_name'
    | 'wait_for_briefing'
    | 'move_to_history'
    | 'click_history'
    | 'move_to_demo_patient'
    | 'focus_case_hub'
    | 'focus_timeline'
    | 'move_to_use_context'
    | 'click_use_context'
    | 'move_to_record'
    | 'click_record'
    | 'processing_1'
    | 'processing_2'
    | 'wait_for_highlight'
    | 'click_highlight'
    | 'wait_for_modal'
    | 'click_confirm'
    | 'move_to_edit'
    | 'click_edit'
    | 'simulate_typing'
    | 'click_save'
    | 'finish_learning'
    | 'move_to_feedback'
    | 'click_feedback_score'
    | 'submit_feedback'
    | 'finish';

type SimulationStep = {
    id: SimulationStepId;
    targetId?: string;
    duration?: number;
    action?: () => void;
    caption?: string;
};

interface SimulationContextType {
    isPlaying: boolean;
    currentStep: SimulationStep | null;
    startSimulation: (specialty?: ClinicalSpecialtyId, clinicianName?: string) => void;
    stopSimulation: () => void;
    cursorPosition: { x: number; y: number } | null;
    demoData: SimulationPayload | null;
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

export const useSimulation = () => {
    const context = useContext(SimulationContext);
    if (!context) {
        throw new Error('useSimulation must be used within a SimulationProvider');
    }
    return context;
};

const typeIntoInput = (inputId: string, value: string, intervalMs = 85) => {
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    if (!el) return;
    let index = 0;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const timer = window.setInterval(() => {
        const nextValue = value.slice(0, index + 1);
        if (nativeSetter) {
            nativeSetter.call(el, nextValue);
        } else {
            el.value = nextValue;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        index += 1;
        if (index >= value.length) {
            window.clearInterval(timer);
        }
    }, intervalMs);
};

const clickById = (id: string) => {
    const el = document.getElementById(id);
    if (el instanceof HTMLElement) {
        el.click();
    }
};

const clickFirstAvailable = (ids: string[]) => {
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el instanceof HTMLElement) {
            el.click();
            return true;
        }
    }
    return false;
};

const positionCursorOnTarget = (
    targetId: string,
    setCursorPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>
) => {
    const el = document.getElementById(targetId);
    if (!el) return;

    el.scrollIntoView({ behavior: 'auto', block: 'center' });

    window.setTimeout(() => {
        const target = document.getElementById(targetId);
        if (!target) return;
        const rect = target.getBoundingClientRect();
        setCursorPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        });
    }, 80);
};

const OTORRINO_SCRIPT: SimulationStep[] = [
    {
        id: 'intro',
        duration: 4000,
        caption: 'Bienvenida, {{clinicianName}}. Vamos a ver una consulta completa desde cero.'
    },
    {
        id: 'move_to_input',
        targetId: 'patient-name-input',
        duration: 2200,
        caption: 'Primero identificamos al paciente.'
    },
    {
        id: 'type_patient_name',
        targetId: 'patient-name-input',
        duration: 3600,
        action: () => typeIntoInput('patient-name-input', 'Paciente Demo (Simulacion)', 80),
        caption: 'Escribimos el nombre del paciente.'
    },
    {
        id: 'move_to_record',
        targetId: 'main-record-btn',
        duration: 2200,
        caption: 'Empezamos la consulta y Maria Notes se pone a escuchar.'
    },
    {
        id: 'click_record',
        targetId: 'main-record-btn',
        duration: 1000,
        action: () => clickById('main-record-btn')
    },
    {
        id: 'processing_1',
        duration: 5000,
        caption: 'La IA transcribe y estructura los datos medicos en segundo plano.'
    },
    {
        id: 'processing_2',
        duration: 5000,
        caption: 'Despues valida el borrador para que partas de una nota segura y editable.'
    },
    {
        id: 'wait_for_highlight',
        targetId: 'uncertainty-highlight-motivo_consulta-0',
        duration: 4200,
        caption: 'Si detecta una duda, la resalta para que la confirmes con evidencia.'
    },
    {
        id: 'click_highlight',
        targetId: 'uncertainty-highlight-motivo_consulta-0',
        duration: 1400,
        action: () => clickById('uncertainty-highlight-motivo_consulta-0'),
        caption: 'Abrimos la evidencia original.'
    },
    {
        id: 'wait_for_modal',
        targetId: 'evidence-modal-close-btn',
        duration: 4200,
        caption: 'Tu sigues teniendo la ultima palabra sobre lo que se guarda.'
    },
    {
        id: 'click_confirm',
        targetId: 'evidence-modal-close-btn',
        duration: 1200,
        action: () => {
            clickFirstAvailable(['evidence-modal-confirm-btn', 'evidence-modal-close-btn']);
        }
    },
    {
        id: 'move_to_edit',
        targetId: 'edit-mode-btn',
        duration: 2800,
        caption: 'Si quieres, ajustas la redaccion con tu propio criterio clinico.'
    },
    {
        id: 'click_edit',
        targetId: 'edit-mode-btn',
        duration: 1200,
        action: () => clickById('edit-mode-btn')
    },
    {
        id: 'simulate_typing',
        targetId: 'save-edit-btn',
        duration: 5200,
        caption: 'Cada correccion ayuda a que Maria se adapte mejor a tu estilo.'
    },
    {
        id: 'click_save',
        targetId: 'save-edit-btn',
        duration: 1400,
        action: () => clickById('save-edit-btn')
    },
    {
        id: 'finish_learning',
        duration: 5200,
        caption: 'La siguiente nota saldra mas cerca de como tu la escribes.'
    },
    {
        id: 'move_to_feedback',
        targetId: 'feedback-score-10',
        duration: 2600,
        caption: 'Solo queda valorar el resultado.'
    },
    {
        id: 'click_feedback_score',
        targetId: 'feedback-score-10',
        duration: 1200,
        action: () => clickById('feedback-score-10')
    },
    {
        id: 'submit_feedback',
        targetId: 'feedback-submit-btn',
        duration: 2200,
        action: () => clickById('feedback-submit-btn'),
        caption: 'Y con eso queda cerrada la consulta.'
    },
    {
        id: 'finish'
    }
];

const PSYCHOLOGY_SCRIPT: SimulationStep[] = [
    {
        id: 'intro',
        duration: 3200,
        caption: 'Bienvenida, {{clinicianName}}. Vamos a ver el flujo completo de una forma muy sencilla.'
    },
    {
        id: 'move_to_input',
        targetId: 'patient-name-input',
        duration: 2200,
        caption: 'Todo empieza en Consulta. Aqui escribes el nombre del paciente y ya puedes arrancar.'
    },
    {
        id: 'type_patient_name',
        targetId: 'patient-name-input',
        duration: 3600,
        action: () => typeIntoInput('patient-name-input', 'Paciente Demo Psicologia (Simulacion)', 75),
        caption: 'Si ese paciente ya existe, Maria reconoce el caso y no te hace empezar de cero.'
    },
    {
        id: 'wait_for_briefing',
        targetId: 'recorder-context-card',
        duration: 3600,
        caption: 'Antes de grabar, tienes un resumen muy corto para volver a situarte en segundos y entrar en la sesion sin empezar en frio.'
    },
    {
        id: 'move_to_history',
        targetId: 'recorder-open-history-btn',
        duration: 2600,
        caption: 'Y si quieres un poco mas de contexto, puedes abrir el historial completo desde aqui.'
    },
    {
        id: 'click_history',
        targetId: 'recorder-open-history-btn',
        duration: 1200,
        action: () => clickById('recorder-open-history-btn')
    },
    {
        id: 'move_to_demo_patient',
        targetId: 'history-patient-card-0',
        duration: 2800,
        caption: 'En Historial lo ves todo por paciente. Asi el caso vive en un solo sitio y no en notas sueltas.'
    },
    {
        id: 'focus_case_hub',
        targetId: 'history-case-hub',
        duration: 3600,
        caption: 'Aqui ves rapido lo importante del caso y, si hace falta, tienes debajo la evolucion para volver a leerla con calma.'
    },
    {
        id: 'move_to_use_context',
        targetId: 'history-use-context-btn',
        duration: 2400,
        caption: 'Cuando ya lo tienes claro, vuelves a Consulta con un solo clic.'
    },
    {
        id: 'click_use_context',
        targetId: 'history-use-context-btn',
        duration: 1200,
        action: () => clickById('history-use-context-btn')
    },
    {
        id: 'move_to_record',
        targetId: 'main-record-btn',
        duration: 2400,
        caption: 'De vuelta en Consulta, ya puedes empezar con el contexto fresco.'
    },
    {
        id: 'click_record',
        targetId: 'main-record-btn',
        duration: 1000,
        action: () => clickById('main-record-btn')
    },
    {
        id: 'processing_1',
        duration: 4400,
        caption: 'Mientras tu te centras en la conversacion, Maria va preparando la nota por detras.'
    },
    {
        id: 'processing_2',
        duration: 3400,
        caption: 'Despues te deja una nota clara y revisable para que partas de una buena base.'
    },
    {
        id: 'wait_for_highlight',
        targetId: 'uncertainty-highlight-antecedentes_relevantes-0',
        duration: 3600,
        caption: '¡Mira! Maria ha marcado una duda importante para que la revises con la evidencia original.'
    },
    {
        id: 'click_highlight',
        targetId: 'uncertainty-highlight-antecedentes_relevantes-0',
        duration: 1400,
        action: () => clickById('uncertainty-highlight-antecedentes_relevantes-0'),
        caption: 'La abrimos y compruebas enseguida si la sertralina era esa o no.'
    },
    {
        id: 'wait_for_modal',
        targetId: 'evidence-modal-confirm-btn',
        duration: 4000,
        caption: 'Asi decides tu, con calma, que entra en la historia clinica y que no.'
    },
    {
        id: 'click_confirm',
        targetId: 'evidence-modal-confirm-btn',
        duration: 1200,
        action: () => {
            clickFirstAvailable(['evidence-modal-confirm-btn', 'evidence-modal-close-btn']);
        }
    },
    {
        id: 'move_to_edit',
        targetId: 'edit-mode-btn',
        duration: 2400,
        caption: 'Y si quieres, ajustas la redaccion para que quede totalmente a tu manera.'
    },
    {
        id: 'click_edit',
        targetId: 'edit-mode-btn',
        duration: 1200,
        action: () => clickById('edit-mode-btn')
    },
    {
        id: 'simulate_typing',
        targetId: 'save-edit-btn',
        duration: 4200,
        caption: 'Cada correccion ayuda a que Maria aprenda un poco mas de tu estilo.'
    },
    {
        id: 'click_save',
        targetId: 'save-edit-btn',
        duration: 1400,
        action: () => clickById('save-edit-btn')
    },
    {
        id: 'finish_learning',
        duration: 2600,
        caption: 'Y con esto dejas el caso listo para la proxima sesion y la nota cada vez mas a tu manera.'
    },
    {
        id: 'move_to_feedback',
        targetId: 'feedback-card',
        duration: 1800,
        caption: 'Ya solo queda valorar el resultado.'
    },
    {
        id: 'click_feedback_score',
        targetId: 'feedback-score-10',
        duration: 1200,
        action: () => clickById('feedback-score-10')
    },
    {
        id: 'submit_feedback',
        targetId: 'feedback-submit-btn',
        duration: 1800,
        action: () => clickById('feedback-submit-btn'),
        caption: 'Y con esto queda cerrada la demo.'
    },
    {
        id: 'finish'
    }
];

const getScriptForSpecialty = (specialty: ClinicalSpecialtyId): SimulationStep[] =>
    specialty === 'psicologia' ? PSYCHOLOGY_SCRIPT : OTORRINO_SCRIPT;

export const SimulationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [stepIndex, setStepIndex] = useState(-1);
    const [activeClinicianName, setActiveClinicianName] = useState('');
    const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
    const activeScriptRef = useRef<SimulationStep[]>(OTORRINO_SCRIPT);
    const activeDemoDataRef = useRef<SimulationPayload>(simulationData);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const startSimulation = (specialty?: ClinicalSpecialtyId, clinicianName?: string) => {
        const resolvedSpecialty = specialty || 'otorrino';
        activeScriptRef.current = getScriptForSpecialty(resolvedSpecialty);
        activeDemoDataRef.current = getSimulationDataForSpecialty(resolvedSpecialty);
        setActiveClinicianName(clinicianName || (resolvedSpecialty === 'psicologia' ? 'Ainhoa' : 'Dra. Gotxi'));
        setIsPlaying(true);
        setStepIndex(0);
        setCursorPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    };

    const stopSimulation = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        setIsPlaying(false);
        setStepIndex(-1);
        setCursorPosition(null);
    };

    useEffect(() => {
        const script = activeScriptRef.current;
        if (!isPlaying || stepIndex < 0 || stepIndex >= script.length) {
            if (stepIndex >= script.length) {
                stopSimulation();
            }
            return;
        }

        const step = script[stepIndex];

        if (step.action) {
            step.action();
        }

        if (step.targetId) {
            positionCursorOnTarget(step.targetId, setCursorPosition);
        }

        timeoutRef.current = setTimeout(() => {
            setStepIndex((prev) => prev + 1);
        }, step.duration || 1000);

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [isPlaying, stepIndex]);

    const getCurrentStep = () => {
        if (!isPlaying || stepIndex < 0 || stepIndex >= activeScriptRef.current.length) {
            return null;
        }
        const step = activeScriptRef.current[stepIndex];
        if (!step.caption) {
            return step;
        }

        return {
            ...step,
            caption: step.caption.replace('{{clinicianName}}', activeClinicianName)
        };
    };

    return (
        <SimulationContext.Provider
            value={{
                isPlaying,
                currentStep: getCurrentStep(),
                startSimulation,
                stopSimulation,
                cursorPosition,
                demoData: isPlaying ? activeDemoDataRef.current : null
            }}
        >
            {children}
        </SimulationContext.Provider>
    );
};
