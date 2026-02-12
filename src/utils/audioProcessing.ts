/**
 * Normalizes audio volume and chunks it for API processing.
 * - Resamples to 16kHz (Whisper optimal)
 * - Converts to Mono
 * - Normalizes Volume (-1dB)
 * - Splits into ~5 minute chunks to avoid 25MB API limit
 */
export async function normalizeAndChunkAudio(blob: Blob): Promise<Blob[]> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000 // Force 16kHz context
    });

    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // 1. Find Peak Volume & Normalize
    let maxAmplitude = 0;
    const channelData = audioBuffer.getChannelData(0); // Only need first channel for mono check

    // Check peak in chunks to save CPU
    for (let i = 0; i < channelData.length; i += 10) {
        if (Math.abs(channelData[i]) > maxAmplitude) {
            maxAmplitude = Math.abs(channelData[i]);
        }
        // Yield to main thread every 2M samples (~40s of audio) to prevent UI hang
        if (i % 2000000 === 0) await new Promise(r => setTimeout(r, 0));
    }

    const targetAmplitude = 0.89; // -1dB
    const gain = maxAmplitude > 0 ? targetAmplitude / maxAmplitude : 1;
    const shouldNormalize = gain > 1.0;

    console.log(`[AudioProcessor] Duration: ${audioBuffer.duration}s | Peak: ${maxAmplitude.toFixed(2)} | Gain: ${gain.toFixed(2)}x`);

    // 2. Process, Downmix to Mono, and Chunk
    // REDUCED to 3 minutes (180s) to be safe even if browser runs at 48kHz
    const CHUNK_DURATION_SEC = 180;
    const chunks: Blob[] = [];
    const MAX_CHUNK_BYTES = 20 * 1024 * 1024; // Hard guard below API limits

    const totalSamples = audioBuffer.length;
    const chunkSamples = CHUNK_DURATION_SEC * audioBuffer.sampleRate;
    const totalChunks = Math.ceil(totalSamples / chunkSamples);

    const encodeRange = (startSample: number, endSample: number): Blob => {
        const frameCount = endSample - startSample;

        // Create new mono buffer for this chunk
        const chunkBuffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
        const chunkData = chunkBuffer.getChannelData(0);

        // Copy and downmix/normalize
        if (audioBuffer.numberOfChannels === 1) {
            // Already mono
            const inputData = audioBuffer.getChannelData(0);
            for (let j = 0; j < frameCount; j++) {
                chunkData[j] = inputData[startSample + j] * (shouldNormalize ? gain : 1);
            }
        } else {
            // Downmix stereo to mono
            const left = audioBuffer.getChannelData(0);
            const right = audioBuffer.getChannelData(1);
            for (let j = 0; j < frameCount; j++) {
                chunkData[j] = ((left[startSample + j] + right[startSample + j]) / 2) * (shouldNormalize ? gain : 1);
            }
        }

        return bufferToWav(chunkBuffer);
    };

    const pushChunkWithSizeGuard = (startSample: number, endSample: number) => {
        const encoded = encodeRange(startSample, endSample);
        if (encoded.size <= MAX_CHUNK_BYTES || (endSample - startSample) <= audioBuffer.sampleRate * 30) {
            chunks.push(encoded);
            return;
        }

        // Oversized range: recursively split to guarantee safety for long/high-rate inputs.
        const midpoint = startSample + Math.floor((endSample - startSample) / 2);
        if (midpoint <= startSample || midpoint >= endSample) {
            chunks.push(encoded);
            return;
        }
        pushChunkWithSizeGuard(startSample, midpoint);
        pushChunkWithSizeGuard(midpoint, endSample);
    };

    for (let i = 0; i < totalChunks; i++) {
        const startSample = i * chunkSamples;
        const endSample = Math.min(startSample + chunkSamples, totalSamples);
        pushChunkWithSizeGuard(startSample, endSample);
    }

    console.log(`[AudioProcessor] Split into ${chunks.length} chunks`);
    await audioContext.close();
    return chunks;
}

// Simple WAV encoder helper (16-bit Mono)
function bufferToWav(abuffer: AudioBuffer) {
    const numOfChan = abuffer.numberOfChannels,
        length = abuffer.length * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [],
        sampleRate = abuffer.sampleRate;

    let offset = 0,
        pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(sampleRate);
    setUint32(sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // write interleaved data
    for (let i = 0; i < numOfChan; i++)
        channels.push(abuffer.getChannelData(i));

    while (pos < length) {
        for (let i = 0; i < numOfChan; i++) { // interleave channels
            let sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
            sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0; // scale to 16-bit signed int
            view.setInt16(pos, sample, true); // write 16-bit sample
            pos += 2;
        }
        offset++; // next source sample
    }

    return new Blob([buffer], { type: "audio/wav" });

    function setUint16(data: number) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data: number) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}
