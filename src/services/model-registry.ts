export type TaskType =
    | 'extraction'
    | 'generation'
    | 'validation_a'
    | 'validation_b'
    | 'merge'
    | 'memory'
    | 'feedback'
    | 'report'
    | 'json_repair'
    | 'classification'
    | 'semantic_check'
    | 'prompt_guard'
    | 'rule_categorization';

export interface ModelLimits {
    requestsPerMinute: number;
    tokensPerMinute: number;
    contextWindowTokens: number;
}

const DEFAULT_LIMITS: ModelLimits = {
    requestsPerMinute: 30,
    tokensPerMinute: 6000,
    contextWindowTokens: 8192
};

// Limits provided by user (conservative context window to avoid overflow).
export const MODEL_LIMITS: Record<string, ModelLimits> = {
    'allam-2-7b': { requestsPerMinute: 30, tokensPerMinute: 6000, contextWindowTokens: 8192 },
    'llama-3.1-8b-instant': { requestsPerMinute: 30, tokensPerMinute: 6000, contextWindowTokens: 8192 },
    'llama-3.3-70b-versatile': { requestsPerMinute: 30, tokensPerMinute: 12000, contextWindowTokens: 8192 },
    'meta-llama/llama-4-maverick-17b-128e-instruct': { requestsPerMinute: 30, tokensPerMinute: 6000, contextWindowTokens: 8192 },
    'meta-llama/llama-4-scout-17b-16e-instruct': { requestsPerMinute: 30, tokensPerMinute: 30000, contextWindowTokens: 8192 },
    'meta-llama/llama-guard-4-12b': { requestsPerMinute: 30, tokensPerMinute: 15000, contextWindowTokens: 8192 },
    'meta-llama/llama-prompt-guard-2-22m': { requestsPerMinute: 30, tokensPerMinute: 15000, contextWindowTokens: 8192 },
    'meta-llama/llama-prompt-guard-2-86m': { requestsPerMinute: 30, tokensPerMinute: 15000, contextWindowTokens: 8192 },
    'moonshotai/kimi-k2-instruct': { requestsPerMinute: 60, tokensPerMinute: 10000, contextWindowTokens: 8192 },
    'moonshotai/kimi-k2-instruct-0905': { requestsPerMinute: 60, tokensPerMinute: 10000, contextWindowTokens: 8192 },
    'openai/gpt-oss-120b': { requestsPerMinute: 30, tokensPerMinute: 8000, contextWindowTokens: 8192 },
    'openai/gpt-oss-20b': { requestsPerMinute: 30, tokensPerMinute: 8000, contextWindowTokens: 8192 },
    'openai/gpt-oss-safeguard-20b': { requestsPerMinute: 30, tokensPerMinute: 8000, contextWindowTokens: 8192 },
    'qwen/qwen3-32b': { requestsPerMinute: 60, tokensPerMinute: 6000, contextWindowTokens: 8192 }
};

export const TASK_MODEL_PREFERENCES: Record<TaskType, string[]> = {
    extraction: [
        // Best reasoning quality for structured extraction.
        'openai/gpt-oss-120b',
        'llama-3.3-70b-versatile',
        'qwen/qwen3-32b'
    ],
    generation: [
        // Highest narrative quality and clinical reasoning.
        'openai/gpt-oss-120b',
        'llama-3.3-70b-versatile',
        'meta-llama/llama-4-scout-17b-16e-instruct',
        'qwen/qwen3-32b'
    ],
    validation_a: [
        // Primary factual validator: strongest reasoning model first.
        'openai/gpt-oss-120b',
        'qwen/qwen3-32b',
        'llama-3.3-70b-versatile'
    ],
    validation_b: [
        // Adversarial validator: diverse architecture + high throughput.
        'meta-llama/llama-4-scout-17b-16e-instruct',
        'qwen/qwen3-32b',
        'llama-3.3-70b-versatile'
    ],
    classification: [
        // Light but accurate classifier; keep reasoning quality high.
        'openai/gpt-oss-120b',
        'llama-3.3-70b-versatile',
        'qwen/qwen3-32b'
    ],
    semantic_check: [
        // Micro-validator for negations/temporality conflicts.
        'openai/gpt-oss-120b',
        'llama-3.3-70b-versatile',
        'qwen/qwen3-32b'
    ],
    prompt_guard: [
        // Dedicated prompt-injection classifiers.
        'meta-llama/llama-prompt-guard-2-86m',
        'meta-llama/llama-prompt-guard-2-22m'
    ],
    merge: [
        // Deterministic merge and conflict resolution.
        'openai/gpt-oss-120b',
        'llama-3.3-70b-versatile',
        'qwen/qwen3-32b'
    ],
    memory: [
        // Consolidation quality matters; keep strong reasoning on top.
        'openai/gpt-oss-120b',
        'llama-3.3-70b-versatile',
        'qwen/qwen3-32b'
    ],
    feedback: [
        // Doctor feedback classification benefits from reasoning quality.
        'openai/gpt-oss-120b',
        'qwen/qwen3-32b',
        'llama-3.1-8b-instant'
    ],
    rule_categorization: [
        'openai/gpt-oss-120b',
        'llama-3.3-70b-versatile',
        'qwen/qwen3-32b'
    ],
    report: [
        'openai/gpt-oss-120b',
        'llama-3.3-70b-versatile',
        'qwen/qwen3-32b'
    ],
    json_repair: [
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'qwen/qwen3-32b'
    ]
};

export function getTaskModels(task: TaskType): string[] {
    return TASK_MODEL_PREFERENCES[task] || [];
}

export function getModelLimits(model: string): ModelLimits {
    return MODEL_LIMITS[model] || DEFAULT_LIMITS;
}
