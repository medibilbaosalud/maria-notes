import { getModelLimits } from '../model-registry';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export class BudgetExceededError extends Error {
    retryAfterMs: number;
    scope: 'minute' | 'hour' | 'day';

    constructor(message: string, retryAfterMs: number, scope: 'minute' | 'hour' | 'day') {
        super(message);
        this.name = 'BudgetExceededError';
        this.retryAfterMs = retryAfterMs;
        this.scope = scope;
    }
}

interface BudgetWindow {
    start: number;
    requests: number;
    tokens: number;
    audioSeconds: number;
}

interface ModelBudgetState {
    minute: BudgetWindow;
    hour: BudgetWindow;
    day: BudgetWindow;
}

interface ConsumeInput {
    requests?: number;
    tokens?: number;
    audioSeconds?: number;
}

const createWindow = (start: number): BudgetWindow => ({
    start,
    requests: 0,
    tokens: 0,
    audioSeconds: 0
});

const createState = (now: number): ModelBudgetState => ({
    minute: createWindow(now),
    hour: createWindow(now),
    day: createWindow(now)
});

export class BudgetManager {
    private readonly state = new Map<string, ModelBudgetState>();

    private ensureState(model: string): ModelBudgetState {
        const now = Date.now();
        const current = this.state.get(model) || createState(now);
        this.rollWindow(current.minute, MINUTE_MS, now);
        this.rollWindow(current.hour, HOUR_MS, now);
        this.rollWindow(current.day, DAY_MS, now);
        this.state.set(model, current);
        return current;
    }

    private rollWindow(window: BudgetWindow, durationMs: number, now: number) {
        if (now - window.start >= durationMs) {
            window.start = now;
            window.requests = 0;
            window.tokens = 0;
            window.audioSeconds = 0;
        }
    }

    consume(model: string, input: ConsumeInput) {
        const limits = getModelLimits(model);
        const state = this.ensureState(model);
        const requests = Math.max(0, input.requests || 0);
        const tokens = Math.max(0, input.tokens || 0);
        const audioSeconds = Math.max(0, input.audioSeconds || 0);
        const now = Date.now();

        if (limits.requestsPerMinute > 0 && state.minute.requests + requests > limits.requestsPerMinute) {
            throw new BudgetExceededError(
                `budget_limit_requests_per_minute:${model}`,
                Math.max(250, MINUTE_MS - (now - state.minute.start)),
                'minute'
            );
        }
        if (limits.tokensPerMinute > 0 && state.minute.tokens + tokens > limits.tokensPerMinute) {
            throw new BudgetExceededError(
                `budget_limit_tokens_per_minute:${model}`,
                Math.max(250, MINUTE_MS - (now - state.minute.start)),
                'minute'
            );
        }
        if (limits.requestsPerDay > 0 && state.day.requests + requests > limits.requestsPerDay) {
            throw new BudgetExceededError(
                `budget_limit_requests_per_day:${model}`,
                Math.max(5_000, DAY_MS - (now - state.day.start)),
                'day'
            );
        }
        if (limits.tokensPerDay > 0 && state.day.tokens + tokens > limits.tokensPerDay) {
            throw new BudgetExceededError(
                `budget_limit_tokens_per_day:${model}`,
                Math.max(5_000, DAY_MS - (now - state.day.start)),
                'day'
            );
        }
        if (limits.audioSecondsPerHour && limits.audioSecondsPerHour > 0 && state.hour.audioSeconds + audioSeconds > limits.audioSecondsPerHour) {
            throw new BudgetExceededError(
                `budget_limit_audio_seconds_per_hour:${model}`,
                Math.max(1_000, HOUR_MS - (now - state.hour.start)),
                'hour'
            );
        }
        if (limits.audioSecondsPerDay && limits.audioSecondsPerDay > 0 && state.day.audioSeconds + audioSeconds > limits.audioSecondsPerDay) {
            throw new BudgetExceededError(
                `budget_limit_audio_seconds_per_day:${model}`,
                Math.max(5_000, DAY_MS - (now - state.day.start)),
                'day'
            );
        }

        state.minute.requests += requests;
        state.minute.tokens += tokens;
        state.minute.audioSeconds += audioSeconds;

        state.hour.requests += requests;
        state.hour.tokens += tokens;
        state.hour.audioSeconds += audioSeconds;

        state.day.requests += requests;
        state.day.tokens += tokens;
        state.day.audioSeconds += audioSeconds;
    }
}

let sharedBudgetManager: BudgetManager | null = null;

export const getBudgetManager = (): BudgetManager => {
    if (!sharedBudgetManager) sharedBudgetManager = new BudgetManager();
    return sharedBudgetManager;
};

