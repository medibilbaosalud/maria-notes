import { handleUpload } from '@vercel/blob/client';

const ACCESS_COOKIE = 'maria_notes_app_access';

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

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'method_not_allowed' });
        return;
    }

    if (isConfigured() && !isAuthorized(req)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }

    try {
        const jsonResponse = await handleUpload({
            token: process.env.BLOB_READ_WRITE_TOKEN,
            request: req,
            body: req.body,
            onBeforeGenerateToken: async (pathname) => {
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
                    allowOverwrite: true
                };
            },
            onUploadCompleted: async () => {
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
