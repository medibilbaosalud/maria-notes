import React, { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import { simulationData } from './simulationData';

type SimulationStep = {
    id: 'intro' | 'processing_1' | 'processing_2' | 'wait_for_highlight' | 'click_highlight' | 'wait_for_modal' | 'click_confirm' | 'move_to_edit' | 'click_edit' | 'simulate_typing' | 'click_save' | 'finish_learning' | 'finish';
    targetId?: string; // DOM ID to move cursor to
    duration?: number; // How long to stay in this step
    action?: () => void; // Function to execute at start of step
    caption?: string; // Text to show in overlay
};

interface SimulationContextType {
    isPlaying: boolean;
    currentStep: SimulationStep | null;
    startSimulation: () => void;
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

// Define the script sequence
const SCRIPT: SimulationStep[] = [
    {
        id: 'intro',
        duration: 3000,
        caption: "Bienvenida, Dra. Gotxi. Vamos a ver una consulta completa desde cero."
    },
    // Phase 1: Processing
    {
        id: 'processing_1',
        duration: 4000,
        caption: "1. Procesando Audio: Whisper v3 transcribe mientras Llama-3-70b empieza a estructurar.",
        action: () => {
            // In a real app we might blur the screen or show a loader here
        }
    },
    {
        id: 'processing_2',
        duration: 4000,
        caption: "2. Validación Clínica: Qwen-2.5-Med audita el resultado buscando alucinaciones o errores."
    },
    // Phase 2: Uncertainty
    {
        id: 'wait_for_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 2500,
        caption: "3. Detección de Dudas: La IA marca en amarillo un dato ambiguo ('hipoacusia') para tu revisión."
    },
    {
        id: 'click_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 1000,
        action: () => {
            const el = document.getElementById('uncertainty-highlight-0');
            if (el) el.click();
        },
        caption: "Hacemos clic para ver la evidencia original..."
    },
    {
        id: 'wait_for_modal',
        targetId: 'evidence-modal-confirm-btn',
        duration: 3000,
        caption: "Aquí ves la transcripción exacta. Tú tienes la última palabra."
    },
    {
        id: 'click_confirm',
        targetId: 'evidence-modal-confirm-btn',
        duration: 1000,
        action: () => {
            const el = document.getElementById('evidence-modal-confirm-btn');
            if (el) el.click();
        },
        caption: "Validamos el dato correcto."
    },
    // Phase 3: Learning loop
    {
        id: 'move_to_edit',
        targetId: 'edit-mode-btn',
        duration: 2000,
        caption: "¿No te gusta el estilo o falta algo? Dale a 'Editar'."
    },
    {
        id: 'click_edit',
        targetId: 'edit-mode-btn',
        duration: 1000,
        action: () => {
            const el = document.getElementById('edit-mode-btn');
            if (el) el.click();
        },
        caption: "Entrando en modo edición..."
    },
    {
        id: 'simulate_typing',
        targetId: 'save-edit-btn', // Move cursor near safe button while "typing"
        duration: 3000,
        caption: "Haces tus cambios... (Simulación: modificando estructura)",
        action: () => {
            // Optional: Could simulate typing if we had a ref to textarea, 
            // but for now just the caption implies it.
        }
    },
    {
        id: 'click_save',
        targetId: 'save-edit-btn',
        duration: 1000,
        action: () => {
            const el = document.getElementById('save-edit-btn');
            if (el) el.click();
        },
        caption: "Al guardar, la IA compara tu versión con la suya."
    },
    {
        id: 'finish_learning',
        duration: 5000,
        caption: "¡Aprendido! Tus preferencias de estilo se aplicarán automáticamente en la próxima consulta."
    },
    {
        id: 'finish',
        action: () => {
            // Stop simulation handles cleanup
        }
    }
];

export const SimulationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [stepIndex, setStepIndex] = useState(-1);
    const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const startSimulation = () => {
        setIsPlaying(true);
        setStepIndex(0);
        setCursorPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); // Start center
    };

    const stopSimulation = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setIsPlaying(false);
        setStepIndex(-1);
        setCursorPosition(null);
    };

    useEffect(() => {
        if (!isPlaying || stepIndex < 0 || stepIndex >= SCRIPT.length) {
            if (stepIndex >= SCRIPT.length) stopSimulation();
            return;
        }

        const step = SCRIPT[stepIndex];

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
            currentStep: isPlaying && stepIndex >= 0 ? SCRIPT[stepIndex] : null,
            startSimulation,
            stopSimulation,
            cursorPosition,
            demoData: isPlaying ? simulationData : null
        }}>
            {children}
        </SimulationContext.Provider>
    );
};
