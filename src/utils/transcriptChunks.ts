import type { ConsultationTranscriptChunk } from '../services/supabase';

const LEGACY_BATCH_MULTIPLIER = 1000;

const hasLegacySibling = (
    chunks: ConsultationTranscriptChunk[],
    baseBatchIndex: number
): boolean => chunks.some((chunk) => {
    if (typeof chunk.part_index !== 'number' || chunk.part_index <= 0) return false;
    return Math.floor(Number(chunk.batch_index) / LEGACY_BATCH_MULTIPLIER) === baseBatchIndex;
});

export const normalizeTranscriptChunkForMerge = (
    chunk: ConsultationTranscriptChunk,
    allChunks: ConsultationTranscriptChunk[]
): ConsultationTranscriptChunk => {
    const batchIndex = Number(chunk.batch_index);
    const partIndex = Math.max(0, Number(chunk.part_index || 0));
    if (batchIndex < LEGACY_BATCH_MULTIPLIER) {
        return {
            ...chunk,
            batch_index: batchIndex,
            part_index: partIndex
        };
    }

    const legacyBaseBatchIndex = Math.floor(batchIndex / LEGACY_BATCH_MULTIPLIER);
    if (!hasLegacySibling(allChunks, legacyBaseBatchIndex)) {
        return {
            ...chunk,
            batch_index: batchIndex,
            part_index: partIndex
        };
    }

    return {
        ...chunk,
        batch_index: legacyBaseBatchIndex,
        part_index: batchIndex % LEGACY_BATCH_MULTIPLIER
    };
};

export const sortTranscriptChunksForMerge = (
    chunks: ConsultationTranscriptChunk[]
): ConsultationTranscriptChunk[] => {
    const normalized = chunks.map((chunk) => normalizeTranscriptChunkForMerge(chunk, chunks));
    return normalized.sort((a, b) => {
        if (a.batch_index !== b.batch_index) return a.batch_index - b.batch_index;
        return (a.part_index || 0) - (b.part_index || 0);
    });
};
