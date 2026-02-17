import { useState, useRef, useCallback, useEffect } from 'react';

export interface AudioRecorderState {
    isRecording: boolean;
    audioBlob: Blob | null;
    duration: number;
    batchCount: number;
}

export interface BatchReadyPayload {
    batchIndex: number;
    blob: Blob;
    startedAt: number;
    endedAt: number;
}

export interface FinalReadyPayload {
    lastBatchIndex: number;
    blob: Blob;
    startedAt: number;
    endedAt: number;
}

interface UseAudioRecorderOptions {
    onBatchReady?: (payload: BatchReadyPayload) => Promise<void> | void;
    onFinalReady?: (payload: FinalReadyPayload) => Promise<void> | void;
    batchIntervalMs?: number;
}

const MIN_BATCH_BYTES = 1024;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MIN_SPLIT_CHUNK_BYTES = 512 * 1024;
const RECORDER_TIMESLICE_MS = 1000;
const RECORDER_ROTATE_STOP_START = String(import.meta.env.VITE_RECORDER_ROTATE_STOP_START || 'true').toLowerCase() === 'true';

const SAFE_BINARY_SPLIT_MIME_HINTS = ['wav', 'wave', 'pcm', 'x-wav', 'l16'];

const canSafelyBinarySplit = (blob: Blob): boolean => {
    const mime = (blob.type || '').toLowerCase();
    if (!mime) return false;
    return SAFE_BINARY_SPLIT_MIME_HINTS.some((hint) => mime.includes(hint));
};

const splitBlobBySize = (blob: Blob, maxBytes: number): Blob[] => {
    if (!canSafelyBinarySplit(blob)) return [blob];
    if (blob.size <= maxBytes) return [blob];
    const midpoint = Math.floor(blob.size / 2);
    if (midpoint < MIN_SPLIT_CHUNK_BYTES) return [blob];
    const left = blob.slice(0, midpoint, blob.type);
    const right = blob.slice(midpoint, blob.size, blob.type);
    if (!left.size || !right.size) return [blob];
    return [...splitBlobBySize(left, maxBytes), ...splitBlobBySize(right, maxBytes)];
};

export const useAudioRecorder = (options: UseAudioRecorderOptions = {}) => {
    const { onBatchReady, onFinalReady, batchIntervalMs = 5 * 60 * 1000 } = options;

    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [duration, setDuration] = useState(0);
    const [batchCount, setBatchCount] = useState(0);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const timerRef = useRef<number | null>(null);
    const batchTimerRef = useRef<number | null>(null);
    const batchIndexRef = useRef(0);
    const segmentStartedAtRef = useRef<number>(0);
    const recordingStartedAtRef = useRef<number>(0);
    const mimeTypeRef = useRef<string>('audio/webm');
    const stopRequestedRef = useRef(false);
    const stopReasonRef = useRef<'rotate' | 'final' | null>(null);
    const flushResolverRef = useRef<(() => void) | null>(null);
    const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
    const bufferedBytesRef = useRef(0);
    const rotateInProgressRef = useRef(false);

    const enqueueOperation = useCallback((operation: () => Promise<void>) => {
        operationQueueRef.current = operationQueueRef.current
            .then(operation)
            .catch((error) => {
                console.error('[Recorder] Operation failed:', error);
            });
        return operationQueueRef.current;
    }, []);

    const harvestCurrentBatch = useCallback((): Blob => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' });
        chunksRef.current = [];
        bufferedBytesRef.current = 0;
        return blob;
    }, []);

    const dispatchBatchBlob = useCallback(async (batchBlob: Blob, startedAt: number, endedAt: number) => {
        if (batchBlob.size < MIN_BATCH_BYTES) return;
        const parts = splitBlobBySize(batchBlob, MAX_BATCH_BYTES);
        for (const part of parts) {
            if (part.size < MIN_BATCH_BYTES) continue;
            const currentBatchIndex = batchIndexRef.current;
            batchIndexRef.current += 1;
            setBatchCount(batchIndexRef.current);
            await onBatchReady?.({
                batchIndex: currentBatchIndex,
                blob: part,
                startedAt,
                endedAt
            });
        }
    }, [onBatchReady]);

    const cleanupStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
    }, []);

    const finalizeStoppedRecorder = useCallback(async (finalBlob: Blob, startedAt: number, endedAt: number) => {
        setAudioBlob(finalBlob);
        const parts = splitBlobBySize(finalBlob, MAX_BATCH_BYTES).filter((part) => part.size >= MIN_BATCH_BYTES);
        if (parts.length > 1) {
            for (let i = 0; i < parts.length - 1; i++) {
                const extraBatchIndex = batchIndexRef.current;
                batchIndexRef.current += 1;
                setBatchCount(batchIndexRef.current);
                await onBatchReady?.({
                    batchIndex: extraBatchIndex,
                    blob: parts[i],
                    startedAt,
                    endedAt
                });
            }
            const finalPart = parts[parts.length - 1];
            await onFinalReady?.({
                lastBatchIndex: batchIndexRef.current,
                blob: finalPart,
                startedAt,
                endedAt
            });
        } else {
            await onFinalReady?.({
                lastBatchIndex: batchIndexRef.current,
                blob: finalBlob,
                startedAt,
                endedAt
            });
        }
        cleanupStream();
    }, [cleanupStream, onBatchReady, onFinalReady]);

    const buildRecorder = useCallback((stream: MediaStream) => {
        const optionsMedia = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 };
        const recorder = new MediaRecorder(
            stream,
            MediaRecorder.isTypeSupported(optionsMedia.mimeType) ? optionsMedia : undefined
        );
        mediaRecorderRef.current = recorder;
        mimeTypeRef.current = recorder.mimeType || optionsMedia.mimeType;
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                if (e.data.type) {
                    mimeTypeRef.current = e.data.type;
                }
                chunksRef.current.push(e.data);
                bufferedBytesRef.current += e.data.size;
            }
            if (flushResolverRef.current) {
                flushResolverRef.current();
            }
            if (!stopRequestedRef.current && bufferedBytesRef.current >= MAX_BATCH_BYTES) {
                void enqueueOperation(async () => {
                    if (rotateInProgressRef.current) return;
                    rotateInProgressRef.current = true;
                    stopReasonRef.current = RECORDER_ROTATE_STOP_START ? 'rotate' : null;
                    if (RECORDER_ROTATE_STOP_START && mediaRecorderRef.current?.state === 'recording') {
                        mediaRecorderRef.current.stop();
                        return;
                    }
                    const endedAt = Date.now();
                    const startedAt = segmentStartedAtRef.current || endedAt;
                    const batchBlob = harvestCurrentBatch();
                    segmentStartedAtRef.current = endedAt;
                    rotateInProgressRef.current = false;
                    await dispatchBatchBlob(batchBlob, startedAt, endedAt);
                });
            }
        };
        recorder.onstop = () => {
            const endedAt = Date.now();
            const startedAt = segmentStartedAtRef.current || recordingStartedAtRef.current || endedAt;
            const reason = stopReasonRef.current || (stopRequestedRef.current ? 'final' : 'rotate');
            stopReasonRef.current = null;
            const stoppedBlob = harvestCurrentBatch();

            // Restart first so we do not drop microphone capture while persisting.
            if (reason === 'rotate' && !stopRequestedRef.current && RECORDER_ROTATE_STOP_START && streamRef.current) {
                try {
                    const nextRecorder = buildRecorder(streamRef.current);
                    segmentStartedAtRef.current = endedAt;
                    nextRecorder.start(RECORDER_TIMESLICE_MS);
                } catch (restartError) {
                    console.error('[Recorder] failed to restart recorder after rotation:', restartError);
                    stopRequestedRef.current = true;
                    setIsRecording(false);
                    void enqueueOperation(async () => {
                        rotateInProgressRef.current = false;
                        await finalizeStoppedRecorder(stoppedBlob, startedAt, endedAt);
                    });
                    return;
                }
                void enqueueOperation(async () => {
                    rotateInProgressRef.current = false;
                    await dispatchBatchBlob(stoppedBlob, startedAt, endedAt);
                });
                return;
            }

            void enqueueOperation(async () => {
                rotateInProgressRef.current = false;
                await finalizeStoppedRecorder(stoppedBlob, startedAt, endedAt);
            });
        };
        return recorder;
    }, [dispatchBatchBlob, enqueueOperation, finalizeStoppedRecorder, harvestCurrentBatch]);

    const rotateBatch = useCallback(async () => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state !== 'recording' || stopRequestedRef.current) return;
        if (rotateInProgressRef.current) return;
        rotateInProgressRef.current = true;

        if (RECORDER_ROTATE_STOP_START) {
            stopReasonRef.current = 'rotate';
            recorder.stop();
            return;
        }

        const waitForFlush = new Promise<void>((resolve) => {
            const timeoutId = setTimeout(() => {
                if (flushResolverRef.current) flushResolverRef.current = null;
                resolve();
            }, 1200);
            flushResolverRef.current = () => {
                clearTimeout(timeoutId);
                flushResolverRef.current = null;
                resolve();
            };
        });
        recorder.requestData();
        await waitForFlush;
        const endedAt = Date.now();
        const startedAt = segmentStartedAtRef.current || endedAt;
        const batchBlob = harvestCurrentBatch();
        segmentStartedAtRef.current = endedAt;
        rotateInProgressRef.current = false;
        await dispatchBatchBlob(batchBlob, startedAt, endedAt);
    }, [dispatchBatchBlob, harvestCurrentBatch]);

    const stopRecording = useCallback(() => {
        if (!isRecording) return;
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;

        stopRequestedRef.current = true;
        stopReasonRef.current = 'final';
        setIsRecording(false);

        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (batchTimerRef.current) {
            clearInterval(batchTimerRef.current);
            batchTimerRef.current = null;
        }

        if (recorder.state !== 'inactive') {
            recorder.stop();
        }
    }, [isRecording]);

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: true,
                    channelCount: 1
                }
            });
            streamRef.current = stream;

            chunksRef.current = [];
            bufferedBytesRef.current = 0;
            batchIndexRef.current = 0;
            stopRequestedRef.current = false;
            stopReasonRef.current = null;
            rotateInProgressRef.current = false;
            setBatchCount(0);
            setDuration(0);
            setAudioBlob(null);

            segmentStartedAtRef.current = Date.now();
            recordingStartedAtRef.current = segmentStartedAtRef.current;
            const mediaRecorder = buildRecorder(stream);
            mediaRecorder.start(RECORDER_TIMESLICE_MS);
            setIsRecording(true);

            timerRef.current = window.setInterval(() => {
                const elapsedMs = Date.now() - recordingStartedAtRef.current;
                setDuration(Math.floor(elapsedMs / 1_000));

                if (batchIntervalMs > 0 && !stopRequestedRef.current) {
                    const segmentElapsed = Date.now() - segmentStartedAtRef.current;
                    if (segmentElapsed >= batchIntervalMs + 2_000) {
                        void enqueueOperation(rotateBatch);
                    }
                }
            }, 1_000);

            if (batchIntervalMs > 0) {
                batchTimerRef.current = window.setInterval(() => {
                    void enqueueOperation(rotateBatch);
                }, batchIntervalMs);
            }
        } catch (error) {
            console.error('Error accessing microphone:', error);
            throw error;
        }
    }, [batchIntervalMs, buildRecorder, enqueueOperation, rotateBatch]);

    const resetRecording = useCallback(() => {
        setAudioBlob(null);
        setDuration(0);
        setBatchCount(0);
        batchIndexRef.current = 0;
        bufferedBytesRef.current = 0;
    }, []);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (batchTimerRef.current) clearInterval(batchTimerRef.current);
            cleanupStream();
        };
    }, [cleanupStream]);

    return {
        isRecording,
        audioBlob,
        duration,
        batchCount,
        startRecording,
        stopRecording,
        resetRecording
    };
};
