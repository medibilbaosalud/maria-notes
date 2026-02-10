export type PipelineStatusState =
    | 'idle'
    | 'recovering'
    | 'recording'
    | 'processing_partials'
    | 'awaiting_budget'
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
const DEFAULT_DRAIN_RETRY_MS = 5_000;

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
    private nextExpectedBatch = 0;
    private missingBatches = new Set<number>();

    private running = false;
    private finalizeRequest: FinalizeRequest<TFinalizeResult> | null = null;
    private drainPromise: Promise<void> | null = null;

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
        if (this.drainPromise) return this.drainPromise;
        this.drainPromise = this.drain().finally(() => {
            this.drainPromise = null;
        });
        return this.drainPromise;
    }

    private async drain(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            while (true) {
                const context = this.getContextOrThrow();

                const nextBlob = this.pending.get(this.nextExpectedBatch);
                if (nextBlob) {
                    this.pending.delete(this.nextExpectedBatch);
                    const currentBatch = this.nextExpectedBatch;
                    this.touch();
                    try {
                        await this.handlers.processPartial({
                            sessionId: context.sessionId,
                            patientName: context.patientName,
                            batchIndex: currentBatch,
                            blob: nextBlob
                        });
                        this.processed.add(currentBatch);
                        this.missingBatches.delete(currentBatch);
                        this.nextExpectedBatch++;
                        this.state = 'processing_partials';
                        this.touch();
                    } catch (error) {
                        const budgetRetryMs = this.readBudgetRetryMs(error);
                        if (budgetRetryMs > 0) {
                            this.pending.set(currentBatch, nextBlob);
                            this.state = 'awaiting_budget';
                            this.touch((error as Error)?.message || 'awaiting_budget_partial');
                            setTimeout(() => {
                                void this.scheduleDrain();
                            }, budgetRetryMs);
                            break;
                        }
                        // Graceful degradation: skip this batch instead of killing the pipeline
                        console.error(`[Orchestrator] Partial batch ${currentBatch} failed, skipping:`, error);
                        this.processed.add(currentBatch);
                        this.missingBatches.add(currentBatch);
                        this.nextExpectedBatch++;
                        this.state = 'processing_partials';
                        this.touch((error as Error)?.message || 'partial_batch_skipped');
                    }
                    continue;
                }

                const finalizeReq = this.finalizeRequest;
                if (!finalizeReq) break;

                const expectedPartials = Math.max(0, finalizeReq.lastBatchIndex);
                const missing = this.computeMissingRange(0, expectedPartials - 1);

                if (missing.length === 0) {
                    try {
                        const result = await this.handlers.finalize({
                            sessionId: context.sessionId,
                            patientName: context.patientName,
                            lastBatchIndex: finalizeReq.lastBatchIndex,
                            finalBlob: finalizeReq.finalBlob,
                            missingBatches: [],
                            processedBatches: Array.from(this.processed).sort((a, b) => a - b)
                        });
                        this.finalizeRequest = null;
                        this.state = 'completed';
                        this.touch();
                        finalizeReq.resolve(result);
                        this.resetInternal(false);
                        break;
                    } catch (error) {
                        const budgetRetryMs = this.readBudgetRetryMs(error);
                        if (budgetRetryMs > 0) {
                            this.state = 'awaiting_budget';
                            this.touch((error as Error)?.message || 'awaiting_budget_finalize');
                            setTimeout(() => {
                                void this.scheduleDrain();
                            }, budgetRetryMs);
                            break;
                        }
                        this.state = 'failed';
                        this.touch((error as Error)?.message || 'finalize_failed');
                        throw error;
                    }
                }

                const waitedMs = Date.now() - finalizeReq.requestedAt;
                if (waitedMs >= this.finalizeWaitMs) {
                    missing.forEach((idx) => this.missingBatches.add(idx));
                    try {
                        const result = await this.handlers.finalize({
                            sessionId: context.sessionId,
                            patientName: context.patientName,
                            lastBatchIndex: finalizeReq.lastBatchIndex,
                            finalBlob: finalizeReq.finalBlob,
                            missingBatches: missing,
                            processedBatches: Array.from(this.processed).sort((a, b) => a - b)
                        });
                        this.finalizeRequest = null;
                        this.state = missing.length > 0 ? 'provisional' : 'completed';
                        this.touch(missing.length > 0 ? `Missing partial batches: ${missing.join(', ')}` : undefined);
                        finalizeReq.resolve(result);
                        this.resetInternal(false);
                        break;
                    } catch (error) {
                        const budgetRetryMs = this.readBudgetRetryMs(error);
                        if (budgetRetryMs > 0) {
                            this.state = 'awaiting_budget';
                            this.touch((error as Error)?.message || 'awaiting_budget_finalize');
                            setTimeout(() => {
                                void this.scheduleDrain();
                            }, budgetRetryMs);
                            break;
                        }
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

    private readBudgetRetryMs(error: unknown): number {
        const direct = Number((error as { retryAfterMs?: number })?.retryAfterMs || 0);
        if (Number.isFinite(direct) && direct > 0) return direct;
        const message = ((error as Error)?.message || '').toLowerCase();
        if (!message.includes('budget_limit') && !message.includes('awaiting_budget')) return 0;
        return DEFAULT_DRAIN_RETRY_MS;
    }

    private resetInternal(resetContext = true): void {
        this.pending.clear();
        this.processed.clear();
        this.missingBatches.clear();
        this.nextExpectedBatch = 0;
        this.running = false;
        this.drainPromise = null;
        this.finalizeRequest = null;
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
