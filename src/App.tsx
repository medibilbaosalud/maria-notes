
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
const LEARNING_V2_ENABLED = String(import.meta.env.VITE_LEARNING_V2_ENABLED || 'true').toLowerCase() === 'true';
const RULEPACK_APPLY_ENABLED = String(import.meta.env.VITE_RULEPACK_APPLY_ENABLED || 'true').toLowerCase() === 'true';
const RULE_AUTO_PROMOTE_ENABLED = String(import.meta.env.VITE_RULE_AUTO_PROMOTE_ENABLED || 'true').toLowerCase() === 'true';
const QUALITY_TRIAGE_ENABLED = String(import.meta.env.VITE_QUALITY_TRIAGE_ENABLED || 'true').toLowerCase() === 'true';
const SECTION_REGEN_ENABLED = String(import.meta.env.VITE_SECTION_REGEN_ENABLED || 'true').toLowerCase() === 'true';

// Helper to get key array
const getApiKeys = (userKey: string) => {
    const envKeys = (import.meta.env.VITE_GROQ_API_KEYS || import.meta.env.VITE_GROQ_API_KEY || '')
        .split(',')
        .map((value: string) => value.trim())
        .filter(Boolean);

    const merged = [
        ...(userKey ? [userKey.trim()] : []),
        ...envKeys
    ].filter(Boolean);

    return Array.from(new Set(merged));
};

const getInitialApiKey = () => {
    if (typeof window === 'undefined') return GROQ_API_KEY;
    return safeGetLocalStorage('groq_api_key', GROQ_API_KEY);
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

    useEffect(() => {
        currentViewRef.current = currentView;
    }, [currentView]);

    useEffect(() => {
        currentPatientRef.current = currentPatientName;
    }, [currentPatientName]);

    const pickBestClassification = (items: ConsultationClassification[]) => {
        if (!items || items.length === 0) {
            return { visit_type: 'unknown', ent_area: 'unknown', urgency: 'unknown', confidence: 0 };
        }
        return items.reduce((best, current) => {
            const bestScore = best?.confidence ?? 0;
            const currentScore = current?.confidence ?? 0;
            return currentScore > bestScore ? current : best;
        }, items[0]);
    };

    const buildValidationLabel = (validations?: { validator: string }[]) => {
        if (!validations || validations.length === 0) return 'unknown';
        const unique = Array.from(new Set(validations.map(v => v.validator).filter(Boolean)));
        return unique.join(' + ');
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

    const splitBlobForSafeProcessing = async (blob: Blob): Promise<Blob[]> => {
        if (blob.size <= MAX_SAFE_AUDIO_BLOB_BYTES) return [blob];
        try {
            const chunks = await normalizeAndChunkAudio(blob);
            if (chunks.length > 0) return chunks;
        } catch (error) {
            console.warn('[App] normalizeAndChunkAudio failed, falling back to binary split:', error);
        }
        const chunks: Blob[] = [];
        let start = 0;
        while (start < blob.size) {
            const end = Math.min(blob.size, start + MAX_SAFE_AUDIO_BLOB_BYTES);
            chunks.push(blob.slice(start, end, blob.type));
            start = end;
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
        const base = `${normalizedPatient}|${normalizedText.slice(0, 1200)}`;
        let hash = 2166136261;
        for (let i = 0; i < base.length; i++) {
            hash ^= base.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        const minuteBucket = Math.floor(Date.now() / 60_000);
        return `text_${minuteBucket}_${(hash >>> 0).toString(16)}`;
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
        try {
            if (sessionId) {
                await upsertConsultationSession({
                    session_id: sessionId,
                    patient_name: orchestratorRef.current?.getStatus().patientName || '',
                    status: 'extracting',
                    last_batch_index: batchIndex,
                    idempotency_key: sessionId
                });
            }
            await markSegmentStatus({ session_id: sessionId, batch_index: batchIndex, type: 'audio', status: 'processing' });

            const safeBlobs = await splitBlobForSafeProcessing(blob);
            const transcriptParts: string[] = [];
            const extractionParts: ExtractionResult[] = [];
            const metaParts: ExtractionMeta[] = [];
            const classificationParts: ConsultationClassification[] = [];

            for (let i = 0; i < safeBlobs.length; i++) {
                const partBlob = safeBlobs[i];
                const partBatchIndex = safeBlobs.length > 1 ? (batchIndex * 1000) + i : batchIndex;
                const transcriptResult = await aiService.transcribeAudio(partBlob);
                transcriptParts.push(transcriptResult.data);
                await saveSegment({
                    session_id: sessionId,
                    batch_index: partBatchIndex,
                    type: 'transcript',
                    text: transcriptResult.data,
                    status: 'completed'
                });

                const extraction = await aiService.extractOnly(transcriptResult.data);
                const normalizedMeta = prefixExtractionMeta(extraction.meta, partBatchIndex);
                extractionParts.push(extraction.data);
                metaParts.push(...normalizedMeta);
                classificationParts.push(extraction.classification);
                await saveSegment({
                    session_id: sessionId,
                    batch_index: partBatchIndex,
                    type: 'extraction',
                    extraction: extraction.data,
                    classification: extraction.classification,
                    meta: normalizedMeta,
                    status: 'completed'
                });
            }

            const mergedTranscript = transcriptParts.join(' ').trim();
            const mergedExtraction = extractionParts[extractionParts.length - 1] || buildFallbackExtraction(`partial_batch_${batchIndex}_empty`);
            const mergedClassification = classificationParts[classificationParts.length - 1] || { visit_type: 'unknown', ent_area: 'unknown', urgency: 'unknown', confidence: 0 };

            transcriptionPartsRef.current.set(batchIndex, mergedTranscript);
            extractionPartsRef.current.set(batchIndex, mergedExtraction);
            extractionMetaPartsRef.current.set(batchIndex, metaParts);
            classificationPartsRef.current.set(batchIndex, mergedClassification);
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
        setProcessingStatus('Transcribiendo segmento final...');
        await markSegmentStatus({ session_id: sessionId, batch_index: batchIndex, type: 'audio', status: 'processing' });
        const safeFinalBlobs = await splitBlobForSafeProcessing(blob);
        const finalTranscriptParts: string[] = [];
        let finalExtractionResult: ExtractionResult | null = null;
        let finalClassification: ConsultationClassification | null = null;
        const finalMetaParts: ExtractionMeta[] = [];

        for (let i = 0; i < safeFinalBlobs.length; i++) {
            const subBlob = safeFinalBlobs[i];
            const subBatchIndex = safeFinalBlobs.length > 1 ? (batchIndex * 1000) + i : batchIndex;
            const transcriptResult = await aiService.transcribeAudio(subBlob);
            finalTranscriptParts.push(transcriptResult.data);
            await saveSegment({
                session_id: sessionId,
                batch_index: subBatchIndex,
                type: 'transcript',
                text: transcriptResult.data,
                status: 'completed'
            });

            setProcessingStatus('Extrayendo datos clinicos finales...');
            const extracted = await aiService.extractOnly(transcriptResult.data);
            const normalizedFinalMeta = prefixExtractionMeta(extracted.meta, subBatchIndex);
            finalExtractionResult = extracted.data;
            finalClassification = extracted.classification;
            finalMetaParts.push(...normalizedFinalMeta);
            await saveSegment({
                session_id: sessionId,
                batch_index: subBatchIndex,
                type: 'extraction',
                extraction: extracted.data,
                classification: extracted.classification,
                meta: normalizedFinalMeta,
                status: 'completed'
            });
        }

        const mergedFinalTranscript = finalTranscriptParts.join(' ').trim();
        transcriptionPartsRef.current.set(batchIndex, mergedFinalTranscript);
        extractionPartsRef.current.set(batchIndex, finalExtractionResult || buildFallbackExtraction('final_extraction_empty'));
        extractionMetaPartsRef.current.set(batchIndex, finalMetaParts);
        classificationPartsRef.current.set(batchIndex, finalClassification || { visit_type: 'unknown', ent_area: 'unknown', urgency: 'unknown', confidence: 0 });
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
        const orderedExtractions = sortedIndexes
            .map((index) => extractionPartsRef.current.get(index))
            .filter((value): value is ExtractionResult => Boolean(value));
        const orderedMeta = sortedIndexes.flatMap((index) => extractionMetaPartsRef.current.get(index) || []);
        const orderedClassifications = sortedIndexes
            .map((index) => classificationPartsRef.current.get(index))
            .filter((value): value is ConsultationClassification => Boolean(value));

        setProcessingStatus(`Fusionando ${orderedExtractions.length} segmentos y generando historia...`);

        const result = await aiService.generateFromMergedExtractions(
            orderedExtractions,
            fullTranscription,
            patientName,
            orderedMeta,
            pickBestClassification(orderedClassifications),
            sessionId
        );

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
            qualityTriageModel: result.quality_triage_model
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
                    remaining_errors: remainingErrors.length
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
                    transcript_length: fullTranscription.length,
                    retry_after_ms: result.retry_after_ms || 0
                }
            });
        }

        setProcessingStatus('Guardando en base de datos...');
        try {
            const savedRecord = await persistPipelineRecord({
                patientName,
                consultationType: result.classification?.visit_type || 'unknown',
                transcription: fullTranscription,
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
        } catch (saveError) {
            console.error('[App] Error saving record:', saveError);
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
            clearPipelineBuffers();
            setCurrentView('record');
            alert('Error processing audio. See console for details.');
        } finally {
            if (!isPartialBatch) {
                setIsLoading(false);
                MemoryService.setPipelineBusy(false);
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

        try {
            const extraction = await aiService.extractOnly(text);
            const normalizedMeta = prefixExtractionMeta(extraction.meta, 0);
            const result = await aiService.generateFromMergedExtractions(
                [extraction.data],
                text,
                patientName,
                normalizedMeta,
                extraction.classification,
                textSessionId
            );

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
                qualityTriageModel: result.quality_triage_model
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
                    result_status: result.result_status || (runStatus === 'completed' ? 'completed' : 'provisional')
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
                    active_memory_used: Boolean(result.active_memory_used)
                }
            });
            setProcessingStatus('Consulta de prueba guardada en Historial');
        } catch (e: any) {
            console.error(e);
            setProcessingStatus('Error procesando texto');
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
}

const App = () => {
    return (
        <SimulationProvider>
            <AppContent />
        </SimulationProvider>
    );
};

export default App;

