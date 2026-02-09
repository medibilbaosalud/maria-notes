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
    | 'rule_categorization'
    | 'quality_triage';

export type ModelProvider = 'groq' | 'gemini';
export type ThinkingMode = 'low' | 'medium';

export interface ModelCandidate {
    provider: ModelProvider;
    model: string;
    routeKey: string;
    thinking?: ThinkingMode;
    taskSupport?: TaskType[];
}

export interface ModelLimits {
    requestsPerMinute: number;
    tokensPerMinute: number;
    requestsPerDay: number;
    tokensPerDay: number;
    audioSecondsPerHour?: number;
    audioSecondsPerDay?: number;
    contextWindowTokens: number;
}

const DEFAULT_LIMITS: ModelLimits = {
    requestsPerMinute: 30,
    tokensPerMinute: 6000,
    requestsPerDay: 1000,
    tokensPerDay: 200000,
    contextWindowTokens: 8192
};

const candidate = (provider: ModelProvider, model: string, options: { thinking?: ThinkingMode; taskSupport?: TaskType[] } = {}): ModelCandidate => ({
    provider,
    model,
    routeKey: `${provider}:${model}`,
    thinking: options.thinking,
    taskSupport: options.taskSupport
});

const GEMINI_TEXT_CHAIN_LOW: ModelCandidate[] = [
    candidate('gemini', 'gemini-3-flash', { thinking: 'low' }),
    candidate('gemini', 'gemini-2.5-flash', { thinking: 'low' }),
    candidate('gemini', 'gemini-2.5-flash-lite', { thinking: 'low' }),
    candidate('gemini', 'gemma-3-27b-it', { thinking: 'low' }),
    candidate('gemini', 'gemma-3-12b-it', { thinking: 'low' }),
    candidate('gemini', 'gemma-3-4b-it', { thinking: 'low' }),
    candidate('gemini', 'gemma-3-2b-it', { thinking: 'low' }),
    candidate('gemini', 'gemma-3-1b-it', { thinking: 'low' })
];

const GEMINI_TEXT_CHAIN_MEDIUM: ModelCandidate[] = [
    candidate('gemini', 'gemini-3-flash', { thinking: 'medium' }),
    candidate('gemini', 'gemini-2.5-flash', { thinking: 'medium' }),
    candidate('gemini', 'gemini-2.5-flash-lite', { thinking: 'low' }),
    candidate('gemini', 'gemma-3-27b-it', { thinking: 'low' }),
    candidate('gemini', 'gemma-3-12b-it', { thinking: 'low' }),
    candidate('gemini', 'gemma-3-4b-it', { thinking: 'low' }),
    candidate('gemini', 'gemma-3-2b-it', { thinking: 'low' }),
    candidate('gemini', 'gemma-3-1b-it', { thinking: 'low' })
];

const GROQ_CORE_FALLBACK: ModelCandidate[] = [
    candidate('groq', 'openai/gpt-oss-120b'),
    candidate('groq', 'llama-3.3-70b-versatile'),
    candidate('groq', 'qwen/qwen3-32b'),
    candidate('groq', 'meta-llama/llama-4-scout-17b-16e-instruct'),
    candidate('groq', 'llama-3.1-8b-instant')
];

const GROQ_REVIEW_PRIMARY: ModelCandidate[] = [
    candidate('groq', 'openai/gpt-oss-120b'),
    candidate('groq', 'qwen/qwen3-32b'),
    candidate('groq', 'llama-3.3-70b-versatile'),
    candidate('groq', 'meta-llama/llama-4-scout-17b-16e-instruct')
];

const GROQ_PROMPT_GUARD: ModelCandidate[] = [
    candidate('groq', 'meta-llama/llama-prompt-guard-2-86m'),
    candidate('groq', 'meta-llama/llama-prompt-guard-2-22m')
];

const DEFAULT_TASK_MODEL_PREFERENCES: Record<TaskType, ModelCandidate[]> = {
    extraction: [...GEMINI_TEXT_CHAIN_LOW, ...GROQ_CORE_FALLBACK],
    generation: [...GEMINI_TEXT_CHAIN_MEDIUM, ...GROQ_CORE_FALLBACK],
    merge: [...GEMINI_TEXT_CHAIN_LOW, ...GROQ_CORE_FALLBACK],
    classification: [...GEMINI_TEXT_CHAIN_LOW, ...GROQ_CORE_FALLBACK],
    report: [...GEMINI_TEXT_CHAIN_MEDIUM, ...GROQ_CORE_FALLBACK],
    memory: [...GEMINI_TEXT_CHAIN_LOW, ...GROQ_CORE_FALLBACK],
    json_repair: [...GEMINI_TEXT_CHAIN_LOW, ...GROQ_CORE_FALLBACK],

    validation_a: [...GROQ_REVIEW_PRIMARY, ...GEMINI_TEXT_CHAIN_LOW],
    validation_b: [
        candidate('groq', 'meta-llama/llama-4-scout-17b-16e-instruct'),
        candidate('groq', 'qwen/qwen3-32b'),
        candidate('groq', 'llama-3.3-70b-versatile'),
        ...GEMINI_TEXT_CHAIN_LOW
    ],
    semantic_check: [...GROQ_REVIEW_PRIMARY, ...GEMINI_TEXT_CHAIN_LOW],
    feedback: [...GROQ_REVIEW_PRIMARY, ...GEMINI_TEXT_CHAIN_LOW],
    rule_categorization: [...GROQ_REVIEW_PRIMARY, ...GEMINI_TEXT_CHAIN_LOW],
    quality_triage: [...GROQ_REVIEW_PRIMARY, ...GEMINI_TEXT_CHAIN_LOW],

    prompt_guard: [...GROQ_PROMPT_GUARD]
};

const DEFAULT_ALLOWED_CANDIDATES: ModelCandidate[] = [
    ...Object.values(DEFAULT_TASK_MODEL_PREFERENCES).flat(),
    candidate('groq', 'whisper-large-v3-turbo'),
    candidate('groq', 'whisper-large-v3'),

    // Visible in user's Gemini console (allowlisted but not used in core clinical generation).
    candidate('gemini', 'gemini-2.5-flash-native-audio-dialog'),
    candidate('gemini', 'gemini-2.5-flash-preview-tts'),
    candidate('gemini', 'gemini-embedding-1'),
    candidate('gemini', 'gemini-robotics-er-1.5-preview')
];

const uniqueCandidates = (items: ModelCandidate[]): ModelCandidate[] => {
    const byKey = new Map<string, ModelCandidate>();
    for (const item of items) {
        if (!byKey.has(item.routeKey)) byKey.set(item.routeKey, item);
    }
    return Array.from(byKey.values());
};

const ALL_KNOWN_CANDIDATES = uniqueCandidates(DEFAULT_ALLOWED_CANDIDATES);
const MODEL_TO_PROVIDER = new Map<string, ModelProvider>();
for (const item of ALL_KNOWN_CANDIDATES) {
    if (!MODEL_TO_PROVIDER.has(item.model)) MODEL_TO_PROVIDER.set(item.model, item.provider);
}

const parseJson = <T>(raw: string | undefined, fallback: T): T => {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

const parseCandidateInput = (value: unknown): ModelCandidate | null => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (trimmed.includes(':')) {
            const [providerRaw, ...rest] = trimmed.split(':');
            const provider = providerRaw.trim() as ModelProvider;
            const model = rest.join(':').trim();
            if ((provider === 'groq' || provider === 'gemini') && model) {
                return candidate(provider, model);
            }
            return null;
        }
        const provider = MODEL_TO_PROVIDER.get(trimmed);
        if (!provider) return null;
        return candidate(provider, trimmed);
    }

    if (value && typeof value === 'object') {
        const raw = value as Record<string, unknown>;
        const provider = String(raw.provider || '').trim() as ModelProvider;
        const model = String(raw.model || '').trim();
        const thinkingValue = String(raw.thinking || '').trim().toLowerCase();
        const thinking = thinkingValue === 'medium' ? 'medium' : thinkingValue === 'low' ? 'low' : undefined;
        if ((provider === 'groq' || provider === 'gemini') && model) {
            return candidate(provider, model, { thinking });
        }
    }
    return null;
};

const buildAllowedRouteKeys = (): Set<string> => {
    const defaultSet = new Set(ALL_KNOWN_CANDIDATES.map((item) => item.routeKey));
    const raw = import.meta.env.VITE_AI_ALLOWED_MODELS_JSON as string | undefined;
    const parsed = parseJson<unknown[]>(raw, []);
    if (!raw || !Array.isArray(parsed) || parsed.length === 0) return defaultSet;

    const selected = new Set<string>();
    for (const entry of parsed) {
        const parsedCandidate = parseCandidateInput(entry);
        if (!parsedCandidate) continue;
        if (!defaultSet.has(parsedCandidate.routeKey)) continue;
        selected.add(parsedCandidate.routeKey);
    }

    return selected.size > 0 ? selected : defaultSet;
};

const ALLOWED_ROUTE_KEYS = buildAllowedRouteKeys();

const withAllowlist = (items: ModelCandidate[]): ModelCandidate[] => {
    const filtered = items.filter((item) => ALLOWED_ROUTE_KEYS.has(item.routeKey));
    return uniqueCandidates(filtered);
};

const parseTaskOverrides = (): Partial<Record<TaskType, ModelCandidate[]>> => {
    const raw = import.meta.env.VITE_AI_TASK_MODEL_OVERRIDES_JSON as string | undefined;
    const parsed = parseJson<Record<string, unknown>>(raw, {});
    if (!raw || !parsed || typeof parsed !== 'object') return {};

    const overrides: Partial<Record<TaskType, ModelCandidate[]>> = {};
    for (const [taskRaw, value] of Object.entries(parsed)) {
        const task = taskRaw as TaskType;
        if (!DEFAULT_TASK_MODEL_PREFERENCES[task]) continue;
        if (!Array.isArray(value)) continue;
        const candidates = value
            .map((entry) => parseCandidateInput(entry))
            .filter((entry): entry is ModelCandidate => Boolean(entry));
        if (candidates.length > 0) {
            overrides[task] = withAllowlist(candidates);
        }
    }
    return overrides;
};

const buildTaskPreferences = (): Record<TaskType, ModelCandidate[]> => {
    const overrides = parseTaskOverrides();
    const output = { ...DEFAULT_TASK_MODEL_PREFERENCES } as Record<TaskType, ModelCandidate[]>;
    (Object.keys(output) as TaskType[]).forEach((task) => {
        const override = overrides[task];
        const base = override && override.length > 0 ? override : output[task];
        output[task] = withAllowlist(base);
    });
    return output;
};

export const TASK_MODEL_PREFERENCES: Record<TaskType, ModelCandidate[]> = buildTaskPreferences();
export const ALLOWED_MODELS: ModelCandidate[] = withAllowlist(ALL_KNOWN_CANDIDATES);

const routeKeyFromModel = (model: string): string => {
    if (!model) return model;
    if (model.includes(':')) return model;
    const provider = MODEL_TO_PROVIDER.get(model) || 'groq';
    return `${provider}:${model}`;
};

export const MODEL_LIMITS: Record<string, ModelLimits> = {
    // Groq
    'groq:allam-2-7b': { requestsPerMinute: 30, requestsPerDay: 7000, tokensPerMinute: 6000, tokensPerDay: 500000, contextWindowTokens: 8192 },
    'groq:llama-3.1-8b-instant': { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 6000, tokensPerDay: 500000, contextWindowTokens: 8192 },
    'groq:llama-3.3-70b-versatile': { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 12000, tokensPerDay: 100000, contextWindowTokens: 8192 },
    'groq:meta-llama/llama-4-maverick-17b-128e-instruct': { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 6000, tokensPerDay: 500000, contextWindowTokens: 8192 },
    'groq:meta-llama/llama-4-scout-17b-16e-instruct': { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 30000, tokensPerDay: 500000, contextWindowTokens: 8192 },
    'groq:meta-llama/llama-guard-4-12b': { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 15000, tokensPerDay: 500000, contextWindowTokens: 8192 },
    'groq:meta-llama/llama-prompt-guard-2-22m': { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 15000, tokensPerDay: 500000, contextWindowTokens: 8192 },
    'groq:meta-llama/llama-prompt-guard-2-86m': { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 15000, tokensPerDay: 500000, contextWindowTokens: 8192 },
    'groq:moonshotai/kimi-k2-instruct': { requestsPerMinute: 60, requestsPerDay: 1000, tokensPerMinute: 10000, tokensPerDay: 300000, contextWindowTokens: 8192 },
    'groq:moonshotai/kimi-k2-instruct-0905': { requestsPerMinute: 60, requestsPerDay: 1000, tokensPerMinute: 10000, tokensPerDay: 300000, contextWindowTokens: 8192 },
    'groq:openai/gpt-oss-120b': { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200000, contextWindowTokens: 8192 },
    'groq:openai/gpt-oss-20b': { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200000, contextWindowTokens: 8192 },
    'groq:openai/gpt-oss-safeguard-20b': { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200000, contextWindowTokens: 8192 },
    'groq:qwen/qwen3-32b': { requestsPerMinute: 60, requestsPerDay: 1000, tokensPerMinute: 6000, tokensPerDay: 500000, contextWindowTokens: 8192 },
    'groq:whisper-large-v3': {
        requestsPerMinute: 20,
        requestsPerDay: 2000,
        tokensPerMinute: 0,
        tokensPerDay: 0,
        audioSecondsPerHour: 7200,
        audioSecondsPerDay: 28800,
        contextWindowTokens: 1
    },
    'groq:whisper-large-v3-turbo': {
        requestsPerMinute: 20,
        requestsPerDay: 2000,
        tokensPerMinute: 0,
        tokensPerDay: 0,
        audioSecondsPerHour: 7200,
        audioSecondsPerDay: 28800,
        contextWindowTokens: 1
    },

    // Gemini / Gemma (strict allowlist from user console)
    'gemini:gemini-3-flash': { requestsPerMinute: 5, requestsPerDay: 20, tokensPerMinute: 250000, tokensPerDay: 5000000, contextWindowTokens: 128000 },
    'gemini:gemini-2.5-flash': { requestsPerMinute: 5, requestsPerDay: 20, tokensPerMinute: 250000, tokensPerDay: 5000000, contextWindowTokens: 128000 },
    'gemini:gemini-2.5-flash-lite': { requestsPerMinute: 10, requestsPerDay: 20, tokensPerMinute: 250000, tokensPerDay: 5000000, contextWindowTokens: 128000 },
    'gemini:gemma-3-27b-it': { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 15000, tokensPerDay: 1000000, contextWindowTokens: 32768 },
    'gemini:gemma-3-12b-it': { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 15000, tokensPerDay: 1000000, contextWindowTokens: 32768 },
    'gemini:gemma-3-4b-it': { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 15000, tokensPerDay: 1000000, contextWindowTokens: 32768 },
    'gemini:gemma-3-2b-it': { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 15000, tokensPerDay: 1000000, contextWindowTokens: 32768 },
    'gemini:gemma-3-1b-it': { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 15000, tokensPerDay: 1000000, contextWindowTokens: 32768 },
    'gemini:gemini-robotics-er-1.5-preview': { requestsPerMinute: 10, requestsPerDay: 20, tokensPerMinute: 250000, tokensPerDay: 5000000, contextWindowTokens: 128000 },
    'gemini:gemini-embedding-1': { requestsPerMinute: 100, requestsPerDay: 1000, tokensPerMinute: 30000, tokensPerDay: 5000000, contextWindowTokens: 8192 },
    'gemini:gemini-2.5-flash-preview-tts': { requestsPerMinute: 3, requestsPerDay: 10, tokensPerMinute: 10000, tokensPerDay: 300000, contextWindowTokens: 32000 },
    'gemini:gemini-2.5-flash-native-audio-dialog': { requestsPerMinute: 200, requestsPerDay: 0, tokensPerMinute: 1000000, tokensPerDay: 0, contextWindowTokens: 128000 }
};

const mergeLimitOverrides = (): void => {
    const raw = import.meta.env.VITE_AI_MODEL_LIMITS_JSON as string | undefined;
    const parsed = parseJson<Record<string, Partial<ModelLimits>>>(raw, {});
    if (!raw || !parsed || typeof parsed !== 'object') return;

    for (const [routeKey, partial] of Object.entries(parsed)) {
        if (!routeKey || !partial || typeof partial !== 'object') continue;
        const current = MODEL_LIMITS[routeKey] || DEFAULT_LIMITS;
        MODEL_LIMITS[routeKey] = {
            requestsPerMinute: Number(partial.requestsPerMinute ?? current.requestsPerMinute),
            tokensPerMinute: Number(partial.tokensPerMinute ?? current.tokensPerMinute),
            requestsPerDay: Number(partial.requestsPerDay ?? current.requestsPerDay),
            tokensPerDay: Number(partial.tokensPerDay ?? current.tokensPerDay),
            audioSecondsPerHour: partial.audioSecondsPerHour ?? current.audioSecondsPerHour,
            audioSecondsPerDay: partial.audioSecondsPerDay ?? current.audioSecondsPerDay,
            contextWindowTokens: Number(partial.contextWindowTokens ?? current.contextWindowTokens)
        };
    }
};

mergeLimitOverrides();

export const isAllowedRouteKey = (routeKey: string): boolean => ALLOWED_ROUTE_KEYS.has(routeKey);

export const buildRouteKey = (provider: ModelProvider, model: string): string => `${provider}:${model}`;

export const getTaskModelCandidates = (task: TaskType): ModelCandidate[] => {
    const candidates = TASK_MODEL_PREFERENCES[task] || [];
    return withAllowlist(candidates);
};

export const getTaskModels = (task: TaskType): string[] => {
    const seen = new Set<string>();
    const models: string[] = [];
    for (const candidate of getTaskModelCandidates(task)) {
        if (seen.has(candidate.model)) continue;
        seen.add(candidate.model);
        models.push(candidate.model);
    }
    return models;
};

export const resolveModelCandidate = (input: string, providerHint?: ModelProvider): ModelCandidate | null => {
    if (!input) return null;

    if (input.includes(':')) {
        const [providerRaw, ...rest] = input.split(':');
        const provider = providerRaw as ModelProvider;
        const model = rest.join(':');
        if ((provider === 'groq' || provider === 'gemini') && model) {
            return candidate(provider, model);
        }
    }

    const provider = providerHint || MODEL_TO_PROVIDER.get(input) || 'groq';
    return candidate(provider, input);
};

export const getModelLimits = (modelOrRouteKey: string): ModelLimits => {
    const routeKey = routeKeyFromModel(modelOrRouteKey);
    return MODEL_LIMITS[routeKey] || MODEL_LIMITS[modelOrRouteKey] || DEFAULT_LIMITS;
};

export const getModelProvider = (modelOrRouteKey: string): ModelProvider => {
    if (modelOrRouteKey.includes(':')) {
        const provider = modelOrRouteKey.split(':')[0];
        if (provider === 'gemini') return 'gemini';
        return 'groq';
    }
    return MODEL_TO_PROVIDER.get(modelOrRouteKey) || 'groq';
};

export const getRouteKeyForModel = (modelOrRouteKey: string): string => routeKeyFromModel(modelOrRouteKey);
