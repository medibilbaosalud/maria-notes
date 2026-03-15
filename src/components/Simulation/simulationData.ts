import type { ClinicalSpecialtyId } from '../../clinical/specialties';

export const otorrinoSimulationData = {
    patientName: "Paciente Demo (Simulación)",
    history: `
MOTIVO DE CONSULTA:
Sensación de taponamiento en oído derecho desde hace 3 días.

ANTECEDENTES:
Sin alergias medicamentosas conocidas.
No fumadora.

ENFERMEDAD ACTUAL:
Paciente de 45 años que acude por sensación de hipoacusia y plenitud ótica en oído derecho tras baño en piscina. Niega dolor, otorrea o acúfenos. No vértigo.

EXPLORACIÓN FÍSICA:
Otoscopia OD: Conducto auditivo externo ocupado totalmente por tapón de cerumen que impide visualizar tímpano.
Otoscopia OI: Tímpano íntegro, nacarado, con triángulo luminoso presente.
Orofaringe: Normal.

DIAGNÓSTICO:
Tapón de cerumen OD.

TRATAMIENTO:
Extracción de cerumen mediante lavado con agua templada. Se comprueba integridad timpánica posterior.
    `.trim(),

    pipelineMetadata: {
        corrections: 0,
        models: { generation: "llama-3-70b", validation: "qwen-2.5-med" },
        errorsFixed: 0,
        versionsCount: 1,
        uncertaintyFlags: [
            {
                field_path: "motivo_consulta",
                value: "hipoacusia",
                reason: "¿Confirmas que el paciente usó el término médico 'hipoacusia' o dijo 'sordera'?",
                severity: "medium" as "medium"
            }
        ],
        extractionMeta: [
            {
                chunk_id: "demo_chunk_1",
                field_evidence: [
                    {
                        field_path: "motivo_consulta",
                        value: "hipoacusia",
                        chunk_id: "demo_chunk_1",
                        evidence_snippet: "...noto como una hipoacusia, como que no oigo bien...",
                        confidence: 0.85
                    }
                ]
            }
        ],
        classification: {
            visit_type: "Primera visita",
            ent_area: "Otología",
            urgency: "Normal",
            confidence: 0.99
        }
    }
};

export const psychologySimulationData = {
    patientName: "Paciente Demo Psicología (Simulación)",
    history: `
MOTIVO DE CONSULTA:
Seguimiento de cuadro ansioso-depresivo. Tercera sesión.

ANTECEDENTES RELEVANTES:
Primer episodio depresivo hace dos años tras pérdida de empleo. Tratamiento farmacológico previo con sertralina 50 mg (retirada por decisión propia hace 6 meses). Sin ideación autolítica en ningún momento.

HISTORIA CLÍNICA:
Paciente de 38 años que acude a tercera sesión de seguimiento. Refiere mejoría parcial del ánimo desde la última sesión. Mantiene dificultad para conciliar el sueño (latencia de 40-50 minutos). Ha comenzado a implementar las pautas de higiene del sueño. Describe episodios de ansiedad anticipatoria ante situaciones laborales nuevas, con respuesta fisiológica (taquicardia, sudoración palmar) que remite en 15-20 minutos. Relación de pareja estable, identifica apoyo social como factor protector.

OBSERVACIONES CLÍNICAS:
Aspecto cuidado. Contacto visual adecuado. Discurso coherente y fluido. Afecto congruente. No se observan signos de agitación psicomotriz. Insight conservado. Motivación activa para el proceso terapéutico.

IMPRESIÓN CLÍNICA:
Trastorno adaptativo mixto con ansiedad y ánimo depresivo, en evolución favorable. Respuesta parcial a intervención cognitivo-conductual.

PLAN TERAPÉUTICO:
Continuar con reestructuración cognitiva centrada en anticipación catastrófica laboral. Introducir técnica de exposición gradual. Mantener registro de pensamientos automáticos. Próxima sesión en 15 días.
    `.trim(),

    pipelineMetadata: {
        corrections: 0,
        models: { generation: "llama-3-70b", validation: "qwen-2.5-med" },
        errorsFixed: 0,
        versionsCount: 1,
        uncertaintyFlags: [
            {
                field_path: "antecedentes_relevantes",
                value: "sertralina 50 mg",
                reason: "¿Confirmas la dosis de sertralina? El paciente mencionó '50' pero no quedó claro si eran 50 o 100 mg.",
                severity: "medium" as "medium"
            }
        ],
        extractionMeta: [
            {
                chunk_id: "demo_psy_chunk_1",
                field_evidence: [
                    {
                        field_path: "antecedentes_relevantes",
                        value: "sertralina 50 mg",
                        chunk_id: "demo_psy_chunk_1",
                        evidence_snippet: "...tomaba sertralina, creo que eran cincuenta miligramos...",
                        confidence: 0.72
                    }
                ]
            }
        ],
        classification: {
            visit_type: "Seguimiento",
            ent_area: "Psicología Clínica",
            urgency: "Normal",
            confidence: 0.97
        }
    }
};

/** Backward-compatible alias — default export stays the same shape as before */
export const simulationData = otorrinoSimulationData;

export const getSimulationDataForSpecialty = (specialty: ClinicalSpecialtyId) =>
    specialty === 'psicologia' ? psychologySimulationData : otorrinoSimulationData;
