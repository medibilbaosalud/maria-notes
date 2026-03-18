import React from 'react';
import { motion, useSpring, useTransform, AnimatePresence } from 'framer-motion';

interface ClinicalOrbProps {
  level: number; // 0 to 1
  isRecording?: boolean;
}

export const ClinicalOrb: React.FC<ClinicalOrbProps> = ({ level, isRecording = false }) => {
  const animatedLevel = useSpring(level, {
    stiffness: 120,
    damping: 20,
    mass: 0.5
  });

  // Transform level to various visual properties
  const scale = useTransform(animatedLevel, [0, 1], [0.85, 1.15]);
  const glowOpacity = useTransform(animatedLevel, [0, 1], [0.3, 0.7]);
  const rotation = useTransform(animatedLevel, [0, 1], [0, 180]);
  const blurValue = useTransform(animatedLevel, [0, 1], [2, 6]);

  return (
    <div className="clinical-orb-wrapper">
      <motion.div
        className="clinical-orb-glow-outer"
        style={{
          opacity: glowOpacity,
          scale: useTransform(animatedLevel, [0, 1], [1, 1.4]),
        }}
      />
      
      <motion.svg
        viewBox="0 0 100 100"
        className="clinical-orb-svg"
        style={{
          scale,
          rotate: rotation,
        }}
      >
        <defs>
          <radialGradient id="orbGradient" cx="50%" cy="50%" r="50%" fx="35%" fy="35%">
            <stop offset="0%" stopColor="#2DDFCF" />
            <stop offset="60%" stopColor="#0F766E" />
            <stop offset="100%" stopColor="#111827" />
          </radialGradient>
          
          <filter id="orbBlur" x="-50%" y="-50%" width="200%" height="200%">
            <motion.feGaussianBlur in="SourceGraphic" stdDeviation={blurValue as any} />
          </filter>
        </defs>

        {/* Ambient pulse */}
        <motion.circle
          cx="50%"
          cy="50%"
          r="45%"
          fill="rgba(45, 223, 207, 0.15)"
          animate={{
            scale: [1, 1.05, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />

        {/* Reactive Orb */}
        <motion.circle
          cx="50%"
          cy="50%"
          r="38%"
          fill="url(#orbGradient)"
          style={{
             filter: 'url(#orbBlur)'
          }}
        />

        {/* Energy layers */}
        <AnimatePresence>
          {isRecording && (
            <motion.circle
              cx="50%"
              cy="50%"
              r="30%"
              stroke="rgba(255, 255, 255, 0.4)"
              strokeWidth="0.5"
              fill="none"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ 
                scale: [0.8, 1.5], 
                opacity: [0.6, 0] 
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeOut"
              }}
            />
          )}
        </AnimatePresence>
        
        {/* Core highlight */}
        <circle
          cx="35%"
          cy="35%"
          r="10%"
          fill="rgba(255, 255, 255, 0.3)"
          filter="url(#orbBlur)"
        />
      </motion.svg>
    </div>
  );
};
