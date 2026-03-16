import crypto from 'node:crypto';

const ACCESS_COOKIE = 'maria_notes_app_access';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;

const readCookie = (req, name) => {
    const raw = String(req.headers.cookie || '');
    const parts = raw.split(';').map((value) => value.trim()).filter(Boolean);
    for (const part of parts) {
        const [key, ...rest] = part.split('=');
        if (key === name) return decodeURIComponent(rest.join('='));
    }
    return null;
};

const writeJson = (res, status, payload, headers = {}) => {
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
    res.status(status).json(payload);
};

const getBody = (req) => {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string' && req.body.trim()) {
        try {
            return JSON.parse(req.body);
        } catch {
            return {};
        }
    }
    return {};
};

const buildAccessCookie = (unlocked) => {
    const parts = [
        `${ACCESS_COOKIE}=${unlocked ? 'granted' : 'revoked'}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax'
    ];
    if (process.env.NODE_ENV === 'production') {
        parts.push('Secure');
    }
    if (unlocked) {
        parts.push(`Max-Age=${COOKIE_MAX_AGE_SECONDS}`);
    } else {
        parts.push('Max-Age=0');
    }
    return parts.join('; ');
};

const isConfigured = () => String(process.env.APP_ACCESS_PASSWORD || '').trim().length > 0;

const isAuthorized = (req) => readCookie(req, ACCESS_COOKIE) === 'granted';

const isPasswordValid = (candidate) => {
    const expected = String(process.env.APP_ACCESS_PASSWORD || '');
    const actual = String(candidate || '');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(actual, 'utf8');
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

export default async function handler(req, res) {
    if (req.method === 'GET') {
        writeJson(res, 200, {
            required: isConfigured(),
            unlocked: !isConfigured() || isAuthorized(req)
        });
        return;
    }

    if (req.method === 'DELETE') {
        writeJson(
            res,
            200,
            { ok: true, unlocked: false },
            { 'Set-Cookie': buildAccessCookie(false) }
        );
        return;
    }

    if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'method_not_allowed' });
        return;
    }

    if (!isConfigured()) {
        writeJson(res, 200, { ok: true, unlocked: true });
        return;
    }

    const body = getBody(req);
    if (!isPasswordValid(body.password)) {
        writeJson(res, 401, { error: 'invalid_password' });
        return;
    }

    writeJson(
        res,
        200,
        { ok: true, unlocked: true },
        { 'Set-Cookie': buildAccessCookie(true) }
    );
}
