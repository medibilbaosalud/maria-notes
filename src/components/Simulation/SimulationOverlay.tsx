import React from 'react';
import { useSimulation } from './SimulationContext';
import { motion, AnimatePresence } from 'framer-motion';
import { GhostCursor } from './GhostCursor';
import { X } from 'lucide-react';

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
                <span>Saltar demo</span>
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
                        initial={{ opacity: 0, y: 20, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.96 }}
                        transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                        style={{
                            position: 'absolute',
                            bottom: '80px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.92) 0%, rgba(30, 41, 59, 0.95) 100%)',
                            color: 'white',
                            padding: '20px 32px',
                            borderRadius: '20px',
                            backdropFilter: 'blur(16px)',
                            boxShadow: '0 20px 40px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.08)',
                            maxWidth: '520px',
                            textAlign: 'center',
                            fontSize: '1.15rem',
                            lineHeight: 1.6,
                            fontWeight: 400,
                            letterSpacing: '-0.01em',
                            border: '1px solid rgba(255,255,255,0.08)'
                        }}
                    >
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: '20%',
                            right: '20%',
                            height: '2px',
                            background: 'linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.6), transparent)',
                            borderRadius: '2px'
                        }} />
                        {currentStep.caption}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
