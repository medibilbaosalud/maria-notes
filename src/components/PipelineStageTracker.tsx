import React from 'react';
import { motion } from 'framer-motion';
import { motionEase, motionTransitions, statusPulseSoft } from '../features/ui/motion-tokens';

type StageState =
    | 'idle'
    | 'recovering'
    | 'recording'
    | 'transcribing_live'
    | 'processing_partials'
    | 'finalizing'
    | 'awaiting_budget'
    | 'draft_ready'
    | 'hardening'
    | 'completed'
    | 'provisional'
    | 'failed';

interface PipelineStageTrackerProps {
    state: StageState;
    sttP95Ms?: number;
    sttConcurrency?: number;
    hedgeRate?: number;
}

const STAGES: Array<{ key: StageState; label: string }> = [
    { key: 'recording', label: 'Grabando' },
    { key: 'transcribing_live', label: 'Transcribiendo' },
    { key: 'draft_ready', label: 'Draft' },
    { key: 'hardening', label: 'Hardening' },
    { key: 'completed', label: 'Final' }
];

const rank: Record<StageState, number> = {
    idle: 0,
    recovering: 1,
    recording: 1,
    transcribing_live: 2,
    processing_partials: 2,
    finalizing: 3,
    awaiting_budget: 2,
    draft_ready: 3,
    hardening: 4,
    completed: 5,
    provisional: 4,
    failed: 1
};

const labelByState: Record<StageState, string> = {
    idle: 'idle',
    recovering: 'recovering',
    recording: 'recording',
    transcribing_live: 'transcribing',
    processing_partials: 'partials',
    finalizing: 'finalizing',
    awaiting_budget: 'awaiting_budget',
    draft_ready: 'draft_ready',
    hardening: 'hardening',
    completed: 'completed',
    provisional: 'provisional',
    failed: 'failed'
};

export const PipelineStageTracker: React.FC<PipelineStageTrackerProps> = ({
    state,
    sttP95Ms,
    sttConcurrency,
    hedgeRate
}) => {
    const currentRank = rank[state] || 0;
    return (
        <motion.div
            className="pipeline-stage-tracker"
            aria-live="polite"
            data-ui-state={state}
            layout
            transition={motionTransitions.normal}
        >
            <div className="stage-row">
                {STAGES.map((stage, idx) => {
                    const isDone = currentRank > idx + 1;
                    const isActive = currentRank === idx + 1;
                    return (
                        <div className={`stage-node ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`} key={stage.key}>
                            <motion.span
                                className="stage-dot"
                                animate={statusPulseSoft(isActive)}
                                transition={{
                                    duration: 1.1,
                                    repeat: isActive ? Infinity : 0,
                                    ease: motionEase.base
                                }}
                            />
                            <motion.span
                                className="stage-label"
                                animate={{
                                    opacity: isDone || isActive ? 1 : 0.72,
                                    y: isActive ? -1 : 0
                                }}
                                transition={motionTransitions.fast}
                            >
                                {stage.label}
                            </motion.span>
                        </div>
                    );
                })}
            </div>
            <div className="stage-metrics">
                <span>P95 STT: {sttP95Ms ? `${Math.round(sttP95Ms)}ms` : 'n/a'}</span>
                <span>Conc: {sttConcurrency || 0}</span>
                <span>Hedge: {typeof hedgeRate === 'number' ? `${(hedgeRate * 100).toFixed(1)}%` : '0%'}</span>
                <span className={`state-pill ${state}`} data-ui-state={state}>{labelByState[state]}</span>
            </div>
        </motion.div>
    );
};
