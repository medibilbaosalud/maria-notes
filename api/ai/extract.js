import { extractMedicalDataPayload, getJsonBody, writeJson } from '../_lib/aiServer.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'method_not_allowed' });
        return;
    }

    try {
        const body = getJsonBody(req);
        const payload = await extractMedicalDataPayload(body);
        writeJson(res, 200, payload);
    } catch (error) {
        writeJson(res, 500, { error: error instanceof Error ? error.message : 'extract_failed' });
    }
}
