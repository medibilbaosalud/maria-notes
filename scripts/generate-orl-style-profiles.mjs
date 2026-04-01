import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const ENV_PATH = path.resolve(ROOT_DIR, '.env');
const OUTPUT_PATH = path.resolve(ROOT_DIR, 'api', '_lib', 'orlStyleProfiles.generated.js');
const SPECIALTY = 'otorrino';
const CLINICIAN = { key: 'gotxi', clinicianName: 'Dra. Gotxi' };

const OPENER_CANDIDATES = [
  'refiere',
  'acude',
  'desde hace',
  'le traen porque',
  'control'
];

const LABEL_CANDIDATES = [
  'exploracion:',
  'otoscopia:',
  'videonaso:',
  'videonasofibroscopia:',
  'videofibrolaringoestroboscopia:',
  'impe:',
  'rinoscopia:',
  'expl vestibular:',
  'plan:'
];

const TERM_CANDIDATES = [
  'disfonia',
  'hipoacusia',
  'cerumen',
  'tapones',
  'rinorrea',
  'lavados',
  'nasonex',
  'control',
  'alta',
  'bilateral'
];

const ABBREVIATION_CANDIDATES = ['od', 'oi', 'izq', 'dcha', 'impe', 'g', 'r', 'b', 'a', 's'];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loadEnvFile = async () => {
  try {
    const raw = await fs.readFile(ENV_PATH, 'utf8');
    return raw.split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex < 0) return acc;
      acc[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const countCandidateOccurrences = (notes, candidates) => {
  const counts = new Map();
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    const regex = new RegExp(`\\b${escapeRegExp(normalizedCandidate)}\\b`, 'g');
    let count = 0;
    for (const note of notes) {
      const matches = normalizeText(note).match(regex);
      count += matches ? matches.length : 0;
    }
    if (count > 0) counts.set(candidate, count);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .map(([label, count]) => ({ label, count }));
};

const fetchLegacyNotes = async ({ supabaseUrl, supabaseKey }) => {
  const url = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/legacy_clinical_records`);
  url.searchParams.set('select', 'original_medical_history');
  url.searchParams.set('specialty', `eq.${SPECIALTY}`);
  url.searchParams.set('clinician_profile', `eq.${CLINICIAN.key}`);
  url.searchParams.set('order', 'consultation_at.desc');
  url.searchParams.set('limit', '1000');

  const response = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`legacy_orl_notes_fetch_failed (${response.status}): ${errorText}`);
  }

  const rows = await response.json();
  return Array.isArray(rows)
    ? rows.map((row) => String(row?.original_medical_history || '').trim()).filter(Boolean)
    : [];
};

const toProfilePayload = ({ notes }) => {
  const frequentOpeners = countCandidateOccurrences(notes, OPENER_CANDIDATES);
  const frequentLabels = countCandidateOccurrences(notes, LABEL_CANDIDATES);
  const frequentTerms = countCandidateOccurrences(notes, TERM_CANDIDATES);
  const frequentAbbreviations = countCandidateOccurrences(notes, ABBREVIATION_CANDIDATES);

  return {
    clinicianKey: CLINICIAN.key,
    clinicianName: CLINICIAN.clinicianName,
    sampleCount: notes.length,
    generatedAt: new Date().toISOString(),
    frequentOpeners: frequentOpeners.map((entry) => entry.label),
    frequentLabels: frequentLabels.map((entry) => entry.label.toUpperCase()),
    frequentTerms: frequentTerms.map((entry) => entry.label),
    frequentAbbreviations: frequentAbbreviations.map((entry) => entry.label.toUpperCase()),
    debugCounts: {
      openers: Object.fromEntries(frequentOpeners.map((entry) => [entry.label, entry.count])),
      labels: Object.fromEntries(frequentLabels.map((entry) => [entry.label.toUpperCase(), entry.count])),
      terms: Object.fromEntries(frequentTerms.map((entry) => [entry.label, entry.count])),
      abbreviations: Object.fromEntries(frequentAbbreviations.map((entry) => [entry.label.toUpperCase(), entry.count]))
    }
  };
};

const buildModuleSource = (profiles) => `export const GENERATED_ORL_STYLE_PROFILES = ${JSON.stringify(profiles, null, 2)};\n`;

const main = async () => {
  const envFromFile = await loadEnvFile();
  const supabaseUrl = process.env.VITE_SUPABASE_URL || envFromFile.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || envFromFile.VITE_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('missing_supabase_credentials_for_orl_style_generation');
  }

  const notes = await fetchLegacyNotes({ supabaseUrl, supabaseKey });
  const profiles = {
    [CLINICIAN.key]: toProfilePayload({ notes })
  };

  await fs.writeFile(OUTPUT_PATH, buildModuleSource(profiles), 'utf8');
  console.log(`Generated ORL style profiles at ${OUTPUT_PATH}`);
  console.log(`- ${CLINICIAN.clinicianName}: ${profiles[CLINICIAN.key].sampleCount} notes analysed`);
};

await main();
