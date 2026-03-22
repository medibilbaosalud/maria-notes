import type { ClinicalSpecialtyId } from '../../clinical/specialties';
import type { PatientBriefing, PatientCaseSummary, PatientTimelineGroup } from '../../services/storage';

export interface SimulationPayload {
    specialty: ClinicalSpecialtyId;
    patientName: string;
    history: string;
    pipelineMetadata: {
        auditId: string;
        corrections: number;
        models: { generation: string; validation: string };
        errorsFixed: number;
        versionsCount: number;
        uncertaintyFlags: Array<{
            field_path: string;
            value: string;
            reason: string;
            severity: 'medium';
        }>;
        extractionMeta: Array<{
            chunk_id: string;
            field_evidence: Array<{
                field_path: string;
                value: string;
                chunk_id: string;
                evidence_snippet: string;
                confidence: number;
            }>;
        }>;
        classification: {
            visit_type: string;
            ent_area: string;
            urgency: string;
            confidence: number;
        };
    };
    briefing?: PatientBriefing;
    caseSummary?: PatientCaseSummary;
    timelineGroup?: PatientTimelineGroup;
}

export const otorrinoSimulationData: SimulationPayload = {
    specialty: 'otorrino',
    patientName: 'Paciente Demo (Simulacion)',
    history: `
MOTIVO DE CONSULTA:
Sensacion de taponamiento en oido derecho desde hace 3 dias.

ANTECEDENTES:
Sin alergias medicamentosas conocidas.
No fumadora.

ENFERMEDAD ACTUAL:
Paciente de 45 anos que acude por sensacion de hipoacusia y plenitud otica en oido derecho tras bano en piscina. Niega dolor, otorrea o acufenos. No vertigo.

EXPLORACION FISICA:
Otoscopia OD: Conducto auditivo externo ocupado totalmente por tapon de cerumen que impide visualizar timpano.
Otoscopia OI: Timpano integro, nacarado, con triangulo luminoso presente.
Orofaringe: Normal.

DIAGNOSTICO:
Tapon de cerumen OD.

TRATAMIENTO:
Extraccion de cerumen mediante lavado con agua templada. Se comprueba integridad timpanica posterior.
    `.trim(),
    pipelineMetadata: {
        auditId: 'demo-audit-id',
        corrections: 0,
        models: { generation: 'llama-3-70b', validation: 'qwen-2.5-med' },
        errorsFixed: 0,
        versionsCount: 1,
        uncertaintyFlags: [
            {
                field_path: 'motivo_consulta',
                value: 'hipoacusia',
                reason: "¿Confirmas que el paciente uso el termino medico 'hipoacusia' o dijo 'sordera'?",
                severity: 'medium'
            }
        ],
        extractionMeta: [
            {
                chunk_id: 'demo_chunk_1',
                field_evidence: [
                    {
                        field_path: 'motivo_consulta',
                        value: 'hipoacusia',
                        chunk_id: 'demo_chunk_1',
                        evidence_snippet: '...noto como una hipoacusia, como que no oigo bien...',
                        confidence: 0.85
                    }
                ]
            }
        ],
        classification: {
            visit_type: 'Primera visita',
            ent_area: 'Otologia',
            urgency: 'Normal',
            confidence: 0.99
        }
    }
};

const psychologyDemoBriefing: PatientBriefing = {
    id: 'demo-briefing-psy',
    owner_user_id: null,
    normalized_patient_name: 'paciente demo psicologia simulacion',
    patient_name: 'Paciente Demo Psicologia (Simulacion)',
    specialty: 'psicologia',
    clinician_profile: 'ainhoa',
    clinician_name: 'Ainhoa',
    source_kind: 'mixed',
    summary_text: [
        'Ultima sesion: volvio a hablar de ansiedad anticipatoria en el trabajo y de las dificultades de sueno.',
        'Foco actual: regulacion emocional, anticipacion catastrofica laboral y consolidar sensacion de seguridad.',
        'Pendiente: revisar registro de pensamientos automaticos y continuidad de higiene del sueno.',
        'Cuidado: el malestar aparece antes de situaciones nuevas, pero no hay ideacion autolitica descrita.',
        'Profesional: Ainhoa, con apoyo de historico previo importado.'
    ].join('\n'),
    latest_consultation_at: '2026-03-18T17:30:00.000Z',
    generated_from_count: 3,
    generated_from_record_ids: ['demo-psy-legacy-1', 'demo-psy-legacy-2', 'demo-psy-current'],
    model: 'groq:llama-3.3-70b-versatile',
    status: 'ready',
    created_at: '2026-03-22T09:00:00.000Z',
    updated_at: '2026-03-22T09:00:00.000Z'
};

const psychologyDemoCaseSummary: PatientCaseSummary = {
    patientName: 'Paciente Demo Psicologia (Simulacion)',
    latestConsultationAt: '2026-03-18T17:30:00.000Z',
    sessionCount: 3,
    clinicians: ['Ainhoa'],
    mainFocus: 'Ansiedad anticipatoria en el trabajo, dificultades de sueno y necesidad de recuperar sensacion de control sin sobreadaptarse.',
    recurringTopics: ['ansiedad', 'trabajo', 'sueno', 'autoestima'],
    openItems: [
        'Mantener registro de pensamientos automaticos',
        'Revisar como llega a las situaciones laborales nuevas',
        'Comprobar adherencia a higiene del sueno'
    ],
    sensitiveFlags: []
};

const psychologyDemoTimelineGroup: PatientTimelineGroup = {
    patientName: 'Paciente Demo Psicologia (Simulacion)',
    normalizedPatientName: 'paciente demo psicologia simulacion',
    latestConsultationAt: '2026-03-18T17:30:00.000Z',
    sessionCount: 3,
    clinicians: ['Ainhoa'],
    specialties: ['psicologia'],
    sourceCounts: { current: 1, legacy: 2 },
    items: [
        {
            id: 'demo-psy-legacy-2',
            source: 'legacy',
            patientName: 'Paciente Demo Psicologia (Simulacion)',
            specialty: 'psicologia',
            clinicianProfile: 'ainhoa',
            clinicianName: 'Ainhoa',
            consultationAt: '2025-10-11T10:30:00.000Z',
            medicalHistory: 'Historia previa importada. Se exploran antecedentes de ansiedad, relacion entre cansancio y exigencia, y se acuerda trabajar autocuidado y tolerancia a la incertidumbre.',
            isEditable: false,
            sourceLabel: 'Historico importado',
            sourceEmail: 'adelgadopsico@gmail.com'
        },
        {
            id: 'demo-psy-legacy-1',
            source: 'legacy',
            patientName: 'Paciente Demo Psicologia (Simulacion)',
            specialty: 'psicologia',
            clinicianProfile: 'ainhoa',
            clinicianName: 'Ainhoa',
            consultationAt: '2025-12-05T16:00:00.000Z',
            medicalHistory: 'Primera valoracion importada. Refiere miedo intenso a equivocarse en el trabajo, sueno irregular y tendencia a exigirse por encima de lo sostenible. Objetivo terapeutico: reducir hiperalerta y volver a confiar en su criterio.',
            isEditable: false,
            sourceLabel: 'Historico importado',
            sourceEmail: 'adelgadopsico@gmail.com'
        },
        {
            id: 'demo-psy-current',
            source: 'current',
            patientName: 'Paciente Demo Psicologia (Simulacion)',
            specialty: 'psicologia',
            clinicianProfile: 'ainhoa',
            clinicianName: 'Ainhoa',
            consultationAt: '2026-03-18T17:30:00.000Z',
            medicalHistory: 'Seguimiento actual. Mejora parcial del animo, persiste ansiedad anticipatoria en contextos laborales nuevos y dificultad para conciliar el sueno. Se mantiene registro cognitivo y proxima sesion en 15 dias.',
            isEditable: true,
            sourceLabel: 'Consulta actual',
            recordUuid: 'demo-psy-current'
        }
    ]
};

export const psychologySimulationData: SimulationPayload = {
    specialty: 'psicologia',
    patientName: 'Paciente Demo Psicologia (Simulacion)',
    history: `
MOTIVO DE CONSULTA:
Seguimiento de cuadro ansioso-depresivo. Tercera sesion.

ANTECEDENTES RELEVANTES:
Primer episodio depresivo hace dos anos tras perdida de empleo. Tratamiento farmacologico previo con sertralina 50 mg (retirada por decision propia hace 6 meses). Sin ideacion autolitica en ningun momento.

HISTORIA CLINICA:
Paciente de 38 anos que acude a tercera sesion de seguimiento. Refiere mejoria parcial del animo desde la ultima sesion. Mantiene dificultad para conciliar el sueno (latencia de 40-50 minutos). Ha comenzado a implementar las pautas de higiene del sueno. Describe episodios de ansiedad anticipatoria ante situaciones laborales nuevas, con respuesta fisiologica (taquicardia, sudoracion palmar) que remite en 15-20 minutos. Relacion de pareja estable, identifica apoyo social como factor protector.

OBSERVACIONES CLINICAS:
Aspecto cuidado. Contacto visual adecuado. Discurso coherente y fluido. Afecto congruente. No se observan signos de agitacion psicomotriz. Insight conservado. Motivacion activa para el proceso terapeutico.

IMPRESION CLINICA:
Trastorno adaptativo mixto con ansiedad y animo depresivo, en evolucion favorable. Respuesta parcial a intervencion cognitivo-conductual.

PLAN TERAPEUTICO:
Continuar con reestructuracion cognitiva centrada en anticipacion catastrofica laboral. Introducir tecnica de exposicion gradual. Mantener registro de pensamientos automaticos. Proxima sesion en 15 dias.
    `.trim(),
    pipelineMetadata: {
        auditId: 'demo-psy-audit-id',
        corrections: 0,
        models: { generation: 'llama-3-70b', validation: 'qwen-2.5-med' },
        errorsFixed: 0,
        versionsCount: 1,
        uncertaintyFlags: [
            {
                field_path: 'antecedentes_relevantes',
                value: 'sertralina 50 mg',
                reason: '¿Confirmas la dosis de sertralina? El paciente menciono 50, pero no quedo claro si eran 50 o 100 mg.',
                severity: 'medium'
            }
        ],
        extractionMeta: [
            {
                chunk_id: 'demo_psy_chunk_1',
                field_evidence: [
                    {
                        field_path: 'antecedentes_relevantes',
                        value: 'sertralina 50 mg',
                        chunk_id: 'demo_psy_chunk_1',
                        evidence_snippet: '...tomaba sertralina, creo que eran cincuenta miligramos...',
                        confidence: 0.72
                    }
                ]
            }
        ],
        classification: {
            visit_type: 'Seguimiento',
            ent_area: 'Psicologia Clinica',
            urgency: 'Normal',
            confidence: 0.97
        }
    },
    briefing: psychologyDemoBriefing,
    caseSummary: psychologyDemoCaseSummary,
    timelineGroup: psychologyDemoTimelineGroup
};

export const simulationData = otorrinoSimulationData;

export const getSimulationDataForSpecialty = (specialty: ClinicalSpecialtyId) =>
    specialty === 'psicologia' ? psychologySimulationData : otorrinoSimulationData;
