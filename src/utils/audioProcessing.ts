/**
 * Audio processing utilities for Whisper transcription.
 *
 * Key insight: Groq's Whisper API rejects raw webm/opus from MediaRecorder (HTTP 400).
 * All audio MUST be converted to WAV before sending to Whisper.
 *
 * - Resamples to 16kHz (Whisper optimal)
 * - Converts to Mono
 * - Splits into safe chunks to avoid 25MB API limit
 * - Yields to main thread during heavy processing to prevent UI freezes
 */

const MAX_CHUNK_BYTES = 20 * 1024 * 1024; // Hard guard below API limits
const CHUNK_DURATION_SEC = 180; // 3 minutes per chunk
const YIELD_EVERY_SAMPLES = 500_000; // Yield to main thread every ~500K samples

/**
 * Convert a single audio blob to WAV format (16kHz mono).
 * Yields to the main thread during encoding to prevent UI freezes.
 * If the result exceeds MAX_CHUNK_BYTES, it is split into smaller WAV chunks.
 */
export async function convertBlobToWav(blob: Blob): Promise<Blob[]> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000
    });

    try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const totalSamples = audioBuffer.length;
        const chunkSamples = CHUNK_DURATION_SEC * audioBuffer.sampleRate;

        // If audio fits in one chunk and the WAV size will be safe, encode directly
        if (totalSamples <= chunkSamples) {
            const wav = await bufferToWavAsync(audioBuffer, 0, totalSamples);
            if (wav.size <= MAX_CHUNK_BYTES) {
                return [wav];
            }
        }

        // Split into time-based chunks and encode each
        const totalChunks = Math.ceil(totalSamples / chunkSamples);
        const chunks: Blob[] = [];

        for (let i = 0; i < totalChunks; i++) {
            const startSample = i * chunkSamples;
            const endSample = Math.min(startSample + chunkSamples, totalSamples);
            const wav = await bufferToWavAsync(audioBuffer, startSample, endSample);

            // Safety: if a single chunk is still too large, split it further
            if (wav.size > MAX_CHUNK_BYTES) {
                const midSample = startSample + Math.floor((endSample - startSample) / 2);
                if (midSample > startSample && midSample < endSample) {
                    chunks.push(await bufferToWavAsync(audioBuffer, startSample, midSample));
                    chunks.push(await bufferToWavAsync(audioBuffer, midSample, endSample));
                } else {
                    chunks.push(wav); // Can't split further, send as-is
                }
            } else {
                chunks.push(wav);
            }
        }

        return chunks.filter(c => c.size > 44); // Filter out empty WAV (header-only)
    } finally {
        await audioContext.close();
    }
}

/**
 * Full normalize-and-chunk pipeline (legacy).
 * Kept for backward compatibility with groq.ts WAV fallback path.
 * Normalizes volume to -1dB in addition to format conversion.
 */
export async function normalizeAndChunkAudio(blob: Blob): Promise<Blob[]> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000
    });

    try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Find peak volume (with yields)
        let maxAmplitude = 0;
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < channelData.length; i += 10) {
            if (Math.abs(channelData[i]) > maxAmplitude) {
                maxAmplitude = Math.abs(channelData[i]);
            }
            if (i % YIELD_EVERY_SAMPLES === 0) await new Promise(r => setTimeout(r, 0));
        }

        const targetAmplitude = 0.89; // -1dB
        const gain = maxAmplitude > 0 ? targetAmplitude / maxAmplitude : 1;
        const shouldNormalize = gain > 1.0;

        console.log(`[AudioProcessor] Duration: ${audioBuffer.duration}s | Peak: ${maxAmplitude.toFixed(2)} | Gain: ${gain.toFixed(2)}x`);

        const totalSamples = audioBuffer.length;
        const chunkSamples = CHUNK_DURATION_SEC * audioBuffer.sampleRate;
        const totalChunks = Math.ceil(totalSamples / chunkSamples);
        const chunks: Blob[] = [];

        for (let i = 0; i < totalChunks; i++) {
            const startSample = i * chunkSamples;
            const endSample = Math.min(startSample + chunkSamples, totalSamples);
            const wav = await bufferToWavAsync(audioBuffer, startSample, endSample, shouldNormalize ? gain : undefined);

            if (wav.size > MAX_CHUNK_BYTES) {
                const midSample = startSample + Math.floor((endSample - startSample) / 2);
                if (midSample > startSample && midSample < endSample) {
                    chunks.push(await bufferToWavAsync(audioBuffer, startSample, midSample, shouldNormalize ? gain : undefined));
                    chunks.push(await bufferToWavAsync(audioBuffer, midSample, endSample, shouldNormalize ? gain : undefined));
                } else {
                    chunks.push(wav);
                }
            } else {
                chunks.push(wav);
            }
        }

        return chunks.filter(c => c.size > 44);
    } finally {
        await audioContext.close();
    }
}

/**
 * Async WAV encoder that yields to the main thread during encoding.
 * Encodes a range of samples from an AudioBuffer to a 16-bit mono WAV blob.
 */
async function bufferToWavAsync(
    audioBuffer: AudioBuffer,
    startSample: number,
    endSample: number,
    gain?: number
): Promise<Blob> {
    const frameCount = endSample - startSample;
    const dataLength = frameCount * 2; // 16-bit = 2 bytes per sample
    const headerLength = 44;
    const totalLength = headerLength + dataLength;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    const sampleRate = audioBuffer.sampleRate;

    // WAV header
    let pos = 0;
    const writeUint16 = (val: number) => { view.setUint16(pos, val, true); pos += 2; };
    const writeUint32 = (val: number) => { view.setUint32(pos, val, true); pos += 4; };

    writeUint32(0x46464952); // "RIFF"
    writeUint32(totalLength - 8);
    writeUint32(0x45564157); // "WAVE"
    writeUint32(0x20746d66); // "fmt "
    writeUint32(16);
    writeUint16(1);          // PCM
    writeUint16(1);          // Mono
    writeUint32(sampleRate);
    writeUint32(sampleRate * 2); // byte rate
    writeUint16(2);          // block align
    writeUint16(16);         // bits per sample
    writeUint32(0x61746164); // "data"
    writeUint32(dataLength);

    // Downmix to mono and encode samples with periodic yields
    const isStereo = audioBuffer.numberOfChannels > 1;
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = isStereo ? audioBuffer.getChannelData(1) : null;
    const applyGain = gain !== undefined && gain !== 1;
    let samplesWritten = 0;

    for (let i = startSample; i < endSample; i++) {
        let sample: number;
        if (ch1) {
            sample = (ch0[i] + ch1[i]) / 2;
        } else {
            sample = ch0[i];
        }

        if (applyGain) {
            sample *= gain!;
        }

        // Clamp and convert to 16-bit signed integer
        sample = Math.max(-1, Math.min(1, sample));
        view.setInt16(pos, (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0, true);
        pos += 2;

        samplesWritten++;
        // Yield to main thread periodically to prevent UI freezes
        if (samplesWritten % YIELD_EVERY_SAMPLES === 0) {
            await new Promise(r => setTimeout(r, 0));
        }
    }

    return new Blob([buffer], { type: 'audio/wav' });
}
