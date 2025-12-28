// Groq API Service - Fallback for when Gemini fails
// Uses Groq's LPU for fast inference with Llama/Whisper models

const GROQ_API_URL = 'https://api.groq.com/openai/v1';

// Model priority cascades (best to fallback)
const GROQ_TEXT_MODELS = [
    'groq/compound',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'llama-3.3-70b-versatile',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'qwen/qwen3-32b',
];

const GROQ_WHISPER_MODELS = [
    'whisper-large-v3-turbo',
    'whisper-large-v3',
];

export class GroqService {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    private async delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async transcribeAudio(audioBlob: Blob): Promise<string> {
        let lastError = null;

        for (const modelName of GROQ_WHISPER_MODELS) {
            try {
                console.log(`[Groq] Attempting transcription with: ${modelName}`);

                const formData = new FormData();
                formData.append('file', audioBlob, 'audio.webm');
                formData.append('model', modelName);
                formData.append('language', 'es');
                formData.append('response_format', 'text');

                const response = await fetch(`${GROQ_API_URL}/audio/transcriptions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                    },
                    body: formData,
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Groq API error: ${response.status} - ${errorText}`);
                }

                const text = await response.text();
                return text;
            } catch (error: any) {
                console.warn(`[Groq] Transcription failed with ${modelName}:`, error);
                lastError = error;

                if (error.message?.includes('429')) {
                    await this.delay(2000);
                } else {
                    await this.delay(500);
                }
            }
        }
        throw lastError || new Error("All Groq Whisper models failed.");
    }

    async generateText(prompt: string): Promise<string> {
        let lastError = null;

        for (const modelName of GROQ_TEXT_MODELS) {
            try {
                console.log(`[Groq] Attempting text generation with: ${modelName}`);

                const response = await fetch(`${GROQ_API_URL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: modelName,
                        messages: [
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.7,
                        max_tokens: 4096,
                    }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Groq API error: ${response.status} - ${errorText}`);
                }

                const data = await response.json();
                return data.choices[0]?.message?.content || '';
            } catch (error: any) {
                console.warn(`[Groq] Text generation failed with ${modelName}:`, error);
                lastError = error;

                if (error.message?.includes('429')) {
                    await this.delay(2000);
                } else {
                    await this.delay(500);
                }
            }
        }
        throw lastError || new Error("All Groq text models failed.");
    }

    async generateMedicalHistory(transcription: string, patientName: string = ""): Promise<string> {
        const prompt = `
Eres Maria Notes, asistente clínico especializado en Otorrinolaringología. Tu tarea es transformar transcripciones de consulta en notas clínicas estructuradas, concisas y en estilo telegráfico.

REGLA CRÍTICA - NO INVENTAR:
• SOLO incluye exploraciones y pruebas que el médico MENCIONE EXPLÍCITAMENTE en la transcripción.
• Si el médico no menciona otoscopia, rinoscopia, audiometría, GRBAS, etc., NO las incluyas.
• NO escribas "N/A" para pruebas no mencionadas. Simplemente OMITE esa línea.
• Cada consulta es diferente: incluye ÚNICAMENTE lo que se dijo.

INSTRUCCIONES OBLIGATORIAS:

1. DETECCIÓN AUTOMÁTICA DE PLANTILLA:
Según los síntomas y hallazgos, selecciona la más adecuada:
• ORL Voz: disfonía, fatiga vocal, estroboscopia, GRBAS, VHI-10.
• ORL Deglución: disfagia, tos al tragar, EAT-10, FEES.
• ORL Otología: hipoacusia, tinnitus, otalgia, otoscopia, impedanciometría.
• ORL Vértigo: vértigo, inestabilidad, nistagmo, vHIT, Dix-Hallpike.
• ORL General: rinitis, sinusitis, epistaxis o mezcla confusa.

2. ESTRUCTURA Y FORMATO (ESTRICTO):
• Rellena la plantilla seleccionada.
• Rótulos en mayúsculas y separados por salto de línea.
• Si no se menciona un campo, OMÍTELO completamente.
• Estilo telegráfico: máximo 14 palabras/línea.

PLANTILLA BASE:
ANTECEDENTES PERSONALES
Alergias medicamentosas: ...
Enfermedades crónicas: ...
Intervenciones quirúrgicas: ...
Tratamiento habitual: ...

ENFERMEDAD ACTUAL
...

EXPLORACIÓN GENERAL
Cavidad oral: ...
Rinoscopia: ...
Otoscopia: ...
Impedanciometría: ...
Audiometría: (rellenar por nosotros)

EXPLORACIÓN COMPLEMENTARIA
[Nombre Prueba]: ...

IMPRESIÓN DIAGNÓSTICA
1. ...

PLAN TERAPÉUTICO
...

IMPORTANTE:
- NO empieces con "Claro", "Aquí tienes".
- Empieza DIRECTAMENTE con ANTECEDENTES PERSONALES.
- Si tienes observaciones extra-clínicas, añádelas AL FINAL, separadas por "---MARIA_NOTES---".

---
CONTEXTO:
Paciente: ${patientName || "No especificado"}

TRANSCRIPCIÓN:
${transcription}
        `;
        return this.generateText(prompt);
    }

    async generateMedicalReport(transcription: string, patientName: string = ""): Promise<string> {
        const prompt = `
Eres Maria Notes, asistente clínico experto. Genera un INFORME MÉDICO FORMAL basado en la transcripción.

REGLA CRÍTICA - NO INVENTAR:
• SOLO incluye exploraciones y pruebas que el médico MENCIONE EXPLÍCITAMENTE.
• Si el médico no menciona GRBAS, otoscopia, audiometría, etc., NO las incluyas.
• NO pongas "No disponible" ni "No realizada" para pruebas no mencionadas. OMÍTELAS.
• Cada consulta tiene exploraciones diferentes según la patología.

INSTRUCCIONES:
1. NO saludes, NO digas "De acuerdo", NO des explicaciones.
2. Empieza DIRECTAMENTE con el contenido del informe.
3. Usa formato Markdown para negritas (**texto**).

Usa esta plantilla (OMITE secciones sin datos):

**INFORME MÉDICO**

**Paciente:** ${patientName || "No especificado"}

**ANTECEDENTES PERSONALES:**
[Extraer antecedentes. Si no hay, poner "Sin interés para el episodio actual".]

**ENFERMEDAD ACTUAL:**
[Resumen conciso y técnico del motivo de consulta y evolución.]

**EXPLORACIÓN:**
[SOLO las exploraciones mencionadas por el médico.]

**IMPRESIÓN DIAGNÓSTICA:**
[Diagnóstico principal.]

**PLAN:**
[Tratamiento o recomendaciones mencionadas.]

---
TRANSCRIPCIÓN:
${transcription}
        `;
        return this.generateText(prompt);
    }
}
