import React from 'react';
import { useSimulation } from './SimulationContext';
import { motion, AnimatePresence } from 'framer-motion';
import { GhostCursor } from './GhostCursor';
import { X, Play } from 'lucide-react';

export const SimulationOverlay: React.FC = () => {
    const { isPlaying, currentStep, stopSimulation, cursorPosition } = useSimulation();

    if (!isPlaying) return null;

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            // Transparent background to show movement, but blocks interaction (pointer-events-auto)
            // But we might need pass-through for "real" clicks if we wanted hybrid, 
            // but for pure auto-pilot, blocking is safer to prevent user messing up the script.
            // step.action() handles the "fake" clicks logic.
            pointerEvents: 'auto',
            cursor: 'none' // Hide real cursor
        }}>

            {/* Stop Button - Always clickable */}
            <button
                onClick={stopSimulation}
                style={{
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    zIndex: 10001,
                    background: 'rgba(255, 255, 255, 0.9)',
                    border: '1px solid #e2e8f0',
                    borderRadius: '50px',
                    padding: '8px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    cursor: 'pointer' // Shows pointer even if we hide it globally? Browser dependent.
                }}
            >
                <X size={16} />
                <span>Salir de la Demo</span>
            </button>


            {/* Cursor */}
            {cursorPosition && (
                <GhostCursor x={cursorPosition.x} y={cursorPosition.y} />
            )}

            {/* Caption Card */}
            <AnimatePresence mode="wait">
                {currentStep?.caption && (
                    <motion.div
                        key={currentStep.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                        style={{
                            position: 'absolute',
                            bottom: '100px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: 'rgba(15, 23, 42, 0.9)', // Dark slate
                            color: 'white',
                            padding: '16px 24px',
                            borderRadius: '16px',
                            backdropFilter: 'blur(8px)',
                            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                            maxWidth: '400px',
                            textAlign: 'center',
                            fontSize: '1.1rem',
                            border: '1px solid rgba(255,255,255,0.1)'
                        }}
                    >
                        {currentStep.caption}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
