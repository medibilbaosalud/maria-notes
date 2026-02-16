export class NetworkRequestError extends Error {
    status?: number;
    retryable: boolean;
    attempt: number;
    cause?: unknown;

    constructor(message: string, options: { status?: number; retryable: boolean; attempt: number; cause?: unknown }) {
        super(message);
        this.name = 'NetworkRequestError';
        this.status = options.status;
        this.retryable = options.retryable;
        this.attempt = options.attempt;
        this.cause = options.cause;
    }
}

export interface RetryOptions {
    retries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    timeoutMs: number;
    classifyError?: (error: unknown, response?: Response) => { retryable: boolean; status?: number; reason: string };
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
    retries: 2,
    baseDelayMs: 350,
    maxDelayMs: 4_000,
    timeoutMs: 60_000
};

export const isRetryableStatus = (status: number): boolean => (
    status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599)
);

const defaultClassifier = (error: unknown, response?: Response) => {
    if (response) {
        const retryable = isRetryableStatus(response.status);
        return {
            retryable,
            status: response.status,
            reason: `http_${response.status}`
        };
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
        return {
            retryable: true,
            reason: 'timeout_or_abort'
        };
    }

    return {
        retryable: true,
        reason: 'network_or_unknown'
    };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const computeBackoffDelay = (attempt: number, baseDelayMs: number, maxDelayMs: number): number => {
    const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * Math.max(100, Math.floor(exponential * 0.25)));
    return Math.min(maxDelayMs, exponential + jitter);
};

export async function fetchWithRetry(
    input: RequestInfo | URL,
    init: RequestInit = {},
    options: Partial<RetryOptions> = {}
): Promise<Response> {
    const merged: RetryOptions = {
        ...DEFAULT_RETRY_OPTIONS,
        ...options
    };
    const classify = merged.classifyError || defaultClassifier;

    let lastError: NetworkRequestError | null = null;

    for (let attempt = 0; attempt <= merged.retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), merged.timeoutMs);
        const externalSignal = init.signal;
        const onExternalAbort = () => controller.abort();
        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort();
            } else {
                externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            }
        }

        try {
            const response = await fetch(input, {
                ...init,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (externalSignal) {
                externalSignal.removeEventListener('abort', onExternalAbort);
            }

            if (response.ok) return response;

            const classification = classify(undefined, response);
            const error = new NetworkRequestError(
                `HTTP ${response.status} (${classification.reason})`,
                {
                    status: response.status,
                    retryable: classification.retryable,
                    attempt
                }
            );
            lastError = error;

            if (!classification.retryable || attempt >= merged.retries) {
                throw error;
            }

            await sleep(computeBackoffDelay(attempt, merged.baseDelayMs, merged.maxDelayMs));
        } catch (rawError) {
            clearTimeout(timeoutId);
            if (externalSignal) {
                externalSignal.removeEventListener('abort', onExternalAbort);
            }

            if (rawError instanceof NetworkRequestError) {
                throw rawError;
            }

            const classification = classify(rawError);
            const error = new NetworkRequestError(
                `Network request failed (${classification.reason})`,
                {
                    status: classification.status,
                    retryable: classification.retryable,
                    attempt,
                    cause: rawError
                }
            );
            lastError = error;

            if (!classification.retryable || attempt >= merged.retries) {
                throw error;
            }

            await sleep(computeBackoffDelay(attempt, merged.baseDelayMs, merged.maxDelayMs));
        }
    }

    throw lastError || new NetworkRequestError('Network request failed', { retryable: false, attempt: merged.retries });
}

export const buildSupabaseFetch = (options: Partial<RetryOptions> = {}) => {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        return fetchWithRetry(input, init, options);
    };
};
