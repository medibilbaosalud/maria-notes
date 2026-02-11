type DiagnosticStageStatus = 'passed' | 'failed' | 'degraded' | 'skipped';

export interface DiagnosticRunConfig {
    mode: 'simulated' | 'real' | 'hybrid';
    scenario_id?: string;
    source: 'audio' | 'text';
    patient_name: string;
}

export interface DiagnosticStageResult {
    stage: string;
    status: DiagnosticStageStatus;
    duration_ms: number;
    error_code?: string;
    error_message?: string;
}

export interface DiagnosticChunkMetric {
    batch_index: number;
    size_bytes: number;
    duration_ms: number;
    status: 'passed' | 'failed';
    error_code?: string;
    error_message?: string;
}

export interface DiagnosticQualityGate {
    required_sections_ok: boolean;
    result_status?: string;
    critical_gaps_count: number;
    missing_sections?: string[];
    placeholder_detected?: boolean;
}

interface DiagnosticRunState {
    run_id: string;
    config: DiagnosticRunConfig;
    started_at: number;
    stage_started_at: Map<string, number>;
    stage_results: DiagnosticStageResult[];
    chunks: DiagnosticChunkMetric[];
    quality_gate?: DiagnosticQualityGate;
}

export interface FinalizeDiagnosticOutput {
    stage_results?: DiagnosticStageResult[];
    quality_gate?: DiagnosticQualityGate;
}

export interface DiagnosticSummary {
    run_id: string;
    mode: 'simulated' | 'real' | 'hybrid';
    scenario_id?: string;
    status: DiagnosticStageStatus;
    stage_results: DiagnosticStageResult[];
    audio_stats: {
        chunk_count: number;
        failed_chunks: number;
        avg_chunk_bytes: number;
        transcription_p95_ms: number;
    };
    quality_gate?: DiagnosticQualityGate;
    insights: string[];
}

const runStore = new Map<string, DiagnosticRunState>();

const buildRunId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `diag_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const REQUIRED_SECTION_MARKERS = [
    '## MOTIVO DE CONSULTA',
    '## ANTECEDENTES',
    '## ENFERMEDAD ACTUAL',
    '## EXPLORACION / PRUEBAS',
    '## DIAGNOSTICO',
    '## PLAN'
];

const hasPlaceholderToken = (text: string): boolean => {
    if (!text) return false;
    return /\[(MISSING_BATCH|PARTIAL_BATCH)_[^\]]+\]/.test(text);
};

const sanitize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

const percentile = (values: number[], p: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
};

export const evaluateRequiredSections = (medicalHistory: string): {
    required_sections_ok: boolean;
    missing_sections: string[];
} => {
    const normalized = sanitize(medicalHistory || '');
    const missing = REQUIRED_SECTION_MARKERS.filter((section) => !normalized.includes(sanitize(section)));
    return {
        required_sections_ok: missing.length === 0,
        missing_sections: missing
    };
};

export const startDiagnosticRun = (config: DiagnosticRunConfig): string => {
    const run_id = buildRunId();
    runStore.set(run_id, {
        run_id,
        config,
        started_at: Date.now(),
        stage_started_at: new Map(),
        stage_results: [],
        chunks: []
    });
    return run_id;
};

export const recordDiagnosticEvent = (
    runId: string,
    event:
        | { type: 'stage_start'; stage: string }
        | {
            type: 'stage_end';
            stage: string;
            status: DiagnosticStageStatus;
            error_code?: string;
            error_message?: string;
            duration_ms?: number;
        }
        | {
            type: 'chunk_result';
            batch_index: number;
            size_bytes: number;
            duration_ms: number;
            status: 'passed' | 'failed';
            error_code?: string;
            error_message?: string;
        }
        | { type: 'quality_gate'; gate: DiagnosticQualityGate }
): void => {
    const run = runStore.get(runId);
    if (!run) return;

    if (event.type === 'stage_start') {
        run.stage_started_at.set(event.stage, Date.now());
        return;
    }

    if (event.type === 'stage_end') {
        const start = run.stage_started_at.get(event.stage);
        const duration_ms = typeof event.duration_ms === 'number'
            ? Math.max(0, event.duration_ms)
            : Math.max(0, Date.now() - (start || Date.now()));
        run.stage_results.push({
            stage: event.stage,
            status: event.status,
            duration_ms,
            error_code: event.error_code,
            error_message: event.error_message
        });
        run.stage_started_at.delete(event.stage);
        return;
    }

    if (event.type === 'chunk_result') {
        run.chunks.push({
            batch_index: event.batch_index,
            size_bytes: event.size_bytes,
            duration_ms: event.duration_ms,
            status: event.status,
            error_code: event.error_code,
            error_message: event.error_message
        });
        return;
    }

    run.quality_gate = event.gate;
};

export const evaluateDiagnosticOutcome = (run: DiagnosticSummary): DiagnosticStageStatus => {
    const hasCriticalStageFailure = run.stage_results.some((stage) => stage.status === 'failed');
    const quality = run.quality_gate;

    if (hasCriticalStageFailure) return 'failed';
    if (quality?.result_status && quality.result_status !== 'completed') return 'failed';
    if (quality && !quality.required_sections_ok) return 'failed';
    if (quality?.placeholder_detected) return 'failed';
    if (run.stage_results.some((stage) => stage.status === 'degraded')) return 'degraded';
    if ((quality?.critical_gaps_count || 0) > 0) return 'degraded';
    return 'passed';
};

export const buildDiagnosticInsights = (run: DiagnosticSummary): string[] => {
    const insights: string[] = [];
    if (run.audio_stats.failed_chunks > 0) {
        insights.push(`Fallaron ${run.audio_stats.failed_chunks} chunk(s) de audio durante STT.`);
    }
    const failedStages = run.stage_results.filter((stage) => stage.status === 'failed');
    if (failedStages.length > 0) {
        insights.push(`Etapas fallidas: ${failedStages.map((stage) => stage.stage).join(', ')}.`);
    }
    if (run.quality_gate && !run.quality_gate.required_sections_ok) {
        insights.push(`Secciones faltantes: ${(run.quality_gate.missing_sections || []).join(', ')}.`);
    }
    if (run.quality_gate?.placeholder_detected) {
        insights.push('Se detectaron placeholders de batches en la salida final.');
    }
    if (run.audio_stats.transcription_p95_ms > 45_000) {
        insights.push(`Latencia STT elevada (p95=${run.audio_stats.transcription_p95_ms}ms).`);
    }
    if (insights.length === 0) {
        insights.push('Pipeline estable sin incidencias criticas en esta corrida.');
    }
    return insights;
};

export const finalizeDiagnosticRun = (
    runId: string,
    output: FinalizeDiagnosticOutput = {}
): DiagnosticSummary | null => {
    const run = runStore.get(runId);
    if (!run) return null;

    const mergedStages = [...run.stage_results, ...(output.stage_results || [])];
    const quality_gate = output.quality_gate || run.quality_gate;

    const chunk_count = run.chunks.length;
    const failed_chunks = run.chunks.filter((chunk) => chunk.status === 'failed').length;
    const avg_chunk_bytes = chunk_count > 0
        ? Math.round(run.chunks.reduce((acc, chunk) => acc + chunk.size_bytes, 0) / chunk_count)
        : 0;
    const transcription_p95_ms = Math.round(percentile(run.chunks.map((chunk) => chunk.duration_ms), 95));

    const provisionalSummary: DiagnosticSummary = {
        run_id: run.run_id,
        mode: run.config.mode,
        scenario_id: run.config.scenario_id,
        status: 'passed',
        stage_results: mergedStages,
        audio_stats: {
            chunk_count,
            failed_chunks,
            avg_chunk_bytes,
            transcription_p95_ms
        },
        quality_gate,
        insights: []
    };

    provisionalSummary.status = evaluateDiagnosticOutcome(provisionalSummary);
    provisionalSummary.insights = buildDiagnosticInsights(provisionalSummary);
    runStore.delete(runId);
    return provisionalSummary;
};

export const buildQualityGateFromHistory = (params: {
    medical_history: string;
    result_status?: string;
    critical_gaps_count?: number;
}): DiagnosticQualityGate => {
    const coverage = evaluateRequiredSections(params.medical_history || '');
    return {
        required_sections_ok: coverage.required_sections_ok,
        result_status: params.result_status,
        critical_gaps_count: Math.max(0, params.critical_gaps_count || 0),
        missing_sections: coverage.missing_sections,
        placeholder_detected: hasPlaceholderToken(params.medical_history || '')
    };
};

