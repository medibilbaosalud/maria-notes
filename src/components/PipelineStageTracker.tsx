import React from 'react';
import { motion } from 'framer-motion';

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
    processingLabel?: string;
    activeEngine?: 'whisper' | 'gemini' | 'groq' | 'llm' | 'storage' | 'idle';
    activeModel?: string;
    modelUpdatedAt?: number;
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
    processingLabel,
    activeEngine = 'idle',
    activeModel
}) => {
    const currentRank = rank[state] || 0;
    const resolvedLabel = processingLabel || `Estado: ${labelByState[state]}`;

    // Use effects or vars to keep linter happy if we want to keep props for future use,
    // or just ignore them. Since we might revert/expand later, let's just not destructure
    // what we don't use, or accept they are unused props.
    // Actually, for cleaner code, let's remove the unused internal computations.

    return (
        <motion.div
            className="pipeline-stage-tracker subtle"
            aria-live="polite"
            data-ui-state={state}
            layout
        >
            <div className="tracker-content">
                {/* Timeline Dots */}
                <div className="stage-timeline">
                    {STAGES.map((stage, idx) => {
                        const isDone = currentRank > idx + 1;
                        const isActive = currentRank === idx + 1;
                        return (
                            <div className={`timeline-node ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`} key={stage.key}>
                                <motion.div
                                    className="timeline-dot"
                                    layout
                                />
                                {isActive && (
                                    <motion.span
                                        className="timeline-label"
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                    >
                                        {stage.label}
                                    </motion.span>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Divider */}
                <div className="tracker-divider" />

                {/* Dynamic Status / Metrics (Compact) */}
                <div className="tracker-status-compact">
                    <span className="status-text">
                        {resolvedLabel}
                    </span>
                    {(activeEngine !== 'idle' || activeModel) && (
                        <div className="tracker-meta">
                            <span className="meta-pill">{activeEngine}</span>
                            {sttP95Ms && <span className="meta-text">{Math.round(sttP95Ms)}ms</span>}
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};
