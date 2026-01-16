import React, { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import { simulationData } from './simulationData';
import { AppState, useApp } from '../../hooks/useApp'; // Assuming useApp exists or we just manage local state

type SimulationStep = {
    id: 'intro' | 'wait_for_highlight' | 'click_highlight' | 'wait_for_modal' | 'click_confirm' | 'wait_for_save' | 'finish';
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
        caption: "Bienvenida, Dra. Gotxi. Vamos a ver cómo funciona el sistema de aprendizaje activo."
    },
    {
        id: 'wait_for_highlight',
        targetId: 'uncertainty-highlight-0', // Needs to match ID in HistoryView
        duration: 2000,
        caption: "Cuando la IA tiene dudas sobre un dato clínico crítico, lo marca en amarillo."
    },
    {
        id: 'click_highlight',
        targetId: 'uncertainty-highlight-0',
        duration: 1000,
        action: () => {
            const el = document.getElementById('uncertainty-highlight-0');
            if (el) el.click();
        },
        caption: "Hacemos clic para revisar la evidencia..."
    },
    {
        id: 'wait_for_modal',
        targetId: 'evidence-modal-confirm-btn', // Needs to match ID in Modal
        duration: 2500,
        caption: "Aquí ves la transcripción original. Tú decides si la IA acertó o no."
    },
    {
        id: 'click_confirm',
        targetId: 'evidence-modal-confirm-btn',
        duration: 1000,
        action: () => {
            const el = document.getElementById('evidence-modal-confirm-btn');
            if (el) el.click();
        },
        caption: "Al confirmar, validas el dato."
    },
    {
        id: 'wait_for_save',
        duration: 3000,
        caption: "¡Listo! El sistema ha aprendido de tu decisión para futuras consultas."
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
