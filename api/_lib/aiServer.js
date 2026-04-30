import { randomUUID } from 'node:crypto';
import { del, get } from '@vercel/blob';
import { GENERATED_ORL_STYLE_PROFILES } from './orlStyleProfiles.generated.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || 'llama-3.3-70b-versatile';
const GROQ_TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo';
const GROQ_TRANSCRIBE_FALLBACK_MODEL = process.env.GROQ_TRANSCRIBE_FALLBACK_MODEL || 'whisper-large-v3';
const GEMINI_TEXT_MODEL = normalizeGeminiModelId(process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-preview');
const GEMINI_LIGHT_MODEL = normalizeGeminiModelId(process.env.GEMINI_LIGHT_MODEL || process.env.GEMINI_TEXT_LIGHT_MODEL || 'gemini-3.1-flash-lite-preview');
const GEMINI_TRANSCRIBE_MODEL = normalizeGeminiModelId(process.env.GEMINI_TRANSCRIBE_MODEL || process.env.GEMINI_MODEL || GEMINI_LIGHT_MODEL);

const ORL_STYLE_PROFILE = `ESTILO ORL TELEGRAFICO (OBLIGATORIO)
- Tono clinico, breve y directo.
- Evita narrativa larga o explicaciones ornamentales.
- Exploracion/pruebas con etiquetas cortas tipo "ETIQUETA: hallazgo".
- Plan en acciones breves y operativas.
- No inventes datos ni expandas mas alla de la transcripcion.`;

const ORL_GOTXI_STYLE_PROFILE = `ESTILO PROFESIONAL DE DRA. GOTXI (OBLIGATORIO EN ORL)
- La historia debe sonar a consulta ORL real de Dra. Gotxi: muy sintetica, clinica, directa y resolutiva.
- Prioriza aperturas naturales tipo "Refiere...", "Acude..." o "Desde hace..." cuando encajen con la transcripcion.
- Dentro de las secciones, usa bloques muy compactos con etiquetas clinicas cortas como "EXPLORACION:", "OTOSCOPIA:", "VIDEONASO:", "IMPE:" o equivalentes solo si la transcripcion aporta ese contenido.
- Usa lateralidad compacta y lenguaje ORL de consulta: "OD", "OI", "IZQ", "DCHA", "bilateral", "control", "alta", siempre que este sustentado.
- El plan debe ser operativo, breve y en estilo de pauta real de consulta, sin explicaciones docentes ni relleno.
- Si la transcripcion permite concrecion, da preferencia a sintomas ORL, evolucion, exploracion, prueba realizada, impresion diagnostica y conducta.
- Mantiene frases cortas y densas en informacion. Evita parrafos largos si la informacion puede resolverse con 1-3 frases clinicas compactas.
- Si un dato no consta, escribe "No consta", pero sin convertir toda la historia en una plantilla mecanica.
- NO imites erratas, ruido de OCR, fallos de acentuacion, codificacion extrana ni abreviaturas ambiguas que bajen la calidad final.
- NO copies literalmente la historia de referencia; solo imita voz, ritmo, etiquetas, longitud y forma de sintetizar.`;

const ORL_GOTXI_STYLE_EXAMPLES = `EJEMPLOS DE FORMA (NO REUTILIZAR CONTENIDO NI DATOS)
1) Apertura breve con motivo y evolucion: "Refiere..." o "Acude..." y despues una exploracion ORL muy sintetica.
2) Si hay tapones o cerumen, es preferible una redaccion muy operativa con "OTOSCOPIA: OD... OI..." y un plan de control o alta si procede.
3) Si hay disfonia, rinorrea, hipoacusia o mareo, prioriza la secuencia problema actual -> exploracion/prueba -> plan, con pocas frases y mucha utilidad clinica.
4) Si se realiza una exploracion endoscopica o funcional, nombra la prueba con etiqueta corta y describe solo el hallazgo clinicamente relevante.
5) El plan puede incluir tratamiento, lavados, pauta, derivacion, control o alta, siempre en estilo breve y real de consulta ORL.`;

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
- Si la transcripcion lo permite, concreta mucho frecuencia, duracion, intensidad, sintomas fisicos, pensamientos asociados y conductas de alivio o evitacion.
- Introduce con naturalidad formulas tipo "Respecto a la familia", "Respecto a las amistades", "En un dia normal", "Por ultimo" o "En cuanto a..." cuando ayuden a ordenar la informacion sin volverla demasiado esquematica.
- Cuando existan frases literales del/la paciente que aporten valor clinico, pueden incluirse de forma breve entre comillas.
- En "OBSERVACIONES CLINICAS" integra recursos, apoyos, rutina diaria, hobbies, factores protectores, areas afectadas, antecedentes relevantes y cualquier informacion clinicamente util, siempre sin inventar.
- Da bastante peso a red de apoyo, rutina, hobbies, sueño, alimentacion, concentracion y actividad fisica cuando aparezcan, porque forman parte de su forma habitual de registrar.
- En "IMPRESION CLINICA" mantente prudente: formula comprensiones clinicas o focos de trabajo, pero no diagnostiques si no consta.
- En "PLAN TERAPEUTICO" redacta con estilo de consulta real. Si en la transcripcion aparecen tareas para casa u objetivos terapeuticos, integrarlos aqui con etiquetas internas como "Tareas para casa:" y "Objetivos terapeuticos:" dentro del cuerpo de la seccion, sin crear encabezados Markdown nuevos.
- Si aparecen objetivos muy concretos, mantenlos con formulacion simple, orientada a consulta y sin convertirlos en jerga tecnica.
- No uses lenguaje grandilocuente, juridico ni excesivamente tecnico.
- No conviertas toda la historia en listas; mezcla frases y parrafos breves con listados solo cuando ayuden a la claridad.
- No moralices ni interpretes mas alla de la evidencia disponible.`;

const PSYCHOLOGY_AINHOA_STYLE_EXAMPLES = `EJEMPLOS DE FORMA (NO REUTILIZAR CONTENIDO NI DATOS)
1) Motivo de consulta breve. Despues, en situacion actual, se abre con edad, convivencia, estudios o trabajo y red de apoyo. A continuacion se describe el problema actual con cronologia, sintomas, impacto en su dia a dia, apoyos, hobbies y factores protectores.
2) Si hay ansiedad, se especifica cuando comenzo, en que momentos ocurre, su frecuencia, duracion, sintomas fisicos, anticipacion o alerta, y como interfiere en su descanso, alimentacion, concentracion o actividad.
3) Si hay conflicto relacional o familiar, se explica de forma clara quien interviene, que secuencia de hechos refiere la paciente y que emocion o malestar actual genera, sin convertirlo en relato literario.
4) Si hay autolesiones, ideacion o antecedentes graves, se registra con sobriedad, literalidad clinica y foco en frecuencia, funciones de la conducta, desencadenantes, factores protectores e impacto funcional.
5) Si aparecen objetivos terapeuticos o tareas, se recogen al final dentro del plan con frases claras, utiles y realistas para seguimiento.
6) Es habitual que primero situe a la persona y despues vaya desplegando el caso con conectores sencillos, sin tecnificarlo demasiado.
7) Cuando el caso tiene varias areas afectadas, las integra dentro del relato, pero manteniendo una sensacion de orden y utilidad clinica.`;

const PSYCHOLOGY_JUNE_STYLE_PROFILE = `ESTILO PROFESIONAL DE JUNE (OBLIGATORIO EN PSICOLOGIA CUANDO EL PERFIL ACTIVO SEA JUNE)
- La escritura debe sonar a nota clinica real, cercana a consulta privada, con mas narrativa integrada y menos estructura de frases telegráficas.
- Puedes abrir con una frase de contexto global antes de bajar a las areas concretas, siempre sin perder claridad clinica.
- Integra con naturalidad apartados internos como "Familia:", "Socialmente:", "Relaciones:", "Antecedentes:", "Medicación:", "Dia normal:", "OT:" u "Observaciones:" cuando esos bloques ayuden a ordenar la informacion aportada.
- Prioriza conflicto nuclear, cambios vitales, antecedentes relacionales y areas afectadas, conectando mejor las piezas de la historia entre si.
- Si la consulta es de pareja, redacta de manera relacional y sistémica: deja claro quien aporta cada dificultad y cuales son las necesidades no cubiertas o los patrones de interacción.
- Si hay trayectorias complejas o varios episodios previos, se pueden resumir en un bloque tipo "CUADRO MEDICO" o "Antecedentes" si eso refleja mejor la informacion de la transcripcion.
- Mantente clinica y prudente: no diagnostiques si no consta, pero si puedes nombrar focos como trauma, abandono, autoestima, impulsividad, confianza o regulacion emocional cuando la transcripcion lo sostenga.
- En el plan terapeutico, permite integrar objetivos con estilo de trabajo real, incluso usando "OT:" o "Objetivos terapeuticos:" si aparece coherente con la informacion disponible.
- No conviertas todo en bullets; alterna bloques breves y subapartados en mayusculas solo cuando aporten orden real.
- Conserva un tono humano y directo, no academico, no juridico y no generico de IA.`;

const PSYCHOLOGY_JUNE_STYLE_EXAMPLES = `EJEMPLOS DE FORMA (NO REUTILIZAR CONTENIDO NI DATOS)
1) Puede abrir con un parrafo compacto que sitúe edad, ocupacion, estudios, ritmo de vida y motivo de consulta, y despues desplegar areas como Familia, Socialmente o Relaciones.
2) Cuando hay varios frentes abiertos, ordena la historia por areas de vida afectadas y no solo por sintomas aislados.
3) Si se trata de pareja, combina informacion de ambos y explicita patron de comunicacion, necesidades no cubiertas, antecedentes y objetivo comun.
4) Si hay un historial clinico largo, sintetiza cronologia y medicacion en bloques claros antes de volver al malestar actual.
5) Los objetivos pueden aparecer como "OT:" con foco terapeutico concreto, manteniendo un lenguaje profesional pero muy natural.`;

const PSYCHOLOGY_JUNE_STYLE_PROFILE_SUPPLEMENT = `REFUERZO DE ESTILO DE JUNE
- Si existen varias subareas relevantes, puedes usar formulas como "Familia:", "Area social:", "Sueno:", "Alimentacion:" o "Relaciones:" dentro de una misma seccion, siempre que ayuden a leer mejor el caso.
- Si el caso gira en torno a limites, abandono, traicion, autoconcepto, control, impulsividad o confianza, puedes nombrar esos focos de trabajo de forma natural cuando la informacion los sostenga.
- En terapia de pareja, deja claro el objetivo comun y, si procede, los objetivos individuales o los siguientes pasos acordados.`;

const PSYCHOLOGY_JUNE_STYLE_EXAMPLES_SUPPLEMENT = `EJEMPLOS ADICIONALES DE JUNE
6) Puede usar frases de enlace que den sensacion de continuidad, para conectar familia, trabajo, pareja y antecedentes en un mismo caso.
7) En casos complejos, el texto puede sonar mas integrado y humano, pero siempre debe seguir siendo util, claro y clinicamente prudente.`;

const normalizePsychologyClinicianName = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'june') return 'June';
    return 'Ainhoa';
};

const normalizeOrlClinicianName = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'Dra. Gotxi';
    if (normalized === 'gotxi' || normalized.includes('gotxi') || normalized.includes('itziar')) return 'Dra. Gotxi';
    return 'Dra. Gotxi';
};

const buildOrlCorpusSummary = (profile) => {
    if (!profile) return '';
    const openers = Array.isArray(profile.frequentOpeners) ? profile.frequentOpeners.slice(0, 5).join(', ') : '';
    const labels = Array.isArray(profile.frequentLabels) ? profile.frequentLabels.slice(0, 8).join(', ') : '';
    const terms = Array.isArray(profile.frequentTerms) ? profile.frequentTerms.slice(0, 8).join(', ') : '';
    const abbreviations = Array.isArray(profile.frequentAbbreviations) ? profile.frequentAbbreviations.slice(0, 8).join(', ') : '';
    return `SENALES DEL CORPUS ORL DE GOTXI
- Muestras analizadas: ${Number(profile.sampleCount || 0)}.
- Aperturas frecuentes: ${openers || 'Refiere, Acude, Desde hace'}.
- Etiquetas frecuentes: ${labels || 'EXPLORACION:, OTOSCOPIA:, PLAN:'}.
- Terminos frecuentes: ${terms || 'disfonia, hipoacusia, cerumen, control'}.
- Abreviaturas frecuentes: ${abbreviations || 'OD, OI, IZQ, DCHA'}.
- Usa estas senales para parecer una nota real de Dra. Gotxi, pero sin copiar datos de pacientes ni reproducir errores tipograficos.`;
};

const getOrlClinicianStyle = (clinicianName) => {
    const normalized = normalizeOrlClinicianName(clinicianName);
    const corpusProfile = GENERATED_ORL_STYLE_PROFILES.gotxi;
    return {
        name: normalized,
        historyProfile: `${ORL_GOTXI_STYLE_PROFILE}\n${buildOrlCorpusSummary(corpusProfile)}`,
        historyExamples: ORL_GOTXI_STYLE_EXAMPLES,
        reportProfile: `- Mantiene una voz ORL muy breve, directa y clinica, alineada con Dra. Gotxi.
- Prioriza hallazgo ORL, prueba, impresion y conducta con frases compactas.
- No reproduce erratas, ruido ni abreviaturas ambiguas aunque la referencia legacy las contenga.`
    };
};

const getPsychologyClinicianStyle = (clinicianName) => {
    const normalized = normalizePsychologyClinicianName(clinicianName);
    if (normalized === 'June') {
        return {
            name: normalized,
            historyProfile: `${PSYCHOLOGY_JUNE_STYLE_PROFILE}\n${PSYCHOLOGY_JUNE_STYLE_PROFILE_SUPPLEMENT}`,
            historyExamples: `${PSYCHOLOGY_JUNE_STYLE_EXAMPLES}\n${PSYCHOLOGY_JUNE_STYLE_EXAMPLES_SUPPLEMENT}`,
            reportProfile: `- Mantiene un estilo clinico humano y algo mas narrativo, parecido a una redaccion real de June.
- Si la complejidad del caso lo pide, puede agrupar informacion por areas o bloques internos utiles como Familia, Relaciones, Antecedentes u OT.
- Si es terapia de pareja, debe explicitar mejor el patron relacional, las necesidades no cubiertas y el objetivo comun.
- Conserva una voz sobria, profesional y con foco terapeutico claro.`
        };
    }
    return {
        name: normalized,
        historyProfile: PSYCHOLOGY_AINHOA_STYLE_PROFILE,
        historyExamples: PSYCHOLOGY_AINHOA_STYLE_EXAMPLES,
        reportProfile: `- Mantiene un estilo clinico humano, sobrio y parecido a una redaccion real de Ainhoa.
- Incluye contexto vital, problema actual, sintomas, impacto funcional, apoyos y plan si constan.
- Tiende a concretar frecuencia, intensidad, impacto funcional y factores protectores cuando aparecen.
- Si aparecen objetivos terapeuticos o tareas, reflejalos con claridad sin sonar academico ni artificial.`
    };
};

const normalizeConsultationType = (value) => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    if (normalized.includes('psic')) return 'psicologia';
    return 'otorrino';
};

const buildAudioUploadFileName = (blobLike) => {
    const mime = String(blobLike?.type || '').toLowerCase();
    if (mime.includes('wav')) return 'audio.wav';
    if (mime.includes('flac')) return 'audio.flac';
    if (mime.includes('ogg')) return 'audio.ogg';
    if (mime.includes('m4a')) return 'audio.m4a';
    if (mime.includes('mp4')) return 'audio.mp4';
    if (mime.includes('mpeg') || mime.includes('mp3') || mime.includes('mpga')) return 'audio.mp3';
    if (mime.includes('webm')) return 'audio.webm';
    return 'audio.wav';
};

const buildTranscriptionPrompt = (consultationType, clinicianName) => {
    const specialty = normalizeConsultationType(consultationType);
    const psychologyClinician = specialty === 'psicologia'
        ? normalizePsychologyClinicianName(clinicianName)
        : null;
    const orlClinician = specialty === 'otorrino'
        ? normalizeOrlClinicianName(clinicianName)
        : null;
    const domainHint = specialty === 'psicologia'
        ? `Consulta de psicologia clinica${psychologyClinician ? ` (${psychologyClinician})` : ''}.`
        : `Consulta medica de otorrinolaringologia${orlClinician ? ` (${orlClinician})` : ''}.`;

    return [
        domainHint,
        'Transcribe el audio de forma literal y util para documentacion clinica.',
        'Manten el idioma original de cada hablante; no traduzcas.',
        'Respeta nombres propios, medicacion, sintomas y terminos clinicos.',
        'Puntuacion clara, sin markdown, sin resumen y sin comentarios extra.'
    ].join(' ');
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

const getTranscriptionProviderAvailability = () => ({
    groq: String(process.env.GROQ_API_KEY || '').trim().length > 0,
    gemini: String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim().length > 0
});

const assertTranscriptionProviderAvailable = () => {
    const availability = getTranscriptionProviderAvailability();
    if (availability.groq || availability.gemini) {
        return availability;
    }
    throw new Error('server_transcription_provider_unconfigured:missing_groq_api_key,missing_gemini_api_key');
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

const startDebugStep = (trace, name, detail) => {
    if (!trace) return -1;
    const index = trace.steps.push({
        name,
        started_at: new Date().toISOString(),
        status: 'started',
        detail
    }) - 1;
    return index;
};

const endDebugStep = (trace, index, status, detail) => {
    if (!trace || index < 0 || !trace.steps[index]) return;
    const step = trace.steps[index];
    const endedAt = new Date();
    step.ended_at = endedAt.toISOString();
    step.duration_ms = Math.max(0, endedAt.getTime() - new Date(step.started_at).getTime());
    step.status = status;
    if (detail) step.detail = detail;
};

const createServerDebugTrace = (clientTrace) => ({
    trace_id: String(clientTrace?.trace_id || randomUUID()),
    transport: clientTrace?.transport || 'inline',
    started_at: new Date().toISOString(),
    client_trace: clientTrace || null,
    steps: []
});

const finalizeServerDebugTrace = (trace) => {
    if (!trace) return trace;
    const endedAt = new Date();
    trace.completed_at = endedAt.toISOString();
    trace.total_duration_ms = Math.max(0, endedAt.getTime() - new Date(trace.started_at).getTime());
    return trace;
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

const getAudioBytesFromBlobUrl = async (audioUrl, debugTrace) => {
    const stepIndex = startDebugStep(debugTrace, 'blob_fetch', String(audioUrl || ''));
    const result = await get(String(audioUrl || ''), { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) {
        endDebugStep(debugTrace, stepIndex, 'failed', 'blob_audio_not_found');
        throw new Error('blob_audio_not_found');
    }

    const arrayBuffer = await new Response(result.stream).arrayBuffer();
    endDebugStep(debugTrace, stepIndex, 'passed', result.blob?.contentType || 'audio/wav');
    return {
        bytes: Buffer.from(arrayBuffer),
        mimeType: result.blob.contentType || 'audio/wav'
    };
};

const resolveTranscriptionInput = async ({ audioBase64, audioUrl, mimeType }, debugTrace) => {
    if (audioUrl) {
        return getAudioBytesFromBlobUrl(audioUrl, debugTrace);
    }

    return {
        bytes: Buffer.from(String(audioBase64 || ''), 'base64'),
        mimeType: String(mimeType || 'audio/wav').trim() || 'audio/wav'
    };
};

const callGroqTranscriptionModel = async ({ bytes, mimeType, model, prompt, debugTrace }) => {
    const stepIndex = startDebugStep(debugTrace, `groq_transcribe:${model}`, mimeType);
    const file = new Blob([bytes], { type: mimeType });
    const formData = new FormData();
    formData.append('file', file, buildAudioUploadFileName(file));
    formData.append('model', model);
    formData.append('prompt', prompt);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
    formData.append('temperature', '0');

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
        endDebugStep(debugTrace, stepIndex, 'failed', message);
        throw new Error(message);
    }
    endDebugStep(debugTrace, stepIndex, 'passed', String(body?.model || model));
    return {
        text: String(body?.text || ''),
        model: `groq:${body?.model || model}`,
        segments: Array.isArray(body?.segments) ? body.segments : []
    };
};

const callPreferredTranscriptionModel = async ({ audioBase64, audioUrl, mimeType, consultationType, clinicianName, debugTrace }) => {
    const transcriptionPrompt = buildTranscriptionPrompt(consultationType, clinicianName);
    const { bytes, mimeType: resolvedMimeType } = await resolveTranscriptionInput({ audioBase64, audioUrl, mimeType }, debugTrace);
    let whisperTurboError;
    let whisperV3Error;

    try {
        const turboResult = await callGroqTranscriptionModel({
            bytes,
            mimeType: resolvedMimeType,
            model: GROQ_TRANSCRIBE_MODEL,
            prompt: transcriptionPrompt,
            debugTrace
        });
        return {
            ...turboResult,
            gemini_attempted: false,
            gemini_success: false,
            fallback_hops: 0
        };
    } catch (error) {
        whisperTurboError = error;
    }

    try {
        const whisperV3Result = await callGroqTranscriptionModel({
            bytes,
            mimeType: resolvedMimeType,
            model: GROQ_TRANSCRIBE_FALLBACK_MODEL,
            prompt: transcriptionPrompt,
            debugTrace
        });
        return {
            ...whisperV3Result,
            gemini_attempted: false,
            gemini_success: false,
            fallback_hops: 1,
            fallback_reason: whisperTurboError instanceof Error ? whisperTurboError.message : 'whisper_turbo_failed'
        };
    } catch (error) {
        whisperV3Error = error;
    }

    const geminiStepIndex = startDebugStep(debugTrace, `gemini_transcribe:${GEMINI_TRANSCRIBE_MODEL}`, resolvedMimeType);
    try {
        const result = await callGeminiText({
            prompt: '',
            jsonMode: false,
            temperature: 0,
            maxTokens: 8192,
            modelName: GEMINI_TRANSCRIBE_MODEL,
            inlineParts: [
                {
                    text: transcriptionPrompt
                },
                {
                    inlineData: {
                        mimeType: resolvedMimeType,
                        data: bytes.toString('base64')
                    }
                }
            ]
        });
        endDebugStep(debugTrace, geminiStepIndex, 'passed', result.model);
        return {
            text: result.text.trim(),
            model: result.model,
            segments: [],
            gemini_attempted: true,
            gemini_success: true,
            fallback_hops: 2,
            fallback_reason: whisperV3Error instanceof Error
                ? whisperV3Error.message
                : (whisperTurboError instanceof Error ? whisperTurboError.message : 'whisper_failed')
        };
    } catch (geminiError) {
        const geminiMessage = geminiError instanceof Error ? geminiError.message : 'unknown';
        endDebugStep(debugTrace, geminiStepIndex, 'failed', geminiMessage);
        const baseReason = whisperV3Error instanceof Error
            ? whisperV3Error.message
            : (whisperTurboError instanceof Error ? whisperTurboError.message : 'whisper_failed');
        throw new Error(`gemini_transcription_failed:${(geminiError instanceof Error ? geminiError.message : 'unknown')}|fallback_reason:${baseReason}`);
    }
};

const safeDeleteBlob = async (audioUrl) => {
    if (!audioUrl) return;
    try {
        await del(String(audioUrl));
    } catch (error) {
        console.warn('[aiServer] failed to delete temporary audio blob:', error);
    }
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

const formatLearningPromptContext = (learningContext, expected = {}) => {
    if (!learningContext || !String(learningContext.promptContext || '').trim()) return '';
    const contextSpecialty = learningContext.specialty ? normalizeConsultationType(learningContext.specialty) : '';
    const expectedSpecialty = expected.specialty ? normalizeConsultationType(expected.specialty) : '';
    if (contextSpecialty && expectedSpecialty && contextSpecialty !== expectedSpecialty) return '';

    const contextArtifactType = String(learningContext.artifactType || '').trim();
    const expectedArtifactType = String(expected.artifactType || '').trim();
    if (contextArtifactType && expectedArtifactType && contextArtifactType !== expectedArtifactType) return '';

    return `REGLAS DE APRENDIZAJE DEL PROFESIONAL (APLICAR SOLO SI NO CONTRADICEN LA TRANSCRIPCION):
${String(learningContext.promptContext).slice(0, 4000)}

No cites estas reglas en la salida. No inventes datos para cumplirlas.`;
};

const formatStyleReferencePrompt = (styleReference) => {
    const referenceStory = String(styleReference?.referenceStory || '').trim();
    const generatedTemplate = String(styleReference?.generatedTemplate || '').trim();
    if (!referenceStory && !generatedTemplate) return '';
    return `REFERENCIA DE ESTILO DEL PROFESIONAL (ACTIVA)
- Usa esta referencia solo para imitar tono, orden, longitud y estructura.
- NO copies nombres, antecedentes, sintomas ni otros datos clinicos de la referencia.
- La historia final debe salir SOLO de la transcripcion actual.

PLANTILLA EDITABLE PREFERIDA:
${generatedTemplate ? generatedTemplate.slice(0, 5000) : 'No consta'}

HISTORIA DE REFERENCIA:
${referenceStory ? referenceStory.slice(0, 8000) : 'No consta'}`;
};

const buildGenerateHistoryPrompt = (transcription, patientName, consultationType, learningContext, clinicianName, styleReference) => {
    const specialty = getSpecialtyConfig(consultationType);
    const specialtyRole = specialty.specialty === 'psicologia' ? 'psicologia clinica' : 'otorrinolaringologia';
    const psychologyClinicianStyle = specialty.specialty === 'psicologia' ? getPsychologyClinicianStyle(clinicianName) : null;
    const orlClinicianStyle = specialty.specialty === 'otorrino' ? getOrlClinicianStyle(clinicianName) : null;
    const activeTemplate = String(styleReference?.generatedTemplate || '').trim() || specialty.historyTemplate;
    return `Eres un asistente clinico experto en ${specialtyRole}. Responde SOLO JSON valido.
Objetivo: generar historia clinica final y extraccion estructurada en una sola respuesta.
Reglas:
- Usa SOLO la transcripcion, no inventes datos.
- Si falta un dato, usa "No consta" en la historia y null/[]/"" en extraccion segun corresponda.
- Respeta negaciones y temporalidad.
- Mantiene exactamente este formato Markdown:
${activeTemplate}
- No incluyas bloques internos del sistema.

${specialty.styleProfile}
${psychologyClinicianStyle ? `\n${psychologyClinicianStyle.historyProfile}\n\n${psychologyClinicianStyle.historyExamples}` : ''}
${orlClinicianStyle ? `\n${orlClinicianStyle.historyProfile}\n\n${orlClinicianStyle.historyExamples}` : ''}
${formatLearningPromptContext(learningContext, { specialty: consultationType, artifactType: 'medical_history' })}
${formatStyleReferencePrompt(styleReference)}

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
${formatLearningPromptContext(learningContext, { specialty: consultationType, artifactType: 'medical_history' })}

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

const buildReportPrompt = (transcription, patientName, consultationType, learningContext, clinicianName) => `Genera un informe ${getSpecialtyConfig(consultationType).reportLabel} profesional en espanol para ${patientName || 'Paciente'}.
Reglas:
- Basate solo en la transcripcion.
- No inventes diagnosticos ni pruebas no mencionadas.
- Si falta un dato, indica "No consta".
- Responde en texto Markdown simple.
${normalizeConsultationType(consultationType) === 'psicologia' ? getPsychologyClinicianStyle(clinicianName).reportProfile : ''}
${normalizeConsultationType(consultationType) === 'otorrino' ? getOrlClinicianStyle(clinicianName).reportProfile : ''}
${formatLearningPromptContext(learningContext, { specialty: consultationType, artifactType: 'medical_report' })}

TRANSCRIPCION:
${String(transcription || '').slice(0, 18000)}`;

const buildSectionPrompt = ({ transcription, currentHistory, sectionTitle, patientName, consultationType, learningContext, clinicianName, styleReference }) => `Eres un asistente medico experto en ${normalizeConsultationType(consultationType) === 'psicologia' ? 'psicologia clinica' : 'otorrinolaringologia'}. Reescribe SOLO la seccion solicitada.
Paciente: ${patientName || 'Paciente'}
Seccion objetivo: ${sectionTitle}
Reglas:
- Devuelve solo el contenido de la seccion objetivo, sin encabezado.
- Usa solo datos de la transcripcion.
- Mantiene estilo clinico breve.
- Si falta dato, escribe "No consta".
${normalizeConsultationType(consultationType) === 'psicologia' ? getPsychologyClinicianStyle(clinicianName).historyProfile : ''}
${normalizeConsultationType(consultationType) === 'otorrino' ? getOrlClinicianStyle(clinicianName).historyProfile : ''}
${formatLearningPromptContext(learningContext, { specialty: consultationType, artifactType: 'medical_history' })}
${formatStyleReferencePrompt(styleReference)}

TRANSCRIPCION:
${String(transcription || '').slice(0, 18000)}

HISTORIA ACTUAL:
${String(currentHistory || '').slice(0, 12000)}`;

const cleanBriefingLine = (value) => cleanText(String(value || '').replace(/^[-*•]+\s*/, ''));

const STRUCTURED_BRIEFING_KEYS = [
    'hilo_terapeutico',
    'ultima_sesion',
    'momento_del_proceso',
    'pendientes',
    'patrones_observados',
    'alerta_clinica',
    'frase_para_retomar',
    'evolucion'
];

const normalizeBriefingText = (rawText) => {
    const text = String(rawText || '').trim();
    if (!text) return '';

    // Try to parse as structured JSON first
    try {
        const parsed = JSON.parse(text);
        if (
            parsed
            && typeof parsed === 'object'
            && !Array.isArray(parsed)
            && STRUCTURED_BRIEFING_KEYS.some((key) => key in parsed)
        ) {
            return JSON.stringify(parsed);
        }
    } catch {
        // Not JSON, fall through to legacy text normalization
    }

    const lines = text
        .split(/\r?\n/)
        .map((line) => cleanBriefingLine(line))
        .filter((line) => {
            if (!line) return false;
            const lower = line.toLowerCase();
            if (lower === 'no consta' || lower === 'no consta.') return false;
            if (/^[^:]+:\s*no consta\.?$/i.test(line)) return false;
            return true;
        });

    if (!lines.length) return '';
    return lines.slice(0, 5).join('\n');
};

const buildBriefingPrompt = ({ patientName, consultationType, clinicianName, timelineItems }) => {
    const specialty = normalizeConsultationType(consultationType);
    const items = Array.isArray(timelineItems) ? timelineItems : [];
    const timelineText = items
        .slice(0, 12)
        .map((item, index) => {
            const consultationAt = String(item?.consultationAt || item?.consultation_at || '').trim();
            const clinician = String(item?.clinicianName || item?.clinician_profile || clinicianName || '').trim() || 'Sin profesional';
            const source = String(item?.source || '').trim() || 'current';
            const history = String(item?.medicalHistory || item?.medical_history || '').trim().slice(0, 2400);
            return [
                `${index + 1}. Fecha: ${consultationAt || 'No consta'}`,
                `   Fuente: ${source}`,
                `   Profesional: ${clinician}`,
                `   Nota: ${history || 'No consta'}`
            ].join('\n');
        })
        .join('\n\n');

    const sessionCount = items.length;
    const hasMultipleSessions = sessionCount > 1;

    if (specialty === 'otorrino') {
        return `Eres una asistente clinica experta en otorrinolaringologia. Genera un briefing estructurado y muy practico para la otorrino que va a ver este paciente.
El objetivo: que lo lea en 15-20 segundos antes de entrar y recuerde rapido el motivo ORL, los hallazgos previos relevantes, las pruebas, la evolucion y el plan pendiente.

Devuelve un JSON con exactamente esta estructura (si un campo no tiene datos suficientes, OMITE ese campo del JSON, no pongas null ni "No consta"):

{
  "hilo_terapeutico": "Frase breve con el motivo ORL central o el problema a seguir. Ej: 'Control de perforacion timpanica OD tras cuadro catarral' o 'Hipoacusia bilateral en estudio'.",
  "ultima_sesion": {
    "fecha": "fecha de la ultima consulta si consta",
    "resumen": "Motivo actual, exploracion ORL o prueba relevante y conducta tomada. Muy concreto."
  },
  "pendientes": ["Tratamiento, control, prueba o indicacion pendiente", "Otro pendiente si existe"],
  "patrones_observados": ["Hallazgo recurrente o antecedente ORL a tener presente", "Otro patron si se observa"],
  "alerta_clinica": "Solo si hay una senal clinica relevante o algo que no conviene pasar por alto. No inventar alertas.",
  "frase_para_retomar": "Apertura breve y natural de consulta ORL. Ej: 'La ultima vez quedamos en control de la perforacion del OD, ¿como ha ido desde entonces?'."${hasMultipleSessions ? `,
  "evolucion": "Si hay varias consultas, una linea sobre la evolucion clinica: mejoria, persistencia, recurrencia o control."` : ''}
}

REGLAS ESTRICTAS:
- Usa SOLO informacion explicitamente presente en las notas clinicas.
- Prioriza motivo ORL, lateralidad, hallazgos, pruebas, tratamientos y plan.
- Tono: consulta ORL breve, directo, practico y accionable.
- No conviertas esto en un informe largo ni academico.
- Si solo hay 1 consulta, omite "patrones_observados" y "evolucion".
- NO repitas informacion entre campos.
- Responde SOLO con el JSON, sin explicaciones ni comentarios adicionales.

Paciente: ${patientName || 'Paciente'}
Especialidad: ${specialty}
Profesional de referencia: ${clinicianName || 'No especificado'}
Numero de sesiones en historial: ${sessionCount}

HISTORIAL CLINICO:
${timelineText || 'Sin historial disponible'}`;
    }

    return `Eres una asistente clinica experta en psicologia. Genera un briefing estructurado para la psicologa que va a atender este caso.
El objetivo: que lo lea en 20 segundos antes de que entre el/la paciente y recuerde lo esencial, se reoriente en el caso, y sepa exactamente por donde retomar.

Devuelve un JSON con exactamente esta estructura (si un campo no tiene datos suficientes, OMITE ese campo del JSON, no pongas null ni "No consta"):

{
  "hilo_terapeutico": "Frase breve que capture el tema central del proceso terapeutico, el 'para que' viene esta persona. Ej: 'Duelo por separacion con impacto en autoestima y vinculo con hijos'",
  "ultima_sesion": {
    "fecha": "fecha de la ultima sesion si consta",
    "resumen": "Que se trabajo, que temas surgieron, como estaba el/la paciente. Concreto y util, no generico."
  },
  "momento_del_proceso": "Donde esta el/la paciente en su proceso: fase inicial (exploracion/vinculacion), fase intermedia (trabajo activo), fase avanzada (consolidacion/cierre). Solo si hay suficientes sesiones para inferirlo.",
  "pendientes": ["Tarea o compromiso concreto que quedo pendiente", "Otro pendiente si existe"],
  "patrones_observados": ["Patron recurrente que la psicologa deberia tener presente. Ej: 'Tiende a intelectualizar cuando se acerca a contenido emocional'", "Otro patron si se observa"],
  "alerta_clinica": "Solo si hay algo sensible: ideacion suicida, autolesiones, abuso, consumo, riesgo. NO inventar alertas.",
  "frase_para_retomar": "Sugerencia concreta de como abrir la sesion. Ej: 'La ultima vez hablamos de X y quedaste con la tarea de Y, ¿como te fue?'. Debe ser natural, no robotica."${hasMultipleSessions ? `,
  "evolucion": "Si hay varias sesiones: una linea sobre como ha evolucionado el/la paciente. Mejoria, estancamiento, retroceso, ambivalencia. Solo lo que se observe en las notas."` : ''}
}

REGLAS ESTRICTAS:
- Usa SOLO informacion explicitamente presente en las notas clinicas. No inferir diagnosticos, gravedad ni riesgos que no consten.
- Prioriza lo CONCRETO y ACCIONABLE: temas, tareas, frases literales, datos especificos.
- Tono: como una nota entre colegas clinicas. Breve, precisa, util. No prosa academica.
- El "hilo_terapeutico" es lo mas importante: debe capturar la esencia del caso en una frase.
- La "frase_para_retomar" debe sonar natural, como algo que la psicologa diria de verdad.
- Si solo hay 1 sesion, omite "momento_del_proceso", "patrones_observados" y "evolucion".
- NO repitas informacion entre campos.
- Responde SOLO con el JSON, sin explicaciones ni comentarios adicionales.

Paciente: ${patientName || 'Paciente'}
Especialidad: ${specialty}
Profesional de referencia: ${clinicianName || 'No especificado'}
Numero de sesiones en historial: ${sessionCount}

HISTORIAL CLINICO:
${timelineText || 'Sin historial disponible'}`
};

const buildProvisionalHistory = (reason, consultationType) => getSpecialtyConfig(consultationType).provisionalHistory(reason);

export const generateMedicalHistoryPayload = async ({ transcription, patientName, consultationType, learningContext, clinicianName, styleReference }) => {
    const specialty = normalizeConsultationType(consultationType);
    const startedAt = Date.now();
    try {
        const historyResponse = await callPreferredTextModel({
            prompt: buildGenerateHistoryPrompt(transcription, patientName, specialty, learningContext, clinicianName, styleReference),
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
            modelName: GEMINI_LIGHT_MODEL,
            includeThoughts: true
        }),
        callPreferredTextModel({
            prompt: buildClassificationPrompt(transcription, specialty),
            jsonMode: true,
            temperature: 0,
            maxTokens: 300,
            modelName: GEMINI_LIGHT_MODEL,
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

export const generateMedicalReportPayload = async ({ transcription, patientName, consultationType, learningContext, clinicianName }) => {
    const response = await callGroqChat({
        prompt: buildReportPrompt(transcription, patientName, consultationType, learningContext, clinicianName),
        jsonMode: false,
        temperature: 0.2,
        maxTokens: 1800,
    });
    return {
        text: response.text.trim(),
        model: response.model,
        audit_trace: {}
    };
};

export const regenerateHistorySectionPayload = async (params) => {
    const response = await callGroqChat({
        prompt: buildSectionPrompt(params),
        jsonMode: false,
        temperature: 0.1,
        maxTokens: 900
    });
    return {
        text: response.text.trim(),
        model: response.model,
        audit_trace: {}
    };
};

export const generatePatientBriefingPayload = async ({ patientName, consultationType, clinicianName, timelineItems }) => {
    const response = await callPreferredTextModel({
        prompt: buildBriefingPrompt({ patientName, consultationType, clinicianName, timelineItems }),
        jsonMode: true,
        temperature: 0.15,
        maxTokens: 900,
        modelName: GEMINI_LIGHT_MODEL
    });
    const normalizedText = normalizeBriefingText(response.text);
    if (!normalizedText) {
        throw new Error('briefing_empty_response');
    }
    return {
        text: normalizedText,
        model: response.model
    };
};

export const transcribeAudioPayload = async ({ audioBase64, audioUrl, mimeType, consultationType, clinicianName, clientTrace }) => {
    const debugTrace = createServerDebugTrace(clientTrace);
    try {
        const availability = assertTranscriptionProviderAvailable();
        console.info('[aiServer] transcribeAudioPayload:start', {
            trace_id: debugTrace.trace_id,
            mode: audioUrl ? 'blob' : 'inline',
            mimeType: mimeType || null,
            consultationType: consultationType || null,
            clinicianName: clinicianName || null,
            providerAvailability: availability
        });
        const response = await callPreferredTranscriptionModel({
            audioBase64,
            audioUrl,
            mimeType,
            consultationType,
            clinicianName,
            debugTrace
        });
        finalizeServerDebugTrace(debugTrace);
        console.info('[aiServer] transcribeAudioPayload:success', {
            trace_id: debugTrace.trace_id,
            model: response.model,
            duration_ms: debugTrace.total_duration_ms,
            steps: debugTrace.steps
        });
        return {
            text: response.text,
            model: response.model,
            segments: response.segments,
            debug_trace: debugTrace
        };
    } catch (error) {
        finalizeServerDebugTrace(debugTrace);
        console.error('[aiServer] transcribeAudioPayload:failed', {
            trace_id: debugTrace.trace_id,
            error: error instanceof Error ? error.message : 'transcribe_failed',
            duration_ms: debugTrace.total_duration_ms,
            steps: debugTrace.steps
        });
        throw error;
    } finally {
        await safeDeleteBlob(audioUrl);
    }
};

export {
    getJsonBody,
    writeJson,
    getTranscriptionProviderAvailability
};
