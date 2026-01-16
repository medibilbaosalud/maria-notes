export const simulationData = {
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

    // This replicates the structure returned by the AI Pipeline
    pipelineMetadata: {
        corrections: 0,
        models: { generation: "llama-3-70b", validation: "qwen-2.5-med" },
        errorsFixed: 0,
        versionsCount: 1,
        // The key part: "Uncertainty Flags" aka "Dudas"
        uncertaintyFlags: [
            {
                field_path: "motivo_consulta",
                value: "hipoacusia",
                reason: "¿Confirmas que el paciente usó el término médico 'hipoacusia' o dijo 'sordera'?"
            }
        ],
        extractionMeta: [
            {
                chunk_id: "demo_chunk_1",
                field_evidence: [
                    {
                        field_path: "motivo_consulta",
                        value: "hipoacusia",
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
