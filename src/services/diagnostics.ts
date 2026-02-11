type DiagnosticStageStatus = 'passed' | 'failed' | 'degraded' | 'skipped';

export interface DiagnosticReconciliationIssue {
    fingerprint: string;
    type: string;
    field: string;
    reason: string;
    severity: 'critical' | 'major' | 'minor';
    phase: 'raw_guard' | 'final_guard';
    blocking: boolean;
}

export interface DiagnosticErrorContext {
    canonical_code?: string;
    provider_code?: string;
    provider_message?: string;
    request_id?: string;
    http_status?: number;
    retry_after_ms?: number;
    retryable?: boolean;
    attempt?: number;
    attempt_index?: number;
    fallback_index?: number;
    provider?: string;
    model?: string;
    route_key?: string;
    operation?: string;
    endpoint?: string;
    input_type?: string;
    mime_type?: string;
    chunk_bytes?: number;
    chunk_id?: string;
    audio_duration_ms?: number;
    phase?: 'raw_guard' | 'final_guard' | 'stt' | 'extract' | 'generate' | 'quality_gate';
    origin?: 'model_output' | 'sanitizer' | 'validator' | 'pipeline_policy';
    blocking?: boolean;
    blocking_rule_id?: string;
    raw_payload_excerpt?: string;
    notes?: string[];
}

export interface DiagnosticErrorDetail {
    code: string;
    message: string;
    stage?: string;
    batch_index?: number;
    occurred_at: string;
    context?: DiagnosticErrorContext;
}

export interface DiagnosticRunConfig {
    mode: 'simulated' | 'real' | 'hybrid';
    execution_mode?: 'deterministic' | 'real';
    scenario_id?: string;
    source: 'audio' | 'text';
    patient_name: string;
}

export interface DiagnosticStageResult {
    stage: string;
    status: DiagnosticStageStatus;
    duration_ms: number;
    ended_at: number;
    error_code?: string;
    error_message?: string;
    error_detail?: DiagnosticErrorDetail;
}

export interface DiagnosticChunkMetric {
    batch_index: number;
    size_bytes: number;
    duration_ms: number;
    ended_at: number;
    status: 'passed' | 'failed';
    mime_type?: string;
    error_code?: string;
    error_message?: string;
    error_detail?: DiagnosticErrorDetail;
}

export interface DiagnosticQualityGate {
    required_sections_ok: boolean;
    result_status?: string;
    pipeline_status?: string;
    critical_gaps_count: number;
    missing_sections?: string[];
    placeholder_detected?: boolean;
    blocking_rule_id?: string;
    blocking_reason?: string;
}

interface DiagnosticRunState {
    run_id: string;
    config: DiagnosticRunConfig;
    started_at: number;
    stage_started_at: Map<string, number>;
    stage_results: DiagnosticStageResult[];
    chunks: DiagnosticChunkMetric[];
    quality_gate?: DiagnosticQualityGate;
    reconciliation?: {
        pre_sanitize_issues: DiagnosticReconciliationIssue[];
        post_sanitize_issues: DiagnosticReconciliationIssue[];
        neutralized_issues: DiagnosticReconciliationIssue[];
    };
    debug?: {
        remaining_errors: Array<{
            type: string;
            field: string;
            reason: string;
            severity?: string;
        }>;
        provisional_reason?: string;
        quality_score?: number;
        pipeline_status?: string;
        result_status?: string;
    };
}

export interface FinalizeDiagnosticOutput {
    stage_results?: DiagnosticStageResult[];
    quality_gate?: DiagnosticQualityGate;
    stt_route_policy?: 'whisper_strict' | 'default';
    reconciliation?: {
        pre_sanitize_issues: DiagnosticReconciliationIssue[];
        post_sanitize_issues: DiagnosticReconciliationIssue[];
        neutralized_issues: DiagnosticReconciliationIssue[];
    };
    debug?: {
        remaining_errors: Array<{
            type: string;
            field: string;
            reason: string;
            severity?: string;
        }>;
        provisional_reason?: string;
        quality_score?: number;
        pipeline_status?: string;
        result_status?: string;
    };
}

export interface DiagnosticSummary {
    run_id: string;
    mode: 'simulated' | 'real' | 'hybrid';
    execution_mode?: 'deterministic' | 'real';
    source: 'audio' | 'text';
    scenario_id?: string;
    stt_route_policy?: 'whisper_strict' | 'default';
    status: DiagnosticStageStatus;
    stage_results: DiagnosticStageResult[];
    audio_stats: {
        chunk_count: number;
        failed_chunks: number;
        avg_chunk_bytes: number;
        transcription_p95_ms: number;
    };
    quality_gate?: DiagnosticQualityGate;
    status_reason_primary: string;
    status_reason_chain: string[];
    primary_failure_evidence?: string;
    failure_graph: Array<{
        node: string;
        caused_by?: string;
        evidence_ref?: string;
    }>;
    reconciliation: {
        pre_sanitize_issues: DiagnosticReconciliationIssue[];
        post_sanitize_issues: DiagnosticReconciliationIssue[];
        neutralized_issues: DiagnosticReconciliationIssue[];
    };
    debug: {
        remaining_errors: Array<{
            type: string;
            field: string;
            reason: string;
            severity?: string;
        }>;
        provisional_reason?: string;
        quality_score?: number;
        pipeline_status?: string;
        result_status?: string;
    };
    root_causes: string[];
    error_catalog: {
        by_code: Array<{
            code: string;
            count: number;
            stages: string[];
            last_message?: string;
        }>;
        by_stage: Array<{
            stage: string;
            failed: number;
            degraded: number;
            last_error_code?: string;
        }>;
    };
    failure_timeline: Array<{
        timestamp: string;
        stage: string;
        status: DiagnosticStageStatus;
        error_code?: string;
        error_message?: string;
        batch_index?: number;
    }>;
    recommendations: string[];
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
            ended_at?: number;
            error_code?: string;
            error_message?: string;
            error_detail?: DiagnosticErrorDetail;
            duration_ms?: number;
        }
        | {
            type: 'chunk_result';
            batch_index: number;
            size_bytes: number;
            duration_ms: number;
            ended_at?: number;
            status: 'passed' | 'failed';
            mime_type?: string;
            error_code?: string;
            error_message?: string;
            error_detail?: DiagnosticErrorDetail;
        }
        | { type: 'quality_gate'; gate: DiagnosticQualityGate }
        | {
            type: 'reconciliation';
            reconciliation: {
                pre_sanitize_issues: DiagnosticReconciliationIssue[];
                post_sanitize_issues: DiagnosticReconciliationIssue[];
                neutralized_issues: DiagnosticReconciliationIssue[];
            };
        }
        | {
            type: 'debug_context';
            debug: {
                remaining_errors: Array<{
                    type: string;
                    field: string;
                    reason: string;
                    severity?: string;
                }>;
                provisional_reason?: string;
                quality_score?: number;
                pipeline_status?: string;
                result_status?: string;
            };
        }
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
        const endedAt = typeof event.ended_at === 'number' ? event.ended_at : Date.now();
        const detail = event.error_detail || (
            event.error_code || event.error_message
                ? {
                    code: event.error_code || 'unknown_error',
                    message: event.error_message || event.error_code || 'unknown_error',
                    stage: event.stage,
                    occurred_at: new Date(endedAt).toISOString()
                }
                : undefined
        );
        run.stage_results.push({
            stage: event.stage,
            status: event.status,
            duration_ms,
            ended_at: endedAt,
            error_code: event.error_code,
            error_message: event.error_message,
            error_detail: detail
        });
        run.stage_started_at.delete(event.stage);
        return;
    }

    if (event.type === 'chunk_result') {
        const endedAt = typeof event.ended_at === 'number' ? event.ended_at : Date.now();
        const detail = event.error_detail || (
            event.error_code || event.error_message
                ? {
                    code: event.error_code || 'unknown_error',
                    message: event.error_message || event.error_code || 'unknown_error',
                    batch_index: event.batch_index,
                    occurred_at: new Date(endedAt).toISOString()
                }
                : undefined
        );
        run.chunks.push({
            batch_index: event.batch_index,
            size_bytes: event.size_bytes,
            duration_ms: event.duration_ms,
            ended_at: endedAt,
            status: event.status,
            mime_type: event.mime_type,
            error_code: event.error_code,
            error_message: event.error_message,
            error_detail: detail
        });
        return;
    }

    if (event.type === 'reconciliation') {
        run.reconciliation = event.reconciliation;
        return;
    }

    if (event.type === 'debug_context') {
        run.debug = event.debug;
        return;
    }

    run.quality_gate = event.gate;
};

const buildStatusReasonChain = (run: DiagnosticSummary): string[] => {
    const reasons: string[] = [];
    const hasFailedStage = run.stage_results.some((stage) => stage.status === 'failed');
    const hasDegradedStage = run.stage_results.some((stage) => stage.status === 'degraded');
    if (run.quality_gate?.pipeline_status && run.quality_gate.pipeline_status !== 'completed') reasons.push(`pipeline_${run.quality_gate.pipeline_status}`);
    if (run.quality_gate?.result_status && run.quality_gate.result_status !== 'completed') reasons.push(`result_${run.quality_gate.result_status}`);
    if (run.quality_gate && !run.quality_gate.required_sections_ok) reasons.push('required_sections_missing');
    if (run.quality_gate?.placeholder_detected) reasons.push('placeholder_detected');
    if ((run.quality_gate?.critical_gaps_count || 0) > 0) reasons.push('critical_gaps_present');
    if (run.audio_stats.failed_chunks > 0) reasons.push('stt_chunk_failures');
    const hasInsufficientClinicalSignal = run.debug.remaining_errors.some((item) => {
        const text = `${item.field}:${item.reason}`.toLowerCase();
        return text.includes('transcripcion') && (text.includes('inaudible') || text.includes('ambiguo') || text.includes('no se identifican datos clinicos'));
    });
    if (hasInsufficientClinicalSignal) reasons.push('insufficient_clinical_signal');
    if (hasFailedStage) reasons.push('stage_failed');
    if (hasDegradedStage && reasons.length === 0) reasons.push('stage_degraded');
    if (run.reconciliation.neutralized_issues.length > 0) reasons.push('sanitized_leak_detected');
    if (reasons.length === 0) reasons.push('ok');
    return Array.from(new Set(reasons));
};

export const evaluateDiagnosticOutcome = (run: DiagnosticSummary): DiagnosticStageStatus => {
    const hasCriticalStageFailure = run.stage_results.some((stage) => stage.status === 'failed');
    const quality = run.quality_gate;

    if (hasCriticalStageFailure) return 'failed';
    if (quality?.pipeline_status && quality.pipeline_status !== 'completed') return 'failed';
    if (quality?.result_status && quality.result_status !== 'completed') return 'failed';
    if (quality && !quality.required_sections_ok) return 'failed';
    if (quality?.placeholder_detected) return 'failed';
    if (run.stage_results.some((stage) => stage.status === 'degraded')) return 'degraded';
    if ((quality?.critical_gaps_count || 0) > 0) return 'degraded';
    return 'passed';
};

const dedupeStageResults = (stages: DiagnosticStageResult[]): DiagnosticStageResult[] => {
    const byStage = new Map<string, DiagnosticStageResult>();
    for (const stage of stages) {
        if (byStage.has(stage.stage)) byStage.delete(stage.stage);
        byStage.set(stage.stage, stage);
    }
    return Array.from(byStage.values());
};

const buildRootCauses = (run: DiagnosticSummary): string[] => {
    const rootCauses = new Set<string>();

    for (const stage of run.stage_results) {
        if ((stage.status === 'failed' || stage.status === 'degraded') && stage.error_code) {
            rootCauses.add(stage.error_code);
        }
    }

    buildStatusReasonChain(run).forEach((reason) => rootCauses.add(reason));

    return Array.from(rootCauses);
};

const buildFailureGraph = (run: DiagnosticSummary): DiagnosticSummary['failure_graph'] => {
    const chain = run.status_reason_chain || [];
    if (chain.length === 0) return [];
    return chain.map((node, idx) => ({
        node,
        caused_by: idx > 0 ? chain[idx - 1] : undefined,
        evidence_ref: idx === 0 ? run.primary_failure_evidence : undefined
    }));
};

const buildErrorCatalog = (
    run: Pick<DiagnosticSummary, 'stage_results'>,
    chunks: DiagnosticChunkMetric[]
): DiagnosticSummary['error_catalog'] => {
    const byCode = new Map<string, { code: string; count: number; stages: Set<string>; last_message?: string }>();
    const byStage = new Map<string, { stage: string; failed: number; degraded: number; last_error_code?: string }>();

    for (const stage of run.stage_results) {
        const stageEntry = byStage.get(stage.stage) || { stage: stage.stage, failed: 0, degraded: 0, last_error_code: undefined };
        if (stage.status === 'failed') stageEntry.failed += 1;
        if (stage.status === 'degraded') stageEntry.degraded += 1;
        if (stage.error_code) stageEntry.last_error_code = stage.error_code;
        byStage.set(stage.stage, stageEntry);

        if (!stage.error_code) continue;
        const codeEntry = byCode.get(stage.error_code) || {
            code: stage.error_code,
            count: 0,
            stages: new Set<string>(),
            last_message: undefined
        };
        codeEntry.count += 1;
        codeEntry.stages.add(stage.stage);
        codeEntry.last_message = stage.error_message || stage.error_detail?.message || codeEntry.last_message;
        byCode.set(stage.error_code, codeEntry);
    }

    for (const chunk of chunks) {
        const stageName = `chunk_${chunk.batch_index}`;
        if (!chunk.error_code) continue;
        const codeEntry = byCode.get(chunk.error_code) || {
            code: chunk.error_code,
            count: 0,
            stages: new Set<string>(),
            last_message: undefined
        };
        codeEntry.count += 1;
        codeEntry.stages.add(stageName);
        codeEntry.last_message = chunk.error_message || chunk.error_detail?.message || codeEntry.last_message;
        byCode.set(chunk.error_code, codeEntry);
    }

    return {
        by_code: Array.from(byCode.values())
            .sort((a, b) => b.count - a.count)
            .map((entry) => ({
                code: entry.code,
                count: entry.count,
                stages: Array.from(entry.stages),
                last_message: entry.last_message
            })),
        by_stage: Array.from(byStage.values())
    };
};

const buildFailureTimeline = (
    run: Pick<DiagnosticSummary, 'stage_results'>,
    chunks: DiagnosticChunkMetric[]
): DiagnosticSummary['failure_timeline'] => {
    const timeline: DiagnosticSummary['failure_timeline'] = [];
    for (const stage of run.stage_results) {
        if (stage.status !== 'failed' && stage.status !== 'degraded') continue;
        timeline.push({
            timestamp: new Date(stage.ended_at).toISOString(),
            stage: stage.stage,
            status: stage.status,
            error_code: stage.error_code || stage.error_detail?.code,
            error_message: stage.error_message || stage.error_detail?.message
        });
    }
    for (const chunk of chunks) {
        if (chunk.status !== 'failed') continue;
        timeline.push({
            timestamp: new Date(chunk.ended_at).toISOString(),
            stage: `chunk_${chunk.batch_index}`,
            status: 'failed',
            error_code: chunk.error_code || chunk.error_detail?.code,
            error_message: chunk.error_message || chunk.error_detail?.message,
            batch_index: chunk.batch_index
        });
    }
    return timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
};

const recommendationForCode = (code: string): string | null => {
    if (code === 'http_400' || code === 'groq_transcription_http_400') {
        return 'Revisar formato/mime del chunk; priorizar WAV/PCM y evitar cortes binarios en contenedores comprimidos.';
    }
    if (code === 'http_429' || code === 'budget_limit') {
        return 'Aplicar backoff y controlar presupuesto/cuotas; reducir concurrencia de STT temporalmente.';
    }
    if (code === 'timeout') {
        return 'Reducir tamano de chunk o aumentar timeout de red para STT.';
    }
    if (code === 'decode_error') {
        return 'Re-codificar audio a WAV mono 16kHz antes de transcribir.';
    }
    if (code === 'unsafe_binary_split_blocked') {
        return 'No dividir por bytes audio comprimido; usar normalizacion previa y chunking seguro.';
    }
    if (code.startsWith('pipeline_') || code.startsWith('result_')) {
        return 'Inspeccionar quality gate y secciones clinicas obligatorias para ubicar la regresion.';
    }
    if (code === 'sanitized_leak_detected') {
        return 'Agregar guardrails al prompt para evitar incluir bloques internos (CLASIFICACION/RULEPACK) aunque luego se saniticen.';
    }
    if (code === 'insufficient_clinical_signal') {
        return 'En modo real usar audio verbal clinico claro; el audio tonal/sin habla produce extraccion ambigua.';
    }
    if (code === 'whisper_route_exhausted') {
        return 'Fallo toda la ruta Whisper estricta; revisar API key, cuota y formato de audio de entrada.';
    }
    return null;
};

const buildRecommendations = (run: Pick<DiagnosticSummary, 'error_catalog' | 'quality_gate' | 'reconciliation'>): string[] => {
    const orderedCodes = run.error_catalog.by_code.map((entry) => entry.code);
    const recommendations = new Set<string>();
    for (const code of orderedCodes) {
        const recommendation = recommendationForCode(code);
        if (recommendation) recommendations.add(recommendation);
    }
    if (run.quality_gate && !run.quality_gate.required_sections_ok) {
        recommendations.add('Revisar extraccion/generacion para completar secciones obligatorias faltantes.');
    }
    if (run.quality_gate?.placeholder_detected) {
        recommendations.add('Sanitizar placeholders de batches antes de extraccion/generacion final.');
    }
    if (run.reconciliation.neutralized_issues.length > 0) {
        recommendations.add('Endurecer prompt para no emitir metadatos internos en la historia final.');
    }
    return Array.from(recommendations);
};

export const buildDiagnosticInsights = (run: DiagnosticSummary): string[] => {
    const insights: string[] = [];
    insights.push(`Motivo principal: ${run.status_reason_primary}.`);
    if (run.primary_failure_evidence) {
        insights.push(`Evidencia primaria: ${run.primary_failure_evidence}.`);
    }
    if (run.debug.remaining_errors.length > 0) {
        const top = run.debug.remaining_errors[0];
        insights.push(`Error exacto principal: ${top.type}:${top.field} -> ${top.reason}.`);
    }
    if (run.audio_stats.failed_chunks > 0) {
        insights.push(`Fallaron ${run.audio_stats.failed_chunks} chunk(s) de audio durante STT.`);
    }
    const failedStages = run.stage_results.filter((stage) => stage.status === 'failed');
    const degradedStages = run.stage_results.filter((stage) => stage.status === 'degraded');
    if (failedStages.length > 0) {
        insights.push(`Etapas fallidas: ${failedStages.map((stage) => stage.stage).join(', ')}.`);
    }
    if (degradedStages.length > 0) {
        insights.push(`Etapas degradadas: ${degradedStages.map((stage) => stage.stage).join(', ')}.`);
    }
    if (run.quality_gate && !run.quality_gate.required_sections_ok) {
        insights.push(`Secciones faltantes: ${(run.quality_gate.missing_sections || []).join(', ')}.`);
    }
    if (run.quality_gate?.pipeline_status && run.quality_gate.pipeline_status !== 'completed') {
        insights.push(`Pipeline final no completado (${run.quality_gate.pipeline_status}).`);
    }
    if (run.quality_gate?.placeholder_detected) {
        insights.push('Se detectaron placeholders de batches en la salida final.');
    }
    if (run.audio_stats.transcription_p95_ms > 45_000) {
        insights.push(`Latencia STT elevada (p95=${run.audio_stats.transcription_p95_ms}ms).`);
    }
    if (run.root_causes.length > 0) {
        insights.push(`Causas raiz detectadas: ${run.root_causes.join(', ')}.`);
    }
    if (run.reconciliation.neutralized_issues.length > 0) {
        insights.push(`Issues neutralizados por sanitizacion: ${run.reconciliation.neutralized_issues.length}.`);
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

    const mergedStages = dedupeStageResults([...run.stage_results, ...(output.stage_results || [])]);
    const quality_gate = output.quality_gate || run.quality_gate;
    const reconciliation = output.reconciliation || run.reconciliation || {
        pre_sanitize_issues: [],
        post_sanitize_issues: [],
        neutralized_issues: []
    };
    const debug = output.debug || run.debug || {
        remaining_errors: [],
        provisional_reason: undefined,
        quality_score: undefined,
        pipeline_status: undefined,
        result_status: undefined
    };

    const chunk_count = run.chunks.length;
    const failed_chunks = run.chunks.filter((chunk) => chunk.status === 'failed').length;
    const avg_chunk_bytes = chunk_count > 0
        ? Math.round(run.chunks.reduce((acc, chunk) => acc + chunk.size_bytes, 0) / chunk_count)
        : 0;
    const transcription_p95_ms = Math.round(percentile(run.chunks.map((chunk) => chunk.duration_ms), 95));

    const provisionalSummary: DiagnosticSummary = {
        run_id: run.run_id,
        mode: run.config.mode,
        execution_mode: run.config.execution_mode,
        source: run.config.source,
        scenario_id: run.config.scenario_id,
        stt_route_policy: output.stt_route_policy || 'default',
        status: 'passed',
        stage_results: mergedStages,
        audio_stats: {
            chunk_count,
            failed_chunks,
            avg_chunk_bytes,
            transcription_p95_ms
        },
        quality_gate,
        status_reason_primary: 'ok',
        status_reason_chain: [],
        primary_failure_evidence: undefined,
        failure_graph: [],
        reconciliation,
        debug,
        root_causes: [],
        error_catalog: {
            by_code: [],
            by_stage: []
        },
        failure_timeline: [],
        recommendations: [],
        insights: []
    };

    provisionalSummary.status_reason_chain = buildStatusReasonChain(provisionalSummary);
    provisionalSummary.status_reason_primary = provisionalSummary.status_reason_chain[0] || 'ok';
    const firstFailedStage = provisionalSummary.stage_results.find((item) => item.status === 'failed' || item.status === 'degraded');
    const firstFailedChunk = run.chunks.find((item) => item.status === 'failed');
    if (firstFailedStage?.error_detail?.context) {
        const ctx = firstFailedStage.error_detail.context;
        provisionalSummary.primary_failure_evidence = [
            `stage=${firstFailedStage.stage}`,
            `code=${firstFailedStage.error_detail.code}`,
            ctx.provider ? `provider=${ctx.provider}` : '',
            ctx.model ? `model=${ctx.model}` : '',
            ctx.route_key ? `route=${ctx.route_key}` : '',
            typeof ctx.http_status === 'number' ? `http=${ctx.http_status}` : '',
            typeof firstFailedStage.error_detail.batch_index === 'number' ? `batch=${firstFailedStage.error_detail.batch_index}` : '',
            ctx.request_id ? `request_id=${ctx.request_id}` : ''
        ].filter(Boolean).join(' ');
    } else if (firstFailedChunk?.error_detail?.context) {
        const ctx = firstFailedChunk.error_detail.context;
        provisionalSummary.primary_failure_evidence = [
            `chunk=${firstFailedChunk.batch_index}`,
            `code=${firstFailedChunk.error_detail.code}`,
            ctx.provider ? `provider=${ctx.provider}` : '',
            ctx.model ? `model=${ctx.model}` : '',
            typeof ctx.http_status === 'number' ? `http=${ctx.http_status}` : '',
            ctx.request_id ? `request_id=${ctx.request_id}` : ''
        ].filter(Boolean).join(' ');
    }
    provisionalSummary.root_causes = buildRootCauses(provisionalSummary);
    provisionalSummary.failure_graph = buildFailureGraph(provisionalSummary);
    provisionalSummary.error_catalog = buildErrorCatalog(provisionalSummary, run.chunks);
    provisionalSummary.failure_timeline = buildFailureTimeline(provisionalSummary, run.chunks);
    provisionalSummary.recommendations = buildRecommendations(provisionalSummary);
    provisionalSummary.status = evaluateDiagnosticOutcome(provisionalSummary);
    provisionalSummary.insights = buildDiagnosticInsights(provisionalSummary);
    runStore.delete(runId);
    return provisionalSummary;
};

export const buildQualityGateFromHistory = (params: {
    medical_history: string;
    result_status?: string;
    pipeline_status?: string;
    critical_gaps_count?: number;
}): DiagnosticQualityGate => {
    const coverage = evaluateRequiredSections(params.medical_history || '');
    const pipelineStatus = params.pipeline_status;
    const resultStatus = params.result_status;
    const placeholderDetected = hasPlaceholderToken(params.medical_history || '');
    let blockingRuleId: string | undefined;
    let blockingReason: string | undefined;
    if (placeholderDetected) {
        blockingRuleId = 'QG_PLACEHOLDER_IN_FINAL_OUTPUT';
        blockingReason = 'Se detectaron placeholders de batch en salida final.';
    } else if (!coverage.required_sections_ok) {
        blockingRuleId = 'QG_REQUIRED_SECTIONS_MISSING';
        blockingReason = `Faltan secciones obligatorias: ${(coverage.missing_sections || []).join(', ')}`;
    } else if (pipelineStatus && pipelineStatus !== 'completed') {
        blockingRuleId = 'QG_PIPELINE_NOT_COMPLETED';
        blockingReason = `pipeline_status=${pipelineStatus}`;
    } else if (resultStatus && resultStatus !== 'completed') {
        blockingRuleId = 'QG_RESULT_NOT_COMPLETED';
        blockingReason = `result_status=${resultStatus}`;
    }
    return {
        required_sections_ok: coverage.required_sections_ok,
        result_status: resultStatus,
        pipeline_status: pipelineStatus,
        critical_gaps_count: Math.max(0, params.critical_gaps_count || 0),
        missing_sections: coverage.missing_sections,
        placeholder_detected: placeholderDetected,
        blocking_rule_id: blockingRuleId,
        blocking_reason: blockingReason
    };
};
