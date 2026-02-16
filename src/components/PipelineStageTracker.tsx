import React from 'react';
import { motion } from 'framer-motion';

type StageState =
    | 'idle'
    | 'recording'
    | 'transcribing_live'
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
    recording: 1,
    transcribing_live: 2,
    draft_ready: 3,
    hardening: 4,
    completed: 5,
    provisional: 4,
    failed: 1
};

export const PipelineStageTracker: React.FC<PipelineStageTrackerProps> = ({
    state,
    sttP95Ms,
    sttConcurrency,
    hedgeRate
}) => {
    const currentRank = rank[state] || 0;
    return (
        <div className="pipeline-stage-tracker" aria-live="polite">
            <div className="stage-row">
                {STAGES.map((stage, idx) => {
                    const isDone = currentRank > idx + 1;
                    const isActive = currentRank === idx + 1;
                    return (
                        <div className={`stage-node ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`} key={stage.key}>
                            <motion.span
                                className="stage-dot"
                                animate={isActive ? { scale: [1, 1.15, 1] } : { scale: 1 }}
                                transition={{ duration: 1.1, repeat: isActive ? Infinity : 0 }}
                            />
                            <span className="stage-label">{stage.label}</span>
                        </div>
                    );
                })}
            </div>
            <div className="stage-metrics">
                <span>P95 STT: {sttP95Ms ? `${Math.round(sttP95Ms)}ms` : 'n/a'}</span>
                <span>Conc: {sttConcurrency || 0}</span>
                <span>Hedge: {typeof hedgeRate === 'number' ? `${(hedgeRate * 100).toFixed(1)}%` : '0%'}</span>
                <span className={`state-pill ${state}`}>{state}</span>
            </div>
        </div>
    );
};

