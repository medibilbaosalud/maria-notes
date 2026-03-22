import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const ENV_PATH = path.resolve(ROOT_DIR, '.env');
const OUTPUT_PATH = path.resolve(ROOT_DIR, 'api', '_lib', 'psychologyStyleProfiles.generated.js');
const SPECIALTY = 'psicologia';
const CLINICIANS = [
  { key: 'ainhoa', clinicianName: 'Ainhoa' },
  { key: 'june', clinicianName: 'June' }
];

const VERB_CANDIDATES = [
  'acude', 'viene', 'refiere', 'describe', 'comenta', 'destaca', 'mantiene', 'presenta',
  'trabaja', 'vive', 'lleva', 'tiene', 'empieza', 'comenzo', 'comenzó', 'explica',
  'considera', 'siente', 'cuenta', 'realiza', 'define', 'observa', 'menciona', 'estudia',
  'reside', 'convive', 'padece', 'consume', 'duerme', 'mejora'
];

const PHRASE_CANDIDATES = [
  'motivo de consulta',
  'situacion actual',
  'acude a consulta',
  'viene a terapia',
  'a dia de hoy',
  'respecto a',
  'en cuanto a',
  'un dia normal',
  'objetivos terapeuticos',
  'proxima sesion',
  'próxima sesión',
  'me cuenta que',
  'refiere que',
  'actualmente',
  'se encuentra',
  'buena relacion',
  'buena relación'
];

const LABEL_CANDIDATES = [
  'motivo de consulta',
  'situacion actual',
  'areas',
  'familia',
  'pareja',
  'social',
  'sintomas',
  'antecedentes',
  'medicacion',
  'dia normal',
  'hobbies',
  'objetivos terapeuticos',
  'observaciones',
  'ot',
  'proxima sesion'
];

const TERM_CANDIDATES = [
  'ansiedad', 'autoestima', 'familia', 'pareja', 'trabajo', 'estudios', 'apoyo', 'apoyos',
  'rutina', 'sueno', 'sueño', 'alimentacion', 'alimentación', 'actividad fisica',
  'actividad física', 'hobbies', 'duelo', 'emocional', 'emociones', 'motivacion',
  'motivación', 'autocuidado', 'relacion', 'relación', 'amistades', 'malestar'
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loadEnvFile = async () => {
  try {
    const raw = await fs.readFile(ENV_PATH, 'utf8');
    return raw.split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex < 0) return acc;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      acc[key] = value;
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

const countCandidateOccurrences = (notes, candidates, mode = 'word') => {
  const counts = new Map();
  const normalizedSeen = new Set();
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedCandidate || normalizedSeen.has(normalizedCandidate)) {
      continue;
    }
    normalizedSeen.add(normalizedCandidate);

    const regex = new RegExp(`\\b${escapeRegExp(normalizedCandidate)}\\b`, 'g');

    let count = 0;
    for (const note of notes) {
      const matches = normalizeText(note).match(regex);
      count += matches ? matches.length : 0;
    }
    if (count > 0) {
      counts.set(candidate, count);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .map(([label, count]) => ({ label, count }));
};

const fetchLegacyNotes = async ({ supabaseUrl, supabaseKey, clinicianProfile }) => {
  const url = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/legacy_clinical_records`);
  url.searchParams.set('select', 'clinician_profile,original_medical_history');
  url.searchParams.set('specialty', `eq.${SPECIALTY}`);
  url.searchParams.set('clinician_profile', `eq.${clinicianProfile}`);
  url.searchParams.set('order', 'consultation_at.desc');
  url.searchParams.set('limit', '500');

  const response = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`legacy_notes_fetch_failed (${response.status}): ${errorText}`);
  }

  const rows = await response.json();
  return Array.isArray(rows)
    ? rows.map((row) => String(row?.original_medical_history || '').trim()).filter(Boolean)
    : [];
};

const toProfilePayload = ({ clinicianKey, clinicianName, notes }) => {
  const frequentVerbs = countCandidateOccurrences(notes, VERB_CANDIDATES, 'word').slice(0, 10);
  const frequentPhrases = countCandidateOccurrences(notes, PHRASE_CANDIDATES, 'phrase').slice(0, 10);
  const frequentLabels = countCandidateOccurrences(notes, LABEL_CANDIDATES, 'phrase').slice(0, 12);
  const frequentTerms = countCandidateOccurrences(notes, TERM_CANDIDATES, 'phrase').slice(0, 10);

  return {
    clinicianKey,
    clinicianName,
    sampleCount: notes.length,
    generatedAt: new Date().toISOString(),
    frequentVerbs: frequentVerbs.map((entry) => entry.label),
    frequentPhrases: frequentPhrases.map((entry) => entry.label),
    frequentLabels: frequentLabels.map((entry) => entry.label),
    frequentTerms: frequentTerms.map((entry) => entry.label),
    debugCounts: {
      verbs: Object.fromEntries(frequentVerbs.map((entry) => [entry.label, entry.count])),
      phrases: Object.fromEntries(frequentPhrases.map((entry) => [entry.label, entry.count])),
      labels: Object.fromEntries(frequentLabels.map((entry) => [entry.label, entry.count])),
      terms: Object.fromEntries(frequentTerms.map((entry) => [entry.label, entry.count]))
    }
  };
};

const buildModuleSource = (profiles) => `export const GENERATED_PSYCHOLOGY_STYLE_PROFILES = ${JSON.stringify(profiles, null, 2)};\n`;

const main = async () => {
  const envFromFile = await loadEnvFile();
  const supabaseUrl = process.env.VITE_SUPABASE_URL || envFromFile.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || envFromFile.VITE_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('missing_supabase_credentials_for_style_generation');
  }

  const profiles = {};
  for (const clinician of CLINICIANS) {
    const notes = await fetchLegacyNotes({
      supabaseUrl,
      supabaseKey,
      clinicianProfile: clinician.key
    });
    profiles[clinician.key] = toProfilePayload({
      clinicianKey: clinician.key,
      clinicianName: clinician.clinicianName,
      notes
    });
  }

  await fs.writeFile(OUTPUT_PATH, buildModuleSource(profiles), 'utf8');

  console.log(`Generated psychology style profiles at ${OUTPUT_PATH}`);
  for (const clinician of CLINICIANS) {
    const profile = profiles[clinician.key];
    console.log(`- ${clinician.clinicianName}: ${profile.sampleCount} notes analysed`);
  }
};

await main();
