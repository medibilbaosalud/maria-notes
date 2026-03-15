import { randomUUID } from 'node:crypto';

const GROQ_API_URL = 'https://api.groq.com/openai/v1';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || 'llama-3.3-70b-versatile';
const GROQ_TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo';
const GEMINI_TEXT_MODEL = normalizeGeminiModelId(process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-preview');
const GEMINI_TRANSCRIBE_MODEL = normalizeGeminiModelId(process.env.GEMINI_TRANSCRIBE_MODEL || process.env.GEMINI_MODEL || GEMINI_TEXT_MODEL);

const ORL_STYLE_PROFILE = `ESTILO ORL TELEGRAFICO (OBLIGATORIO)
- Tono clinico, breve y directo.
- Evita narrativa larga o explicaciones ornamentales.
- Exploracion/pruebas con etiquetas cortas tipo "ETIQUETA: hallazgo".
- Plan en acciones breves y operativas.
- No inventes datos ni expandas mas alla de la transcripcion.`;

const PSYCHOLOGY_STYLE_PROFILE = `ESTILO PSICOLOGIA CLINICA (OBLIGATORIO)
- Tono profesional, sobrio y centrado en la utilidad clinica.
- Resume con claridad, sin lenguaje dramatizante ni excesivamente literario.
- Prioriza motivo de consulta, contexto relevante, sintomas, observaciones clinicas, impresion y plan.
- Diferencia claramente hechos referidos por la paciente, observacion clinica e impresion profesional.
- No inventes riesgos, antecedentes, pruebas ni diagnosticos no mencionados.
- Si no consta un dato importante, dejalo explicito como "No consta".`;

const PSYCHOLOGY_AINHOA_STYLE_PROFILE = `ESTILO PROFESIONAL DE AINHOA (OBLIGATORIO EN PSICOLOGIA)
- La escritura debe sonar a nota clinica real de psicologia en consulta ambulatoria, no a texto academico ni a resumen de IA.
- "MOTIVO DE CONSULTA" debe ser breve y directo.
- En "ANTECEDENTES RELEVANTES" incluye primero el contexto vital funcional si aparece en la transcripcion: edad, lugar de residencia, convivencia, estudios o trabajo, red familiar y datos de contexto que ayuden a entender el caso.
- En "SINTOMATOLOGIA ACTUAL" prioriza el problema actual, su inicio, frecuencia, duracion, intensidad, desencadenantes, factores que aumentan o disminuyen, e impacto en su funcionamiento.
- Cuando existan frases literales del/la paciente que aporten valor clinico, pueden incluirse de forma breve entre comillas.
- En "OBSERVACIONES CLINICAS" integra recursos, apoyos, rutina diaria, hobbies, factores protectores, areas afectadas, antecedentes relevantes y cualquier informacion clinicamente util, siempre sin inventar.
- En "IMPRESION CLINICA" mantente prudente: formula comprensiones clinicas o focos de trabajo, pero no diagnostiques si no consta.
- En "PLAN TERAPEUTICO" redacta con estilo de consulta real. Si en la transcripcion aparecen tareas para casa u objetivos terapeuticos, integrarlos aqui con etiquetas internas como "Tareas para casa:" y "Objetivos terapeuticos:" dentro del cuerpo de la seccion, sin crear encabezados Markdown nuevos.
- No uses lenguaje grandilocuente, juridico ni excesivamente tecnico.
- No conviertas toda la historia en listas; mezcla frases y parrafos breves con listados solo cuando ayuden a la claridad.
- No moralices ni interpretes mas alla de la evidencia disponible.`;

const PSYCHOLOGY_AINHOA_STYLE_EXAMPLES = `EJEMPLOS DE FORMA (NO REUTILIZAR CONTENIDO NI DATOS)
1) Motivo de consulta breve. Despues, en situacion actual, se abre con edad, convivencia, estudios o trabajo y red de apoyo. A continuacion se describe el problema actual con cronologia, sintomas, impacto en su dia a dia, apoyos, hobbies y factores protectores.
2) Si hay ansiedad, se especifica cuando comenzo, en que momentos ocurre, su frecuencia, duracion, sintomas fisicos, anticipacion o alerta, y como interfiere en su descanso, alimentacion, concentracion o actividad.
3) Si hay conflicto relacional o familiar, se explica de forma clara quien interviene, que secuencia de hechos refiere la paciente y que emocion o malestar actual genera, sin convertirlo en relato literario.
4) Si hay autolesiones, ideacion o antecedentes graves, se registra con sobriedad, literalidad clinica y foco en frecuencia, funciones de la conducta, desencadenantes, factores protectores e impacto funcional.
5) Si aparecen objetivos terapeuticos o tareas, se recogen al final dentro del plan con frases claras, utiles y realistas para seguimiento.`;

const normalizeConsultationType = (value) => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    if (normalized.includes('psic')) return 'psicologia';
    return 'otorrino';
};

const getSpecialtyConfig = (value) => {
    const specialty = normalizeConsultationType(value);
    if (specialty === 'psicologia') {
        return {
            specialty,
            styleProfile: PSYCHOLOGY_STYLE_PROFILE,
            requiredSections: [
                '## MOTIVO DE CONSULTA',
                '## ANTECEDENTES RELEVANTES',
                '## SINTOMATOLOGIA ACTUAL',
                '## OBSERVACIONES CLINICAS',
                '## IMPRESION CLINICA',
                '## PLAN TERAPEUTICO'
            ],
            reportLabel: 'psicologico',
            classificationHint: `{
  "visit_type": "first_visit|follow_up|therapy_session|assessment|crisis|unknown",
  "clinical_area": "psicologia|ansiedad|estado_de_animo|trauma|relacional|mixto|unknown",
  "urgency": "routine|preferente|urgent|unknown",
  "confidence": 0.0
}`,
            historyTemplate: `## MOTIVO DE CONSULTA
...

## ANTECEDENTES RELEVANTES
...

## SINTOMATOLOGIA ACTUAL
...

## OBSERVACIONES CLINICAS
...

## IMPRESION CLINICA
...

## PLAN TERAPEUTICO
...`,
            provisionalHistory: (reason) => `## MOTIVO DE CONSULTA
No consta (procesamiento aplazado)

## ANTECEDENTES RELEVANTES
No consta

## SINTOMATOLOGIA ACTUAL
No consta

## OBSERVACIONES CLINICAS
No consta

## IMPRESION CLINICA
No consta

## PLAN TERAPEUTICO
Reintentar procesamiento automatico. Motivo tecnico: ${reason}`
        };
    }

    return {
        specialty,
        styleProfile: ORL_STYLE_PROFILE,
        requiredSections: [
            '## MOTIVO DE CONSULTA',
            '## ANTECEDENTES',
            '## ENFERMEDAD ACTUAL',
            '## EXPLORACION / PRUEBAS',
            '## DIAGNOSTICO',
            '## PLAN'
        ],
        reportLabel: 'medico ORL',
        classificationHint: CLASSIFICATION_SCHEMA_HINT,
        historyTemplate: `## MOTIVO DE CONSULTA
...

## ANTECEDENTES
- Alergias: ...
- Enfermedades cronicas: ...
- Cirugias: ...
- Tratamiento habitual: ...

## ENFERMEDAD ACTUAL
- Sintomas: ...
- Evolucion: ...

## EXPLORACION / PRUEBAS
...

## DIAGNOSTICO
...

## PLAN
...`,
        provisionalHistory: (reason) => `## MOTIVO DE CONSULTA
No consta (procesamiento aplazado)

## ANTECEDENTES
- Alergias: No consta
- Enfermedades cronicas: No consta
- Cirugias: No consta
- Tratamiento habitual: No consta

## ENFERMEDAD ACTUAL
- Sintomas: No consta
- Evolucion: No consta

## EXPLORACION / PRUEBAS
No consta

## DIAGNOSTICO
No consta

## PLAN
Reintentar procesamiento automatico. Motivo tecnico: ${reason}`
    };
};

const ORL_HISTORY_SCHEMA_HINT = `{
  "history_markdown": "## MOTIVO DE CONSULTA\\n...",
  "extraction": {
    "antecedentes": {
      "alergias": [],
      "enfermedades_cronicas": [],
      "cirugias": [],
      "tratamiento_habitual": []
    },
    "enfermedad_actual": {
      "motivo_consulta": "",
      "sintomas": [],
      "evolucion": null
    },
    "exploraciones_realizadas": {},
    "diagnostico": [],
    "plan": "",
    "notas_calidad": []
  },
  "classification": {
    "visit_type": "string",
    "clinical_area": "string",
    "urgency": "string",
    "confidence": 0.0
  },
  "quality_notes": [
    { "type": "missing|inconsistency|ambiguity", "field": "string", "reason": "string", "severity": "low|medium|high" }
  ],
  "uncertainty_flags": [
    { "field_path": "string", "reason": "string", "severity": "low|medium|high", "value": "string" }
  ]
}`;

const PSYCHOLOGY_HISTORY_SCHEMA_HINT = `{
  "history_markdown": "## MOTIVO DE CONSULTA\\n...",
  "extraction": {
    "antecedentes_relevantes": [],
    "sintomatologia_actual": {
      "motivo_consulta": "",
      "sintomas_principales": [],
      "factores_desencadenantes": [],
      "duracion": null,
      "impacto_funcional": null
    },
    "observaciones_clinicas": {
      "estado_mental": [],
      "conducta_observada": [],
      "factores_riesgo": [],
      "factores_protectores": []
    },
    "impresion_clinica": [],
    "plan_terapeutico": [],
    "notas_calidad": []
  },
  "classification": {
    "visit_type": "string",
    "clinical_area": "string",
    "urgency": "string",
    "confidence": 0.0
  },
  "quality_notes": [
    { "type": "missing|inconsistency|ambiguity", "field": "string", "reason": "string", "severity": "low|medium|high" }
  ],
  "uncertainty_flags": [
    { "field_path": "string", "reason": "string", "severity": "low|medium|high", "value": "string" }
  ]
}`;

const ORL_EXTRACTION_SCHEMA_HINT = `{
  "antecedentes": {
    "alergias": [],
    "enfermedades_cronicas": [],
    "cirugias": [],
    "tratamiento_habitual": []
  },
  "enfermedad_actual": {
    "motivo_consulta": "",
    "sintomas": [],
    "evolucion": null
  },
  "exploraciones_realizadas": {},
  "diagnostico": [],
  "plan": "",
  "notas_calidad": []
}`;

const PSYCHOLOGY_EXTRACTION_SCHEMA_HINT = `{
  "antecedentes_relevantes": [],
  "sintomatologia_actual": {
    "motivo_consulta": "",
    "sintomas_principales": [],
    "factores_desencadenantes": [],
    "duracion": null,
    "impacto_funcional": null
  },
  "observaciones_clinicas": {
    "estado_mental": [],
    "conducta_observada": [],
    "factores_riesgo": [],
    "factores_protectores": []
  },
  "impresion_clinica": [],
  "plan_terapeutico": [],
  "notas_calidad": []
}`;

const CLASSIFICATION_SCHEMA_HINT = `{
  "visit_type": "first_visit|follow_up|procedure|urgent|unknown",
  "clinical_area": "ear|nose|throat|larynx|vestibular|mixed|unknown",
  "urgency": "routine|preferente|urgent|unknown",
  "confidence": 0.0
}`;

const buildHistorySchemaHint = (consultationType) =>
    normalizeConsultationType(consultationType) === 'psicologia'
        ? PSYCHOLOGY_HISTORY_SCHEMA_HINT
        : ORL_HISTORY_SCHEMA_HINT;

const buildExtractionSchemaHint = (consultationType) =>
    normalizeConsultationType(consultationType) === 'psicologia'
        ? PSYCHOLOGY_EXTRACTION_SCHEMA_HINT
        : ORL_EXTRACTION_SCHEMA_HINT;

function normalizeGeminiModelId(modelName) {
    const trimmed = String(modelName || '').trim().replace(/^models\//, '');
    if (!trimmed) return 'gemini-3-flash-preview';
    if (trimmed === 'gemini-3-flash') return 'gemini-3-flash-preview';
    if (trimmed === 'gemini-flash-latest') return 'gemini-3-flash-preview';
    return trimmed;
}

const getApiKey = () => {
    const key = String(process.env.GROQ_API_KEY || '').trim();
    if (!key) {
        throw new Error('server_groq_api_key_missing');
    }
    return key;
};

const getGeminiApiKey = () => {
    const key = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    if (!key) {
        throw new Error('server_gemini_api_key_missing');
    }
    return key;
};

const getJsonBody = (req) => {
    if (typeof req.body === 'string') {
        return req.body ? JSON.parse(req.body) : {};
    }
    return req.body || {};
};

const writeJson = (res, statusCode, payload) => {
    res.status(statusCode).setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(payload));
};

const parseModelText = async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = body?.error?.message || body?.message || `provider_error_${response.status}`;
        throw new Error(message);
    }
    const content = body?.choices?.[0]?.message?.content || '';
    const model = body?.model || `groq:${GROQ_CHAT_MODEL}`;
    return { text: content, model: model.startsWith('groq:') ? model : `groq:${model}` };
};

const buildThoughtSummary = (parts) => {
    if (!Array.isArray(parts)) return undefined;
    const thoughtTexts = parts
        .filter((part) => Boolean(part?.thought))
        .map((part) => typeof part?.text === 'string' ? part.text.trim() : '')
        .filter(Boolean);
    if (thoughtTexts.length === 0) return undefined;
    return thoughtTexts.join('\n').slice(0, 4000);
};

const extractThoughtSignature = (parts) => {
    if (!Array.isArray(parts)) return undefined;
    const partWithSignature = parts.find((part) => typeof part?.thoughtSignature === 'string' && part.thoughtSignature.trim());
    return typeof partWithSignature?.thoughtSignature === 'string'
        ? partWithSignature.thoughtSignature.trim()
        : undefined;
};

const parseGeminiText = async (response, modelName) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = body?.error?.message || body?.message || `gemini_provider_error_${response.status}`;
        throw new Error(message);
    }

    const promptFeedback = body?.promptFeedback;
    const blockedReason = promptFeedback?.blockReason || body?.candidates?.[0]?.finishReason;
    if (blockedReason && blockedReason !== 'STOP' && blockedReason !== 'MAX_TOKENS') {
        throw new Error(`gemini_blocked:${blockedReason}`);
    }

    const parts = body?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
        ? parts
            .filter((part) => !part?.thought)
            .map((part) => typeof part?.text === 'string' ? part.text : '')
            .join('')
            .trim()
        : '';
    if (!text) {
        throw new Error('gemini_empty_response');
    }
    return {
        text,
        model: `gemini:${normalizeGeminiModelId(body?.modelVersion || modelName)}`,
        thought_summary: buildThoughtSummary(parts),
        thought_signature: extractThoughtSignature(parts)
    };
};

const callGroqChat = async ({ prompt, jsonMode = false, temperature = 0.1, maxTokens = 2600 }) => {
    const response = await fetch(`${GROQ_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getApiKey()}`
        },
        body: JSON.stringify({
            model: GROQ_CHAT_MODEL,
            temperature,
            max_tokens: maxTokens,
            response_format: jsonMode ? { type: 'json_object' } : undefined,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ]
        })
    });
    return parseModelText(response);
};

const callGeminiText = async ({
    prompt,
    jsonMode = false,
    temperature = 0.1,
    maxTokens = 2600,
    modelName = GEMINI_TEXT_MODEL,
    inlineParts,
    includeThoughts = false
}) => {
    const resolvedModelName = normalizeGeminiModelId(modelName);
    const contents = [{
        role: 'user',
        parts: Array.isArray(inlineParts) && inlineParts.length > 0 ? inlineParts : [{ text: prompt }]
    }];

    const response = await fetch(
        `${GEMINI_API_URL}/models/${encodeURIComponent(resolvedModelName)}:generateContent?key=${encodeURIComponent(getGeminiApiKey())}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents,
                generationConfig: {
                    temperature,
                    maxOutputTokens: maxTokens,
                    responseMimeType: jsonMode ? 'application/json' : 'text/plain',
                    thinkingConfig: includeThoughts
                        ? {
                            includeThoughts: true
                        }
                        : undefined
                }
            })
        }
    );
    return parseGeminiText(response, resolvedModelName);
};

const callPreferredTextModel = async (options) => {
    let geminiError;
    let geminiAttempted = false;

    try {
        geminiAttempted = true;
        const result = await callGeminiText(options);
        return {
            ...result,
            gemini_attempted: true,
            gemini_success: true,
            fallback_hops: 0
        };
    } catch (error) {
        geminiError = error;
    }

    const groqResult = await callGroqChat(options);
    return {
        ...groqResult,
        gemini_attempted: geminiAttempted,
        gemini_success: false,
        fallback_hops: geminiAttempted ? 1 : 0,
        fallback_reason: geminiError instanceof Error ? geminiError.message : 'gemini_failed'
    };
};

const callPreferredTranscriptionModel = async ({ audioBase64, mimeType }) => {
    const normalizedMimeType = String(mimeType || 'audio/wav').trim() || 'audio/wav';
    let geminiError;

    try {
        const result = await callGeminiText({
            prompt: '',
            jsonMode: false,
            temperature: 0,
            maxTokens: 8192,
            modelName: GEMINI_TRANSCRIBE_MODEL,
            inlineParts: [
                {
                    text: 'Transcribe este audio medico en espanol. Devuelve solo la transcripcion literal, sin resumen, sin markdown y sin comentarios adicionales.'
                },
                {
                    inlineData: {
                        mimeType: normalizedMimeType,
                        data: String(audioBase64 || '')
                    }
                }
            ]
        });

        return {
            text: result.text.trim(),
            model: result.model,
            gemini_attempted: true,
            gemini_success: true,
            fallback_hops: 0
        };
    } catch (error) {
        geminiError = error;
    }

    const bytes = Buffer.from(String(audioBase64 || ''), 'base64');
    const file = new Blob([bytes], { type: normalizedMimeType });
    const formData = new FormData();
    formData.append('file', file, 'audio.wav');
    formData.append('model', GROQ_TRANSCRIBE_MODEL);

    const response = await fetch(`${GROQ_API_URL}/audio/transcriptions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getApiKey()}`
        },
        body: formData
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = body?.error?.message || body?.message || `transcription_failed_${response.status}`;
        throw new Error(message);
    }
    return {
        text: String(body?.text || ''),
        model: `groq:${body?.model || GROQ_TRANSCRIBE_MODEL}`,
        gemini_attempted: true,
        gemini_success: false,
        fallback_hops: 1,
        fallback_reason: geminiError instanceof Error ? geminiError.message : 'gemini_transcription_failed'
    };
};

const parseJsonWithFallback = (text, fallbackFactory) => {
    try {
        return JSON.parse(text);
    } catch {
        return fallbackFactory();
    }
};

const normalizeStringArray = (value) => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
};

const normalizeExtraction = (value, consultationType) => {
    const raw = value && typeof value === 'object' ? value : {};
    const antecedentes = raw.antecedentes && typeof raw.antecedentes === 'object' ? raw.antecedentes : {};
    const enfermedadActual = raw.enfermedad_actual && typeof raw.enfermedad_actual === 'object' ? raw.enfermedad_actual : {};
    const exploraciones = raw.exploraciones_realizadas && typeof raw.exploraciones_realizadas === 'object' ? raw.exploraciones_realizadas : {};
    const notasCalidad = Array.isArray(raw.notas_calidad) ? raw.notas_calidad : [];
    const specialty = normalizeConsultationType(consultationType);

    const normalized = {
        antecedentes: {
            alergias: normalizeStringArray(antecedentes.alergias),
            enfermedades_cronicas: normalizeStringArray(antecedentes.enfermedades_cronicas),
            cirugias: normalizeStringArray(antecedentes.cirugias),
            tratamiento_habitual: normalizeStringArray(antecedentes.tratamiento_habitual)
        },
        enfermedad_actual: {
            motivo_consulta: String(enfermedadActual.motivo_consulta || 'No consta').trim() || 'No consta',
            sintomas: normalizeStringArray(enfermedadActual.sintomas),
            evolucion: enfermedadActual.evolucion == null ? null : String(enfermedadActual.evolucion || '').trim()
        },
        exploraciones_realizadas: Object.fromEntries(
            Object.entries(exploraciones).map(([key, currentValue]) => [key, currentValue == null ? null : String(currentValue || '').trim()])
        ),
        diagnostico: normalizeStringArray(raw.diagnostico),
        plan: raw.plan == null ? null : String(raw.plan || '').trim(),
        notas_calidad: notasCalidad
            .map((entry) => ({
                tipo: entry?.tipo === 'INAUDIBLE' ? 'INAUDIBLE' : 'AMBIGUO',
                seccion: String(entry?.seccion || 'transcripcion'),
                descripcion: String(entry?.descripcion || 'Sin detalle')
            }))
    };

    if (specialty !== 'psicologia') {
        return normalized;
    }

    const sintomatologiaActual = raw.sintomatologia_actual && typeof raw.sintomatologia_actual === 'object' ? raw.sintomatologia_actual : {};
    const observacionesClinicas = raw.observaciones_clinicas && typeof raw.observaciones_clinicas === 'object' ? raw.observaciones_clinicas : {};

    return {
        ...normalized,
        enfermedad_actual: {
            motivo_consulta: String(
                sintomatologiaActual.motivo_consulta
                || enfermedadActual.motivo_consulta
                || 'No consta'
            ).trim() || 'No consta',
            sintomas: normalizeStringArray(
                sintomatologiaActual.sintomas_principales
                || enfermedadActual.sintomas
            ),
            evolucion: sintomatologiaActual.duracion == null
                ? normalized.enfermedad_actual.evolucion
                : String(sintomatologiaActual.duracion || '').trim()
        },
        diagnostico: normalizeStringArray(raw.impresion_clinica || raw.diagnostico),
        plan: raw.plan_terapeutico == null
            ? normalized.plan
            : (normalizeStringArray(raw.plan_terapeutico).join('; ') || null),
        psychology_context: {
            antecedentes_relevantes: normalizeStringArray(raw.antecedentes_relevantes),
            sintomas_principales: normalizeStringArray(sintomatologiaActual.sintomas_principales || enfermedadActual.sintomas),
            factores_desencadenantes: normalizeStringArray(sintomatologiaActual.factores_desencadenantes),
            impacto_funcional: sintomatologiaActual.impacto_funcional == null ? null : String(sintomatologiaActual.impacto_funcional || '').trim(),
            observaciones_clinicas: [
                ...normalizeStringArray(observacionesClinicas.estado_mental),
                ...normalizeStringArray(observacionesClinicas.conducta_observada)
            ],
            impresion_clinica: normalizeStringArray(raw.impresion_clinica),
            plan_terapeutico: normalizeStringArray(raw.plan_terapeutico),
            factores_riesgo: normalizeStringArray(observacionesClinicas.factores_riesgo),
            factores_protectores: normalizeStringArray(observacionesClinicas.factores_protectores)
        }
    };
};

const normalizeClassification = (value) => {
    const raw = value && typeof value === 'object' ? value : {};
    const confidence = Number(raw.confidence);
    const clinicalArea = String(raw.clinical_area || raw.ent_area || 'unknown');
    return {
        visit_type: String(raw.visit_type || 'unknown'),
        ent_area: clinicalArea,
        clinical_area: clinicalArea,
        urgency: String(raw.urgency || 'unknown'),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5
    };
};

const normalizeQualityNotes = (value) => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => ({
            type: String(entry?.type || 'ambiguity').trim() || 'ambiguity',
            field: String(entry?.field || 'unknown').trim() || 'unknown',
            reason: String(entry?.reason || 'Sin detalle').trim() || 'Sin detalle',
            severity: entry?.severity === 'high'
                ? 'high'
                : (entry?.severity === 'medium' ? 'medium' : 'low')
        }))
        .filter((entry) => entry.reason);
};

const sanitizeClinicalHistory = (rawHistory, consultationType) => {
    if (!rawHistory) return rawHistory;
    const allowedSections = new Set(
        getSpecialtyConfig(consultationType).requiredSections
            .map((section) => section.replace(/^##\s+/, ''))
            .map((section) => section.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase())
    );
    const forbiddenMatchers = [
        /^CLASIFICACION\s*\(/i,
        /^RULEPACK:/i,
        /^REGLAS DE APRENDIZAJE:/i
    ];
    const stripTail = (body) => {
        const lines = String(body || '').split(/\r?\n/);
        const cutoff = lines.findIndex((line) => {
            const trimmed = line.trim();
            return trimmed && forbiddenMatchers.some((matcher) => matcher.test(trimmed));
        });
        return (cutoff >= 0 ? lines.slice(0, cutoff) : lines).join('\n').trim();
    };
    const matches = Array.from(String(rawHistory).matchAll(/^##\s+(.+)$/gm));
    if (matches.length === 0) return stripTail(String(rawHistory).trim());

    const chunks = [];
    for (let i = 0; i < matches.length; i += 1) {
        const current = matches[i];
        const title = String(current[1] || '').trim();
        const normalized = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
        if (!allowedSections.has(normalized)) continue;
        const start = (current.index || 0) + current[0].length;
        const end = i + 1 < matches.length ? (matches[i + 1].index || String(rawHistory).length) : String(rawHistory).length;
        const body = stripTail(String(rawHistory).slice(start, end).trim());
        chunks.push(`## ${title}\n${body || 'No consta'}`);
    }
    return chunks.length > 0 ? chunks.join('\n\n').trim() : stripTail(String(rawHistory).trim());
};

const buildValidationIssues = (history, extraction, consultationType) => {
    const issues = [];
    const normalized = String(history || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
    const specialtyConfig = getSpecialtyConfig(consultationType);
    const requiredSections = specialtyConfig.requiredSections;

    requiredSections.forEach((section) => {
        if (!normalized.includes(section)) {
            issues.push({
                type: 'missing',
                field: section.replace('## ', '').toLowerCase(),
                reason: `Falta seccion obligatoria: ${section}`,
                severity: (
                    section.includes('DIAGNOSTICO')
                    || section.includes('PLAN')
                    || section.includes('IMPRESION')
                    || section.includes('PLAN TERAPEUTICO')
                ) ? 'critical' : 'major'
            });
        }
    });

    if (/\{[^}]+\}/.test(String(history || ''))) {
        issues.push({
            type: 'inconsistency',
            field: 'template',
            reason: 'Hay placeholders sin resolver en la historia final',
            severity: 'critical'
        });
    }

    const qualityNotes = extraction?.notas_calidad || [];
    qualityNotes.forEach((note) => {
        if (note.tipo === 'INAUDIBLE' || note.tipo === 'AMBIGUO') {
            issues.push({
                type: 'missing',
                field: note.seccion || 'transcripcion',
                reason: `[${note.tipo}] ${note.descripcion}`,
                severity: note.tipo === 'INAUDIBLE' ? 'major' : 'minor'
            });
        }
    });

    return issues;
};

const computeRiskLevel = (errors) => {
    if (!errors.length) return 'low';
    const hasCritical = errors.some((error) => error.severity === 'critical');
    if (hasCritical) return 'high';
    return errors.length >= 3 ? 'medium' : 'low';
};

const formatLearningPromptContext = (learningContext) => {
    if (!learningContext || !String(learningContext.promptContext || '').trim()) return '';
    return `REGLAS DE APRENDIZAJE DEL PROFESIONAL (APLICAR SOLO SI NO CONTRADICEN LA TRANSCRIPCION):
${String(learningContext.promptContext).slice(0, 4000)}

No cites estas reglas en la salida. No inventes datos para cumplirlas.`;
};

const buildGenerateHistoryPrompt = (transcription, patientName, consultationType, learningContext) => {
    const specialty = getSpecialtyConfig(consultationType);
    const specialtyRole = specialty.specialty === 'psicologia' ? 'psicologia clinica' : 'otorrinolaringologia';
    return `Eres un asistente clinico experto en ${specialtyRole}. Responde SOLO JSON valido.
Objetivo: generar historia clinica final y extraccion estructurada en una sola respuesta.
Reglas:
- Usa SOLO la transcripcion, no inventes datos.
- Si falta un dato, usa "No consta" en la historia y null/[]/"" en extraccion segun corresponda.
- Respeta negaciones y temporalidad.
- Mantiene exactamente este formato Markdown:
${specialty.historyTemplate}
- No incluyas bloques internos del sistema.

${specialty.styleProfile}
${specialty.specialty === 'psicologia' ? `\n${PSYCHOLOGY_AINHOA_STYLE_PROFILE}\n\n${PSYCHOLOGY_AINHOA_STYLE_EXAMPLES}` : ''}
${formatLearningPromptContext(learningContext)}

Paciente: ${patientName || 'Paciente'}

TRANSCRIPCION:
${String(transcription || '').slice(0, 32000)}

Salida JSON exacta con esquema:
${buildHistorySchemaHint(consultationType)}`;
};

const buildExtractionPrompt = (transcription, consultationType, learningContext) => `Extrae datos clinicos de ${normalizeConsultationType(consultationType) === 'psicologia' ? 'psicologia clinica' : 'otorrinolaringologia'} en JSON. Responde SOLO JSON valido.
Reglas:
- Usa solo datos presentes en la transcripcion.
- No inventes diagnosticos, pruebas ni antecedentes.
- Si falta un dato, usa [] o null segun corresponda.
${formatLearningPromptContext(learningContext)}

TRANSCRIPCION:
${String(transcription || '').slice(0, 24000)}

Schema:
${buildExtractionSchemaHint(consultationType)}`;

const buildClassificationPrompt = (transcription, consultationType) => {
    const specialty = getSpecialtyConfig(consultationType);
    const classificationRules = specialty.specialty === 'psicologia'
        ? `- visit_type: first_visit|follow_up|therapy_session|assessment|crisis|unknown
- clinical_area: psicologia|ansiedad|estado_de_animo|trauma|relacional|mixto|unknown
- urgency: routine|preferente|urgent|unknown`
        : `- visit_type: first_visit|follow_up|procedure|urgent|unknown
- clinical_area: ear|nose|throat|larynx|vestibular|mixed|unknown
- urgency: routine|preferente|urgent|unknown`;
    return `Clasifica esta consulta de ${specialty.specialty === 'psicologia' ? 'psicologia clinica' : 'otorrinolaringologia'}. Responde SOLO JSON valido.
Reglas:
${classificationRules}

TRANSCRIPCION:
${String(transcription || '').slice(0, 12000)}

Schema:
${specialty.classificationHint}`;
};

const buildReportPrompt = (transcription, patientName, consultationType, learningContext) => `Genera un informe ${getSpecialtyConfig(consultationType).reportLabel} profesional en espanol para ${patientName || 'Paciente'}.
Reglas:
- Basate solo en la transcripcion.
- No inventes diagnosticos ni pruebas no mencionadas.
- Si falta un dato, indica "No consta".
- Responde en texto Markdown simple.
${normalizeConsultationType(consultationType) === 'psicologia' ? `- Mantiene un estilo clinico humano, sobrio y parecido a una redaccion real de psicologia.
- Incluye contexto vital, problema actual, sintomas, impacto funcional, apoyos y plan si constan.
- Si aparecen objetivos terapeuticos o tareas, reflejalos con claridad sin sonar academico ni artificial.` : ''}
${formatLearningPromptContext(learningContext)}

TRANSCRIPCION:
${String(transcription || '').slice(0, 18000)}`;

const buildSectionPrompt = ({ transcription, currentHistory, sectionTitle, patientName, consultationType, learningContext }) => `Eres un asistente medico experto en ${normalizeConsultationType(consultationType) === 'psicologia' ? 'psicologia clinica' : 'otorrinolaringologia'}. Reescribe SOLO la seccion solicitada.
Paciente: ${patientName || 'Paciente'}
Seccion objetivo: ${sectionTitle}
Reglas:
- Devuelve solo el contenido de la seccion objetivo, sin encabezado.
- Usa solo datos de la transcripcion.
- Mantiene estilo clinico breve.
- Si falta dato, escribe "No consta".
${formatLearningPromptContext(learningContext)}

TRANSCRIPCION:
${String(transcription || '').slice(0, 18000)}

HISTORIA ACTUAL:
${String(currentHistory || '').slice(0, 12000)}`;

const buildProvisionalHistory = (reason, consultationType) => getSpecialtyConfig(consultationType).provisionalHistory(reason);

export const generateMedicalHistoryPayload = async ({ transcription, patientName, consultationType, learningContext }) => {
    const specialty = normalizeConsultationType(consultationType);
    const startedAt = Date.now();
    try {
        const historyResponse = await callPreferredTextModel({
            prompt: buildGenerateHistoryPrompt(transcription, patientName, specialty, learningContext),
            jsonMode: true,
            temperature: 0.1,
            maxTokens: 2600,
            includeThoughts: true
        });

        const parsedHistory = parseJsonWithFallback(historyResponse.text, () => ({}));
        const historyMarkdown = sanitizeClinicalHistory(String(parsedHistory.history_markdown || '').trim(), specialty);
        if (!historyMarkdown) {
            throw new Error('single_shot_empty_history');
        }

        const extraction = normalizeExtraction(parsedHistory.extraction, specialty);
        const classification = normalizeClassification(parsedHistory.classification);
        const qualityNotes = normalizeQualityNotes(parsedHistory.quality_notes);

        const uncertaintyFlags = Array.isArray(parsedHistory.uncertainty_flags)
            ? parsedHistory.uncertainty_flags
                .map((entry) => ({
                    field_path: String(entry?.field_path || '').trim(),
                    reason: String(entry?.reason || '').trim(),
                    severity: entry?.severity === 'high' ? 'high' : (entry?.severity === 'medium' ? 'medium' : 'low'),
                    value: typeof entry?.value === 'string' ? entry.value : undefined
                }))
                .filter((entry) => entry.field_path && entry.reason)
            : [];

        const issues = buildValidationIssues(historyMarkdown, extraction, specialty);
        const riskLevel = computeRiskLevel(issues);
        const criticalGaps = issues
            .filter((issue) => issue.severity !== 'minor')
            .slice(0, 5)
            .map((issue) => ({
                field: issue.field || 'unknown',
                reason: issue.reason || 'Sin detalle',
                severity: issue.severity || 'major'
            }));
        const provisionalReason = issues.some((issue) => issue.severity === 'critical')
            ? 'high_risk_detected_requires_manual_review'
            : undefined;
        const resultStatus = provisionalReason ? 'provisional' : 'completed';
        const pipelineStatus = issues.length > 0 ? 'degraded' : 'completed';
        const durationMs = Date.now() - startedAt;
        const geminiCallsUsed = historyResponse.gemini_success ? 1 : 0;
        const fallbackHops = historyResponse.fallback_hops;
        const validations = [{
            validator: 'server_guard',
            is_valid: issues.length === 0,
            errors: issues,
            confidence: issues.length === 0 ? 0.9 : 0.45,
            risk_level: riskLevel
        }];

        return {
            data: historyMarkdown,
            model: historyResponse.model,
            extraction,
            extraction_meta: [],
            classification,
            quality_notes: qualityNotes,
            validations,
            corrections_applied: 0,
            remaining_errors: issues.length > 0 ? issues : undefined,
            active_memory_used: false,
            uncertainty_flags: uncertaintyFlags.length > 0 ? uncertaintyFlags : undefined,
            audit_id: randomUUID(),
            pipeline_status: pipelineStatus,
            result_status: resultStatus,
            session_id: randomUUID(),
            learning_applied: Boolean(learningContext?.promptContext),
            quality_score: Math.max(25, 100 - (issues.length * 10)),
            critical_gaps: criticalGaps,
            doctor_next_actions: [
                'Revisar primero los gaps clinicos detectados',
                'Confirmar datos dudosos antes de cerrar',
                'Finalizar solo cuando no queden dudas clinicas'
            ],
            quality_triage_model: 'server_quality_guard',
            correction_rounds_executed: 1,
            early_stop_reason: issues.length === 0 ? 'clean_consensus' : 'low_risk_remaining',
            risk_level: riskLevel,
            call_budget_mode: 'single_shot',
            logical_calls_used: 1,
            physical_calls_used: 1 + fallbackHops,
            provisional_reason: provisionalReason,
            fallback_hops: fallbackHops,
            sanitization_applied: historyMarkdown !== String(parsedHistory.history_markdown || '').trim(),
            errors_raw_count: issues.length,
            errors_final_count: issues.length,
            resolved_by_sanitization: [],
            still_blocking_after_sanitization: issues.map((issue) => `${issue.type}:${issue.field}:${issue.reason}`),
            reconciliation: {
                pre_sanitize_issues: [],
                post_sanitize_issues: issues.map((issue) => ({
                    fingerprint: `${issue.type}|${issue.field}|${issue.reason}`,
                    type: issue.type,
                    field: issue.field,
                    reason: issue.reason,
                    severity: issue.severity,
                    phase: 'final_guard',
                    blocking: issue.severity !== 'minor'
                })),
                neutralized_issues: []
            },
            phase_timings_ms: {
                extract: 0,
                generate: durationMs,
                validate: 0,
                corrections: 0,
                total: durationMs
            },
            followup_status: 'completed',
            output_tier: 'final',
            gemini_calls_used: geminiCallsUsed,
            rule_pack_version: Number(learningContext?.rulePackVersion || 0) || undefined,
            rule_ids_used: Array.isArray(learningContext?.ruleIdsUsed) ? learningContext.ruleIdsUsed : undefined,
            one_call_policy_applied: true,
            degraded_reason_code: provisionalReason || historyResponse.fallback_reason,
            audit_trace: {
                thought_summary: historyResponse.thought_summary,
                thought_signature: historyResponse.thought_signature
            }
        };
    } catch (error) {
        const reason = error?.message || 'server_generation_failed';
        return {
            data: buildProvisionalHistory(reason, specialty),
            model: `gemini:${GEMINI_TEXT_MODEL}`,
            quality_notes: [{
                type: 'pipeline',
                field: 'pipeline',
                reason,
                severity: 'high'
            }],
            remaining_errors: [{ type: 'error', field: 'pipeline', reason }],
            pipeline_status: 'degraded',
            result_status: 'failed_recoverable',
            quality_score: 0,
            critical_gaps: [{ field: 'pipeline', reason, severity: 'critical' }],
            doctor_next_actions: [
                'Reintentar el procesamiento',
                'Verificar conectividad y audio de entrada',
                'Revisar la historia manualmente'
            ],
            quality_triage_model: 'server_fallback',
            correction_rounds_executed: 0,
            early_stop_reason: 'max_rounds_reached',
            risk_level: 'high',
            call_budget_mode: 'single_shot',
            logical_calls_used: 0,
            physical_calls_used: 0,
            provisional_reason: reason,
            fallback_hops: 0,
            phase_timings_ms: { extract: 0, generate: 0, validate: 0, corrections: 0, total: 0 },
            followup_status: 'failed',
            output_tier: 'final',
            gemini_calls_used: 0,
            one_call_policy_applied: true,
            degraded_reason_code: reason,
            audit_id: randomUUID(),
            session_id: randomUUID(),
            audit_trace: {
                thought_summary: undefined,
                thought_signature: undefined
            }
        };
    }
};

export const extractMedicalDataPayload = async ({ transcription, consultationType, learningContext }) => {
    const specialty = normalizeConsultationType(consultationType);
    const [extractionResponse, classificationResponse] = await Promise.all([
        callPreferredTextModel({
            prompt: buildExtractionPrompt(transcription, specialty, learningContext),
            jsonMode: true,
            temperature: 0,
            maxTokens: 1200,
            includeThoughts: true
        }),
        callPreferredTextModel({
            prompt: buildClassificationPrompt(transcription, specialty),
            jsonMode: true,
            temperature: 0,
            maxTokens: 300,
            includeThoughts: true
        })
    ]);
    return {
        data: normalizeExtraction(parseJsonWithFallback(extractionResponse.text, () => ({})), specialty),
        meta: [],
        classification: normalizeClassification(parseJsonWithFallback(classificationResponse.text, () => ({}))),
        model: extractionResponse.model,
        audit_trace: {
            thought_summary: [extractionResponse.thought_summary, classificationResponse.thought_summary].filter(Boolean).join('\n\n') || undefined,
            thought_signature: extractionResponse.thought_signature || classificationResponse.thought_signature
        }
    };
};

export const generateMedicalReportPayload = async ({ transcription, patientName, consultationType, learningContext }) => {
    const response = await callPreferredTextModel({
        prompt: buildReportPrompt(transcription, patientName, consultationType, learningContext),
        jsonMode: false,
        temperature: 0.2,
        maxTokens: 1800,
        includeThoughts: true
    });
    return {
        text: response.text.trim(),
        model: response.model,
        audit_trace: {
            thought_summary: response.thought_summary,
            thought_signature: response.thought_signature
        }
    };
};

export const regenerateHistorySectionPayload = async (params) => {
    const response = await callPreferredTextModel({
        prompt: buildSectionPrompt(params),
        jsonMode: false,
        temperature: 0.1,
        maxTokens: 900,
        includeThoughts: true
    });
    return {
        text: response.text.trim(),
        model: response.model,
        audit_trace: {
            thought_summary: response.thought_summary,
            thought_signature: response.thought_signature
        }
    };
};

export const transcribeAudioPayload = async ({ audioBase64, mimeType }) => {
    const response = await callPreferredTranscriptionModel({ audioBase64, mimeType });
    return {
        text: response.text,
        model: response.model
    };
};

export {
    getJsonBody,
    writeJson
};
