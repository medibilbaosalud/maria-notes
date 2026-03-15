import { expect, test } from '@playwright/test';
import type { ConsultationTranscriptChunk } from '../src/services/supabase';
import { sortTranscriptChunksForMerge } from '../src/utils/transcriptChunks';

const buildChunk = (overrides: Partial<ConsultationTranscriptChunk>): ConsultationTranscriptChunk => ({
  session_id: 'session-1',
  session_version: 1,
  batch_index: 0,
  part_index: 0,
  text: '',
  status: 'completed',
  ...overrides
});

test.describe('sortTranscriptChunksForMerge', () => {
  test('preserves canonical ordering for current chunks', async () => {
    const ordered = sortTranscriptChunksForMerge([
      buildChunk({ batch_index: 1, part_index: 1, text: 'b' }),
      buildChunk({ batch_index: 0, part_index: 0, text: 'a' }),
      buildChunk({ batch_index: 1, part_index: 0, text: 'c' })
    ]);

    expect(ordered.map((chunk) => chunk.text)).toEqual(['a', 'c', 'b']);
  });

  test('normalizes legacy synthetic batch indexes before merge', async () => {
    const ordered = sortTranscriptChunksForMerge([
      buildChunk({ batch_index: 1, part_index: 0, text: 'batch-1' }),
      buildChunk({ batch_index: 2001, part_index: 1, text: 'part-1' }),
      buildChunk({ batch_index: 2000, part_index: 0, text: 'part-0' }),
      buildChunk({ batch_index: 3, part_index: 0, text: 'batch-3' })
    ]);

    expect(ordered.map((chunk) => chunk.text)).toEqual(['batch-1', 'part-0', 'part-1', 'batch-3']);
    expect(ordered.map((chunk) => [chunk.batch_index, chunk.part_index])).toEqual([
      [1, 0],
      [2, 0],
      [2, 1],
      [3, 0]
    ]);
  });
});
