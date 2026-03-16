import { handleUpload } from '@vercel/blob/client';

const ACCESS_COOKIE = 'maria_notes_app_access';
const BLOB_EVENT_GENERATE = 'blob.generate-client-token';
const BLOB_EVENT_COMPLETED = 'blob.upload-completed';

const readCookie = (req, name) => {
    const raw = String(req.headers.cookie || '');
    const parts = raw.split(';').map((value) => value.trim()).filter(Boolean);
    for (const part of parts) {
        const [key, ...rest] = part.split('=');
        if (key === name) return decodeURIComponent(rest.join('='));
    }
    return null;
};

const isConfigured = () => String(process.env.APP_ACCESS_PASSWORD || '').trim().length > 0;
const isAuthorized = (req) => readCookie(req, ACCESS_COOKIE) === 'granted';
const parseBody = (body) => {
    if (body && typeof body === 'object') return body;
    if (typeof body === 'string') {
        try {
            return JSON.parse(body);
        } catch {
            return null;
        }
    }
    return null;
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'method_not_allowed' });
        return;
    }

    const body = parseBody(req.body);
    const eventType = String(body?.type || '');

    if (!body) {
        res.status(400).json({ error: 'invalid_body' });
        return;
    }

    // The Vercel Blob completion callback does not come from the interactive
    // browser session and therefore does not carry our access cookie. We gate
    // only token generation requests and let handleUpload verify signed
    // completion callbacks.
    if (eventType === BLOB_EVENT_GENERATE && isConfigured() && !isAuthorized(req)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }

    try {
        console.info('[blob/upload] event received', {
            type: eventType || 'unknown',
            pathname: body?.payload?.pathname || null,
            multipart: body?.payload?.multipart ?? null,
            hasSignature: Boolean(req.headers['x-vercel-signature'])
        });

        const jsonResponse = await handleUpload({
            token: process.env.BLOB_READ_WRITE_TOKEN,
            request: req,
            body,
            onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
                if (!/^clinical-audio\/[a-z0-9/_-]+\.(wav|webm|ogg|mp3|m4a|mp4|mpeg|mpga|flac)$/i.test(pathname)) {
                    throw new Error('invalid_audio_pathname');
                }

                return {
                    allowedContentTypes: [
                        'audio/wav',
                        'audio/x-wav',
                        'audio/webm',
                        'audio/ogg',
                        'audio/mpeg',
                        'audio/mp3',
                        'audio/mp4',
                        'audio/m4a',
                        'audio/flac'
                    ],
                    maximumSizeInBytes: 25 * 1024 * 1024,
                    validUntil: Date.now() + (15 * 60 * 1000),
                    addRandomSuffix: false,
                    allowOverwrite: true,
                    tokenPayload: clientPayload,
                    callbackUrl: process.env.VERCEL_BLOB_CALLBACK_URL
                };
            },
            onUploadCompleted: async (payload) => {
                console.info('[blob/upload] upload completed', {
                    pathname: payload?.blob?.pathname || null,
                    size: payload?.blob?.size || null,
                    uploadedAt: payload?.blob?.uploadedAt || null
                });
                return;
            }
        });

        res.status(200).json(jsonResponse);
    } catch (error) {
        console.error('[blob/upload] failed:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'blob_upload_failed'
        });
    }
}
