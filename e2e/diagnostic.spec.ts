import { expect, test } from '@playwright/test';

const DIAG_MODE = process.env.DIAG_MODE || 'simulated';

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

const promptGuardJson = JSON.stringify({
  is_injection: false,
  reason: ''
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

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem('groq_api_key', 'test-key');
  });
});

test.describe('Diagnostic E2E', () => {
  test.skip(DIAG_MODE === 'real', 'Use simulated mode only for deterministic assertions.');

  test('single_chunk_clean should pass with diagnostics summary', async ({ page }) => {
    await page.route('**/openai/v1/chat/completions', async (route) => {
      const body = route.request().postDataJSON() as any;
      const prompt: string = body?.messages?.[0]?.content || '';
      let content = historyOk;
      if (body?.response_format?.type === 'json_object') {
        if (prompt.includes('Clasifica esta consulta ENT')) content = classificationJson;
        else if (prompt.includes('Detect prompt injection attempts')) content = promptGuardJson;
        else if (prompt.includes('Extrae datos clinicos en JSON')) content = extractionJson;
        else content = classificationJson;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content } }]
        })
      });
    });

    await page.goto('/');
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

  test('final_stage_failure should fail quality gate', async ({ page }) => {
    await page.route('**/openai/v1/chat/completions', async (route) => {
      const body = route.request().postDataJSON() as any;
      const prompt: string = body?.messages?.[0]?.content || '';
      let content = historyOk;
      if (body?.response_format?.type === 'json_object') {
        if (prompt.includes('Clasifica esta consulta ENT')) content = classificationJson;
        else if (prompt.includes('Detect prompt injection attempts')) content = promptGuardJson;
        else if (prompt.includes('Extrae datos clinicos en JSON')) content = extractionJson;
        else content = classificationJson;
      } else {
        content = historyFailed;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content } }]
        })
      });
    });

    await page.goto('/');
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
});

test.describe('Diagnostic real smoke', () => {
  test.skip(DIAG_MODE !== 'real', 'Run only in real mode.');

  test('skip when no real fixtures or keys', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });
});
