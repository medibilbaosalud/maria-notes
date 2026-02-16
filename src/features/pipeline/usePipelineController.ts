import { useCallback } from 'react';

type SetLiveState = (value:
    | 'idle'
    | 'recovering'
    | 'recording'
    | 'transcribing_live'
    | 'processing_partials'
    | 'awaiting_budget'
    | 'finalizing'
    | 'draft_ready'
    | 'hardening'
    | 'completed'
    | 'provisional'
    | 'failed'
) => void;
type SetBusyState = (busy: boolean) => void;
type StartConsultation = (sessionId: string, patientName: string) => void;
type StartDiagnosticRun = (sessionId: string, patientName: string) => void;

interface UsePipelineControllerParams {
    setLivePipelineState: SetLiveState;
    setPipelineBusy: SetBusyState;
    startConsultation: StartConsultation;
    maybeStartDiagnosticRun: StartDiagnosticRun;
}

export const usePipelineController = (params: UsePipelineControllerParams) => {
    const initializeSessionRuntime = useCallback((sessionId: string, patientName: string) => {
        params.startConsultation(sessionId, patientName);
        params.maybeStartDiagnosticRun(sessionId, patientName);
        params.setPipelineBusy(true);
        params.setLivePipelineState('recording');
    }, [params]);

    const resetSessionRuntime = useCallback(() => {
        params.setPipelineBusy(false);
        params.setLivePipelineState('idle');
    }, [params]);

    return {
        initializeSessionRuntime,
        resetSessionRuntime
    };
};
