export type PipelineStatusState =
    | 'idle'
    | 'recovering'
    | 'recording'
    | 'transcribing_live'
    | 'processing_partials'
    | 'awaiting_budget'
    | 'draft_ready'
    | 'hardening'
    | 'finalizing'
    | 'completed'
    | 'provisional'
    | 'degraded'
    | 'failed';

export interface PipelineStatusSnapshot {
    sessionId: string | null;
    patientName: string | null;
    state: PipelineStatusState;
    startedAt?: number;
    updatedAt: number;
    processedBatches: number[];
    failedBatches: number[];
    pendingBatches: number[];
    nextExpectedBatch: number;
    missingBatches: number[];
    reason?: string;
}

export interface ProcessPartialPayload {
    sessionId: string;
    patientName: string;
    batchIndex: number;
    blob: Blob;
}

export interface FinalizePayload {
    sessionId: string;
    patientName: string;
    lastBatchIndex: number;
    finalBlob: Blob;
    missingBatches: number[];
    failedBatches: number[];
    processedBatches: number[];
}

export interface OrchestratorHandlers<TFinalizeResult> {
    processPartial: (payload: ProcessPartialPayload) => Promise<void>;
    finalize: (payload: FinalizePayload) => Promise<TFinalizeResult>;
    onStatusChange?: (status: PipelineStatusSnapshot) => void;
    finalizeWaitMs?: number;
}

interface FinalizeRequest<TFinalizeResult> {
    lastBatchIndex: number;
    finalBlob: Blob;
    requestedAt: number;
    resolve: (value: TFinalizeResult) => void;
    reject: (reason?: unknown) => void;
}

const DEFAULT_FINALIZE_WAIT_MS = 180_000;

const MAX_CONCURRENT_PARTIALS = 4; // Allow parallel STT/Extraction
const MAX_FINALIZE_RETRIES = 2;

export class ConsultationPipelineOrchestrator<TFinalizeResult = void> {
    private readonly handlers: OrchestratorHandlers<TFinalizeResult>;
    private readonly finalizeWaitMs: number;

    private sessionId: string | null = null;
    private patientName: string | null = null;
    private state: PipelineStatusState = 'idle';
    private startedAt?: number;
    private updatedAt: number = Date.now();

    private pending = new Map<number, Blob>();
    private processed = new Set<number>();
    private failed = new Set<number>();
    private nextExpectedBatch = 0;
    private missingBatches = new Set<number>();

    private running = false;
    private runningPartials = new Set<number>();
    private finalizeRequest: FinalizeRequest<TFinalizeResult> | null = null;
    private drainPromise: Promise<void> | null = null;
    private finalizeRetries = 0;
    private rescheduleAfterDrain = false;

    constructor(handlers: OrchestratorHandlers<TFinalizeResult>) {
        this.handlers = handlers;
        this.finalizeWaitMs = handlers.finalizeWaitMs ?? DEFAULT_FINALIZE_WAIT_MS;
    }

    startConsultation(sessionId: string, patientName: string, options?: { recovering?: boolean }): void {
        this.resetInternal();
        this.sessionId = sessionId;
        this.patientName = patientName;
        this.startedAt = Date.now();
        this.state = options?.recovering ? 'recovering' : 'recording';
        this.touch();
    }

    getStatus(): PipelineStatusSnapshot {
        return {
            sessionId: this.sessionId,
            patientName: this.patientName,
            state: this.state,
            startedAt: this.startedAt,
            updatedAt: this.updatedAt,
            processedBatches: Array.from(this.processed).sort((a, b) => a - b),
            failedBatches: Array.from(this.failed).sort((a, b) => a - b),
            pendingBatches: Array.from(this.pending.keys()).sort((a, b) => a - b),
            nextExpectedBatch: this.nextExpectedBatch,
            missingBatches: Array.from(this.missingBatches).sort((a, b) => a - b)
        };
    }

    enqueuePartial(batchIndex: number, blob: Blob): Promise<void> {
        if (!this.sessionId || !this.patientName) {
            throw new Error('Cannot enqueue partial batch before startConsultation');
        }
        if (this.state === 'failed' || this.state === 'completed' || this.state === 'degraded' || this.state === 'provisional') {
            return Promise.resolve();
        }
        if (this.processed.has(batchIndex) || this.pending.has(batchIndex)) {
            return Promise.resolve();
        }
        if (this.failed.has(batchIndex)) {
            this.failed.delete(batchIndex);
            this.missingBatches.delete(batchIndex);
        }

        this.pending.set(batchIndex, blob);
        this.state = 'processing_partials';
        this.touch();
        return this.scheduleDrain();
    }

    finalize(lastBatchIndex: number, finalBlob: Blob): Promise<TFinalizeResult> {
        if (!this.sessionId || !this.patientName) {
            throw new Error('Cannot finalize before startConsultation');
        }

        if (this.finalizeRequest) {
            return Promise.reject(new Error('Finalize already requested'));
        }

        this.state = 'finalizing';
        this.touch();

        return new Promise<TFinalizeResult>((resolve, reject) => {
            this.finalizeRequest = {
                lastBatchIndex,
                finalBlob,
                requestedAt: Date.now(),
                resolve,
                reject
            };
            void this.scheduleDrain();
        });
    }

    abort(reason: string): void {
        this.state = 'failed';
        this.touch(reason);
        if (this.finalizeRequest) {
            this.finalizeRequest.reject(new Error(reason));
            this.finalizeRequest = null;
        }
        this.resetInternal(false);
    }

    private scheduleDrain(): Promise<void> {
        if (this.drainPromise) {
            this.rescheduleAfterDrain = true;
            return this.drainPromise;
        }
        this.drainPromise = this.drain().finally(() => {
            this.drainPromise = null;
            if (this.rescheduleAfterDrain) {
                this.rescheduleAfterDrain = false;
                if (this.pending.size > 0 || this.runningPartials.size > 0 || this.finalizeRequest) {
                    void this.scheduleDrain();
                }
            }
        });
        return this.drainPromise;
    }

    private async drain(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            while (true) {
                const context = this.getContextOrThrow();

                // 1. Process as many partials as we can concurrently
                const pendingIndices = Array.from(this.pending.keys())
                    .filter(idx => !this.runningPartials.has(idx))
                    .sort((a, b) => a - b);

                if (pendingIndices.length > 0 && this.runningPartials.size < MAX_CONCURRENT_PARTIALS) {
                    const toFire = pendingIndices.slice(0, MAX_CONCURRENT_PARTIALS - this.runningPartials.size);

                    for (const batchIndex of toFire) {
                        const blob = this.pending.get(batchIndex);
                        if (!blob) continue;

                        this.pending.delete(batchIndex);
                        this.runningPartials.add(batchIndex);
                        this.touch();

                        // Fire and handle internally to not block the drain loop
                        void (async () => {
                            try {
                                await this.handlers.processPartial({
                                    sessionId: context.sessionId,
                                    patientName: context.patientName,
                                    batchIndex,
                                    blob
                                });
                                this.processed.add(batchIndex);
                                this.failed.delete(batchIndex);
                                this.missingBatches.delete(batchIndex);
                                // The original code used nextExpectedBatch for strict ordering.
                                // We'll update it to be the first non-processed batch.
                                this.updateNextExpected();
                                this.state = 'processing_partials';
                            } catch (error) {
                                console.error(`[Orchestrator] Partial batch ${batchIndex} failed:`, error);
                                this.failed.add(batchIndex);
                                this.missingBatches.add(batchIndex);
                                this.updateNextExpected();
                            } finally {
                                this.runningPartials.delete(batchIndex);
                                this.touch();
                                void this.scheduleDrain(); // Check for more work
                            }
                        })();
                    }
                    // Continue loop to see if we can trigger more or move to finalize
                    if (this.runningPartials.size >= MAX_CONCURRENT_PARTIALS) break;
                    continue;
                }

                // If still running partials, we might need to wait before finalizing
                if (this.runningPartials.size > 0 && this.finalizeRequest) {
                    break; // Finalize will be handled in a later drain call when partials finish
                }

                const finalizeReq = this.finalizeRequest;
                if (!finalizeReq) break;

                const expectedPartials = Math.max(0, finalizeReq.lastBatchIndex);
                const isWaitingForPartials = this.runningPartials.size > 0;
                const missing = this.computeMissingRange(0, expectedPartials - 1);
                const failed = Array.from(this.failed).filter((idx) => idx >= 0 && idx <= expectedPartials - 1).sort((a, b) => a - b);
                const unresolved = Array.from(new Set([...missing, ...failed])).sort((a, b) => a - b);

                if (unresolved.length === 0 && !isWaitingForPartials) {
                    try {
                        const result = await this.handlers.finalize({
                            sessionId: context.sessionId,
                            patientName: context.patientName,
                            lastBatchIndex: finalizeReq.lastBatchIndex,
                            finalBlob: finalizeReq.finalBlob,
                            missingBatches: [],
                            failedBatches: [],
                            processedBatches: Array.from(this.processed).sort((a, b) => a - b)
                        });
                        this.finalizeRequest = null;
                        this.state = 'completed';
                        this.touch();
                        finalizeReq.resolve(result);
                        this.resetInternal(false);
                        break;
                    } catch (error) {
                        const totalWaitedMs = Date.now() - finalizeReq.requestedAt;
                        const retryBudgetMs = Math.max(this.finalizeWaitMs, DEFAULT_FINALIZE_WAIT_MS);

                        if (this.finalizeRetries < MAX_FINALIZE_RETRIES && totalWaitedMs < retryBudgetMs) {
                            this.finalizeRetries++;
                            this.state = 'processing_partials';
                            this.touch(`finalize retry ${this.finalizeRetries}/${MAX_FINALIZE_RETRIES}: ${(error as Error)?.message || 'error'}`);
                            setTimeout(() => {
                                void this.scheduleDrain();
                            }, 3_000);
                            break;
                        }
                        this.state = 'failed';
                        const failReason = totalWaitedMs >= retryBudgetMs ? 'pipeline_timeout' : ((error as Error)?.message || 'finalize_failed');
                        this.touch(failReason);
                        throw new Error(failReason);
                    }
                }

                const waitedMs = Date.now() - finalizeReq.requestedAt;
                const noMorePartialWork = this.pending.size === 0 && this.runningPartials.size === 0;
                const allUnresolvedAlreadyFailed =
                    unresolved.length > 0
                    && noMorePartialWork
                    && unresolved.every((idx) => this.failed.has(idx));

                if (allUnresolvedAlreadyFailed) {
                    try {
                        const result = await this.handlers.finalize({
                            sessionId: context.sessionId,
                            patientName: context.patientName,
                            lastBatchIndex: finalizeReq.lastBatchIndex,
                            finalBlob: finalizeReq.finalBlob,
                            missingBatches: [],
                            failedBatches: failed,
                            processedBatches: Array.from(this.processed).sort((a, b) => a - b)
                        });
                        this.finalizeRequest = null;
                        this.state = 'provisional';
                        this.touch(`Known failed partial batches: ${failed.join(', ')}`);
                        finalizeReq.resolve(result);
                        this.resetInternal(false);
                        break;
                    } catch (error) {
                        this.state = 'failed';
                        this.touch((error as Error)?.message || 'finalize_failed');
                        throw error;
                    }
                }

                if (waitedMs >= this.finalizeWaitMs) {
                    unresolved.forEach((idx) => this.missingBatches.add(idx));
                    try {
                        const result = await this.handlers.finalize({
                            sessionId: context.sessionId,
                            patientName: context.patientName,
                            lastBatchIndex: finalizeReq.lastBatchIndex,
                            finalBlob: finalizeReq.finalBlob,
                            missingBatches: unresolved,
                            failedBatches: failed,
                            processedBatches: Array.from(this.processed).sort((a, b) => a - b)
                        });
                        this.finalizeRequest = null;
                        this.state = unresolved.length > 0 ? 'provisional' : 'completed';
                        this.touch(unresolved.length > 0 ? `Missing or failed partial batches: ${unresolved.join(', ')}` : undefined);
                        finalizeReq.resolve(result);
                        this.resetInternal(false);
                        break;
                    } catch (error) {
                        this.state = 'failed';
                        this.touch((error as Error)?.message || 'finalize_failed');
                        throw error;
                    }
                }

                setTimeout(() => {
                    void this.scheduleDrain();
                }, 250);
                break;
            }
        } finally {
            this.running = false;
        }
    }

    private computeMissingRange(start: number, endInclusive: number): number[] {
        if (endInclusive < start) return [];
        const missing: number[] = [];
        for (let i = start; i <= endInclusive; i++) {
            if (this.processed.has(i)) continue;
            if (this.pending.has(i)) continue;
            missing.push(i);
        }
        return missing;
    }

    private getContextOrThrow(): { sessionId: string; patientName: string } {
        if (!this.sessionId || !this.patientName) {
            throw new Error('Pipeline context is not initialized');
        }
        return {
            sessionId: this.sessionId,
            patientName: this.patientName
        };
    }



    private updateNextExpected(): void {
        let next = 0;
        while (this.processed.has(next)) {
            next++;
        }
        this.nextExpectedBatch = next;
    }

    private resetInternal(resetContext = true): void {
        this.pending.clear();
        this.processed.clear();
        this.failed.clear();
        this.missingBatches.clear();
        this.nextExpectedBatch = 0;
        this.running = false;
        this.drainPromise = null;
        this.finalizeRequest = null;
        this.finalizeRetries = 0;
        this.rescheduleAfterDrain = false;
        if (resetContext) {
            this.sessionId = null;
            this.patientName = null;
            this.startedAt = undefined;
            this.state = 'idle';
            this.touch();
        }
    }

    private touch(reason?: string): void {
        this.updatedAt = Date.now();
        if (!this.handlers.onStatusChange) return;
        const snapshot = this.getStatus();
        this.handlers.onStatusChange({
            ...snapshot,
            reason
        });
    }
}
