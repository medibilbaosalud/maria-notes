import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getSimulationDataForSpecialty, simulationData, type SimulationPayload } from './simulationData.ts';
import type { ClinicalSpecialtyId } from '../../clinical/specialties';

type SimulationStepId =
    | 'intro'
    | 'move_to_input'
    | 'type_patient_name'
    | 'wait_for_briefing'
    | 'move_to_history'
    | 'click_history'
    | 'move_to_demo_patient'
    | 'focus_briefing_card'
    | 'focus_case_hub'
    | 'focus_timeline'
    | 'select_legacy_timeline_item'
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

const typeIntoInput = (inputId: string, value: string, intervalMs = 80) => {
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
    if (el) {
        el.click();
    }
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
        duration: 2000,
        caption: 'Primero identificamos al paciente.'
    },
    {
        id: 'type_patient_name',
        targetId: 'patient-name-input',
        duration: 3500,
        action: () => typeIntoInput('patient-name-input', 'Paciente Demo (Simulación)', 80),
        caption: 'Escribimos el nombre del paciente...'
    },
    {
        id: 'move_to_record',
        targetId: 'main-record-btn',
        duration: 2000,
        caption: 'Iniciamos la consulta para que Maria Notes empiece a escuchar.'
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
        caption: '1. Procesando audio: la IA transcribe y estructura los datos médicos al instante.'
    },
    {
        id: 'processing_2',
        duration: 5000,
        caption: '2. Validación clínica: el sistema audita el resultado buscando alucinaciones o errores.'
    },
    {
        id: 'wait_for_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 4000,
        caption: "3. Detección de dudas: la IA marca en amarillo un dato ambiguo para tu revisión."
    },
    {
        id: 'click_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 1500,
        action: () => clickById('uncertainty-highlight-0'),
        caption: 'Hacemos clic para ver la evidencia original...'
    },
    {
        id: 'wait_for_modal',
        targetId: 'evidence-modal-confirm-btn',
        duration: 5000,
        caption: 'Aquí ves la transcripción exacta. Tú tienes la última palabra sobre qué guardar.'
    },
    {
        id: 'click_confirm',
        targetId: 'evidence-modal-confirm-btn',
        duration: 1500,
        action: () => clickById('evidence-modal-confirm-btn'),
        caption: 'Validamos el dato correcto.'
    },
    {
        id: 'move_to_edit',
        targetId: 'edit-mode-btn',
        duration: 3000,
        caption: "¿No te gusta el estilo o falta algo? Dale a 'Editar'."
    },
    {
        id: 'click_edit',
        targetId: 'edit-mode-btn',
        duration: 1500,
        action: () => clickById('edit-mode-btn'),
        caption: 'Entrando en modo edición...'
    },
    {
        id: 'simulate_typing',
        targetId: 'save-edit-btn',
        duration: 6000,
        caption: "Modificas el texto... la IA observa cómo prefieres estructurar la nota."
    },
    {
        id: 'click_save',
        targetId: 'save-edit-btn',
        duration: 2000,
        action: () => clickById('save-edit-btn'),
        caption: 'Guardando cambios...'
    },
    {
        id: 'finish_learning',
        duration: 7000,
        caption: 'Analizando correcciones. La próxima nota usará mejor tu estructura preferida.'
    },
    {
        id: 'move_to_feedback',
        targetId: 'feedback-score-10',
        duration: 3000,
        caption: 'Lo último es valorar la calidad clínica de la nota generada.'
    },
    {
        id: 'submit_feedback',
        targetId: 'feedback-submit-btn',
        duration: 3000,
        action: () => clickById('feedback-submit-btn'),
        caption: 'Enviamos la valoración para que el sistema aprenda de tus preferencias.'
    },
    {
        id: 'finish'
    }
];

const PSYCHOLOGY_SCRIPT: SimulationStep[] = [
    {
        id: 'intro',
        duration: 3200,
        caption: 'Bienvenida, {{clinicianName}}. Vamos a enseñarte cómo Maria Notes te prepara una sesión de Psicología con continuidad real.'
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
        duration: 3800,
        action: () => typeIntoInput('patient-name-input', 'Paciente Demo Psicología (Simulación)', 75),
        caption: 'Escribimos el nombre y Maria Notes reconoce que ya existe contexto previo.'
    },
    {
        id: 'wait_for_briefing',
        targetId: 'recorder-context-card',
        duration: 3200,
        caption: 'Antes de grabar, aparece un Briefing 30s con lo último importante del caso.'
    },
    {
        id: 'move_to_history',
        targetId: 'recorder-open-history-btn',
        duration: 2600,
        caption: 'Si quieres profundizar, puedes abrir el historial completo sin salir del flujo.'
    },
    {
        id: 'click_history',
        targetId: 'recorder-open-history-btn',
        duration: 1400,
        action: () => clickById('recorder-open-history-btn'),
        caption: 'Entramos al historial unificado del paciente.'
    },
    {
        id: 'move_to_demo_patient',
        targetId: 'history-patient-card-0',
        duration: 2600,
        caption: 'Aquí se agrupan juntas la consulta actual y el histórico importado.'
    },
    {
        id: 'focus_briefing_card',
        targetId: 'history-briefing-card',
        duration: 3200,
        caption: 'El mismo briefing queda guardado para que la siguiente sesión esté preparada en segundos.'
    },
    {
        id: 'focus_case_hub',
        targetId: 'history-case-hub',
        duration: 3400,
        caption: 'Debajo tienes el Case Hub: foco principal, temas recurrentes, acuerdos y profesionales implicados.'
    },
    {
        id: 'focus_timeline',
        targetId: 'history-timeline-panel',
        duration: 3000,
        caption: 'Y aquí ves el Patient Timeline, mezclando continuidad actual e histórico importado.'
    },
    {
        id: 'select_legacy_timeline_item',
        targetId: 'history-timeline-item-1',
        duration: 1500,
        action: () => clickById('history-timeline-item-1'),
        caption: 'Seleccionamos una sesión importada para reutilizarla como contexto.'
    },
    {
        id: 'move_to_use_context',
        targetId: 'history-use-context-btn',
        duration: 2200,
        caption: 'Con un clic volvemos a consulta usando ese histórico como memoria clínica.'
    },
    {
        id: 'click_use_context',
        targetId: 'history-use-context-btn',
        duration: 1200,
        action: () => clickById('history-use-context-btn'),
        caption: 'Volvemos a la grabación con el paciente y el contexto ya listos.'
    },
    {
        id: 'move_to_record',
        targetId: 'main-record-btn',
        duration: 2400,
        caption: 'Ahora sí, empezamos la consulta con todo el contexto relevante al alcance.'
    },
    {
        id: 'click_record',
        targetId: 'main-record-btn',
        duration: 1000,
        action: () => clickById('main-record-btn')
    },
    {
        id: 'processing_1',
        duration: 5200,
        caption: 'Mientras tú te centras en la conversación, Maria Notes transcribe y estructura la sesión.'
    },
    {
        id: 'processing_2',
        duration: 5200,
        caption: 'Después valida el borrador clínico para que partas de una nota segura y editable.'
    },
    {
        id: 'wait_for_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 5000,
        caption: 'Si detecta una duda importante, la resalta para que la confirmes con evidencia.'
    },
    {
        id: 'click_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 1500,
        action: () => clickById('uncertainty-highlight-0'),
        caption: 'Abrimos la evidencia original.'
    },
    {
        id: 'wait_for_modal',
        targetId: 'evidence-modal-confirm-btn',
        duration: 4500,
        caption: 'Sigues teniendo la última palabra sobre lo que se guarda en la historia clínica.'
    },
    {
        id: 'click_confirm',
        targetId: 'evidence-modal-confirm-btn',
        duration: 1200,
        action: () => clickById('evidence-modal-confirm-btn'),
        caption: 'Confirmamos el dato.'
    },
    {
        id: 'move_to_edit',
        targetId: 'edit-mode-btn',
        duration: 2600,
        caption: 'Si quieres, puedes ajustar la redacción con tu propio criterio terapéutico.'
    },
    {
        id: 'click_edit',
        targetId: 'edit-mode-btn',
        duration: 1300,
        action: () => clickById('edit-mode-btn'),
        caption: 'Entrando en modo edición...'
    },
    {
        id: 'simulate_typing',
        targetId: 'save-edit-btn',
        duration: 5000,
        caption: 'Cada corrección ayuda a que Maria Notes se adapte a tu estilo clínico.'
    },
    {
        id: 'click_save',
        targetId: 'save-edit-btn',
        duration: 1400,
        action: () => clickById('save-edit-btn'),
        caption: 'Guardamos tus cambios.'
    },
    {
        id: 'finish_learning',
        duration: 5600,
        caption: 'La continuidad queda guardada para la próxima sesión: briefing, timeline y contexto clínico del caso.'
    },
    {
        id: 'move_to_feedback',
        targetId: 'feedback-score-10',
        duration: 2800,
        caption: 'Solo queda valorar el resultado para seguir afinando el sistema.'
    },
    {
        id: 'submit_feedback',
        targetId: 'feedback-submit-btn',
        duration: 2500,
        action: () => clickById('feedback-submit-btn'),
        caption: 'Con esto queda cerrada la demo completa de continuidad en Psicología.'
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
            const el = document.getElementById(step.targetId);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const rect = el.getBoundingClientRect();
                setCursorPosition({
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                });
            }
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
