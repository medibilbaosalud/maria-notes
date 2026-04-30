import type { ClinicalSpecialtyId } from '../clinical/specialties';
import { supabase } from './supabase';

export interface ClinicalStyleReference {
    referenceStory: string;
    generatedTemplate: string;
}

export interface ClinicalStyleProfile extends ClinicalStyleReference {
    id: string;
    specialty: ClinicalSpecialtyId;
    clinicianProfile?: string | null;
    displayName?: string | null;
    updatedAt: string;
}

const cleanText = (value?: string | null): string => String(value || '').replace(/\r/g, '').trim();

const buildProfileDisplayName = (specialty: ClinicalSpecialtyId, clinicianProfile?: string | null): string => {
    if (specialty === 'psicologia') return 'Estilo de historias psicologia';
    return clinicianProfile === 'gotxi'
        ? 'Estilo de historias ORL · Dra. Gotxi'
        : 'Estilo de historias ORL';
};

const normalizeHeading = (value: string): string => value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const DEFAULT_TEMPLATES: Record<ClinicalSpecialtyId, string> = {
    psicologia: `## MOTIVO DE CONSULTA
...

## ANTECEDENTES RELEVANTES
...

## SINTOMATOLOGIA ACTUAL
...

## OBSERVACIONES CLINICAS
...

## IMPRESION CLINICA
...

## PLAN TERAPEUTICO
...`,
    otorrino: `## MOTIVO DE CONSULTA
...

## ANTECEDENTES
- Alergias: ...
- Enfermedades cronicas: ...
- Cirugias: ...
- Tratamiento habitual: ...

## ENFERMEDAD ACTUAL
- Sintomas: ...
- Evolucion: ...

## EXPLORACION / PRUEBAS
...

## DIAGNOSTICO
...

## PLAN
...`
};

const SPECIALTY_SECTION_ALIASES: Record<ClinicalSpecialtyId, Array<{ target: string; aliases: string[] }>> = {
    psicologia: [
        { target: 'MOTIVO DE CONSULTA', aliases: ['motivo de consulta', 'motivo consulta', 'motivo'] },
        { target: 'ANTECEDENTES RELEVANTES', aliases: ['antecedentes relevantes', 'antecedentes', 'contexto', 'contexto vital'] },
        { target: 'SINTOMATOLOGIA ACTUAL', aliases: ['sintomatologia actual', 'sintomatologia', 'sintomas actuales', 'situacion actual', 'problema actual'] },
        { target: 'OBSERVACIONES CLINICAS', aliases: ['observaciones clinicas', 'observaciones', 'estado mental', 'exploracion mental'] },
        { target: 'IMPRESION CLINICA', aliases: ['impresion clinica', 'impresion', 'hipotesis clinica'] },
        { target: 'PLAN TERAPEUTICO', aliases: ['plan terapeutico', 'plan', 'objetivos terapeuticos', 'ot'] }
    ],
    otorrino: [
        { target: 'MOTIVO DE CONSULTA', aliases: ['motivo de consulta', 'motivo consulta', 'motivo'] },
        { target: 'ANTECEDENTES', aliases: ['antecedentes', 'antecedentes personales'] },
        { target: 'ENFERMEDAD ACTUAL', aliases: ['enfermedad actual', 'historia actual', 'evolucion actual'] },
        { target: 'EXPLORACION / PRUEBAS', aliases: ['exploracion / pruebas', 'exploracion', 'pruebas', 'exploraciones realizadas'] },
        { target: 'DIAGNOSTICO', aliases: ['diagnostico', 'impresion diagnostica'] },
        { target: 'PLAN', aliases: ['plan', 'tratamiento', 'conducta'] }
    ]
};

const getTargetSections = (specialty: ClinicalSpecialtyId): string[] =>
    DEFAULT_TEMPLATES[specialty]
        .split('\n')
        .filter((line) => line.startsWith('## '))
        .map((line) => line.replace(/^##\s+/, '').trim());

const normalizeTemplateLine = (line: string): string => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (/^[-*]\s+[^:]+:\s*/.test(trimmed)) {
        return trimmed.replace(/:\s*.+$/, ': ...');
    }
    if (/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][^:]{0,80}:\s*/.test(trimmed)) {
        return trimmed.replace(/:\s*.+$/, ': ...');
    }
    if (/^[-*]\s+/.test(trimmed)) {
        return '- ...';
    }
    return '...';
};

const splitReferenceByHeading = (referenceStory: string): Array<{ heading: string | null; lines: string[] }> => {
    const lines = cleanText(referenceStory).split('\n');
    const sections: Array<{ heading: string | null; lines: string[] }> = [];
    let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };

    const pushCurrent = () => {
        if (current.heading || current.lines.length > 0) {
            sections.push({
                heading: current.heading,
                lines: current.lines.filter((line) => cleanText(line).length > 0)
            });
        }
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        const headingMatch = line.match(/^##\s+(.+)$/);
        if (headingMatch) {
            pushCurrent();
            current = { heading: headingMatch[1].trim(), lines: [] };
            continue;
        }
        current.lines.push(rawLine);
    }

    pushCurrent();
    return sections;
};

const findReferenceSectionLines = (specialty: ClinicalSpecialtyId, targetSection: string, referenceStory: string): string[] => {
    const sections = splitReferenceByHeading(referenceStory);
    const aliases = SPECIALTY_SECTION_ALIASES[specialty]
        .find((entry) => entry.target === targetSection)?.aliases || [targetSection];
    const normalizedAliases = aliases.map(normalizeHeading);

    const exactSection = sections.find((section) =>
        section.heading && normalizedAliases.includes(normalizeHeading(section.heading))
    );
    if (exactSection?.lines?.length) {
        return exactSection.lines;
    }

    const fallbackMatches = cleanText(referenceStory)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && normalizedAliases.some((alias) => normalizeHeading(line).includes(alias)));

    return fallbackMatches;
};

const buildSectionTemplate = (specialty: ClinicalSpecialtyId, targetSection: string, referenceStory: string): string[] => {
    const extractedLines = findReferenceSectionLines(specialty, targetSection, referenceStory)
        .map(normalizeTemplateLine)
        .filter(Boolean);

    if (extractedLines.length > 0) {
        return Array.from(new Set(extractedLines)).slice(0, 8);
    }

    const defaultLines = DEFAULT_TEMPLATES[specialty]
        .split('\n')
        .slice(
            DEFAULT_TEMPLATES[specialty].split('\n').findIndex((line) => line === `## ${targetSection}`) + 1
        );
    const nextHeadingIndex = defaultLines.findIndex((line) => line.startsWith('## '));
    return defaultLines
        .slice(0, nextHeadingIndex >= 0 ? nextHeadingIndex : defaultLines.length)
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0);
};

export const buildEditableTemplateFromReferenceStory = (
    specialty: ClinicalSpecialtyId,
    referenceStory: string
): string => {
    const cleanedReference = cleanText(referenceStory);
    if (!cleanedReference) {
        return DEFAULT_TEMPLATES[specialty];
    }

    const sections = getTargetSections(specialty).map((sectionTitle) => {
        const bodyLines = buildSectionTemplate(specialty, sectionTitle, cleanedReference);
        return [`## ${sectionTitle}`, ...bodyLines].join('\n');
    });

    return sections.join('\n\n').trim();
};

const mapRowToProfile = (row: Record<string, unknown>, specialty: ClinicalSpecialtyId): ClinicalStyleProfile => {
    const notePreferences = (row.note_preferences as Record<string, unknown> | null) || {};
    const referenceStory = cleanText(String(notePreferences.reference_story || ''));
    const generatedTemplate = cleanText(String(notePreferences.generated_template_markdown || ''))
        || buildEditableTemplateFromReferenceStory(specialty, referenceStory);

    return {
        id: String(row.id || ''),
        specialty,
        clinicianProfile: typeof row.clinician_profile === 'string' ? row.clinician_profile : null,
        displayName: typeof row.display_name === 'string' ? row.display_name : buildProfileDisplayName(
            specialty,
            typeof row.clinician_profile === 'string' ? row.clinician_profile : null
        ),
        referenceStory,
        generatedTemplate,
        updatedAt: String(row.updated_at || new Date().toISOString())
    };
};

const getCurrentOwnerUserId = async (): Promise<string | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error) {
        console.warn('[ClinicalStyleProfile] Could not resolve authenticated user:', error.message);
    }
    return data.user?.id || null;
};

export const loadClinicalStyleProfile = async (
    specialty: ClinicalSpecialtyId,
    clinicianProfile?: string | null
): Promise<ClinicalStyleProfile | null> => {
    if (!supabase) return null;
    const ownerUserId = await getCurrentOwnerUserId();

    let query = supabase
        .from('clinical_specialty_profiles')
        .select('*')
        .eq('specialty', specialty)
        .order('updated_at', { ascending: false })
        .limit(1);

    if (clinicianProfile) {
        query = query.eq('clinician_profile', clinicianProfile);
    } else {
        query = query.is('clinician_profile', null);
    }

    if (ownerUserId) {
        query = query.eq('owner_user_id', ownerUserId);
    } else {
        query = query.is('owner_user_id', null);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
        console.warn('[ClinicalStyleProfile] Failed to load profile:', error.message);
        return null;
    }
    if (!data) return null;
    return mapRowToProfile(data as Record<string, unknown>, specialty);
};

export const saveClinicalStyleProfile = async (params: {
    specialty: ClinicalSpecialtyId;
    referenceStory: string;
    generatedTemplate: string;
    clinicianProfile?: string | null;
}): Promise<ClinicalStyleProfile> => {
    if (!supabase) {
        throw new Error('supabase_not_configured');
    }

    const specialty = params.specialty;
    const referenceStory = cleanText(params.referenceStory);
    const generatedTemplate = cleanText(params.generatedTemplate)
        || buildEditableTemplateFromReferenceStory(specialty, referenceStory);

    if (!referenceStory) {
        throw new Error('reference_story_required');
    }

    const ownerUserId = await getCurrentOwnerUserId();
    const existing = await loadClinicalStyleProfile(specialty, params.clinicianProfile);
    const payload = {
        owner_user_id: ownerUserId || null,
        specialty,
        clinician_profile: params.clinicianProfile || null,
        display_name: buildProfileDisplayName(specialty, params.clinicianProfile || null),
        note_preferences: {
            mode: 'reference_story',
            reference_story: referenceStory,
            generated_template_markdown: generatedTemplate,
            personalization_enabled: false,
            extracted_from_reference: true,
            updated_at: new Date().toISOString()
        },
        report_preferences: {
            reference_story_enabled: true
        },
        updated_at: new Date().toISOString()
    };

    const query = existing?.id
        ? supabase
            .from('clinical_specialty_profiles')
            .update(payload)
            .eq('id', existing.id)
            .select('*')
            .single()
        : supabase
            .from('clinical_specialty_profiles')
            .insert([payload])
            .select('*')
            .single();

    const { data, error } = await query;
    if (error) {
        throw new Error(error.message || 'clinical_style_profile_save_failed');
    }

    return mapRowToProfile(data as Record<string, unknown>, specialty);
};

export const getStyleReferencePayload = (
    profile: ClinicalStyleProfile | null | undefined
): ClinicalStyleReference | undefined => {
    if (!profile?.referenceStory || !profile.generatedTemplate) return undefined;
    return {
        referenceStory: profile.referenceStory,
        generatedTemplate: profile.generatedTemplate
    };
};
