export type ClinicalSpecialtyId = 'otorrino' | 'psicologia';

export interface ClinicalSpecialtyConfig {
    id: ClinicalSpecialtyId;
    consultationType: string;
    shortLabel: string;
    displayName: string;
    professionalLabel: string;
    reportTitle: string;
    historyTitle: string;
    requiredSections: string[];
}

const SPECIALTY_CONFIG: Record<ClinicalSpecialtyId, ClinicalSpecialtyConfig> = {
    otorrino: {
        id: 'otorrino',
        consultationType: 'otorrino',
        shortLabel: 'Otorrino',
        displayName: 'Otorrinolaringologia',
        professionalLabel: 'Otorrinolaringologia',
        reportTitle: 'Informe medico ORL',
        historyTitle: 'Historia clinica ORL',
        requiredSections: [
            '## MOTIVO DE CONSULTA',
            '## ANTECEDENTES',
            '## ENFERMEDAD ACTUAL',
            '## EXPLORACION / PRUEBAS',
            '## DIAGNOSTICO',
            '## PLAN'
        ]
    },
    psicologia: {
        id: 'psicologia',
        consultationType: 'psicologia',
        shortLabel: 'Psicologia',
        displayName: 'Psicologia',
        professionalLabel: 'Psicologia clinica',
        reportTitle: 'Informe psicologico',
        historyTitle: 'Historia psicologica',
        requiredSections: [
            '## MOTIVO DE CONSULTA',
            '## ANTECEDENTES RELEVANTES',
            '## SINTOMATOLOGIA ACTUAL',
            '## OBSERVACIONES CLINICAS',
            '## IMPRESION CLINICA',
            '## PLAN TERAPEUTICO'
        ]
    }
};

const OTORRINO_ALIASES = new Set([
    'otorrino',
    'otorrinolaringologia',
    'otorrinolaringología',
    'orl',
    'ent',
    'historia',
    'historia_orl',
    'historia_clinica_orl'
]);

const PSICOLOGIA_ALIASES = new Set([
    'psicologia',
    'psicología',
    'psicologia clinica',
    'psicología clínica',
    'psicologia_clinica',
    'psychology',
    'psych'
]);

const normalizeKey = (value?: string | null): string => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export const normalizeClinicalSpecialty = (value?: string | null): ClinicalSpecialtyId => {
    const normalized = normalizeKey(value);
    if (PSICOLOGIA_ALIASES.has(normalized)) return 'psicologia';
    if (OTORRINO_ALIASES.has(normalized)) return 'otorrino';
    return normalized.includes('psic') ? 'psicologia' : 'otorrino';
};

export const getClinicalSpecialtyConfig = (value?: string | null): ClinicalSpecialtyConfig => {
    return SPECIALTY_CONFIG[normalizeClinicalSpecialty(value)];
};

export const getClinicalSpecialtyOptions = (): ClinicalSpecialtyConfig[] => {
    return [SPECIALTY_CONFIG.otorrino, SPECIALTY_CONFIG.psicologia];
};

export const getRequiredSectionsForSpecialty = (value?: string | null): string[] => {
    return getClinicalSpecialtyConfig(value).requiredSections;
};

export const buildLocalProvisionalHistoryForSpecialty = (value: string | null | undefined, reason: string): string => {
    const specialty = normalizeClinicalSpecialty(value);
    if (specialty === 'psicologia') {
        return `## MOTIVO DE CONSULTA
No consta (procesamiento aplazado)

## ANTECEDENTES RELEVANTES
No consta

## SINTOMATOLOGIA ACTUAL
No consta

## OBSERVACIONES CLINICAS
No consta

## IMPRESION CLINICA
No consta

## PLAN TERAPEUTICO
Reintentar procesamiento automatico. Motivo tecnico: ${reason || 'pipeline_error'}`;
    }

    return `## MOTIVO DE CONSULTA
No consta (procesamiento aplazado)

## ANTECEDENTES
- Alergias: No consta
- Enfermedades cronicas: No consta
- Cirugias: No consta
- Tratamiento habitual: No consta

## ENFERMEDAD ACTUAL
- Sintomas: No consta
- Evolucion: No consta

## EXPLORACION / PRUEBAS
No consta

## DIAGNOSTICO
No consta

## PLAN
Reintentar procesamiento automatico. Motivo tecnico: ${reason || 'pipeline_error'}`;
};
