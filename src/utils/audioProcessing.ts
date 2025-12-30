/**
 * Normalizes audio volume to a target peak level.
 * Simulates Auto Gain Control for uploaded files.
 */
export async function normalizeAudio(blob: Blob): Promise<Blob> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // 1. Find Peak Volume
    let maxAmplitude = 0;
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        const channelData = audioBuffer.getChannelData(i);
        for (let j = 0; j < channelData.length; j++) {
            if (Math.abs(channelData[j]) > maxAmplitude) {
                maxAmplitude = Math.abs(channelData[j]);
            }
        }
    }

    // 2. Calculate Gain to reach -1.0 dB (approx 0.89 amplitude)
    // Avoid infinite gain if silent
    if (maxAmplitude === 0) return blob;

    const targetAmplitude = 0.89; // -1dB
    const gain = targetAmplitude / maxAmplitude;

    if (gain <= 1.0) {
        console.log(`[AudioNormalizer] Audio already loud (Peak: ${maxAmplitude.toFixed(2)}). Skipping normalization.`);
        return blob; // Don't amplify if already loud enough or clipping
    }

    console.log(`[AudioNormalizer] Boosting volume. Peak: ${maxAmplitude.toFixed(2)} -> Gain: ${gain.toFixed(2)}x`);

    // 3. Apply Gain
    const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;

    const gainNode = offlineContext.createGain();
    gainNode.gain.value = gain;

    source.connect(gainNode);
    gainNode.connect(offlineContext.destination);
    source.start();

    const renderedBuffer = await offlineContext.startRendering();

    // 4. Encode back to WAV
    return bufferToWav(renderedBuffer);
}

// Simple WAV encoder helper
function bufferToWav(abuffer: AudioBuffer) {
    const numOfChan = abuffer.numberOfChannels;
    const length = abuffer.length * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let i;
    let sample;
    let offset = 0;
    let pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded in this loop)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // write interleaved data
    for (i = 0; i < abuffer.numberOfChannels; i++)
        channels.push(abuffer.getChannelData(i));

    while (pos < abuffer.length) {
        for (i = 0; i < numOfChan; i++) {
            // interleave channels
            sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
            view.setInt16(44 + offset, sample, true); // write 16-bit sample
            offset += 2;
        }
        pos++;
    }

    // transform to blob
    return new Blob([buffer], { type: 'audio/wav' });

    function setUint16(data: any) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data: any) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}
