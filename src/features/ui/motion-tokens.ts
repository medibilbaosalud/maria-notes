import type { TargetAndTransition, Transition, Variants } from 'framer-motion';

export type InteractionState = 'idle' | 'hover' | 'active' | 'success' | 'warning' | 'error';

type EaseTuple = [number, number, number, number];

const easeBase: EaseTuple = [0.2, 0.8, 0.2, 1];
const easeOut: EaseTuple = [0, 0, 0.2, 1];

export const motionDurations = {
  fast: 0.12,
  normal: 0.18,
  slow: 0.26
} as const;

export const motionEase = {
  base: easeBase,
  out: easeOut,
  linear: 'linear' as const
};

export const motionTransitions: Record<'fast' | 'normal' | 'slow', Transition> = {
  fast: { duration: motionDurations.fast, ease: motionEase.base },
  normal: { duration: motionDurations.normal, ease: motionEase.base },
  slow: { duration: motionDurations.slow, ease: motionEase.base }
};

export const fadeSlideInSmall: Variants = {
  initial: { opacity: 0, y: 6 },
  enter: { opacity: 1, y: 0, transition: motionTransitions.slow },
  exit: { opacity: 0, y: -4, transition: motionTransitions.fast }
};

export const softScaleTap = {
  whileHover: { scale: 1.01, transition: motionTransitions.fast } as TargetAndTransition,
  whileTap: { scale: 0.98, transition: motionTransitions.fast } as TargetAndTransition
};

export const statusPulseSoft = (isActive: boolean): TargetAndTransition => {
  if (!isActive) {
    return { scale: 1, opacity: 1 };
  }

  return {
    scale: [1, 1.14, 1],
    opacity: [0.72, 1, 0.72]
  };
};
