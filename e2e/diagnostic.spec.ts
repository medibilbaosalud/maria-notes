import { expect, test, type Page } from '@playwright/test';

const DIAG_MODE = process.env.DIAG_MODE || 'simulated';
const DIAG_SCENARIO = process.env.DIAG_SCENARIO || 'all';

const extractionJson = JSON.stringify({
  antecedentes: {
    alergias: null,
    enfermedades_cronicas: ['Rinitis alergica'],
    cirugias: null,
    tratamiento_habitual: null
  },
  enfermedad_actual: {
    motivo_consulta: 'Dolor de garganta',
    sintomas: ['odinofagia'],
    evolucion: '3 dias'
  },
  exploraciones_realizadas: {
    faringoscopia: 'hiperemia leve'
  },
  diagnostico: ['Faringitis catarral'],
  plan: 'Hidratacion y analgesia',
  notas_calidad: []
});

const classificationJson = JSON.stringify({
  visit_type: 'first_visit',
  ent_area: 'throat',
  urgency: 'routine',
  confidence: 0.9
});

const historyOk = [
  '## MOTIVO DE CONSULTA',
  'Dolor de garganta de 3 dias.',
  '',
  '## ANTECEDENTES',
  '- Alergias: No consta',
  '- Enfermedades cronicas: Rinitis alergica',
  '- Cirugias: No consta',
  '- Tratamiento habitual: No consta',
  '',
  '## ENFERMEDAD ACTUAL',
  '- Sintomas: odinofagia',
  '- Evolucion: 3 dias',
  '',
  '## EXPLORACION / PRUEBAS',
  'Faringoscopia con hiperemia leve.',
  '',
  '## DIAGNOSTICO',
  'Faringitis catarral.',
  '',
  '## PLAN',
  'Hidratacion, analgesia y control evolutivo.'
].join('\n');

const historyFailed = [
  '## MOTIVO DE CONSULTA',
  'No consta'
].join('\n');

const installDeterministicAiMocks = async (page: Page) => {
  await page.route('**/api/ai/transcribe', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: 'Paciente con sintomatologia ENT estable.', model: 'gemini:gemini-3-flash-preview' })
    });
  });

  await page.route('**/api/ai/extract', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: JSON.parse(extractionJson),
        meta: [],
        classification: JSON.parse(classificationJson),
        model: 'gemini:gemini-3-flash-preview'
      })
    });
  });

  await page.route('**/api/ai/generate-history', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: historyOk,
        model: 'gemini:gemini-3-flash-preview',
        extraction: JSON.parse(extractionJson),
        extraction_meta: [],
        classification: JSON.parse(classificationJson),
        validations: [],
        corrections_applied: 0,
        audit_id: 'audit-test-id',
        pipeline_status: 'completed',
        result_status: 'completed',
        quality_score: 100,
        critical_gaps: [],
        doctor_next_actions: [],
        uncertainty_flags: []
      })
    });
  });

  await page.route('**/api/ai/generate-report', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        text: '## INFORME\n\nPaciente estable.',
        model: 'gemini:gemini-3-flash-preview'
      })
    });
  });

  await page.route('**/api/ai/regenerate-section', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        text: '- Sintomas: odinofagia',
        model: 'gemini:gemini-3-flash-preview'
      })
    });
  });
};

const enterWorkspace = async (page: Page) => {
  const entryButton = page.getByRole('button', { name: /Entrar en modo/i });
  if (await entryButton.isVisible().catch(() => false)) {
    await entryButton.click();
  }
};

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.removeItem('groq_api_key');
  });
});

test.describe('Diagnostic E2E', () => {
  test.skip(DIAG_MODE === 'real', 'Use simulated mode only for deterministic assertions.');

  test('single_chunk_clean should pass with diagnostics summary', async ({ page }) => {
    await installDeterministicAiMocks(page);

    await page.goto('/');
    await enterWorkspace(page);
    await page.getByRole('button', { name: 'Abrir Zona Test' }).click();
    await page.getByRole('button', { name: 'Diagnostico E2E' }).click();
    await page.getByTestId('diagnostic-mode').waitFor();
    await page.getByTestId('diagnostic-scenario').selectOption('single_chunk_clean');
    await page.getByTestId('run-diagnostic-btn').click();

    await expect(page.getByRole('button', { name: 'Nueva Consulta' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Zona Test' }).click();
    await page.getByRole('button', { name: 'Historial Auditoria' }).click();
    await expect(page.getByTestId('diagnostic-history-table')).toContainText('passed');
  });

  test('multi_chunk_clean deterministic should pass', async ({ page }) => {
    await installDeterministicAiMocks(page);

    await page.goto('/');
    await enterWorkspace(page);
    await page.getByRole('button', { name: 'Abrir Zona Test' }).click();
    await page.getByRole('button', { name: 'Diagnostico E2E' }).click();
    await page.getByTestId('diagnostic-mode').waitFor();
    await page.getByTestId('diagnostic-scenario').selectOption('multi_chunk_clean');
    await page.getByTestId('diagnostic-execution-mode').selectOption('deterministic');
    await page.getByTestId('run-diagnostic-btn').click();

    await expect(page.getByRole('button', { name: 'Nueva Consulta' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Zona Test' }).click();
    await page.getByRole('button', { name: 'Historial Auditoria' }).click();
    await expect(page.getByTestId('diagnostic-history-table')).toContainText('passed');
  });

  test('final_stage_failure should fail quality gate', async ({ page }) => {
    await installDeterministicAiMocks(page);
    await page.route('**/api/ai/generate-history', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: historyFailed,
          model: 'gemini:gemini-3-flash-preview',
          extraction: JSON.parse(extractionJson),
          extraction_meta: [],
          classification: JSON.parse(classificationJson),
          validations: [],
          corrections_applied: 0,
          audit_id: 'audit-failed-id',
          pipeline_status: 'completed',
          result_status: 'completed',
          quality_score: 30,
          critical_gaps: [{ field: 'diagnostico', reason: 'missing', severity: 'critical' }],
          doctor_next_actions: [],
          uncertainty_flags: []
        })
      });
    });

    await page.goto('/');
    await enterWorkspace(page);
    await page.getByRole('button', { name: 'Abrir Zona Test' }).click();
    await page.getByRole('button', { name: 'Diagnostico E2E' }).click();
    await page.getByTestId('diagnostic-mode').waitFor();
    await page.getByTestId('diagnostic-scenario').selectOption('final_stage_failure');
    await page.getByTestId('run-diagnostic-btn').click();

    await expect(page.getByRole('button', { name: 'Nueva Consulta' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Zona Test' }).click();
    await page.getByRole('button', { name: 'Historial Auditoria' }).click();
    await expect(page.getByTestId('diagnostic-history-table')).toContainText('failed');
  });

  test('chunk_failure_in_middle should fail and report diagnostics', async ({ page }) => {
    let transcriptionRequestCount = 0;
    await page.route('**/api/ai/transcribe', async (route) => {
      transcriptionRequestCount += 1;
      if (transcriptionRequestCount >= 2 && transcriptionRequestCount <= 3) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'bad audio payload' })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: 'Paciente con sintomatologia ENT estable.', model: 'gemini:gemini-3-flash-preview' })
      });
    });

    await installDeterministicAiMocks(page);

    await page.goto('/');
    await enterWorkspace(page);
    await page.getByRole('button', { name: 'Abrir Zona Test' }).click();
    await page.getByRole('button', { name: 'Diagnostico E2E' }).click();
    await page.getByTestId('diagnostic-mode').waitFor();
    await page.getByTestId('diagnostic-scenario').selectOption('chunk_failure_in_middle');
    await page.getByTestId('run-diagnostic-btn').click();

    await expect(page.getByRole('button', { name: 'Nueva Consulta' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Zona Test' }).click();
    await page.getByRole('button', { name: 'Historial Auditoria' }).click();
    await expect(page.getByTestId('diagnostic-history-table')).toContainText('failed');
  });

  test('hourly_complex_consultation deterministic should pass', async ({ page }) => {
    await installDeterministicAiMocks(page);

    await page.goto('/');
    await enterWorkspace(page);
    await page.getByRole('button', { name: 'Abrir Zona Test' }).click();
    await page.getByRole('button', { name: 'Diagnostico E2E' }).click();
    await page.getByTestId('diagnostic-mode').waitFor();
    await page.getByTestId('diagnostic-scenario').selectOption('hourly_complex_consultation');
    await page.getByTestId('diagnostic-execution-mode').selectOption('deterministic');
    await page.getByTestId('run-diagnostic-btn').click();

    await expect(page.getByRole('button', { name: 'Nueva Consulta' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Zona Test' }).click();
    await page.getByRole('button', { name: 'Historial Auditoria' }).click();
    await expect(page.getByTestId('diagnostic-history-table')).toContainText('hourly_complex_consultation');
    await expect(page.getByTestId('diagnostic-history-table')).toContainText('passed');
  });
});

test.describe('Diagnostic real smoke', () => {
  test.skip(DIAG_MODE !== 'real', 'Run only in real mode.');

  test('skip when no real fixtures or keys', async ({ page }) => {
    test.skip(DIAG_SCENARIO === 'hourly', 'Hourly real run is executed from UI/manual flow.');
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });
});
