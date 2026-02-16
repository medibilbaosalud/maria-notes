import { useEffect } from 'react';
import { enqueueAuditEvent } from '../../services/audit-worker';
import { getRecoverableSessions, requeueSession } from '../../services/storage';

interface UseSessionRecoveryParams {
    apiKey: string;
    onInitBackground: (apiKey: string) => Promise<void>;
    onRecoverSession: () => Promise<void>;
    disableBackground?: boolean;
}

export const useSessionRecovery = (params: UseSessionRecoveryParams) => {
    useEffect(() => {
        if (params.disableBackground) return;
        const runInBackground = () => {
            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                (window as Window & { requestIdleCallback: (fn: IdleRequestCallback) => number }).requestIdleCallback(() => {
                    void params.onInitBackground(params.apiKey);
                    void params.onRecoverSession();
                });
                return;
            }
            setTimeout(() => {
                void params.onInitBackground(params.apiKey);
                void params.onRecoverSession();
            }, 2_000);
        };
        runInBackground();
    }, [params]);

    useEffect(() => {
        const STALLED_HARDENING_MS = Math.max(60_000, Number(import.meta.env.VITE_TURBO_HARDENING_STALL_MS || 180_000));
        const STALLED_DRAFT_MS = Math.max(90_000, Number(import.meta.env.VITE_TURBO_DRAFT_STALL_MS || 240_000));
        const timer = window.setInterval(() => {
            void (async () => {
                try {
                    const sessions = await getRecoverableSessions();
                    const now = Date.now();
                    for (const session of sessions) {
                        const updatedAtMs = Date.parse(session.updated_at || '');
                        if (!Number.isFinite(updatedAtMs)) continue;
                        const ageMs = Math.max(0, now - updatedAtMs);
                        const isHardeningStalled = session.status === 'hardening' && ageMs > STALLED_HARDENING_MS;
                        const isDraftStalled = session.status === 'draft_ready' && ageMs > STALLED_DRAFT_MS;
                        if (!isHardeningStalled && !isDraftStalled) continue;
                        await requeueSession(session.session_id);
                        void enqueueAuditEvent('pipeline_sla_breach', {
                            session_id: session.session_id,
                            stage: session.status,
                            latency_ms: ageMs,
                            threshold_ms: isHardeningStalled ? STALLED_HARDENING_MS : STALLED_DRAFT_MS,
                            reason: 'session_stalled_auto_requeue'
                        });
                    }
                } catch (error) {
                    console.warn('[SessionRecovery] stalled-session watchdog failed:', error);
                }
            })();
        }, 30_000);
        return () => clearInterval(timer);
    }, []);
};
