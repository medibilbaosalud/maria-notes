import React, { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import { simulationData, getSimulationDataForSpecialty } from './simulationData';
import type { ClinicalSpecialtyId } from '../../clinical/specialties';

type SimulationStepId =
    | 'intro'
    | 'move_to_input'
    | 'move_to_record'
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
    startSimulation: (specialty?: ClinicalSpecialtyId) => void;
    stopSimulation: () => void;
    cursorPosition: { x: number; y: number } | null;
    demoData: typeof simulationData | null;
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

export const useSimulation = () => {
    const context = useContext(SimulationContext);
    if (!context) {
        throw new Error('useSimulation must be used within a SimulationProvider');
    }
    return context;
};

// ────────────────────────────────────────────────
// OTORRINO SCRIPT (original)
// ────────────────────────────────────────────────
const OTORRINO_SCRIPT: SimulationStep[] = [
    {
        id: 'intro',
        duration: 4000,
        caption: "Bienvenida, Dra. Gotxi. Vamos a ver una consulta completa desde cero."
    },
    {
        id: 'processing_1',
        duration: 5000,
        caption: "1. Procesando Audio: Whisper v3 transcribe... Llama-3 estructura los datos médicos...",
    },
    {
        id: 'processing_2',
        duration: 5000,
        caption: "2. Validación Clínica: Qwen-2.5-Med audita el resultado buscando alucinaciones o errores."
    },
    {
        id: 'wait_for_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 4000,
        caption: "3. Detección de Dudas: La IA marca en amarillo un dato ambiguo ('hipoacusia') para tu revisión."
    },
    {
        id: 'click_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 1500,
        action: () => {
            const el = document.getElementById('uncertainty-highlight-0');
            if (el) el.click();
        },
        caption: "Hacemos clic para ver la evidencia original..."
    },
    {
        id: 'wait_for_modal',
        targetId: 'evidence-modal-confirm-btn',
        duration: 5000,
        caption: "Aquí ves la transcripción exacta. Tú tienes la última palabra sobre qué guardar."
    },
    {
        id: 'click_confirm',
        targetId: 'evidence-modal-confirm-btn',
        duration: 1500,
        action: () => {
            const el = document.getElementById('evidence-modal-confirm-btn');
            if (el) el.click();
        },
        caption: "Validamos el dato correcto."
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
        action: () => {
            const el = document.getElementById('edit-mode-btn');
            if (el) el.click();
        },
        caption: "Entrando en modo edición..."
    },
    {
        id: 'simulate_typing',
        targetId: 'save-edit-btn',
        duration: 6000,
        caption: "Modificas el texto... (La IA observa cómo prefieres estructurar la 'Enfermedad Actual')",
    },
    {
        id: 'click_save',
        targetId: 'save-edit-btn',
        duration: 2000,
        action: () => {
            const el = document.getElementById('save-edit-btn');
            if (el) el.click();
        },
        caption: "Guardando cambios..."
    },
    {
        id: 'finish_learning',
        duration: 7000,
        caption: "¡Analizando correcciones! He actualizado mis parámetros para que la próxima nota use TU estructura preferida."
    },
    {
        id: 'move_to_feedback',
        targetId: 'feedback-score-10',
        duration: 3000,
        caption: "Maria Notes quiere mejorar. Lo último es valorar la calidad clínica de la nota generada."
    },
    {
        id: 'submit_feedback',
        targetId: 'feedback-submit-btn',
        duration: 3000,
        caption: "Enviamos la valoración para que el sistema aprenda de tus preferencias."
    },
    {
        id: 'finish',
        action: () => { /* Stop simulation handles cleanup */ }
    }
];

// ────────────────────────────────────────────────
// PSYCHOLOGY SCRIPT (new guided demo)
// ────────────────────────────────────────────────
const PSYCHOLOGY_SCRIPT: SimulationStep[] = [
    // Phase 0 — Welcome
    {
        id: 'intro',
        duration: 3000,
        caption: "Bienvenida, Jone. Vamos a recorrer juntas una sesión completa de Psicología con Maria Notes."
    },
    {
        id: 'move_to_input',
        targetId: 'patient-name-input',
        duration: 2500,
        caption: "Primero, identificamos al paciente que ha venido a terapia."
    },
    {
        id: 'move_to_record',
        targetId: 'main-record-btn',
        duration: 2500,
        caption: "Pulsamos en Iniciar Consulta y Maria Notes empezará a escuchar discretamente."
    },

    // Phase 1 — Recording & Transcription
    {
        id: 'processing_1',
        duration: 6000,
        caption: "📍 Fase 1 · Grabación: El audio se procesa en bloques mientras tú te centras 100% en el paciente."
    },
    {
        id: 'processing_2',
        duration: 6000,
        caption: "📍 Fase 2 · Estructura: Los motores Llama y Gemini organizan la sesión en: motivo, sintomatología, observaciones e impresión."
    },

    // Phase 2 — AI Validation
    {
        id: 'wait_for_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 6000,
        caption: "📍 Fase 3 · Validación clínica: Qwen-Med revisa el resultado buscando errores o datos ambiguos. ¡Mira! Ha marcado en amarillo la dosis de sertralina porque no estaba claro en el audio."
    },
    {
        id: 'click_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 2000,
        action: () => {
            const el = document.getElementById('uncertainty-highlight-0');
            if (el) el.click();
        },
        caption: "Hacemos clic en el dato marcado para ver la transcripción original..."
    },
    {
        id: 'wait_for_modal',
        targetId: 'evidence-modal-confirm-btn',
        duration: 6000,
        caption: "📍 Aquí puedes escuchar lo que dijo el paciente. Si la dosis es correcta, confirmas. Si no, editas. Tú tienes la última palabra."
    },
    {
        id: 'click_confirm',
        targetId: 'evidence-modal-confirm-btn',
        duration: 1500,
        action: () => {
            const el = document.getElementById('evidence-modal-confirm-btn');
            if (el) el.click();
        },
        caption: "Confirmamos la dosis."
    },

    // Phase 3 — Editing & Learning
    {
        id: 'move_to_edit',
        targetId: 'edit-mode-btn',
        duration: 5000,
        caption: "📍 Fase 4 · Tu criterio clínico: ¿Quieres cambiar la redacción del plan terapéutico o añadir una observación? Pulsa «Editar»."
    },
    {
        id: 'click_edit',
        targetId: 'edit-mode-btn',
        duration: 1500,
        action: () => {
            const el = document.getElementById('edit-mode-btn');
            if (el) el.click();
        },
        caption: "Entrando en modo edición..."
    },
    {
        id: 'simulate_typing',
        targetId: 'save-edit-btn',
        duration: 7000,
        caption: "📍 Fase 5 · Aprendizaje: Cada corrección que haces enseña a Maria Notes cómo prefieres documentar. Si reformulas la «Impresión Clínica» con tu estilo, la IA lo recordará para la próxima sesión."
    },
    {
        id: 'click_save',
        targetId: 'save-edit-btn',
        duration: 2000,
        action: () => {
            const el = document.getElementById('save-edit-btn');
            if (el) el.click();
        },
        caption: "Guardando tus cambios..."
    },

    // Phase 4 — Finish
    {
        id: 'finish_learning',
        duration: 8000,
        caption: "📍 Fase 6 · Informe y continuidad: Desde «Informes» puedes generar un documento para derivación o archivo. En «Historial» recuperas sesiones anteriores. Maria Notes se adapta a TU forma de trabajar. ¡Bienvenida!"
    },
    {
        id: 'move_to_feedback',
        targetId: 'feedback-score-10',
        duration: 3500,
        caption: "Por último, valoras el borrador. Esto ayuda a Maria a refinar el tono terapéutico para tus próximas sesiones."
    },
    {
        id: 'submit_feedback',
        targetId: 'feedback-submit-btn',
        duration: 3500,
        caption: "Con un solo clic, envías tu feedback clínico y cierras la consulta."
    },
    {
        id: 'finish',
        action: () => { /* Stop simulation handles cleanup */ }
    }
];

const getScriptForSpecialty = (specialty: ClinicalSpecialtyId): SimulationStep[] =>
    specialty === 'psicologia' ? PSYCHOLOGY_SCRIPT : OTORRINO_SCRIPT;


export const SimulationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [stepIndex, setStepIndex] = useState(-1);
    const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
    const activeScriptRef = useRef<SimulationStep[]>(OTORRINO_SCRIPT);
    const activeDemoDataRef = useRef(simulationData);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const startSimulation = (specialty?: ClinicalSpecialtyId) => {
        const resolved = specialty || 'otorrino';
        activeScriptRef.current = getScriptForSpecialty(resolved);
        activeDemoDataRef.current = getSimulationDataForSpecialty(resolved);
        setIsPlaying(true);
        setStepIndex(0);
        setCursorPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    };

    const stopSimulation = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setIsPlaying(false);
        setStepIndex(-1);
        setCursorPosition(null);
    };

    useEffect(() => {
        const script = activeScriptRef.current;
        if (!isPlaying || stepIndex < 0 || stepIndex >= script.length) {
            if (stepIndex >= script.length) stopSimulation();
            return;
        }

        const step = script[stepIndex];

        // 1. Execute Action
        if (step.action) {
            step.action();
        }

        // 2. Move Cursor if target
        if (step.targetId) {
            const el = document.getElementById(step.targetId);
            if (el) {
                const rect = el.getBoundingClientRect();
                setCursorPosition({
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                });
            }
        }

        // 3. Schedule Next Step
        const duration = step.duration || 1000;
        timeoutRef.current = setTimeout(() => {
            setStepIndex(prev => prev + 1);
        }, duration);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [isPlaying, stepIndex]);

    return (
        <SimulationContext.Provider value={{
            isPlaying,
            currentStep: isPlaying && stepIndex >= 0 ? activeScriptRef.current[stepIndex] : null,
            startSimulation,
            stopSimulation,
            cursorPosition,
            demoData: isPlaying ? activeDemoDataRef.current : null
        }}>
            {children}
        </SimulationContext.Provider>
    );
};
