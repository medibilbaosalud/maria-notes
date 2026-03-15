import { expect, test } from '@playwright/test';
import { generateMedicalHistoryPayload } from '../api/_lib/aiServer.js';

const originalFetch = globalThis.fetch;

const buildGeminiResponse = (
  payload: Record<string, unknown>,
  modelVersion = 'gemini-3-flash-preview',
  thoughtSummary?: string,
  thoughtSignature?: string
) => new Response(
  JSON.stringify({
    modelVersion,
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          parts: [
            ...(thoughtSummary
              ? [{
                thought: true,
                text: thoughtSummary,
                ...(thoughtSignature ? { thoughtSignature } : {})
              }]
              : []),
            {
              text: JSON.stringify(payload)
            }
          ]
        }
      }
    ]
  }),
  {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  }
);

test.describe('generateMedicalHistoryPayload', () => {
  test.beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_TEXT_MODEL = 'gemini-3-flash-preview';
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('uses a single model call and returns unified ORL history payload', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return buildGeminiResponse({
        history_markdown: `## MOTIVO DE CONSULTA
Otalgia derecha

## ANTECEDENTES
- Alergias: No consta
- Enfermedades cronicas: No consta
- Cirugias: No consta
- Tratamiento habitual: No consta

## ENFERMEDAD ACTUAL
- Sintomas: otalgia
- Evolucion: 3 dias

## EXPLORACION / PRUEBAS
Otoscopia: hiperemia

## DIAGNOSTICO
Otitis externa

## PLAN
Tratamiento topico y control`,
        extraction: {
          antecedentes: {
            alergias: [],
            enfermedades_cronicas: [],
            cirugias: [],
            tratamiento_habitual: []
          },
          enfermedad_actual: {
            motivo_consulta: 'Otalgia derecha',
            sintomas: ['otalgia'],
            evolucion: '3 dias'
          },
          exploraciones_realizadas: {
            otoscopia: 'hiperemia'
          },
          diagnostico: ['Otitis externa'],
          plan: 'Tratamiento topico y control',
          notas_calidad: []
        },
        classification: {
          visit_type: 'follow_up',
          clinical_area: 'ear',
          urgency: 'routine',
          confidence: 0.93
        },
        quality_notes: [],
        uncertainty_flags: []
      });
    };

    const result = await generateMedicalHistoryPayload({
      transcription: 'Paciente con otalgia derecha de tres dias.',
      patientName: 'Paciente ORL',
      consultationType: 'otorrino',
      learningContext: undefined
    });

    expect(fetchCalls).toBe(1);
    expect(result.data).toContain('## MOTIVO DE CONSULTA');
    expect(result.classification?.clinical_area).toBe('ear');
    expect(result.logical_calls_used).toBe(1);
    expect(result.physical_calls_used).toBe(1);
    expect(result.gemini_calls_used).toBe(1);
    expect(result.one_call_policy_applied).toBe(true);
    expect(result.quality_notes).toEqual([]);
  });

  test('captures Gemini thought trace internally without contaminating the clinical history', async () => {
    globalThis.fetch = async () => buildGeminiResponse({
      history_markdown: `## MOTIVO DE CONSULTA
Ansiedad

## ANTECEDENTES RELEVANTES
Sin incidencias

## SINTOMATOLOGIA ACTUAL
- Ansiedad anticipatoria

## OBSERVACIONES CLINICAS
Discurso coherente

## IMPRESION CLINICA
Sintomatologia ansiosa

## PLAN TERAPEUTICO
Psychoeducacion y seguimiento`,
      extraction: {
        antecedentes_relevantes: ['Sin incidencias'],
        sintomatologia_actual: ['Ansiedad anticipatoria'],
        observaciones_clinicas: 'Discurso coherente',
        impresion_clinica: 'Sintomatologia ansiosa',
        plan_terapeutico: 'Psychoeducacion y seguimiento',
        notas_calidad: []
      },
      classification: {
        visit_type: 'follow_up',
        clinical_area: 'psicologia',
        urgency: 'routine',
        confidence: 0.88
      },
      quality_notes: [],
      uncertainty_flags: []
    }, 'gemini-3-flash-preview', 'Resumen tecnico interno del razonamiento', 'sig_thought_123');

    const result = await generateMedicalHistoryPayload({
      transcription: 'Paciente con ansiedad anticipatoria.',
      patientName: 'Paciente PSI',
      consultationType: 'psicologia',
      learningContext: undefined
    });

    expect(result.audit_trace?.thought_summary).toContain('Resumen tecnico interno');
    expect(result.audit_trace?.thought_signature).toBe('sig_thought_123');
    expect(result.data).not.toContain('Resumen tecnico interno');
    expect(result.data).toContain('## MOTIVO DE CONSULTA');
  });

  test('returns provisional payload when the unified model call fails', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('gemini_down');
    };

    const result = await generateMedicalHistoryPayload({
      transcription: 'Consulta de psicologia',
      patientName: 'Paciente PSI',
      consultationType: 'psicologia',
      learningContext: undefined
    });

    expect(fetchCalls).toBe(1);
    expect(result.result_status).toBe('failed_recoverable');
    expect(result.logical_calls_used).toBe(0);
    expect(result.one_call_policy_applied).toBe(true);
    expect(result.quality_notes?.[0]?.field).toBe('pipeline');
    expect(result.data).toContain('## MOTIVO DE CONSULTA');
  });
});
