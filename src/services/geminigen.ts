import { saveAiModelInvocation } from './supabase';

export const IMAGEN_4_ULTRA_MODEL = 'imagen-4.0-ultra-generate-001';
export const IMAGEN_4_MODEL = 'imagen-4.0-generate-001';
export const IMAGEN_4_FAST_MODEL = 'imagen-4.0-fast-generate-001';

export const IMAGEN_4_MODEL_PRIORITY = [
    IMAGEN_4_ULTRA_MODEL,
    IMAGEN_4_MODEL,
    IMAGEN_4_FAST_MODEL
] as const;

export interface ImagenGenerationOptions {
    model?: string;
    aspectRatio?: string;
    negativePrompt?: string;
    sampleCount?: number;
    addWatermark?: boolean;
    enhancePrompt?: boolean;
    safetySetting?: 'block_low_and_above' | 'block_medium_and_above' | 'block_only_high';
    personGeneration?: 'allow_adult' | 'dont_allow';
    mimeType?: 'image/png' | 'image/jpeg';
    compressionQuality?: number;
    storageUri?: string;
    specialty?: string;
    clinicianProfile?: string;
    sessionId?: string;
    auditId?: string;
}

export interface ImagenGenerationResult {
    images: string[];
    model: string;
    provider: 'vertex';
    routeKey: string;
    latencyMs: number;
    raw: unknown;
}

type ImagenPrediction = {
    bytesBase64Encoded?: string;
    mimeType?: string;
    imageUri?: string;
    raiFilteredReason?: string;
    safetyAttributes?: Record<string, unknown>;
};

const DEFAULT_LOCATION = import.meta.env.VITE_VERTEX_AI_LOCATION || 'us-central1';
const DEFAULT_PUBLISHER = import.meta.env.VITE_VERTEX_AI_PUBLISHER || 'google';
const DEFAULT_ASPECT_RATIO = '16:9';
const DEFAULT_MIME_TYPE = 'image/png';

const buildDataUrl = (mimeType: string, base64Data: string): string =>
    `data:${mimeType};base64,${base64Data}`;

const normalizeModel = (input?: string): string => {
    const trimmed = String(input || '').trim();
    if (!trimmed) return IMAGEN_4_ULTRA_MODEL;
    if (trimmed === 'imagen-4-ultra') return IMAGEN_4_ULTRA_MODEL;
    if (trimmed === 'imagen-4') return IMAGEN_4_MODEL;
    if (trimmed === 'imagen-4-fast') return IMAGEN_4_FAST_MODEL;
    return trimmed;
};

const shouldDisablePromptEnhancement = (model: string): boolean =>
    model === IMAGEN_4_FAST_MODEL;

const pickResponseImages = (predictions: ImagenPrediction[]): string[] =>
    predictions.flatMap((prediction) => {
        if (prediction.bytesBase64Encoded) {
            return [buildDataUrl(prediction.mimeType || DEFAULT_MIME_TYPE, prediction.bytesBase64Encoded)];
        }
        if (prediction.imageUri) {
            return [prediction.imageUri];
        }
        return [];
    });

export class GeminigenService {
    private projectId: string;
    private location: string;
    private publisher: string;
    private accessToken: string;

    constructor(config?: {
        projectId?: string;
        location?: string;
        publisher?: string;
        accessToken?: string;
    }) {
        this.projectId = config?.projectId || import.meta.env.VITE_VERTEX_AI_PROJECT_ID || '';
        this.location = config?.location || DEFAULT_LOCATION;
        this.publisher = config?.publisher || DEFAULT_PUBLISHER;
        this.accessToken = config?.accessToken || import.meta.env.VITE_VERTEX_AI_ACCESS_TOKEN || '';

        if (!this.projectId || !this.accessToken) {
            console.warn('[GeminigenService] Missing Vertex AI config (VITE_VERTEX_AI_PROJECT_ID / VITE_VERTEX_AI_ACCESS_TOKEN)');
        }
    }

    private getEndpoint(model: string): string {
        return `https://${this.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/locations/${encodeURIComponent(this.location)}/publishers/${encodeURIComponent(this.publisher)}/models/${encodeURIComponent(model)}:predict`;
    }

    async generateImage(
        prompt: string,
        options: ImagenGenerationOptions = {}
    ): Promise<string> {
        const result = await this.generateImageWithMetadata(prompt, options);
        const first = result.images[0];
        if (!first) {
            throw new Error('Imagen response missing generated image');
        }
        return first;
    }

    async generateImageWithMetadata(
        prompt: string,
        options: ImagenGenerationOptions = {}
    ): Promise<ImagenGenerationResult> {
        if (!this.projectId) {
            throw new Error('Vertex AI project id is missing');
        }
        if (!this.accessToken) {
            throw new Error('Vertex AI access token is missing');
        }

        const model = normalizeModel(options.model);
        const startedAt = performance.now();
        const response = await fetch(this.getEndpoint(model), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                instances: [{
                    prompt
                }],
                parameters: {
                    sampleCount: Math.max(1, Math.min(4, Number(options.sampleCount || 1))),
                    aspectRatio: options.aspectRatio || DEFAULT_ASPECT_RATIO,
                    negativePrompt: options.negativePrompt || undefined,
                    addWatermark: options.addWatermark !== false,
                    enhancePrompt: typeof options.enhancePrompt === 'boolean'
                        ? options.enhancePrompt
                        : !shouldDisablePromptEnhancement(model),
                    safetySetting: options.safetySetting || 'block_medium_and_above',
                    personGeneration: options.personGeneration || 'allow_adult',
                    outputOptions: {
                        mimeType: options.mimeType || DEFAULT_MIME_TYPE,
                        compressionQuality: Math.max(0, Math.min(100, Number(options.compressionQuality || 90)))
                    },
                    storageUri: options.storageUri || undefined
                }
            })
        });

        const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            const errorMessage = body?.error?.message || body?.message || `imagen_generation_failed_${response.status}`;
            await saveAiModelInvocation({
                audit_id: options.auditId || null,
                session_id: options.sessionId || null,
                task: 'image_generation',
                phase: 'image_generation',
                provider: 'vertex',
                model,
                route_key: `vertex:${model}`,
                success: false,
                error_type: 'api_error',
                error_code: String(response.status),
                latency_ms: latencyMs,
                specialty: options.specialty || null,
                clinician_profile: options.clinicianProfile || null,
                artifact_type: 'image',
                pipeline_status: 'failed',
                result_status: 'failed',
                response_preview: String(errorMessage).slice(0, 500)
            });
            throw new Error(`Imagen API error: ${response.status} - ${errorMessage}`);
        }

        const predictions = Array.isArray(body?.predictions) ? body.predictions as ImagenPrediction[] : [];
        const images = pickResponseImages(predictions);
        if (images.length === 0) {
            await saveAiModelInvocation({
                audit_id: options.auditId || null,
                session_id: options.sessionId || null,
                task: 'image_generation',
                phase: 'image_generation',
                provider: 'vertex',
                model,
                route_key: `vertex:${model}`,
                success: false,
                error_type: 'empty_response',
                latency_ms: latencyMs,
                specialty: options.specialty || null,
                clinician_profile: options.clinicianProfile || null,
                artifact_type: 'image',
                pipeline_status: 'degraded',
                result_status: 'failed',
                response_preview: JSON.stringify(body).slice(0, 500)
            });
            throw new Error('Imagen response missing generated images');
        }

        await saveAiModelInvocation({
            audit_id: options.auditId || null,
            session_id: options.sessionId || null,
            task: 'image_generation',
            phase: 'image_generation',
            provider: 'vertex',
            model,
            route_key: `vertex:${model}`,
            success: true,
            latency_ms: latencyMs,
            specialty: options.specialty || null,
            clinician_profile: options.clinicianProfile || null,
            artifact_type: 'image',
            pipeline_status: 'completed',
            result_status: 'completed',
            response_preview: images[0]?.slice(0, 500) || null
        });

        return {
            images,
            model,
            provider: 'vertex',
            routeKey: `vertex:${model}`,
            latencyMs,
            raw: body
        };
    }
}
