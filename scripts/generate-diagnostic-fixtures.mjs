import fs from 'node:fs/promises';
import path from 'node:path';

const OUTPUT_DIR = path.resolve(process.cwd(), 'e2e', 'fixtures');
const SAMPLE_RATE = 16000;

const writeWavHeader = (buffer, totalSamples, sampleRate = SAMPLE_RATE) => {
  const dataSize = totalSamples * 2;
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
};

const lcg = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
};

const writePseudoSpeechWavFile = async (filePath, {
  durationSec,
  baseFreq = 160,
  sampleRate = SAMPLE_RATE,
  seed = 1
}) => {
  const totalSamples = Math.max(1, Math.floor(durationSec * sampleRate));
  const buffer = Buffer.alloc(44 + totalSamples * 2);
  writeWavHeader(buffer, totalSamples, sampleRate);
  const rand = lcg(seed);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const phrasePhase = Math.floor(t * 2) % 12;
    const formantA = baseFreq + (phrasePhase * 9);
    const formantB = (baseFreq * 2.15) + (phrasePhase * 7);
    const vibrato = Math.sin(2 * Math.PI * 5.1 * t) * 0.015;
    const envelope = 0.25 + 0.2 * Math.sin(2 * Math.PI * 1.7 * t) + 0.1 * Math.sin(2 * Math.PI * 0.23 * t);
    const harmonic1 = Math.sin(2 * Math.PI * formantA * t);
    const harmonic2 = 0.55 * Math.sin(2 * Math.PI * formantB * t + vibrato);
    const breathNoise = (rand() - 0.5) * 0.02;
    const sample = Math.max(-1, Math.min(1, (harmonic1 + harmonic2) * envelope + breathNoise));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }

  await fs.writeFile(filePath, buffer);
};

const writeToneFixture = async (filePath, { durationSec, frequencyHz }) => {
  const totalSamples = Math.max(1, Math.floor(durationSec * SAMPLE_RATE));
  const buffer = Buffer.alloc(44 + totalSamples * 2);
  writeWavHeader(buffer, totalSamples, SAMPLE_RATE);
  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const amplitude = 0.2 * Math.sin(2 * Math.PI * frequencyHz * t);
    const sample = Math.max(-1, Math.min(1, amplitude));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  await fs.writeFile(filePath, buffer);
};

const baseScenarios = [
  { id: 'single_chunk_clean', durationSec: 8, frequencyHz: 330 },
  { id: 'multi_chunk_clean', durationSec: 12, frequencyHz: 392 },
  { id: 'chunk_failure_in_middle', durationSec: 10, frequencyHz: 262 },
  { id: 'final_stage_failure', durationSec: 7, frequencyHz: 494 }
];

const longRunScenario = {
  id: 'hourly_complex_consultation',
  chunkCount: 20,
  chunkDurationSec: 180
};

await fs.mkdir(OUTPUT_DIR, { recursive: true });

for (const scenario of baseScenarios) {
  const outPath = path.join(OUTPUT_DIR, `${scenario.id}.wav`);
  await writeToneFixture(outPath, scenario);
}

const longRunDir = path.join(OUTPUT_DIR, longRunScenario.id);
await fs.mkdir(longRunDir, { recursive: true });
const manifest = {
  scenario_id: longRunScenario.id,
  sample_rate_hz: SAMPLE_RATE,
  chunk_duration_sec: longRunScenario.chunkDurationSec,
  chunk_count: longRunScenario.chunkCount,
  chunk_files: []
};
for (let i = 0; i < longRunScenario.chunkCount; i++) {
  const fileName = `chunk_${String(i + 1).padStart(2, '0')}.wav`;
  const outPath = path.join(longRunDir, fileName);
  await writePseudoSpeechWavFile(outPath, {
    durationSec: longRunScenario.chunkDurationSec,
    baseFreq: 145 + (i % 7) * 18,
    seed: i + 1
  });
  manifest.chunk_files.push(fileName);
}
await fs.writeFile(path.join(longRunDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Generated ${baseScenarios.length + longRunScenario.chunkCount} WAV fixtures in ${OUTPUT_DIR}`);
