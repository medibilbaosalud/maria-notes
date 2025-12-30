import { useState, useRef, useCallback, useEffect } from 'react';

export interface AudioRecorderState {
    isRecording: boolean;
    audioBlob: Blob | null;
    duration: number;
    batchCount: number;
}

interface UseAudioRecorderOptions {
    onBatchReady?: (blob: Blob, batchIndex: number) => void;
    batchIntervalMs?: number; // Default: 35 minutes
}

export const useAudioRecorder = (options: UseAudioRecorderOptions = {}) => {
    const { onBatchReady, batchIntervalMs = 35 * 60 * 1000 } = options;

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
    const isStoppingRef = useRef(false); // Flag to know if it's final stop vs batch rotation

    // Create a blob from current chunks and reset
    const harvestCurrentBatch = useCallback((): Blob => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        chunksRef.current = [];
        return blob;
    }, []);

    // Handle batch rotation (called by interval timer)
    const rotateBatch = useCallback(() => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return;

        console.log(`[Recorder] Rotating batch at ${batchIndexRef.current}...`);

        // Request any pending data
        mediaRecorderRef.current.requestData();

        // Small delay to ensure data is flushed, then harvest
        setTimeout(() => {
            const batchBlob = harvestCurrentBatch();
            const currentBatchIndex = batchIndexRef.current;
            batchIndexRef.current++;
            setBatchCount(batchIndexRef.current);

            console.log(`[Recorder] Batch ${currentBatchIndex} harvested: ${(batchBlob.size / 1024 / 1024).toFixed(2)} MB`);

            if (onBatchReady) {
                onBatchReady(batchBlob, currentBatchIndex);
            }
        }, 100);
    }, [harvestCurrentBatch, onBatchReady]);

    const startRecording = useCallback(async () => {
        try {
            // OPTIMIZED AUDIO CONSTRAINTS
            // autoGainControl: Boosts volume automatically if too low
            // noiseSuppression: Reduces background noise
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false, // Disabled to prevent processing artifacts
                    noiseSuppression: false, // Disabled to prevent cutting off voice frequencies
                    autoGainControl: true,   // Kept enabled for consistent volume
                    channelCount: 1,
                }
            });
            streamRef.current = stream;

            // Use high bitrate for better clarity
            const options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 };
            // Fallback for browsers that might not support specific mimeType
            const mediaRecorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(options.mimeType) ? options : undefined);
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];
            batchIndexRef.current = 0;
            isStoppingRef.current = false;
            setBatchCount(0);

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                // Final blob (whatever remains after last batch)
                const finalBlob = harvestCurrentBatch();
                setAudioBlob(finalBlob);

                // Cleanup
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                }
            };

            // Start with timeslice for regular data chunks
            mediaRecorder.start(1000); // Get data every 1 second
            setIsRecording(true);
            setAudioBlob(null);

            // Start duration timer
            const startTime = Date.now();
            timerRef.current = window.setInterval(() => {
                setDuration(Math.floor((Date.now() - startTime) / 1000));
            }, 1000);

            // Start batch rotation timer (only if interval is set and > 0)
            if (batchIntervalMs > 0) {
                console.log(`[Recorder] Batch rotation every ${batchIntervalMs / 1000 / 60} minutes`);
                batchTimerRef.current = window.setInterval(rotateBatch, batchIntervalMs);
            }

        } catch (error) {
            console.error("Error accessing microphone:", error);
            throw error;
        }
    }, [batchIntervalMs, harvestCurrentBatch, rotateBatch]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            isStoppingRef.current = true;
            mediaRecorderRef.current.stop();
            setIsRecording(false);

            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            if (batchTimerRef.current) {
                clearInterval(batchTimerRef.current);
                batchTimerRef.current = null;
            }
        }
    }, [isRecording]);

    const resetRecording = useCallback(() => {
        setAudioBlob(null);
        setDuration(0);
        setBatchCount(0);
        batchIndexRef.current = 0;
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (batchTimerRef.current) clearInterval(batchTimerRef.current);
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

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
