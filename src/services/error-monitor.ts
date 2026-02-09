import { logAppErrorEvent } from './supabase';

type Breadcrumb = {
    at: string;
    type: string;
    message: string;
    metadata?: Record<string, unknown>;
};

interface ErrorMonitorOptions {
    getContext?: () => {
        session_id?: string;
        route?: string;
        context?: Record<string, unknown>;
    };
    maxBreadcrumbs?: number;
}

const breadcrumbs: Breadcrumb[] = [];
const recentFingerprintTimestamps = new Map<string, number>();
let isStarted = false;

const nowIso = () => new Date().toISOString();

const truncateText = (value: string, maxLen = 2_000): string => {
    if (!value) return '';
    if (value.length <= maxLen) return value;
    return `${value.slice(0, maxLen)}...`;
};

const safeSerializeReason = (value: unknown): string => {
    if (value instanceof Error) return value.message || 'error';
    if (typeof value === 'string') return value;
    try {
        const seen = new WeakSet<object>();
        return JSON.stringify(value, (_key, candidate) => {
            if (candidate && typeof candidate === 'object') {
                if (seen.has(candidate as object)) return '[Circular]';
                seen.add(candidate as object);
            }
            if (typeof candidate === 'bigint') return candidate.toString();
            return candidate;
        }) || String(value);
    } catch {
        return String(value);
    }
};

const makeFingerprint = (message: string, source: string, stack?: string): string => {
    const base = `${source}|${message}|${(stack || '').split('\n')[0] || ''}`.toLowerCase();
    let hash = 5381;
    for (let i = 0; i < base.length; i++) {
        hash = ((hash << 5) + hash) + base.charCodeAt(i);
        hash &= 0xffffffff;
    }
    return `fp_${Math.abs(hash)}`;
};

const shouldRateLimit = (fingerprint: string, cooldownMs = 5000): boolean => {
    const now = Date.now();
    const previous = recentFingerprintTimestamps.get(fingerprint) || 0;
    if (now - previous < cooldownMs) return true;
    recentFingerprintTimestamps.set(fingerprint, now);
    return false;
};

export const addErrorBreadcrumb = (
    type: string,
    message: string,
    metadata?: Record<string, unknown>,
    maxBreadcrumbs = 60
): void => {
    breadcrumbs.push({
        at: nowIso(),
        type,
        message,
        metadata
    });
    if (breadcrumbs.length > maxBreadcrumbs) {
        breadcrumbs.splice(0, breadcrumbs.length - maxBreadcrumbs);
    }
};

export const startErrorMonitoring = (options: ErrorMonitorOptions = {}): (() => void) => {
    if (typeof window === 'undefined' || isStarted) return () => undefined;
    isStarted = true;

    const maxBreadcrumbs = options.maxBreadcrumbs || 60;

    addErrorBreadcrumb('monitor', 'error_monitor_started', {
        href: window.location.href,
        online: navigator.onLine
    }, maxBreadcrumbs);

    const report = async (payload: {
        message: string;
        source: string;
        stack?: string;
        handled: boolean;
        severity?: 'error' | 'warning' | 'info';
        context?: Record<string, unknown>;
    }) => {
        const fingerprint = makeFingerprint(payload.message, payload.source, payload.stack);
        if (shouldRateLimit(fingerprint)) return;

        const runtimeContext = options.getContext?.() || {};
        await logAppErrorEvent({
            message: payload.message,
            source: payload.source,
            stack: payload.stack,
            handled: payload.handled,
            severity: payload.severity || 'error',
            session_id: runtimeContext.session_id,
            route: runtimeContext.route || window.location.pathname,
            context: {
                ...(runtimeContext.context || {}),
                ...(payload.context || {}),
                online: navigator.onLine,
                url: window.location.href
            },
            breadcrumbs: breadcrumbs.slice(-maxBreadcrumbs),
            user_agent: navigator.userAgent,
            fingerprint
        });
    };

    const onWindowError = (event: ErrorEvent) => {
        const message = event.message || 'unknown_window_error';
        addErrorBreadcrumb('window.error', message, {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        }, maxBreadcrumbs);

        void report({
            message,
            source: 'window.onerror',
            stack: event.error?.stack,
            handled: false,
            context: {
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
            }
        });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        const message = truncateText(safeSerializeReason(reason), 800);

        addErrorBreadcrumb('unhandledrejection', message, undefined, maxBreadcrumbs);

        void report({
            message,
            source: 'window.unhandledrejection',
            stack: reason instanceof Error ? reason.stack : undefined,
            handled: false
        });
    };

    const onOnline = () => addErrorBreadcrumb('network', 'online', undefined, maxBreadcrumbs);
    const onOffline = () => addErrorBreadcrumb('network', 'offline', undefined, maxBreadcrumbs);

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
        window.removeEventListener('error', onWindowError);
        window.removeEventListener('unhandledrejection', onUnhandledRejection);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
        isStarted = false;
    };
};
