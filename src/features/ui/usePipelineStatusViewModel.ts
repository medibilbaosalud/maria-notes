import { useMemo } from 'react';

export type LivePipelineState =
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

export interface SttMetricsSnapshot {
    latenciesMs: number[];
    concurrency: number;
    hedgedTriggered: number;
    totalChunks: number;
}

export const usePipelineStatusViewModel = (
    state: LivePipelineState,
    metrics: SttMetricsSnapshot
) => {
    return useMemo(() => {
        const sorted = [...(metrics.latenciesMs || [])].sort((a, b) => a - b);
        const sttP95Ms = (() => {
            if (sorted.length === 0) return 0;
            const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
            return sorted[idx];
        })();
        return {
            state,
            sttP95Ms,
            sttConcurrency: metrics.concurrency || 0,
            hedgeRate: metrics.totalChunks > 0 ? (metrics.hedgedTriggered / metrics.totalChunks) : 0
        };
    }, [state, metrics.latenciesMs, metrics.concurrency, metrics.hedgedTriggered, metrics.totalChunks]);
};
