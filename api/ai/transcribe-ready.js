import { getTranscriptionProviderAvailability, writeJson } from '../_lib/aiServer.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        writeJson(res, 405, { error: 'method_not_allowed' });
        return;
    }

    const availability = getTranscriptionProviderAvailability();
    const ready = availability.groq || availability.gemini;
    writeJson(res, ready ? 200 : 503, {
        ready,
        availability,
        error: ready ? undefined : 'server_transcription_provider_unconfigured:missing_groq_api_key,missing_gemini_api_key'
    });
}
