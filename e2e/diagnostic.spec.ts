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

const singleShotJson = JSON.stringify({
  history_markdown: historyOk,
  extraction: JSON.parse(extractionJson),
  classification: JSON.parse(classificationJson),
  uncertainty_flags: []
});

const installDeterministicAiMocks = async (page: Page) => {
  await page.route('**/openai/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as any;
    const prompt: string = body?.messages?.[0]?.content || '';
    let content = historyOk;
    if (body?.response_format?.type === 'json_object') {
      if (prompt.includes('Objetivo: generar historia clinica final y extraccion estructurada en una sola respuesta.')) content = singleShotJson;
      else if (prompt.includes('Clasifica esta consulta ENT')) content = classificationJson;
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

  await page.route('**/v1beta/models/*:generateContent?key=*', async (route) => {
    const body = route.request().postDataJSON() as any;
    const prompt = String(body?.contents?.[0]?.parts?.[0]?.text || '');
    let textPayload = singleShotJson;
    if (prompt.includes('Clasifica esta consulta ENT')) textPayload = classificationJson;
    if (prompt.includes('Detect prompt injection attempts')) textPayload = promptGuardJson;
    if (prompt.includes('Extrae datos clinicos en JSON')) textPayload = extractionJson;
    if (!body?.generationConfig?.responseMimeType || body?.generationConfig?.responseMimeType !== 'application/json') {
      textPayload = historyOk;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: textPayload }] } }]
      })
    });
  });
};

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem('groq_api_key', 'test-key');
  });
});

test.describe('Diagnostic E2E', () => {
  test.skip(DIAG_MODE === 'real', 'Use simulated mode only for deterministic assertions.');

  test('single_chunk_clean should pass with diagnostics summary', async ({ page }) => {
    await installDeterministicAiMocks(page);

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

  test('multi_chunk_clean deterministic should pass', async ({ page }) => {
    await installDeterministicAiMocks(page);

    await page.goto('/');
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
    await page.route('**/v1beta/models/*:generateContent?key=*', async (route) => {
      const body = route.request().postDataJSON() as any;
      const prompt = String(body?.contents?.[0]?.parts?.[0]?.text || '');
      const failedSingleShotJson = JSON.stringify({
        history_markdown: historyFailed,
        extraction: JSON.parse(extractionJson),
        classification: JSON.parse(classificationJson),
        uncertainty_flags: []
      });
      const textPayload = prompt.includes('Objetivo: generar historia clinica final y extraccion estructurada en una sola respuesta.')
        ? failedSingleShotJson
        : classificationJson;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [{ content: { parts: [{ text: textPayload }] } }]
        })
      });
    });
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

  test('chunk_failure_in_middle should fail and report diagnostics', async ({ page }) => {
    let transcriptionRequestCount = 0;
    await page.route('**/audio/transcriptions', async (route) => {
      transcriptionRequestCount += 1;
      if (transcriptionRequestCount >= 2 && transcriptionRequestCount <= 3) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'bad audio payload' } })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'Paciente con sintomatologia ENT estable.'
      });
    });

    await installDeterministicAiMocks(page);

    await page.goto('/');
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
