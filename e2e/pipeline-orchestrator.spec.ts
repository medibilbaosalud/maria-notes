import { expect, test } from '@playwright/test';
import { ConsultationPipelineOrchestrator } from '../src/services/pipeline-orchestrator';

const buildBlob = (label: string) => new Blob([label], { type: 'audio/wav' });
const waitForDrain = async (ms: number = 50) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

test.describe('ConsultationPipelineOrchestrator', () => {
  test('marks failed partials as unresolved during finalize', async () => {
    const finalizePayloads: Array<{ missingBatches: number[]; failedBatches: number[]; processedBatches: number[] }> = [];
    const orchestrator = new ConsultationPipelineOrchestrator<void>({
      processPartial: async ({ batchIndex }) => {
        if (batchIndex === 1) {
          throw new Error('forced_partial_failure');
        }
      },
      finalize: async (payload) => {
        finalizePayloads.push({
          missingBatches: payload.missingBatches,
          failedBatches: payload.failedBatches,
          processedBatches: payload.processedBatches
        });
      },
      finalizeWaitMs: 20
    });

    orchestrator.startConsultation('session-1', 'Paciente Test');
    await Promise.all([
      orchestrator.enqueuePartial(0, buildBlob('a')),
      orchestrator.enqueuePartial(1, buildBlob('b'))
    ]);

    await waitForDrain();
    expect(orchestrator.getStatus().failedBatches).toEqual([1]);
    await orchestrator.finalize(2, buildBlob('final'));

    expect(finalizePayloads).toHaveLength(1);
    expect(finalizePayloads[0]).toEqual({
      missingBatches: [1],
      failedBatches: [1],
      processedBatches: [0]
    });
  });

  test('does not duplicate unresolved batches when one is failed and timed out', async () => {
    const finalizePayloads: Array<{ missingBatches: number[]; failedBatches: number[] }> = [];
    const orchestrator = new ConsultationPipelineOrchestrator<void>({
      processPartial: async ({ batchIndex }) => {
        if (batchIndex === 0) {
          throw new Error('forced_partial_failure');
        }
      },
      finalize: async (payload) => {
        finalizePayloads.push({
          missingBatches: payload.missingBatches,
          failedBatches: payload.failedBatches
        });
      },
      finalizeWaitMs: 20
    });

    orchestrator.startConsultation('session-2', 'Paciente Test');
    await orchestrator.enqueuePartial(0, buildBlob('a'));
    await waitForDrain();
    expect(orchestrator.getStatus().failedBatches).toEqual([0]);
    await orchestrator.finalize(1, buildBlob('final'));

    expect(finalizePayloads[0]).toEqual({
      missingBatches: [0],
      failedBatches: [0]
    });
  });
});
