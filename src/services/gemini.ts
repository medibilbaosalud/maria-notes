import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL_PRIORITY = [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-live",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
];

export class GeminiService {
    private genAI: GoogleGenerativeAI;

    constructor(apiKey: string) {
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    private async delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
        let lastError = null;

        for (const modelName of MODEL_PRIORITY) {
            try {
                console.log(`Attempting transcription with model: ${modelName}`);
                const model = this.genAI.getGenerativeModel({ model: modelName });

                const result = await model.generateContent([
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: audioBase64
                        }
                    },
                    { text: "Please provide a verbatim transcription of this audio." },
                ]);

                const response = await result.response;
                return response.text();
            } catch (error: any) {
                console.warn(`Transcription failed with ${modelName}:`, error);
                lastError = error;

                // If rate limited (429), wait longer
                if (error.message?.includes('429') || error.status === 429) {
                    console.log('Rate limit hit, waiting 2s...');
                    await this.delay(2000);
                } else {
                    await this.delay(500); // Small delay for other errors
                }
            }
        }
        throw lastError || new Error("All models failed to transcribe audio.");
    }

    async generateMedicalHistory(transcription: string, patientName: string = ""): Promise<string> {
        let lastError = null;
        const prompt = `
      Eres Maria Notes, asistente clínico especializado en Otorrinolaringología. Tu tarea es transformar transcripciones de consulta en notas clínicas estructuradas, concisas y en estilo telegráfico.

      INSTRUCCIONES OBLIGATORIAS:

      1. DETECCIÓN AUTOMÁTICA DE PLANTILLA:
      Según los síntomas y hallazgos, selecciona la más adecuada:
      • ORL Voz: disfonía, fatiga vocal, estroboscopia, GRBAS, VHI-10.
      • ORL Deglución: disfagia, tos al tragar, EAT-10, FEES.
      • ORL Otología: hipoacusia, tinnitus, otalgia, otoscopia, impedanciometría.
      • ORL Vértigo: vértigo, inestabilidad, nistagmo, vHIT, Dix-Hallpike.
      • ORL General: rinitis, sinusitis, epistaxis o mezcla confusa.
      *Prioriza la que tenga prueba específica. Si hay duda, usa ORL General.*

      2. ESTRUCTURA Y FORMATO (ESTRICTO):
      • Rellena la plantilla seleccionada.
      • Rótulos en mayúsculas y separados por salto de línea.
      • Si no se menciona algo, escribe "N/A". No uses "—".
      • En "Audiometría", escribe SIEMPRE: "(rellenar por nosotros)".
      • En "Exploración complementaria", incluye SOLO UNA prueba (la más relevante).
      • Estilo telegráfico: máximo 14 palabras/línea. Sin prosa. Unidades: mg, d, sem.
      
      EJEMPLOS DE REFERENCIA (ESTILO ESPERADO):
      
      Ejemplo 1 (Voz):
      ENFERMEDAD ACTUAL
      Disfonía 1.5 años; peor últimos meses; no mejora con reposo.
      EXPLORACIÓN GENERAL
      G: 2 R: 2 B: 0 A: 1 S: 0
      EXPLORACIÓN COMPLEMENTARIA
      Videolaringoestroboscopia: FNI, cavum, valleculas libres; CV móviles con nódulos tercio medio.
      PLAN TERAPÉUTICO
      Logopedia.

      Ejemplo 2 (Pediatría/General):
      ENFERMEDAD ACTUAL
      Odinofagia repetición; episodio rinorrea/neumonía dic; Strepto+; tos perruna; voz gangosa previa.
      EXPLORACIÓN GENERAL
      Cavidad oral: hipertrofia amigdalar subobstructiva; retromoco.
      Rinoscopia: rinorrea.
      Otoscopia: normal.
      Impedanciometría: NORMAL.
      PLAN TERAPÉUTICO
      Lavados nasales + Nasonex 1/24h 3m; Inmunoferon 3m; Pectox 5ml/8h 1m; Polisomnografía pte; control 3m.

      Ejemplo 3 (Voz Post-Catarro):
      ENFERMEDAD ACTUAL
      Disfonía tras catarro e inicio inhalador corticoideo.
      EXPLORACIÓN GENERAL
      G: 1 R: 0 B: 1 A: 1 S: 0
      EXPLORACIÓN COMPLEMENTARIA
      Videolaringoestroboscopia: CV-S leve atrofia; hiatus ojival; acortamiento trasversal; fonación bandas.
      PLAN TERAPÉUTICO
      Higiene vocal; si persiste 1 mes cita logopedia.

      ---
      PLANTILLA BASE (A rellenar):
      
      ANTECEDENTES PERSONALES
      Alergias medicamentosas: ...
      Enfermedades crónicas: ...
      Intervenciones quirúrgicas: ...
      Tratamiento habitual: ...

      ENFERMEDAD ACTUAL
      ...

      EXPLORACIÓN GENERAL (Solo si se menciona)
      Cavidad oral: ...
      Rinoscopia: ...
      Otoscopia: ...
      Impedanciometría: ...
      Audiometría: (rellenar por nosotros)

      EXPLORACIÓN COMPLEMENTARIA (Elegir SOLO UNA)
      [Nombre Prueba]: ...

      IMPRESIÓN DIAGNÓSTICA
      1. ...

      PLAN TERAPÉUTICO
      ...

      3. PASO FINAL:
      Si tienes comentarios sobre la calidad del audio, el tono del paciente o observaciones extra-clínicas, añádelas AL FINAL, separadas por "---MARIA_NOTES---".
      
      IMPORTANTE:
      - NO empieces con "Claro", "Aquí tienes", "Comprendido".
      - Empieza DIRECTAMENTE con el título de la primera sección (ej. ANTECEDENTES PERSONALES).
      - La parte superior debe ser SOLO la historia clínica lista para copiar y pegar.
      - NO incluyas preguntas finales como "¿Desea que le prepare también el informe médico?".
      - NO incluyas texto conversacional al final.

      ---
      CONTEXTO:
      Paciente: ${patientName || "No especificado"}
      
      TRANSCRIPCIÓN:
      ${transcription}
    `;

        for (const modelName of MODEL_PRIORITY) {
            try {
                console.log(`Attempting history generation with model: ${modelName}`);
                const model = this.genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                return response.text();
            } catch (error: any) {
                console.warn(`History generation failed with ${modelName}:`, error);
                lastError = error;

                // If rate limited (429), wait longer
                if (error.message?.includes('429') || error.status === 429) {
                    console.log('Rate limit hit, waiting 2s...');
                    await this.delay(2000);
                } else {
                    await this.delay(500);
                }
            }
        }
        throw lastError || new Error("All models failed to generate medical history.");
    }

    async generateMedicalReport(transcription: string, patientName: string = ""): Promise<string> {
        let lastError = null;
        const prompt = `
            Eres Maria Notes, asistente clínico experto. Genera un INFORME MÉDICO FORMAL basado en la transcripción.
            
            INSTRUCCIONES CRÍTICAS:
            1. NO saludes, NO digas "De acuerdo", NO des explicaciones.
            2. Empieza DIRECTAMENTE con el contenido del informe.
            3. Usa formato Markdown para negritas (**texto**).
            
            Usa ESTRICTAMENTE esta plantilla:

            **INFORME MÉDICO**

            **Paciente:** ${patientName || "No especificado"}
            
            **ANTECEDENTES PERSONALES:**
            [Extraer antecedentes. Si no hay, poner "Sin interés para el episodio actual" o "NAM" si aplica.]

            **ENFERMEDAD ACTUAL:**
            [Resumen conciso y técnico del motivo de consulta y evolución.]

            **EXPLORACION:**
            [Datos objetivos. Si es voz, usar formato G R B A S si está disponible.]
            
            **VIDEOFIBROLARINGOESTROBOSCOPIA:**
            [Hallazgos específicos de la prueba. Si no se hizo, poner "No realizada" o omitir si no hay datos.]

            **IMPRESIÓN DIAGNOSTICA:**
            [Diagnóstico principal.]

            **PLAN:**
            [Tratamiento o recomendaciones.]

            ---
            TRANSCRIPCIÓN:
            ${transcription}
        `;

        for (const modelName of MODEL_PRIORITY) {
            try {
                console.log(`Attempting report generation with model: ${modelName}`);
                const model = this.genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                return response.text();
            } catch (error: any) {
                console.warn(`Report generation failed with ${modelName}:`, error);
                lastError = error;
                if (error.message?.includes('429') || error.status === 429) {
                    await this.delay(2000);
                } else {
                    await this.delay(500);
                }
            }
        }
        throw lastError || new Error("All models failed to generate medical report.");
    }
}
