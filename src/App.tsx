
import { useState, useRef, useEffect, useCallback } from 'react';
import { Layout } from './components/Layout';
import { Recorder } from './components/Recorder';

import { SearchHistory } from './components/SearchHistory';
import { HistoryView } from './components/HistoryView';

import { Settings } from './components/Settings';
import { AIService } from './services/ai';

import { ReportsView } from './components/ReportsView';
import type { ExtractionResult, ExtractionMeta, ConsultationClassification, UncertaintyFlag } from './services/groq';
import { saveLabTestLog } from './services/storage';
import {
    saveMedicalRecord,
    updateMedicalRecord,
    upsertPipelineJob,
    upsertConsultationSession,
    saveSegment,
    markSegmentStatus,
    resumeSession,
    getRecoverableSessions,
    finalizeSession,
    purgeExpiredPipelineArtifacts
} from './services/storage';
import { logError, upsertConsultationQualitySummary } from './services/supabase';
import { AudioTestLab } from './components/AudioTestLab';
import LessonsPanel from './components/LessonsPanel';
import { MemoryService } from './services/memory';
import { ConsultationPipelineOrchestrator } from './services/pipeline-orchestrator';
import { enqueueAuditEvent, startAuditWorker, stopAuditWorker } from './services/audit-worker';
import { startErrorMonitoring } from './services/error-monitor';
import {
    buildQualityGateFromHistory,
    finalizeDiagnosticRun,
    recordDiagnosticEvent,
    startDiagnosticRun,
    type DiagnosticSummary,
    type DiagnosticErrorDetail
} from './services/diagnostics';
import { WhatsNewModal } from './components/WhatsNewModal';
import { OnboardingModal } from './components/OnboardingModal';
import { SimulationProvider, useSimulation } from './components/Simulation/SimulationContext';
import { SimulationOverlay } from './components/Simulation/SimulationOverlay';
import { normalizeAndChunkAudio } from './utils/audioProcessing';
import { PipelineHealthPanel } from './components/PipelineHealthPanel';
import { safeGetLocalStorage, safeSetLocalStorage } from './utils/safeBrowser';

import './App.css';
import { Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// API Key from environment variable
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';
const PIPELINE_V4_ENABLED = String(import.meta.env.VITE_PIPELINE_V4_ENABLED || 'true').toLowerCase() === 'true';
const MAX_SAFE_AUDIO_BLOB_BYTES = 20 * 1024 * 1024;
const SAFE_BINARY_SPLIT_MIME_HINTS = ['wav', 'wave', 'pcm', 'x-wav', 'l16'];
const LEARNING_V2_ENABLED = String(import.meta.env.VITE_LEARNING_V2_ENABLED || 'true').toLowerCase() === 'true';
const RULEPACK_APPLY_ENABLED = String(import.meta.env.VITE_RULEPACK_APPLY_ENABLED || 'true').toLowerCase() === 'true';
const RULE_AUTO_PROMOTE_ENABLED = String(import.meta.env.VITE_RULE_AUTO_PROMOTE_ENABLED || 'true').toLowerCase() === 'true';
const QUALITY_TRIAGE_ENABLED = String(import.meta.env.VITE_QUALITY_TRIAGE_ENABLED || 'true').toLowerCase() === 'true';
const SECTION_REGEN_ENABLED = String(import.meta.env.VITE_SECTION_REGEN_ENABLED || 'true').toLowerCase() === 'true';
const FAST_PATH_ADAPTIVE_VALIDATION = String(import.meta.env.VITE_FAST_PATH_ADAPTIVE_VALIDATION || 'true').toLowerCase() === 'true';
const FAST_PATH_TOKEN_BUDGETS = String(import.meta.env.VITE_FAST_PATH_TOKEN_BUDGETS || 'true').toLowerCase() === 'true';
const FAST_PATH_RETRY_TUNING = String(import.meta.env.VITE_FAST_PATH_RETRY_TUNING || 'true').toLowerCase() === 'true';
const FAST_PATH_ASYNC_TRIAGE = String(import.meta.env.VITE_FAST_PATH_ASYNC_TRIAGE || 'true').toLowerCase() === 'true';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to get key array
const getApiKeys = (userKey?: string) => {
    const source = userKey || GROQ_API_KEY;
    return source.includes(',')
        ? source.split(',').map((k: string) => k.trim())
        : [source];
};

const getInitialApiKey = () => {
    if (typeof window === 'undefined') return GROQ_API_KEY;
    return safeGetLocalStorage('groq_api_key', GROQ_API_KEY);
};

const canSafelyBinarySplitAudio = (blob: Blob): boolean => {
    const mime = (blob.type || '').toLowerCase();
    if (!mime) return false;
    return SAFE_BINARY_SPLIT_MIME_HINTS.some((hint) => mime.includes(hint));
};

// ════════════════════════════════════════════════════════════════
// NEW: WELCOME MODAL FOR DRA. GOTXI (30 DEC 2025)
// ════════════════════════════════════════════════════════════════
const AppContent = () => {
    const [apiKey, setApiKey] = useState<string>(getInitialApiKey());
    const [showSettings, setShowSettings] = useState(false);
    const [history, setHistory] = useState<string>('');
    const [originalHistory, setOriginalHistory] = useState<string>('');
    const [transcription, setTranscription] = useState<string>('');
    const [currentPatientName, setCurrentPatientName] = useState<string>('');
    const [_processingStatus, setProcessingStatus] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [currentView, setCurrentView] = useState<'record' | 'history' | 'reports' | 'result' | 'test-lab'>('record');

    const [pipelineMetadata, setPipelineMetadata] = useState<{
        corrections: number;
        models: { generation: string; validation: string };
        errorsFixed: number;
        versionsCount: number;
        remainingErrors?: { type: string; field: string; reason: string }[];
        validationHistory?: { type: string; field: string; reason: string }[];
        extractionMeta?: ExtractionMeta[];
        classification?: ConsultationClassification;
        uncertaintyFlags?: UncertaintyFlag[];
        auditId?: string;
        rulePackVersion?: number;
        ruleIdsUsed?: string[];
        learningApplied?: boolean;
        qualityScore?: number;
        criticalGaps?: { field: string; reason: string; severity: 'critical' | 'major' | 'minor' }[];
        doctorNextActions?: string[];
        qualityTriageModel?: string;
        correctionRoundsExecuted?: number;
        earlyStopReason?: 'clean_consensus' | 'low_risk_remaining' | 'max_rounds_reached';
        riskLevel?: 'low' | 'medium' | 'high';
        phaseTimingsMs?: { extract: number; generate: number; validate: number; corrections: number; total: number };
        resultStatus?: 'completed' | 'provisional' | 'failed_recoverable' | 'failed_final';
        provisionalReason?: string;
        logicalCallsUsed?: number;
        physicalCallsUsed?: number;
        fallbackHops?: number;
        fastPathConfig?: {
            adaptiveValidation: boolean;
            tokenBudgets: boolean;
            retryTuning: boolean;
            asyncTriage: boolean;
        };
    } | undefined>(undefined);
    const [showLessons, setShowLessons] = useState(false);
    const [showWelcomeModal, setShowWelcomeModal] = useState(false);
    const [showWhatsNew, setShowWhatsNew] = useState(false);
    const [currentRecordId, setCurrentRecordId] = useState<string | null>(null);

    const { isPlaying, demoData, startSimulation } = useSimulation();

    // Effect to handle Simulation Mode Data Injection
    useEffect(() => {
        if (isPlaying && demoData) {
            setCurrentView('result');
            setHistory(demoData.history);
            setOriginalHistory(demoData.history);
            setCurrentPatientName(demoData.patientName);
            setPipelineMetadata(demoData.pipelineMetadata);
        } else if (!isPlaying && currentPatientName === "Paciente Demo (Simulación)") {
            // Reset when stopping demo
            setCurrentView('record');
            setHistory('');
            setOriginalHistory('');
            setCurrentPatientName('');
            setPipelineMetadata(undefined);
        }
    }, [isPlaying, demoData, currentPatientName]);

    useEffect(() => {
        setShowWelcomeModal(true);
    }, []);


    // ════════════════════════════════════════════════════════════════
    // BATCHING STATE: Store partial extractions for long consultations
    // ════════════════════════════════════════════════════════════════
    const extractionPartsRef = useRef<Map<number, ExtractionResult>>(new Map());
    const transcriptionPartsRef = useRef<Map<number, string>>(new Map());
    const extractionMetaPartsRef = useRef<Map<number, ExtractionMeta[]>>(new Map());
    const classificationPartsRef = useRef<Map<number, ConsultationClassification>>(new Map());
    const aiServiceRef = useRef<AIService | null>(null);
    const orchestratorRef = useRef<ConsultationPipelineOrchestrator<void> | null>(null);
    const [pipelineRuntimeReason, setPipelineRuntimeReason] = useState<string>('');
    const activeSessionIdRef = useRef<string | null>(null);
    const processingLockRef = useRef(false);
    const currentViewRef = useRef(currentView);
    const currentPatientRef = useRef(currentPatientName);
    const diagnosticRunBySessionRef = useRef<Map<string, string>>(new Map());
    const diagnosticSummaryBySessionRef = useRef<Map<string, DiagnosticSummary>>(new Map());

    useEffect(() => {
        currentViewRef.current = currentView;
    }, [currentView]);

    useEffect(() => {
        currentPatientRef.current = currentPatientName;
    }, [currentPatientName]);

    const isLabRun = (patientName: string) => patientName.startsWith('TEST_LAB_') || patientName.startsWith('DIAG_');
    const extractDiagnosticContext = (patientName: string): {
        scenarioId?: string;
        executionMode?: 'deterministic' | 'real';
    } => {
        const stripped = patientName
            .replace(/^TEST_LAB_/, '')
            .replace(/^DIAG_/, '')
            .trim();
        if (!stripped) return {};
        const tokens = stripped.split('_').filter(Boolean);
        if (tokens.length === 0) return {};
        let executionMode: 'deterministic' | 'real' | undefined;
        if (tokens[0] === 'det') executionMode = 'deterministic';
        if (tokens[0] === 'real') executionMode = 'real';
        const startIndex = executionMode ? 1 : 0;
        const coreTokens = tokens.slice(startIndex);
        const maybeTimestamp = coreTokens[coreTokens.length - 1];
        const scenarioTokens = /^\d{10,}$/.test(maybeTimestamp || '')
            ? coreTokens.slice(0, -1)
            : coreTokens;
        return {
            scenarioId: scenarioTokens.join('_') || stripped,
            executionMode
        };
    };

    const isWhisperStrictScenario = (scenarioId?: string, executionMode?: 'deterministic' | 'real') => {
        if (executionMode !== 'real') return false;
        return (scenarioId || '').toLowerCase().includes('hourly_complex_consultation');
    };

    const normalizeDiagnosticError = (error: unknown): string => {
        const message = ((error as Error)?.message || '').toLowerCase();
        if (message.includes('whisper_route_exhausted')) return 'whisper_route_exhausted';
        if (message.includes('unsafe_binary_split_blocked')) return 'unsafe_binary_split_blocked';
        if (message.includes('groq_transcription_http_400')) return 'http_400';
        if (message.includes('groq_transcription_http_429')) return 'http_429';
        if (message.includes('budget_limit') || message.includes('awaiting_budget')) return 'budget_limit';
        if (message.includes('timeout') || message.includes('abort')) return 'timeout';
        if (message.includes('400')) return 'http_400';
        if (message.includes('401')) return 'http_401';
        if (message.includes('403')) return 'http_403';
        if (message.includes('404')) return 'http_404';
        if (message.includes('408')) return 'http_408';
        if (message.includes('409')) return 'http_409';
        if (message.includes('413')) return 'http_413';
        if (message.includes('422')) return 'http_422';
        if (message.includes('429')) return 'http_429';
        if (message.includes('500')) return 'http_500';
        if (message.includes('502')) return 'http_502';
        if (message.includes('503')) return 'http_503';
        if (message.includes('504')) return 'http_504';
        if (message.includes('decode') || message.includes('wav conversion')) return 'decode_error';
        return 'unknown_error';
    };

    const inferEndpointFromErrorMessage = (message: string): string | undefined => {
        const normalized = (message || '').toLowerCase();
        if (normalized.includes('groq_transcription')) return '/audio/transcriptions';
        if (normalized.includes('chat/completions')) return '/chat/completions';
        if (normalized.includes('gemini')) return 'gemini_api';
        return undefined;
    };

    const extractTrailingJsonObject = (message: string): Record<string, unknown> | null => {
        if (!message) return null;
        const start = message.lastIndexOf('{');
        const end = message.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        const candidate = message.slice(start, end + 1);
        try {
            const parsed = JSON.parse(candidate);
            return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
        } catch {
            return null;
        }
    };

    const buildDiagnosticErrorDetail = (
        error: unknown,
        params: {
            stage?: string;
            batchIndex?: number;
            provider?: string;
            operation?: string;
            mimeType?: string;
            chunkBytes?: number;
            inputType?: 'audio' | 'text';
            codeOverride?: string;
            messageOverride?: string;
            phase?: 'raw_guard' | 'final_guard' | 'stt' | 'extract' | 'generate' | 'quality_gate';
            origin?: 'model_output' | 'sanitizer' | 'validator' | 'pipeline_policy';
            blocking?: boolean;
            blockingRuleId?: string;
        } = {}
    ): DiagnosticErrorDetail => {
        const anyError = error as {
            message?: string;
            status?: number;
            retryable?: boolean;
            attempt?: number;
        };
        const message = params.messageOverride || anyError?.message || 'unknown_error';
        const code = params.codeOverride || normalizeDiagnosticError(error);
        const metadata = extractTrailingJsonObject(message);
        const maybeHttpStatus = Number((metadata?.status as number) || anyError?.status || 0) || undefined;
        const endpoint = inferEndpointFromErrorMessage(message);
        const providerCode = typeof metadata?.reason === 'string'
            ? metadata.reason
            : (message.match(/(groq_[a-z_]+_(?:http_\d{3}|timeout|network))/)?.[1] || undefined);
        const requestId = (metadata?.request_id as string | undefined) || undefined;
        const model = (metadata?.model as string | undefined) || undefined;
        const routeKey = (metadata?.route_key as string | undefined) || undefined;
        const rawPayloadExcerpt = (metadata?.body_excerpt as string | undefined) || undefined;
        const retryAfterMs = typeof metadata?.retry_after_ms === 'number' ? metadata.retry_after_ms : undefined;
        const canonicalCode = code;

        return {
            code,
            message,
            stage: params.stage,
            batch_index: params.batchIndex,
            occurred_at: new Date().toISOString(),
            context: {
                canonical_code: canonicalCode,
                provider_code: providerCode,
                provider_message: message,
                request_id: requestId,
                http_status: maybeHttpStatus,
                retry_after_ms: retryAfterMs,
                retryable: typeof anyError?.retryable === 'boolean' ? anyError.retryable : undefined,
                attempt: typeof anyError?.attempt === 'number' ? anyError.attempt : undefined,
                attempt_index: typeof metadata?.attempt_index === 'number' ? metadata.attempt_index : undefined,
                fallback_index: typeof metadata?.fallback_index === 'number' ? metadata.fallback_index : undefined,
                provider: params.provider,
                model,
                route_key: routeKey,
                operation: params.operation,
                endpoint,
                input_type: params.inputType,
                mime_type: params.mimeType || (metadata?.input_type as string | undefined),
                chunk_bytes: params.chunkBytes,
                chunk_id: typeof params.batchIndex === 'number' ? `batch_${params.batchIndex}` : undefined,
                audio_duration_ms: typeof metadata?.audio_duration_ms === 'number' ? metadata.audio_duration_ms : undefined,
                phase: params.phase,
                origin: params.origin,
                blocking: params.blocking,
                blocking_rule_id: params.blockingRuleId || (typeof metadata?.blocking_rule_id === 'string' ? metadata.blocking_rule_id : undefined),
                raw_payload_excerpt: rawPayloadExcerpt,
                notes: [
                    typeof metadata?.retry_after_ms === 'number' ? `retry_after_ms=${metadata.retry_after_ms}` : '',
                    typeof metadata?.transcription_length === 'number' ? `transcription_length=${metadata.transcription_length}` : ''
                ].filter(Boolean)
            }
        };
    };

    const sanitizeTranscriptForExtraction = (raw: string) => {
        if (!raw) return raw;
        return raw
            .replace(/\[(MISSING_BATCH|PARTIAL_BATCH)_[^\]]+\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };



    const buildValidationLabel = (validations?: { validator: string }[]) => {
        if (!validations || validations.length === 0) return 'unknown';
        const unique = Array.from(new Set(validations.map(v => v.validator).filter(Boolean)));
        return unique.join(' + ');
    };

    const hasInsufficientClinicalSignal = (params: {
        stillBlocking?: string[];
        remainingErrors?: { type: string; field: string; reason: string }[];
    }): boolean => {
        const joined = [
            ...(params.stillBlocking || []),
            ...((params.remainingErrors || []).map((item) => `${item.field}:${item.reason}`))
        ].join(' ').toLowerCase();
        return (
            joined.includes('transcripcion')
            && (
                joined.includes('ambiguo')
                || joined.includes('inaudible')
                || joined.includes('no se identifican datos clinicos')
            )
        );
    };

    const toLogDiagnostics = (diagnostics?: DiagnosticSummary | null) => {
        if (!diagnostics) return undefined;
        return {
            run_id: diagnostics.run_id,
            mode: diagnostics.mode,
            execution_mode: diagnostics.execution_mode,
            input_source: diagnostics.source,
            scenario_id: diagnostics.scenario_id,
            stt_route_policy: diagnostics.stt_route_policy,
            status: diagnostics.status,
            stage_results: diagnostics.stage_results,
            audio_stats: diagnostics.audio_stats,
            quality_gate: diagnostics.quality_gate ? {
                required_sections_ok: diagnostics.quality_gate.required_sections_ok,
                result_status: diagnostics.quality_gate.result_status,
                pipeline_status: diagnostics.quality_gate.pipeline_status,
                critical_gaps_count: diagnostics.quality_gate.critical_gaps_count,
                blocking_rule_id: diagnostics.quality_gate.blocking_rule_id,
                blocking_reason: diagnostics.quality_gate.blocking_reason
            } : undefined,
            status_reason_primary: diagnostics.status_reason_primary,
            status_reason_chain: diagnostics.status_reason_chain,
            primary_failure_evidence: diagnostics.primary_failure_evidence,
            failure_graph: diagnostics.failure_graph,
            reconciliation: diagnostics.reconciliation,
            debug: diagnostics.debug,
            root_causes: diagnostics.root_causes,
            error_catalog: diagnostics.error_catalog,
            failure_timeline: diagnostics.failure_timeline,
            recommendations: diagnostics.recommendations,
            insights: diagnostics.insights
        };
    };

    const prefixExtractionMeta = (meta: ExtractionMeta[], batchIndex: number) => {
        const prefix = `batch_${batchIndex + 1}`;
        return meta.map((chunk) => ({
            ...chunk,
            chunk_id: `${prefix}_${chunk.chunk_id}`,
            field_evidence: (chunk.field_evidence || []).map((entry) => ({
                ...entry,
                chunk_id: `${prefix}_${entry.chunk_id}`
            }))
        }));
    };

    const buildFallbackExtraction = (reason: string): ExtractionResult => ({
        antecedentes: { alergias: null, enfermedades_cronicas: null, cirugias: null, tratamiento_habitual: null },
        enfermedad_actual: { motivo_consulta: '', sintomas: [], evolucion: null },
        exploraciones_realizadas: {},
        diagnostico: [],
        plan: '',
        notas_calidad: [{ tipo: 'AMBIGUO', seccion: 'pipeline', descripcion: reason }]
    });

    const splitBlobForSafeProcessing = async (
        blob: Blob,
        options?: { sessionId?: string; stageName?: string; batchIndex?: number }
    ): Promise<Blob[]> => {
        const runId = options?.sessionId ? diagnosticRunBySessionRef.current.get(options.sessionId) : undefined;
        const splitStage = options?.stageName || 'split_blob';
        if (runId) {
            recordDiagnosticEvent(runId, { type: 'stage_start', stage: splitStage });
        }
        if (blob.size <= MAX_SAFE_AUDIO_BLOB_BYTES) {
            if (runId) {
                recordDiagnosticEvent(runId, {
                    type: 'stage_end',
                    stage: splitStage,
                    status: 'passed'
                });
            }
            return [blob];
        }
        let normalizeFallbackError: unknown = null;
        try {
            const chunks = await normalizeAndChunkAudio(blob);
            if (chunks.length > 0) {
                if (runId) {
                    recordDiagnosticEvent(runId, {
                        type: 'stage_end',
                        stage: splitStage,
                        status: 'passed'
                    });
                }
                return chunks;
            }
            normalizeFallbackError = new Error('normalize_and_chunk_returned_empty');
        } catch (error) {
            normalizeFallbackError = error;
        }

        if (!canSafelyBinarySplitAudio(blob)) {
            const blockedError = new Error('unsafe_binary_split_blocked');
            const errorDetail = buildDiagnosticErrorDetail(normalizeFallbackError || blockedError, {
                stage: splitStage,
                provider: 'client',
                operation: 'split_blob',
                mimeType: blob.type,
                chunkBytes: blob.size,
                inputType: 'audio',
                codeOverride: 'unsafe_binary_split_blocked',
                phase: 'stt',
                origin: 'pipeline_policy',
                blocking: true
            });
            if (runId) {
                recordDiagnosticEvent(runId, {
                    type: 'stage_end',
                    stage: splitStage,
                    status: 'failed',
                    error_code: errorDetail.code,
                    error_message: errorDetail.message,
                    error_detail: errorDetail
                });
            }
            throw blockedError;
        }

        console.warn('[App] normalizeAndChunkAudio failed, falling back to binary split:', normalizeFallbackError);
        const chunks: Blob[] = [];
        let start = 0;
        while (start < blob.size) {
            const end = Math.min(blob.size, start + MAX_SAFE_AUDIO_BLOB_BYTES);
            chunks.push(blob.slice(start, end, blob.type));
            start = end;
        }
        const fallbackErrorDetail = buildDiagnosticErrorDetail(normalizeFallbackError, {
            stage: splitStage,
            provider: 'client',
            operation: 'split_blob_fallback',
            mimeType: blob.type,
            chunkBytes: blob.size,
            inputType: 'audio',
            phase: 'stt',
            origin: 'sanitizer',
            blocking: false
        });
        if (runId) {
            recordDiagnosticEvent(runId, {
                type: 'stage_end',
                stage: splitStage,
                status: 'degraded',
                error_code: fallbackErrorDetail.code,
                error_message: fallbackErrorDetail.message,
                error_detail: fallbackErrorDetail
            });
        }
        return chunks;
    };

    const getSortedBatchIndexes = () => {
        return Array.from(
            new Set([
                ...transcriptionPartsRef.current.keys(),
                ...extractionPartsRef.current.keys(),
                ...extractionMetaPartsRef.current.keys(),
                ...classificationPartsRef.current.keys()
            ])
        ).sort((a, b) => a - b);
    };

    const buildTranscriptFromStoredSegments = async (sessionId: string): Promise<string> => {
        if (!sessionId) return '';
        const recovered = await resumeSession(sessionId);
        if (!recovered?.transcript_segments || recovered.transcript_segments.length === 0) return '';
        return recovered.transcript_segments
            .sort((a, b) => a.batch_index - b.batch_index)
            .map((segment) => segment.text || '')
            .join(' ')
            .trim();
    };

    // ════════════════════════════════════════════════════════════════
    // PERSONALIZATION & MEMORY INIT
    // ════════════════════════════════════════════════════════════════
    useEffect(() => {
        console.info('[LearningConfig]', {
            learning_v2_enabled: LEARNING_V2_ENABLED,
            rulepack_apply_enabled: RULEPACK_APPLY_ENABLED,
            rule_auto_promote_enabled: RULE_AUTO_PROMOTE_ENABLED
        });
        startAuditWorker();
        void purgeExpiredPipelineArtifacts();
        const stopErrorMonitoring = startErrorMonitoring({
            getContext: () => ({
                session_id: activeSessionIdRef.current || undefined,
                route: currentViewRef.current,
                context: {
                    current_view: currentViewRef.current,
                    patient_name: currentPatientRef.current || null
                }
            })
        });

        // Memory Consolidation (Nightly Logic)
        const runConsolidation = async () => {
            const keys = getApiKeys(apiKey);
            if (keys.length > 0) {
                console.log('Running startup memory consolidation...');
                await MemoryService.consolidateDailyLessons(keys);
            }
        };

        const recoverPipelineSession = async () => {
            if (processingLockRef.current) return;
            const keys = getApiKeys(apiKey);
            if (keys.length === 0) return;
            const recoverable = await getRecoverableSessions();
            if (!recoverable.length) return;
            const latest = recoverable.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
            const sessionData = await resumeSession(latest.session_id);
            if (!sessionData) return;
            const finalSegment = sessionData.audio_segments.find((segment) => segment.is_final);
            if (!finalSegment) return;

            const aiService = aiServiceRef.current || new AIService(keys);
            aiServiceRef.current = aiService;
            const orchestrator = ensureOrchestrator(aiService);
            processingLockRef.current = true;
            activeSessionIdRef.current = latest.session_id;
            setCurrentPatientName(latest.patient_name);
            setCurrentView('result');
            setIsLoading(true);
            setProcessingStatus('Recuperando sesión pendiente...');
            MemoryService.setPipelineBusy(true);
            orchestrator.startConsultation(latest.session_id, latest.patient_name, { recovering: true });

            const partialSegments = sessionData.audio_segments.filter((segment) => !segment.is_final).sort((a, b) => a.batch_index - b.batch_index);
            try {
                for (const segment of partialSegments) {
                    await orchestrator.enqueuePartial(segment.batch_index, segment.blob);
                }
                const fallbackLastBatchIndex = partialSegments.length;
                const recoveredLastBatchIndex = Math.max(latest.last_batch_index || 0, fallbackLastBatchIndex);
                await orchestrator.finalize(recoveredLastBatchIndex, finalSegment.blob);
            } finally {
                processingLockRef.current = false;
                setIsLoading(false);
                MemoryService.setPipelineBusy(false);
            }
        };

        const runInBackground = () => {
            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                (window as Window & { requestIdleCallback: (fn: IdleRequestCallback) => number }).requestIdleCallback(() => {
                    void runConsolidation();
                    void recoverPipelineSession();
                });
                return;
            }
            setTimeout(() => {
                void runConsolidation();
                void recoverPipelineSession();
            }, 2_000);
        };

        runInBackground();

        return () => {
            stopAuditWorker();
            stopErrorMonitoring();
        };
    }, [apiKey]);

    const handleSaveSettings = (key: string) => {
        setApiKey(key);
        safeSetLocalStorage('groq_api_key', key);
        aiServiceRef.current = null;
        setShowSettings(false);
    };

    const persistMedicalHistory = useCallback(
        async (
            newContent: string,
            options?: {
                autosave?: boolean;
            }
        ) => {
            if (!currentRecordId) return;

            try {
                await updateMedicalRecord(currentRecordId, {
                    medical_history: newContent
                });
            } catch (error) {
                console.error('[App] Error updating medical record:', error);
                if (!options?.autosave) {
                    logError({
                        message: 'Error actualizando historia médica',
                        context: { recordId: currentRecordId },
                        source: 'App.persistMedicalHistory',
                        severity: 'warning'
                    });
                }
            }
        },
        [currentRecordId]
    );

    const clearPipelineBuffers = () => {
        extractionPartsRef.current = new Map();
        transcriptionPartsRef.current = new Map();
        extractionMetaPartsRef.current = new Map();
        classificationPartsRef.current = new Map();
    };

    const buildTextPipelineIdempotencyKey = (patientName: string, text: string) => {
        const normalizedPatient = patientName.trim().toLowerCase();
        const normalizedText = text.trim().replace(/\s+/g, ' ');
        const timestampMs = Date.now();
        const base = `${normalizedPatient}|${normalizedText}|${timestampMs}`;
        let hash = 2166136261;
        for (let i = 0; i < base.length; i++) {
            hash ^= base.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        const randomPart = Math.floor(Math.random() * 1e9).toString(16);
        return `text_${timestampMs}_${(hash >>> 0).toString(16)}_${randomPart}`;
    };

    const replaceHistorySection = (historyText: string, sectionTitle: string, newSectionContent: string) => {
        const normalizedTitle = sectionTitle.trim().toLowerCase();
        const headingRegex = /^##\s+(.+)$/gim;
        const matches = Array.from(historyText.matchAll(headingRegex));
        const target = matches.find((match) => (match[1] || '').trim().toLowerCase() === normalizedTitle);
        if (!target || typeof target.index !== 'number') return historyText;
        const targetStart = target.index;
        const contentStart = targetStart + target[0].length;
        const nextHeading = matches.find((match) => typeof match.index === 'number' && (match.index as number) > targetStart);
        const contentEnd = nextHeading && typeof nextHeading.index === 'number' ? nextHeading.index : historyText.length;
        const before = historyText.slice(0, contentStart).trimEnd();
        const after = historyText.slice(contentEnd).trimStart();
        return `${before}\n${newSectionContent.trim()}\n\n${after}`.trim();
    };

    const persistPipelineRecord = async (params: {
        patientName: string;
        consultationType: string;
        transcription: string;
        medicalHistory: string;
        auditId?: string;
        aiModel: string;
        idempotencyKey?: string;
    }) => {
        const savedRecord = await saveMedicalRecord({
            patient_name: params.patientName,
            consultation_type: params.consultationType,
            transcription: params.transcription,
            medical_history: params.medicalHistory,
            original_medical_history: params.medicalHistory,
            audit_id: params.auditId,
            ai_model: params.aiModel,
            idempotency_key: params.idempotencyKey
        });
        const saved = savedRecord?.[0];
        if (saved?.record_uuid) {
            setCurrentRecordId(saved.record_uuid);
        }
        return saved;
    };

    const processPartialBatch = async (
        aiService: AIService,
        blob: Blob,
        batchIndex: number
    ) => {
        const partialStartedAt = Date.now();
        const sessionId = orchestratorRef.current?.getStatus().sessionId || '';
        const runId = sessionId ? diagnosticRunBySessionRef.current.get(sessionId) : undefined;
        const currentPatientName = orchestratorRef.current?.getStatus().patientName || '';
        const diagnosticContext = extractDiagnosticContext(currentPatientName);
        const whisperStrict = isWhisperStrictScenario(diagnosticContext.scenarioId, diagnosticContext.executionMode);
        try {
            if (runId) {
                recordDiagnosticEvent(runId, { type: 'stage_start', stage: `partial_${batchIndex}` });
            }
            if (sessionId) {
                await upsertConsultationSession({
                    session_id: sessionId,
                    patient_name: orchestratorRef.current?.getStatus().patientName || '',
                    status: 'transcribing_partial',
                    last_batch_index: batchIndex,
                    idempotency_key: sessionId
                });
            }
            await markSegmentStatus({ session_id: sessionId, batch_index: batchIndex, type: 'audio', status: 'processing' });

            const safeBlobs = await splitBlobForSafeProcessing(blob, {
                sessionId,
                stageName: `partial_${batchIndex}_split`,
                batchIndex
            });
            const transcriptParts: string[] = [];

            for (let i = 0; i < safeBlobs.length; i++) {
                const partBlob = safeBlobs[i];
                const partBatchIndex = safeBlobs.length > 1 ? (batchIndex * 1000) + i : batchIndex;
                const chunkStartedAt = Date.now();
                try {
                    const transcriptResult = await aiService.transcribeAudio(partBlob, undefined, undefined, {
                        whisperStrict
                    });
                    transcriptParts.push(transcriptResult.data);
                    if (runId) {
                        recordDiagnosticEvent(runId, {
                            type: 'chunk_result',
                            batch_index: partBatchIndex,
                            size_bytes: partBlob.size,
                            duration_ms: Date.now() - chunkStartedAt,
                            status: 'passed',
                            mime_type: partBlob.type
                        });
                    }
                    await saveSegment({
                        session_id: sessionId,
                        batch_index: partBatchIndex,
                        type: 'transcript',
                        text: transcriptResult.data,
                        status: 'completed'
                    });
                    continue;
                } catch (error) {
                    const errorDetail = buildDiagnosticErrorDetail(error, {
                        stage: `partial_${batchIndex}`,
                        batchIndex: partBatchIndex,
                        provider: 'groq',
                        operation: 'transcribeAudio',
                        mimeType: partBlob.type,
                        chunkBytes: partBlob.size,
                        inputType: 'audio',
                        phase: 'stt',
                        origin: 'model_output',
                        blocking: true
                    });
                    if (runId) {
                        recordDiagnosticEvent(runId, {
                            type: 'chunk_result',
                            batch_index: partBatchIndex,
                            size_bytes: partBlob.size,
                            duration_ms: Date.now() - chunkStartedAt,
                            status: 'failed',
                            mime_type: partBlob.type,
                            error_code: errorDetail.code,
                            error_message: errorDetail.message,
                            error_detail: errorDetail
                        });
                    }
                    throw error;
                }
                // DEFERRED EXTRACTION: We only transcribe here to save tokens.
                // Extraction will happen once at the end with the full transcript.
            }

            const mergedTranscript = transcriptParts.join(' ').trim();
            // Extraction parts are now empty during partial processing

            transcriptionPartsRef.current.set(batchIndex, mergedTranscript);
            // We no longer set extraction parts here
            await markSegmentStatus({ session_id: sessionId, batch_index: batchIndex, type: 'audio', status: 'completed' });
            if (sessionId) {
                await upsertConsultationSession({
                    session_id: sessionId,
                    patient_name: orchestratorRef.current?.getStatus().patientName || '',
                    status: 'uploading_chunks',
                    last_batch_index: batchIndex,
                    idempotency_key: sessionId
                });
            }

            if (sessionId) {
                void enqueueAuditEvent('pipeline_attempt', {
                    session_id: sessionId,
                    stage: `partial_${batchIndex}`,
                    attempt_index: batchIndex,
                    status: 'completed',
                    started_at: new Date(partialStartedAt).toISOString(),
                    finished_at: new Date().toISOString(),
                    duration_ms: Date.now() - partialStartedAt,
                    metadata: {
                        blob_size: blob.size,
                        transcript_length: mergedTranscript.length
                    }
                });
            }
            if (runId) {
                recordDiagnosticEvent(runId, {
                    type: 'stage_end',
                    stage: `partial_${batchIndex}`,
                    status: 'passed',
                    duration_ms: Date.now() - partialStartedAt
                });
            }
        } catch (error: any) {
            console.error(`[App] Partial batch ${batchIndex} failed, adding degraded placeholder:`, error);
            transcriptionPartsRef.current.set(batchIndex, `[PARTIAL_BATCH_${batchIndex}_FAILED]`);
            extractionPartsRef.current.set(batchIndex, buildFallbackExtraction(`partial_batch_${batchIndex}_failed`));
            extractionMetaPartsRef.current.set(batchIndex, [{
                chunk_id: `batch_${batchIndex + 1}_missing`,
                chunk_text: '',
                field_evidence: []
            }]);
            classificationPartsRef.current.set(batchIndex, { visit_type: 'unknown', ent_area: 'unknown', urgency: 'unknown', confidence: 0 });
            // All audit/persistence calls wrapped so they NEVER escape the catch block
            try {
                if (sessionId) {
                    await upsertConsultationSession({
                        session_id: sessionId,
                        patient_name: orchestratorRef.current?.getStatus().patientName || '',
                        status: 'awaiting_budget',
                        result_status: 'failed_recoverable',
                        last_batch_index: batchIndex,
                        error_reason: error?.message || 'partial_batch_failed',
                        idempotency_key: sessionId
                    });
                    await markSegmentStatus({
                        session_id: sessionId,
                        batch_index: batchIndex,
                        type: 'audio',
                        status: 'failed',
                        error_reason: error?.message || 'partial_batch_failed'
                    });
                }
                await logError({
                    message: error?.message || `Partial batch ${batchIndex} failed`,
                    stack: error?.stack,
                    context: { batchIndex, blobSize: blob.size },
                    source: 'App.processPartialBatch',
                    severity: 'warning'
                });
            } catch (auditError) {
                console.error('[App] Failed to persist partial batch failure audit:', auditError);
            }
            if (sessionId) {
                void enqueueAuditEvent('pipeline_attempt', {
                    session_id: sessionId,
                    stage: `partial_${batchIndex}`,
                    attempt_index: batchIndex,
                    status: 'failed',
                    started_at: new Date(partialStartedAt).toISOString(),
                    finished_at: new Date().toISOString(),
                    duration_ms: Date.now() - partialStartedAt,
                    error_message: error?.message || 'partial_batch_failed',
                    metadata: {
                        blob_size: blob.size
                    }
                });
            }
            if (runId) {
                const errorDetail = buildDiagnosticErrorDetail(error, {
                    stage: `partial_${batchIndex}`,
                    batchIndex,
                    provider: 'pipeline',
                    operation: 'process_partial_batch',
                    mimeType: blob.type,
                    chunkBytes: blob.size,
                    inputType: 'audio',
                    messageOverride: error?.message || 'partial_batch_failed',
                    phase: 'stt',
                    origin: 'pipeline_policy',
                    blocking: true
                });
                recordDiagnosticEvent(runId, {
                    type: 'stage_end',
                    stage: `partial_${batchIndex}`,
                    status: 'failed',
                    duration_ms: Date.now() - partialStartedAt,
                    error_code: errorDetail.code,
                    error_message: errorDetail.message,
                    error_detail: errorDetail
                });
            }
        }
    };

    const finalizePipeline = async (
        aiService: AIService,
        blob: Blob,
        patientName: string,
        batchIndex: number,
        missingBatches: number[] = []
    ) => {
        const finalizeStartedAt = Date.now();
        const sessionId = orchestratorRef.current?.getStatus().sessionId || '';
        const runId = sessionId ? diagnosticRunBySessionRef.current.get(sessionId) : undefined;
        const diagnosticContext = extractDiagnosticContext(patientName);
        const whisperStrict = isWhisperStrictScenario(diagnosticContext.scenarioId, diagnosticContext.executionMode);
        if (runId) {
            recordDiagnosticEvent(runId, { type: 'stage_start', stage: 'finalize' });
        }
        setProcessingStatus('Transcribiendo segmento final...');
        await markSegmentStatus({ session_id: sessionId, batch_index: batchIndex, type: 'audio', status: 'processing' });
        const safeFinalBlobs = await splitBlobForSafeProcessing(blob, {
            sessionId,
            stageName: 'final_split',
            batchIndex
        });
        const finalTranscriptParts: string[] = [];
        for (let i = 0; i < safeFinalBlobs.length; i++) {
            const subBlob = safeFinalBlobs[i];
            const subBatchIndex = safeFinalBlobs.length > 1 ? (batchIndex * 1000) + i : batchIndex;
            const chunkStartedAt = Date.now();
            try {
                const transcriptResult = await aiService.transcribeAudio(subBlob, undefined, undefined, {
                    whisperStrict
                });
                finalTranscriptParts.push(transcriptResult.data);
                if (runId) {
                    recordDiagnosticEvent(runId, {
                        type: 'chunk_result',
                        batch_index: subBatchIndex,
                        size_bytes: subBlob.size,
                        duration_ms: Date.now() - chunkStartedAt,
                        status: 'passed',
                        mime_type: subBlob.type
                    });
                }
                await saveSegment({
                    session_id: sessionId,
                    batch_index: subBatchIndex,
                    type: 'transcript',
                    text: transcriptResult.data,
                    status: 'completed'
                });
                continue;
            } catch (error) {
                const errorDetail = buildDiagnosticErrorDetail(error, {
                    stage: 'finalize',
                    batchIndex: subBatchIndex,
                    provider: 'groq',
                    operation: 'transcribeAudio',
                    mimeType: subBlob.type,
                    chunkBytes: subBlob.size,
                    inputType: 'audio',
                    phase: 'stt',
                    origin: 'model_output',
                    blocking: true
                });
                if (runId) {
                    recordDiagnosticEvent(runId, {
                        type: 'chunk_result',
                        batch_index: subBatchIndex,
                        size_bytes: subBlob.size,
                        duration_ms: Date.now() - chunkStartedAt,
                        status: 'failed',
                        mime_type: subBlob.type,
                        error_code: errorDetail.code,
                        error_message: errorDetail.message,
                        error_detail: errorDetail
                    });
                }
                throw error;
            }
        }

        const mergedFinalTranscript = finalTranscriptParts.join(' ').trim();
        transcriptionPartsRef.current.set(batchIndex, mergedFinalTranscript);
        // Deferred extraction means we don't set extraction parts yet
        await markSegmentStatus({ session_id: sessionId, batch_index: batchIndex, type: 'audio', status: 'completed' });

        if (missingBatches.length > 0) {
            for (const missing of missingBatches) {
                if (!extractionPartsRef.current.has(missing)) {
                    extractionPartsRef.current.set(missing, buildFallbackExtraction(`missing_batch_${missing}`));
                }
                if (!transcriptionPartsRef.current.has(missing)) {
                    transcriptionPartsRef.current.set(missing, `[MISSING_BATCH_${missing}]`);
                }
                if (!extractionMetaPartsRef.current.has(missing)) {
                    extractionMetaPartsRef.current.set(missing, [{
                        chunk_id: `batch_${missing + 1}_missing`,
                        chunk_text: '',
                        field_evidence: []
                    }]);
                }
                await saveSegment({
                    session_id: sessionId,
                    batch_index: missing,
                    type: 'transcript',
                    text: `[MISSING_BATCH_${missing}]`,
                    status: 'failed',
                    error_reason: 'missing_batch'
                });
            }
        }

        const sortedIndexes = getSortedBatchIndexes();
        const fullTranscription = sortedIndexes.map((index) => transcriptionPartsRef.current.get(index) || '').join(' ').trim();
        setTranscription(fullTranscription);

        // SINGLE EXTRACTION CALL on the full transcript
        setProcessingStatus('Extrayendo datos clinicos de toda la consulta (Gemini)...');
        aiService.resetInvocationCounters(sessionId || undefined);
        const sanitizedTranscription = sanitizeTranscriptForExtraction(fullTranscription);
        let extractionInput = sanitizedTranscription;
        let fullExtraction;
        if (runId) {
            recordDiagnosticEvent(runId, { type: 'stage_start', stage: 'extract_full' });
        }
        try {
            fullExtraction = await aiService.extractOnly(extractionInput);
            if (runId) {
                recordDiagnosticEvent(runId, { type: 'stage_end', stage: 'extract_full', status: 'passed' });
            }
        } catch (firstError) {
            console.warn('[App] Final extraction failed, retrying from stored transcript segments...', firstError);
            const recoveredTranscript = await buildTranscriptFromStoredSegments(sessionId);
            if (recoveredTranscript && recoveredTranscript.length > extractionInput.length) {
                extractionInput = sanitizeTranscriptForExtraction(recoveredTranscript);
                setTranscription(extractionInput);
            }
            await sleep(700);
            try {
                fullExtraction = await aiService.extractOnly(extractionInput);
                if (runId) {
                    const degradedDetail = buildDiagnosticErrorDetail(firstError, {
                        stage: 'extract_full',
                        provider: 'gemini',
                        operation: 'extractOnly_retry_success',
                        inputType: 'text',
                        phase: 'extract',
                        origin: 'model_output',
                        blocking: false
                    });
                    recordDiagnosticEvent(runId, {
                        type: 'stage_end',
                        stage: 'extract_full',
                        status: 'degraded',
                        error_code: degradedDetail.code,
                        error_message: degradedDetail.message,
                        error_detail: degradedDetail
                    });
                }
            } catch (secondError: any) {
                if (runId) {
                    const extractErrorDetail = buildDiagnosticErrorDetail(secondError, {
                        stage: 'extract_full',
                        provider: 'gemini',
                        operation: 'extractOnly',
                        inputType: 'text',
                        messageOverride: secondError?.message || 'final_extraction_failed',
                        phase: 'extract',
                        origin: 'model_output',
                        blocking: true
                    });
                    recordDiagnosticEvent(runId, {
                        type: 'stage_end',
                        stage: 'extract_full',
                        status: 'failed',
                        error_code: extractErrorDetail.code,
                        error_message: extractErrorDetail.message,
                        error_detail: extractErrorDetail
                    });
                }
                try {
                    if (sessionId) {
                        await upsertConsultationSession({
                            session_id: sessionId,
                            patient_name: patientName,
                            status: 'awaiting_budget',
                            result_status: 'failed_recoverable',
                            last_batch_index: batchIndex,
                            error_reason: secondError?.message || 'final_extraction_failed',
                            idempotency_key: sessionId
                        });
                    }
                } catch (auditErr) {
                    console.error('[App] Failed to persist extraction failure audit:', auditErr);
                }
                throw secondError;
            }
        }

        const orderedExtractions = [fullExtraction.data];
        const orderedMeta = prefixExtractionMeta(fullExtraction.meta, 0); // usage index 0 as it's full
        const bestClassification = fullExtraction.classification;

        setProcessingStatus(`Generando historia clinica final (${orderedExtractions.length} bloque)...`);

        if (runId) {
            recordDiagnosticEvent(runId, { type: 'stage_start', stage: 'generate_history' });
        }
        const result = await aiService.generateFromMergedExtractions(
            orderedExtractions,
            extractionInput,
            patientName,
            orderedMeta,
            bestClassification,
            sessionId
        );
        if (runId) {
            recordDiagnosticEvent(runId, {
                type: 'stage_end',
                stage: 'generate_history',
                status: result.pipeline_status === 'completed' ? 'passed' : 'degraded'
            });
        }

        const missingWarnings = missingBatches.map((idx) => ({
            type: 'missing_batch',
            field: `batch_${idx + 1}`,
            reason: 'Segmento parcial no disponible durante finalizacion'
        }));
        const remainingErrors = [
            ...(result.remaining_errors || []),
            ...missingWarnings
        ];

        setHistory(result.data);
        setOriginalHistory(result.data);
        setPipelineMetadata({
            corrections: result.corrections_applied || 0,
            models: { generation: result.model, validation: buildValidationLabel(result.validations) },
            errorsFixed: 0,
            versionsCount: (result.corrections_applied || 0) + 1,
            remainingErrors: remainingErrors.length > 0 ? remainingErrors : undefined,
            validationHistory: result.validations?.flatMap(v => v.errors),
            extractionMeta: orderedMeta,
            classification: result.classification,
            uncertaintyFlags: result.uncertainty_flags,
            auditId: result.audit_id,
            rulePackVersion: result.rule_pack_version,
            ruleIdsUsed: result.rule_ids_used,
            learningApplied: result.learning_applied,
            qualityScore: result.quality_score,
            criticalGaps: result.critical_gaps,
            doctorNextActions: result.doctor_next_actions,
            qualityTriageModel: result.quality_triage_model,
            correctionRoundsExecuted: result.correction_rounds_executed,
            earlyStopReason: result.early_stop_reason,
            riskLevel: result.risk_level,
            phaseTimingsMs: result.phase_timings_ms,
            resultStatus: result.result_status,
            provisionalReason: result.provisional_reason,
            logicalCallsUsed: result.logical_calls_used,
            physicalCallsUsed: result.physical_calls_used,
            fallbackHops: result.fallback_hops,
            fastPathConfig: {
                adaptiveValidation: FAST_PATH_ADAPTIVE_VALIDATION,
                tokenBudgets: FAST_PATH_TOKEN_BUDGETS,
                retryTuning: FAST_PATH_RETRY_TUNING,
                asyncTriage: FAST_PATH_ASYNC_TRIAGE
            }
        });

        if (sessionId) {
            const runStatus = result.pipeline_status || (missingBatches.length > 0 ? 'degraded' : 'completed');
            const resultStatus = result.result_status || (runStatus === 'completed' ? 'completed' : 'provisional');
            await upsertConsultationSession({
                session_id: sessionId,
                patient_name: patientName,
                status: resultStatus === 'completed' ? 'completed' : 'provisional',
                result_status: resultStatus,
                last_batch_index: batchIndex,
                metadata: {
                    missing_batches: missingBatches,
                    corrections_applied: result.corrections_applied || 0,
                    remaining_errors: remainingErrors.length,
                    pipeline_status: runStatus,
                    result_status: resultStatus,
                    provisional_reason: result.provisional_reason || null
                },
                error_reason: resultStatus === 'provisional' ? (result.remaining_errors?.[0]?.reason || pipelineRuntimeReason) : undefined
            });
            void enqueueAuditEvent('pipeline_run_update', {
                session_id: sessionId,
                patient_name: patientName,
                status: runStatus,
                outcome: runStatus,
                metadata: {
                    missing_batches: missingBatches,
                    corrections_applied: result.corrections_applied || 0,
                    remaining_errors: remainingErrors.length,
                    result_status: resultStatus
                }
            });
            void enqueueAuditEvent('pipeline_attempt', {
                session_id: sessionId,
                stage: 'finalize',
                attempt_index: batchIndex,
                status: runStatus,
                started_at: new Date(finalizeStartedAt).toISOString(),
                finished_at: new Date().toISOString(),
                duration_ms: Date.now() - finalizeStartedAt,
                metadata: {
                    blob_size: blob.size,
                    missing_batches: missingBatches,
                    transcript_length: extractionInput.length,
                    retry_after_ms: result.retry_after_ms || 0
                }
            });
        }

        setProcessingStatus('Guardando en base de datos...');
        try {
            const savedRecord = await persistPipelineRecord({
                patientName,
                consultationType: result.classification?.visit_type || 'unknown',
                transcription: extractionInput,
                medicalHistory: result.data,
                auditId: result.audit_id,
                aiModel: result.model,
                idempotencyKey: sessionId || undefined
            });
            if (QUALITY_TRIAGE_ENABLED && savedRecord?.record_uuid) {
                void upsertConsultationQualitySummary({
                    record_id: savedRecord.record_uuid,
                    quality_score: result.quality_score || 0,
                    critical_gaps_count: result.critical_gaps?.length || 0,
                    corrected_count: result.corrections_applied || 0
                });
            }
            if (sessionId && result.result_status === 'completed') {
                await finalizeSession(sessionId, {
                    status: 'completed',
                    result_status: 'completed',
                    purgeArtifacts: true
                });
            }

            const qualityGate = buildQualityGateFromHistory({
                medical_history: result.data,
                result_status: result.result_status,
                pipeline_status: result.pipeline_status,
                critical_gaps_count: result.critical_gaps?.length || 0
            });
            if (runId) {
                recordDiagnosticEvent(runId, { type: 'quality_gate', gate: qualityGate });
                if (result.reconciliation) {
                    recordDiagnosticEvent(runId, {
                        type: 'reconciliation',
                        reconciliation: result.reconciliation
                    });
                }
                recordDiagnosticEvent(runId, {
                    type: 'debug_context',
                    debug: {
                        remaining_errors: (result.remaining_errors || []).map((item) => ({
                            type: item.type,
                            field: item.field,
                            reason: item.reason,
                            severity: (item as { severity?: string }).severity
                        })),
                        provisional_reason: result.provisional_reason,
                        quality_score: result.quality_score,
                        pipeline_status: result.pipeline_status,
                        result_status: result.result_status
                    }
                });
                const finalizeStageStatus = (
                    !qualityGate.required_sections_ok
                    || qualityGate.placeholder_detected
                    || (qualityGate.pipeline_status && qualityGate.pipeline_status !== 'completed')
                    || (qualityGate.result_status && qualityGate.result_status !== 'completed')
                ) ? 'failed' : 'passed';
                const finalizeErrorDetail = finalizeStageStatus === 'failed'
                    ? buildDiagnosticErrorDetail(new Error('quality_gate_failed'), {
                        stage: 'finalize',
                        provider: 'pipeline',
                        operation: 'quality_gate',
                        inputType: 'audio',
                        codeOverride: hasInsufficientClinicalSignal({
                            stillBlocking: result.still_blocking_after_sanitization,
                            remainingErrors: result.remaining_errors
                        })
                            ? 'insufficient_clinical_signal'
                            : qualityGate.placeholder_detected
                                ? 'placeholder_detected'
                                : (!qualityGate.required_sections_ok ? 'required_sections_missing' : 'pipeline_not_completed'),
                        messageOverride: `quality_gate_failed(required_sections_ok=${String(qualityGate.required_sections_ok)}, pipeline_status=${qualityGate.pipeline_status || 'n/a'}, result_status=${qualityGate.result_status || 'n/a'})`,
                        phase: 'quality_gate',
                        origin: 'pipeline_policy',
                        blocking: true,
                        blockingRuleId: qualityGate.blocking_rule_id
                    })
                    : undefined;
                recordDiagnosticEvent(runId, {
                    type: 'stage_end',
                    stage: 'finalize',
                    status: finalizeStageStatus,
                    duration_ms: Date.now() - finalizeStartedAt,
                    error_code: finalizeErrorDetail?.code,
                    error_message: finalizeErrorDetail?.message,
                    error_detail: finalizeErrorDetail
                });
                const diagnostics = finalizeDiagnosticRun(runId, {
                    quality_gate: qualityGate,
                    stt_route_policy: whisperStrict ? 'whisper_strict' : 'default'
                });
                if (diagnostics) {
                    diagnosticSummaryBySessionRef.current.set(sessionId, diagnostics);
                }
            }

            if (isLabRun(patientName)) {
                const diagnostics = diagnosticSummaryBySessionRef.current.get(sessionId);
                await saveLabTestLog({
                    test_name: patientName,
                    input_type: 'audio',
                    transcription: extractionInput,
                    medical_history: result.data,
                    metadata: {
                        corrections: result.corrections_applied || 0,
                        models: { generation: result.model, validation: buildValidationLabel(result.validations) },
                        versionsCount: (result.corrections_applied || 0) + 1,
                        errorsFixed: 0,
                        active_memory_used: Boolean(result.active_memory_used),
                        validationHistory: result.validations?.flatMap((v) => v.errors),
                        remainingErrors: result.remaining_errors,
                        diagnostics: toLogDiagnostics(diagnostics)
                    }
                });
            }
        } catch (saveError) {
            console.error('[App] Error saving record:', saveError);
            if (runId) {
                const saveErrorDetail = buildDiagnosticErrorDetail(saveError, {
                    stage: 'finalize',
                    provider: 'storage',
                    operation: 'persistPipelineRecord',
                    inputType: 'audio',
                    codeOverride: normalizeDiagnosticError(saveError),
                    messageOverride: (saveError as Error)?.message || 'save_failed',
                    phase: 'quality_gate',
                    origin: 'pipeline_policy',
                    blocking: true
                });
                recordDiagnosticEvent(runId, {
                    type: 'stage_end',
                    stage: 'finalize',
                    status: 'failed',
                    duration_ms: Date.now() - finalizeStartedAt,
                    error_code: saveErrorDetail.code,
                    error_message: saveErrorDetail.message,
                    error_detail: saveErrorDetail
                });
            }
        }
    };

    const ensureOrchestrator = (aiService: AIService) => {
        if (!orchestratorRef.current) {
            orchestratorRef.current = new ConsultationPipelineOrchestrator<void>({
                finalizeWaitMs: 180_000,
                onStatusChange: (status) => {
                    setPipelineRuntimeReason(status.reason || '');
                    if (status.sessionId && status.patientName) {
                        activeSessionIdRef.current = status.sessionId;
                        void upsertPipelineJob({
                            session_id: status.sessionId,
                            patient_name: status.patientName,
                            status: status.state,
                            result_status: status.state === 'provisional' ? 'provisional' : undefined,
                            last_stage: status.state,
                            idempotency_key: status.sessionId,
                            payload: {
                                processed_batches: status.processedBatches,
                                pending_batches: status.pendingBatches,
                                missing_batches: status.missingBatches,
                                next_expected_batch: status.nextExpectedBatch
                            },
                            error_reason: status.reason
                        });
                        void upsertConsultationSession({
                            session_id: status.sessionId,
                            patient_name: status.patientName,
                            status: status.state === 'processing_partials'
                                ? 'extracting'
                                : status.state === 'awaiting_budget'
                                    ? 'awaiting_budget'
                                    : status.state === 'finalizing'
                                        ? 'finalizing'
                                        : status.state === 'provisional'
                                            ? 'provisional'
                                            : status.state === 'completed'
                                                ? 'completed'
                                                : 'recording',
                            result_status: status.state === 'provisional'
                                ? 'provisional'
                                : status.state === 'completed'
                                    ? 'completed'
                                    : undefined,
                            last_batch_index: Math.max(status.nextExpectedBatch, status.processedBatches[status.processedBatches.length - 1] || 0),
                            metadata: {
                                processed_batches: status.processedBatches,
                                pending_batches: status.pendingBatches,
                                missing_batches: status.missingBatches,
                                next_expected_batch: status.nextExpectedBatch
                            },
                            error_reason: status.reason,
                            idempotency_key: status.sessionId
                        });
                        void enqueueAuditEvent('pipeline_run_update', {
                            session_id: status.sessionId,
                            patient_name: status.patientName,
                            status: status.state,
                            outcome: status.state === 'failed' ? 'failed' : undefined,
                            metadata: {
                                processed_batches: status.processedBatches,
                                pending_batches: status.pendingBatches,
                                missing_batches: status.missingBatches,
                                next_expected_batch: status.nextExpectedBatch,
                                reason: status.reason || ''
                            }
                        });
                    }
                    if (status.state === 'processing_partials') {
                        setProcessingStatus(`Procesando parciales... (${status.processedBatches.length} completados)`);
                    }
                },
                processPartial: async ({ blob: partialBlob, batchIndex: partialIndex }) => {
                    await processPartialBatch(aiService, partialBlob, partialIndex);
                },
                finalize: async ({ finalBlob, patientName: finalPatient, lastBatchIndex, missingBatches }) => {
                    await finalizePipeline(aiService, finalBlob, finalPatient, lastBatchIndex, missingBatches);
                }
            });
        }
        return orchestratorRef.current;
    };

    const handleConsultationStart = (sessionId: string, patientName: string) => {
        if (!PIPELINE_V4_ENABLED) return;
        const keys = getApiKeys(apiKey);
        if (keys.length === 0) return;
        const aiService = aiServiceRef.current || new AIService(keys);
        aiServiceRef.current = aiService;
        const orchestrator = ensureOrchestrator(aiService);
        activeSessionIdRef.current = sessionId;
        orchestrator.startConsultation(sessionId, patientName);
        if (isLabRun(patientName) && !diagnosticRunBySessionRef.current.has(sessionId)) {
            const diagnosticContext = extractDiagnosticContext(patientName);
            const runId = startDiagnosticRun({
                mode: 'hybrid',
                source: 'audio',
                patient_name: patientName,
                scenario_id: diagnosticContext.scenarioId,
                execution_mode: diagnosticContext.executionMode
            });
            diagnosticRunBySessionRef.current.set(sessionId, runId);
            recordDiagnosticEvent(runId, { type: 'stage_start', stage: 'session_start' });
            recordDiagnosticEvent(runId, { type: 'stage_end', stage: 'session_start', status: 'passed', duration_ms: 1 });
        }
        MemoryService.setPipelineBusy(true);
        setPipelineRuntimeReason('');
        void upsertConsultationSession({
            session_id: sessionId,
            patient_name: patientName,
            status: 'recording',
            last_batch_index: 0,
            idempotency_key: sessionId
        });
        void enqueueAuditEvent('pipeline_run_update', {
            session_id: sessionId,
            patient_name: patientName,
            status: 'recording',
            metadata: {}
        });
    };

    const handleRecordingCompleteLegacy = async (
        blob: Blob,
        patientName: string,
        isPartialBatch: boolean = false,
        batchIndex: number = 0
    ) => {
        const keys = getApiKeys(apiKey);
        if (keys.length === 0) {
            alert('Please configure your API Key in settings first.');
            setShowSettings(true);
            return;
        }

        const aiService = aiServiceRef.current || new AIService(keys);
        aiServiceRef.current = aiService;

        try {
            if (isPartialBatch) {
                await processPartialBatch(aiService, blob, batchIndex);
                return;
            }

            setIsLoading(true);
            setProcessingStatus('Iniciando procesamiento final...');
            setCurrentView('result');
            setCurrentPatientName(patientName);
            await finalizePipeline(aiService, blob, patientName, batchIndex, []);

        } catch (error: any) {
            console.error(error);
            setProcessingStatus('Error en el procesamiento.');

            logError({
                message: error?.message || 'Unknown error processing recording',
                stack: error?.stack,
                context: { patientName, blobSize: blob?.size, isPartialBatch, batchIndex },
                source: 'App.handleRecordingCompleteLegacy',
                severity: 'error'
            });

            alert('Error processing audio. See console for details.');
            setCurrentView('record');
            clearPipelineBuffers();
        } finally {
            setIsLoading(false);
            MemoryService.setPipelineBusy(false);
        }
    };

    const handleRecordingComplete = async (
        blob: Blob,
        patientName: string,
        isPartialBatch: boolean = false,
        batchIndex: number = 0
    ) => {
        if (!PIPELINE_V4_ENABLED) {
            await handleRecordingCompleteLegacy(blob, patientName, isPartialBatch, batchIndex);
            return;
        }

        const keys = getApiKeys(apiKey);
        if (keys.length === 0) {
            alert('Please configure your API Key in settings first.');
            setShowSettings(true);
            return;
        }

        const aiService = aiServiceRef.current || new AIService(keys);
        aiServiceRef.current = aiService;
        const orchestrator = ensureOrchestrator(aiService);

        const status = orchestrator.getStatus();
        if (!status.sessionId) {
            const sessionId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
                ? crypto.randomUUID()
                : `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            activeSessionIdRef.current = sessionId;
            orchestrator.startConsultation(sessionId, patientName);
            if (isLabRun(patientName) && !diagnosticRunBySessionRef.current.has(sessionId)) {
                const diagnosticContext = extractDiagnosticContext(patientName);
                const runId = startDiagnosticRun({
                    mode: 'hybrid',
                    source: 'audio',
                    patient_name: patientName,
                    scenario_id: diagnosticContext.scenarioId,
                    execution_mode: diagnosticContext.executionMode
                });
                diagnosticRunBySessionRef.current.set(sessionId, runId);
            }
            MemoryService.setPipelineBusy(true);
            await upsertConsultationSession({
                session_id: sessionId,
                patient_name: patientName,
                status: 'recording',
                last_batch_index: 0,
                idempotency_key: sessionId
            });
        }

        try {
            const currentSessionId = orchestrator.getStatus().sessionId || activeSessionIdRef.current || '';
            if (isPartialBatch) {
                if (currentSessionId) {
                    await saveSegment({
                        session_id: currentSessionId,
                        batch_index: batchIndex,
                        type: 'audio',
                        blob,
                        status: 'pending',
                        is_final: false
                    });
                    await upsertConsultationSession({
                        session_id: currentSessionId,
                        patient_name: patientName,
                        status: 'uploading_chunks',
                        last_batch_index: batchIndex,
                        idempotency_key: currentSessionId
                    });
                }
                await orchestrator.enqueuePartial(batchIndex, blob);
                return;
            }

            setIsLoading(true);
            setCurrentView('result');
            setCurrentPatientName(patientName);
            setProcessingStatus('Iniciando procesamiento final...');
            const activeSessionId = orchestrator.getStatus().sessionId;
            if (activeSessionId) {
                await saveSegment({
                    session_id: activeSessionId,
                    batch_index: batchIndex,
                    type: 'audio',
                    blob,
                    status: 'pending',
                    is_final: true
                });
                await upsertConsultationSession({
                    session_id: activeSessionId,
                    patient_name: patientName,
                    status: 'finalizing',
                    last_batch_index: batchIndex,
                    idempotency_key: activeSessionId
                });
            }

            await orchestrator.finalize(batchIndex, blob);
            clearPipelineBuffers();
        } catch (error: any) {
            console.error('[App] V4 pipeline failed:', error);
            setProcessingStatus('Error en el procesamiento.');
            const sessionId = orchestrator.getStatus().sessionId || '';
            if (sessionId) {
                const runId = diagnosticRunBySessionRef.current.get(sessionId);
                if (runId) {
                    const v4ErrorDetail = buildDiagnosticErrorDetail(error, {
                        stage: 'finalize',
                        provider: 'pipeline',
                        operation: 'orchestrator_finalize',
                        inputType: 'audio',
                        mimeType: blob.type,
                        chunkBytes: blob.size,
                        codeOverride: normalizeDiagnosticError(error),
                        messageOverride: error?.message || 'v4_pipeline_failed',
                        phase: 'quality_gate',
                        origin: 'pipeline_policy',
                        blocking: true
                    });
                    recordDiagnosticEvent(runId, {
                        type: 'stage_end',
                        stage: 'finalize',
                        status: 'failed',
                        error_code: v4ErrorDetail.code,
                        error_message: v4ErrorDetail.message,
                        error_detail: v4ErrorDetail
                    });
                    recordDiagnosticEvent(runId, {
                        type: 'debug_context',
                        debug: {
                            remaining_errors: [{
                                type: 'error',
                                field: 'pipeline',
                                reason: error?.message || 'v4_pipeline_failed'
                            }],
                            provisional_reason: error?.message || 'v4_pipeline_failed',
                            pipeline_status: 'failed',
                            result_status: 'failed_recoverable'
                        }
                    });
                    const diagnostics = finalizeDiagnosticRun(runId, {
                        quality_gate: {
                            required_sections_ok: false,
                            result_status: 'failed_recoverable',
                            pipeline_status: 'failed',
                            critical_gaps_count: 1
                        },
                        stt_route_policy: isWhisperStrictScenario(
                            extractDiagnosticContext(patientName).scenarioId,
                            extractDiagnosticContext(patientName).executionMode
                        ) ? 'whisper_strict' : 'default'
                    });
                    if (diagnostics) {
                        diagnosticSummaryBySessionRef.current.set(sessionId, diagnostics);
                    }
                }
            }
            if (sessionId) {
                void enqueueAuditEvent('pipeline_run_update', {
                    session_id: sessionId,
                    patient_name: patientName,
                    status: 'failed',
                    outcome: 'failed',
                    metadata: {
                        batch_index: batchIndex,
                        is_partial: isPartialBatch
                    }
                });
                void enqueueAuditEvent('pipeline_attempt', {
                    session_id: sessionId,
                    stage: isPartialBatch ? `partial_${batchIndex}` : 'finalize',
                    attempt_index: batchIndex,
                    status: 'failed',
                    started_at: new Date().toISOString(),
                    finished_at: new Date().toISOString(),
                    error_message: error?.message || 'v4_pipeline_failed',
                    metadata: {
                        blob_size: blob.size
                    }
                });
            }
            try {
                await logError({
                    message: error?.message || 'Unknown error processing recording (v4)',
                    stack: error?.stack,
                    context: { patientName, blobSize: blob?.size, isPartialBatch, batchIndex, reason: pipelineRuntimeReason },
                    source: 'App.handleRecordingComplete.v4',
                    severity: 'error'
                });
                if (sessionId) {
                    await upsertConsultationSession({
                        session_id: sessionId,
                        patient_name: patientName,
                        status: 'awaiting_budget',
                        result_status: 'failed_recoverable',
                        last_batch_index: batchIndex,
                        error_reason: error?.message || 'v4_pipeline_failed',
                        idempotency_key: sessionId
                    });
                }
            } catch (auditError) {
                console.error('[App] Failed to persist v4 pipeline failure audit:', auditError);
            }
            clearPipelineBuffers();
            setCurrentView('record');
            alert('Error processing audio. See console for details.');
        } finally {
            if (!isPartialBatch) {
                setIsLoading(false);
                MemoryService.setPipelineBusy(false);
                const sessionId = orchestrator.getStatus().sessionId || '';
                if (sessionId && isLabRun(patientName) && diagnosticRunBySessionRef.current.has(sessionId)) {
                    diagnosticRunBySessionRef.current.delete(sessionId);
                }
            }
        }
    };
    const handleTextPipeline = async (text: string, patientName: string) => {
        const keys = getApiKeys(apiKey);
        if (keys.length === 0) {
            alert('Configura tu API Key primero');
            return;
        }
        const textSessionId = buildTextPipelineIdempotencyKey(patientName, text);
        const startedAt = Date.now();
        const aiService = aiServiceRef.current || new AIService(keys);
        aiServiceRef.current = aiService;
        setIsLoading(true);
        setCurrentView('result');
        setCurrentPatientName(patientName);
        setProcessingStatus('Procesando transcripcion con pipeline clinico...');
        MemoryService.setPipelineBusy(true);
        void enqueueAuditEvent('pipeline_run_update', {
            session_id: textSessionId,
            patient_name: patientName,
            status: 'finalizing',
            metadata: {
                input_type: 'text',
                transcription_length: text.length
            }
        });
        const diagnosticRunId = startDiagnosticRun({
            mode: 'hybrid',
            source: 'text',
            patient_name: patientName,
            scenario_id: extractDiagnosticContext(patientName).scenarioId,
            execution_mode: extractDiagnosticContext(patientName).executionMode
        });

        try {
            aiService.resetInvocationCounters(textSessionId);
            recordDiagnosticEvent(diagnosticRunId, { type: 'stage_start', stage: 'extract_text' });
            const extraction = await aiService.extractOnly(text);
            recordDiagnosticEvent(diagnosticRunId, { type: 'stage_end', stage: 'extract_text', status: 'passed' });
            const normalizedMeta = prefixExtractionMeta(extraction.meta, 0);
            recordDiagnosticEvent(diagnosticRunId, { type: 'stage_start', stage: 'generate_text_history' });
            const result = await aiService.generateFromMergedExtractions(
                [extraction.data],
                text,
                patientName,
                normalizedMeta,
                extraction.classification,
                textSessionId
            );
            recordDiagnosticEvent(diagnosticRunId, {
                type: 'stage_end',
                stage: 'generate_text_history',
                status: result.pipeline_status === 'completed' ? 'passed' : 'degraded'
            });

            setHistory(result.data);
            setOriginalHistory(result.data);
            setTranscription(text);
            setPipelineMetadata({
                corrections: result.corrections_applied || 0,
                models: { generation: result.model, validation: buildValidationLabel(result.validations) },
                errorsFixed: 0,
                versionsCount: (result.corrections_applied || 0) + 1,
                remainingErrors: result.remaining_errors,
                validationHistory: result.validations?.flatMap(v => v.errors),
                extractionMeta: result.extraction_meta,
                classification: result.classification,
                uncertaintyFlags: result.uncertainty_flags,
                auditId: result.audit_id,
                rulePackVersion: result.rule_pack_version,
                ruleIdsUsed: result.rule_ids_used,
                learningApplied: result.learning_applied,
                qualityScore: result.quality_score,
                criticalGaps: result.critical_gaps,
                doctorNextActions: result.doctor_next_actions,
                qualityTriageModel: result.quality_triage_model,
                correctionRoundsExecuted: result.correction_rounds_executed,
                earlyStopReason: result.early_stop_reason,
                riskLevel: result.risk_level,
                phaseTimingsMs: result.phase_timings_ms,
                resultStatus: result.result_status,
                provisionalReason: result.provisional_reason,
                logicalCallsUsed: result.logical_calls_used,
                physicalCallsUsed: result.physical_calls_used,
                fallbackHops: result.fallback_hops,
                fastPathConfig: {
                    adaptiveValidation: FAST_PATH_ADAPTIVE_VALIDATION,
                    tokenBudgets: FAST_PATH_TOKEN_BUDGETS,
                    retryTuning: FAST_PATH_RETRY_TUNING,
                    asyncTriage: FAST_PATH_ASYNC_TRIAGE
                }
            });

            setProcessingStatus('Guardando consulta de prueba en Historial...');
            const savedRecord = await persistPipelineRecord({
                patientName,
                consultationType: 'test_text',
                transcription: text,
                medicalHistory: result.data,
                auditId: result.audit_id,
                aiModel: result.model,
                idempotencyKey: textSessionId
            });
            if (QUALITY_TRIAGE_ENABLED && savedRecord?.record_uuid) {
                void upsertConsultationQualitySummary({
                    record_id: savedRecord.record_uuid,
                    quality_score: result.quality_score || 0,
                    critical_gaps_count: result.critical_gaps?.length || 0,
                    corrected_count: result.corrections_applied || 0
                });
            }

            const runStatus = result.pipeline_status || 'completed';
            void enqueueAuditEvent('pipeline_run_update', {
                session_id: textSessionId,
                patient_name: patientName,
                status: runStatus,
                outcome: runStatus,
                metadata: {
                    input_type: 'text',
                    corrections_applied: result.corrections_applied || 0,
                    remaining_errors: result.remaining_errors?.length || 0,
                    result_status: result.result_status || (runStatus === 'completed' ? 'completed' : 'provisional'),
                    pipeline_status: runStatus,
                    provisional_reason: result.provisional_reason || null
                }
            });
            void enqueueAuditEvent('pipeline_attempt', {
                session_id: textSessionId,
                stage: 'text_pipeline',
                attempt_index: 0,
                status: runStatus,
                started_at: new Date(startedAt).toISOString(),
                finished_at: new Date().toISOString(),
                duration_ms: Date.now() - startedAt,
                metadata: {
                    input_type: 'text',
                    transcription_length: text.length,
                    retry_after_ms: result.retry_after_ms || 0
                }
            });

            const qualityGate = buildQualityGateFromHistory({
                medical_history: result.data,
                result_status: result.result_status,
                pipeline_status: result.pipeline_status,
                critical_gaps_count: result.critical_gaps?.length || 0
            });
            recordDiagnosticEvent(diagnosticRunId, { type: 'quality_gate', gate: qualityGate });
            if (result.reconciliation) {
                recordDiagnosticEvent(diagnosticRunId, {
                    type: 'reconciliation',
                    reconciliation: result.reconciliation
                });
            }
            recordDiagnosticEvent(diagnosticRunId, {
                type: 'debug_context',
                debug: {
                    remaining_errors: (result.remaining_errors || []).map((item) => ({
                        type: item.type,
                        field: item.field,
                        reason: item.reason,
                        severity: (item as { severity?: string }).severity
                    })),
                    provisional_reason: result.provisional_reason,
                    quality_score: result.quality_score,
                    pipeline_status: result.pipeline_status,
                    result_status: result.result_status
                }
            });
            const textPipelineStageStatus = (
                qualityGate.required_sections_ok
                && !qualityGate.placeholder_detected
                && (qualityGate.pipeline_status || 'completed') === 'completed'
                && (qualityGate.result_status || 'completed') === 'completed'
            ) ? 'passed' : 'failed';
            const textGateErrorDetail = textPipelineStageStatus === 'failed'
                ? buildDiagnosticErrorDetail(new Error('text_quality_gate_failed'), {
                    stage: 'text_pipeline',
                    provider: 'pipeline',
                    operation: 'text_quality_gate',
                    inputType: 'text',
                    codeOverride: qualityGate.placeholder_detected
                        ? 'placeholder_detected'
                        : (!qualityGate.required_sections_ok ? 'required_sections_missing' : 'pipeline_not_completed'),
                    messageOverride: `text_quality_gate_failed(required_sections_ok=${String(qualityGate.required_sections_ok)}, pipeline_status=${qualityGate.pipeline_status || 'n/a'}, result_status=${qualityGate.result_status || 'n/a'})`,
                    phase: 'quality_gate',
                    origin: 'pipeline_policy',
                    blocking: true,
                    blockingRuleId: qualityGate.blocking_rule_id
                })
                : undefined;
            recordDiagnosticEvent(diagnosticRunId, {
                type: 'stage_end',
                stage: 'text_pipeline',
                status: textPipelineStageStatus,
                error_code: textGateErrorDetail?.code,
                error_message: textGateErrorDetail?.message,
                error_detail: textGateErrorDetail
            });
            const diagnostics = finalizeDiagnosticRun(diagnosticRunId, {
                quality_gate: qualityGate,
                stt_route_policy: 'default'
            });
            await saveLabTestLog({
                test_name: patientName,
                input_type: 'text',
                transcription: text,
                medical_history: result.data,
                metadata: {
                    corrections: result.corrections_applied || 0,
                    models: { generation: result.model, validation: buildValidationLabel(result.validations) },
                    versionsCount: (result.corrections_applied || 0) + 1,
                    errorsFixed: 0,
                    active_memory_used: Boolean(result.active_memory_used),
                    validationHistory: result.validations?.flatMap((v) => v.errors),
                    remainingErrors: result.remaining_errors,
                    diagnostics: toLogDiagnostics(diagnostics)
                }
            });
            setProcessingStatus('Consulta de prueba guardada en Historial');
        } catch (e: any) {
            console.error(e);
            setProcessingStatus('Error procesando texto');
            const textErrorDetail = buildDiagnosticErrorDetail(e, {
                stage: 'text_pipeline',
                provider: 'pipeline',
                operation: 'text_pipeline',
                inputType: 'text',
                codeOverride: normalizeDiagnosticError(e),
                messageOverride: e?.message || 'text_pipeline_failed',
                phase: 'quality_gate',
                origin: 'pipeline_policy',
                blocking: true
            });
            recordDiagnosticEvent(diagnosticRunId, {
                type: 'stage_end',
                stage: 'text_pipeline',
                status: 'failed',
                error_code: textErrorDetail.code,
                error_message: textErrorDetail.message,
                error_detail: textErrorDetail
            });
            recordDiagnosticEvent(diagnosticRunId, {
                type: 'debug_context',
                debug: {
                    remaining_errors: [{
                        type: 'error',
                        field: 'text_pipeline',
                        reason: e?.message || 'text_pipeline_failed'
                    }],
                    provisional_reason: e?.message || 'text_pipeline_failed',
                    pipeline_status: 'failed',
                    result_status: 'failed_recoverable'
                }
            });
            const diagnostics = finalizeDiagnosticRun(diagnosticRunId, {
                quality_gate: {
                    required_sections_ok: false,
                    result_status: 'failed_recoverable',
                    pipeline_status: 'failed',
                    critical_gaps_count: 1
                },
                stt_route_policy: 'default'
            });
            if (diagnostics) {
                await saveLabTestLog({
                    test_name: patientName,
                    input_type: 'text',
                    transcription: text,
                    medical_history: '',
                    metadata: {
                        corrections: 0,
                        models: { generation: 'failed', validation: 'failed' },
                        versionsCount: 0,
                        errorsFixed: 0,
                        active_memory_used: false,
                        diagnostics: toLogDiagnostics(diagnostics)
                    }
                });
            }
            void enqueueAuditEvent('pipeline_run_update', {
                session_id: textSessionId,
                patient_name: patientName,
                status: 'failed',
                outcome: 'failed',
                metadata: {
                    input_type: 'text',
                    reason: e?.message || 'text_pipeline_failed'
                }
            });
            void enqueueAuditEvent('pipeline_attempt', {
                session_id: textSessionId,
                stage: 'text_pipeline',
                attempt_index: 0,
                status: 'failed',
                started_at: new Date(startedAt).toISOString(),
                finished_at: new Date().toISOString(),
                duration_ms: Date.now() - startedAt,
                error_message: e?.message || 'text_pipeline_failed',
                metadata: {
                    input_type: 'text',
                    transcription_length: text.length
                }
            });
        } finally {
            setIsLoading(false);
            MemoryService.setPipelineBusy(false);
        }
    }

    const handleRegenerateSection = async (sectionTitle: string, currentContent: string) => {
        const keys = getApiKeys(apiKey);
        if (!SECTION_REGEN_ENABLED || keys.length === 0 || !transcription.trim()) return currentContent;
        try {
            const aiService = aiServiceRef.current || new AIService(keys);
            aiServiceRef.current = aiService;
            const regenerated = await aiService.regenerateHistorySection(
                transcription,
                currentContent,
                sectionTitle,
                currentPatientName
            );
            return replaceHistorySection(currentContent, sectionTitle, regenerated.data);
        } catch (error) {
            console.error('[App] Section regeneration failed:', error);
            return currentContent;
        }
    };

    const availableApiKeys = getApiKeys(apiKey);
    const canStartConsultation = availableApiKeys.length > 0;
    const startBlockReason = canStartConsultation
        ? ''
        : 'Configura una API key válida para iniciar y asegurar recuperación automática.';

    return (
        <div className="app-container">
            <SimulationOverlay />
            <AnimatePresence>
                {showWelcomeModal && (
                    <OnboardingModal
                        onClose={() => setShowWelcomeModal(false)}
                        onOpenSettings={() => setShowSettings(true)}
                        onNavigate={setCurrentView}
                        onStartDemo={startSimulation}
                    />
                )}
            </AnimatePresence>
            <AnimatePresence>
                {showWhatsNew && (
                    <WhatsNewModal onClose={() => setShowWhatsNew(false)} />
                )}
            </AnimatePresence>

            <Layout
                currentView={currentView}
                onNavigate={setCurrentView}
                onOpenSettings={() => setShowSettings(true)}
                onOpenLessons={() => setShowLessons(true)}
            >
                {/* Floating "Novedades" Pill */}
                <motion.button
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="whats-new-trigger"
                    onClick={() => setShowWhatsNew(true)}
                >
                    <Sparkles size={14} />
                    <span>Novedades: AI v3.0</span>
                </motion.button>
                {currentView === 'record' && (
                    <div className="view-content">
                        <Recorder
                            onRecordingComplete={handleRecordingComplete}
                            onConsultationStart={handleConsultationStart}
                            canStart={canStartConsultation}
                            startBlockReason={startBlockReason}
                        />
                        <PipelineHealthPanel />
                    </div>
                )}

                {currentView === 'history' && (
                    <SearchHistory
                        apiKey={apiKey}
                        onLoadRecord={(record) => {
                            setHistory(record.medical_history);
                            setOriginalHistory(record.original_medical_history || record.medical_history);
                            setTranscription(record.transcription || '');
                            setCurrentPatientName(record.patient_name);
                            setCurrentRecordId(record.record_uuid || null);

                            // Set metadata if relevant, though legacy records might lack it
                            setCurrentView('result');
                        }}
                    />
                )}

                {currentView === 'reports' && (
                    <ReportsView />
                )}

                {currentView === 'result' && (
                    <HistoryView
                        content={history}
                        isLoading={isLoading}
                        patientName={currentPatientName}
                        originalContent={originalHistory}
                        transcription={transcription}
                        apiKey={apiKey}
                        onNewConsultation={() => {
                            if (activeSessionIdRef.current) {
                                void finalizeSession(activeSessionIdRef.current, {
                                    status: 'failed',
                                    result_status: 'failed_recoverable',
                                    error_reason: 'new_consultation_interrupted'
                                });
                            }
                            setHistory('');
                            setOriginalHistory('');
                            setTranscription('');
                            setCurrentPatientName('');
                            setPipelineMetadata(undefined);
                            clearPipelineBuffers();
                            if (orchestratorRef.current) {
                                orchestratorRef.current.abort('new_consultation');
                                orchestratorRef.current = null;
                            }
                            MemoryService.setPipelineBusy(false);
                            aiServiceRef.current = null;
                            activeSessionIdRef.current = null;
                            setCurrentRecordId(null);
                            setCurrentView('record');
                        }}
                        onContentChange={(newContent) => setHistory(newContent)}
                        metadata={pipelineMetadata}
                        recordId={currentRecordId || undefined}
                        onPersistMedicalHistory={persistMedicalHistory}
                        onRegenerateSection={SECTION_REGEN_ENABLED ? handleRegenerateSection : undefined}
                        onGenerateReport={async () => {
                            // Reuse existing report generation logic if possible, or leave handled by HistoryView internal logic if simpler
                            // For now HistoryView handles generation via its own simple standard prompt if prop not fully passed, 
                            // but we can pass a closure to reuse AIService. 
                            const aiService = new AIService(getApiKeys(apiKey));
                            const res = await aiService.generateMedicalReport(transcription, currentPatientName);
                            return res.data;
                        }}
                    />
                )}

                {currentView === 'test-lab' && (
                    <AudioTestLab
                        onClose={() => setCurrentView('record')}
                        onRunFullPipeline={handleRecordingComplete}
                        onRunTextPipeline={handleTextPipeline}
                    />
                )}
                {showSettings && (
                    <Settings
                        apiKey={apiKey}
                        onSave={handleSaveSettings}
                        onClose={() => setShowSettings(false)}
                    />
                )}

                {showLessons && (
                    <LessonsPanel
                        onClose={() => setShowLessons(false)}
                    />
                )}
            </Layout>
        </div >
    );
};

const App = () => {
    return (
        <SimulationProvider>
            <AppContent />
        </SimulationProvider>
    );
};

export default App;
