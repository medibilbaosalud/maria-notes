import fs from 'node:fs/promises';
import path from 'node:path';

const OUTPUT_DIR = path.resolve(process.cwd(), 'e2e', 'fixtures');

const writeWavFile = async (filePath, { durationSec, frequencyHz, sampleRate = 16000 }) => {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

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

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const amplitude = 0.22 * Math.sin(2 * Math.PI * frequencyHz * t);
    const sample = Math.max(-1, Math.min(1, amplitude));
    const int16 = Math.round(sample * 32767);
    buffer.writeInt16LE(int16, 44 + i * 2);
  }

  await fs.writeFile(filePath, buffer);
};

const scenarios = [
  { id: 'single_chunk_clean', durationSec: 8, frequencyHz: 330 },
  { id: 'multi_chunk_clean', durationSec: 12, frequencyHz: 392 },
  { id: 'chunk_failure_in_middle', durationSec: 10, frequencyHz: 262 },
  { id: 'final_stage_failure', durationSec: 7, frequencyHz: 494 }
];

await fs.mkdir(OUTPUT_DIR, { recursive: true });

for (const scenario of scenarios) {
  const outPath = path.join(OUTPUT_DIR, `${scenario.id}.wav`);
  await writeWavFile(outPath, scenario);
}

console.log(`Generated ${scenarios.length} WAV fixtures in ${OUTPUT_DIR}`);

