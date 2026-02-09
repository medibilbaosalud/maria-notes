export type RetryStage =
    | 'transcription'
    | 'extraction'
    | 'generation'
    | 'validation'
    | 'persistence'
    | 'default';

export interface StageRetryPolicy {
    retries: number;
    timeoutMs: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

const FAST_PATH_RETRY_TUNING = String(import.meta.env.VITE_FAST_PATH_RETRY_TUNING || 'true').toLowerCase() === 'true';

const RETRY_POLICY: Record<RetryStage, StageRetryPolicy> = {
    transcription: {
        retries: 5,
        timeoutMs: 180_000,
        baseDelayMs: 500,
        maxDelayMs: 12_000
    },
    extraction: {
        retries: 4,
        timeoutMs: 90_000,
        baseDelayMs: 350,
        maxDelayMs: 8_000
    },
    generation: {
        retries: FAST_PATH_RETRY_TUNING ? 2 : 4,
        timeoutMs: FAST_PATH_RETRY_TUNING ? 45_000 : 90_000,
        baseDelayMs: 350,
        maxDelayMs: 8_000
    },
    validation: {
        retries: FAST_PATH_RETRY_TUNING ? 2 : 4,
        timeoutMs: FAST_PATH_RETRY_TUNING ? 45_000 : 90_000,
        baseDelayMs: 350,
        maxDelayMs: 8_000
    },
    persistence: {
        retries: 6,
        timeoutMs: 30_000,
        baseDelayMs: 250,
        maxDelayMs: 5_000
    },
    default: {
        retries: 3,
        timeoutMs: 60_000,
        baseDelayMs: 350,
        maxDelayMs: 6_000
    }
};

const TASK_STAGE_MAP: Record<string, RetryStage> = {
    extraction: 'extraction',
    generation: 'generation',
    validation_a: 'validation',
    validation_b: 'validation',
    report: 'generation',
    json_repair: 'generation',
    classification: 'extraction',
    semantic_check: 'validation',
    prompt_guard: 'validation',
    memory: 'generation',
    feedback: 'generation',
    merge: 'generation',
    rule_categorization: 'generation',
    quality_triage: 'validation'
};

export const getRetryPolicy = (stage: RetryStage): StageRetryPolicy => RETRY_POLICY[stage] || RETRY_POLICY.default;

export const getRetryPolicyForTask = (task: string): StageRetryPolicy => {
    const stage = TASK_STAGE_MAP[task] || 'default';
    return getRetryPolicy(stage);
};
