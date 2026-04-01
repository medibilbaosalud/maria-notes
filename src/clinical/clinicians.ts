import { normalizeClinicalSpecialty, type ClinicalSpecialtyId } from './specialties';

export type KnownClinicianProfile = 'ainhoa' | 'june' | 'gotxi';

const normalizeKey = (value?: string | null): string => String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export const normalizePsychologyClinicianProfile = (value?: string | null): 'ainhoa' | 'june' | undefined => {
    const normalized = normalizeKey(value);
    if (normalized === 'june') return 'june';
    if (normalized === 'ainhoa') return 'ainhoa';
    return undefined;
};

export const normalizeOrlClinicianProfile = (value?: string | null): 'gotxi' | undefined => {
    const normalized = normalizeKey(value);
    if (!normalized) return undefined;
    if (normalized === 'gotxi' || normalized.includes('gotxi') || normalized.includes('itziar')) {
        return 'gotxi';
    }
    return undefined;
};

export const normalizeClinicianProfileForSpecialty = (
    specialty?: string | null,
    value?: string | null
): KnownClinicianProfile | undefined => {
    const normalizedSpecialty = normalizeClinicalSpecialty(specialty);
    return normalizedSpecialty === 'psicologia'
        ? normalizePsychologyClinicianProfile(value)
        : normalizeOrlClinicianProfile(value);
};

export const resolveFixedClinicianProfileForSpecialty = (
    specialty: ClinicalSpecialtyId,
    psychologyClinician?: string | null
): KnownClinicianProfile => {
    if (specialty === 'psicologia') {
        return normalizePsychologyClinicianProfile(psychologyClinician) || 'ainhoa';
    }
    return 'gotxi';
};

export const displayClinicianName = (value?: string | null): string | undefined => {
    const normalized = normalizeKey(value);
    if (!normalized) return undefined;
    if (normalized === 'ainhoa') return 'Ainhoa';
    if (normalized === 'june') return 'June';
    if (normalized === 'gotxi' || normalized.includes('gotxi') || normalized.includes('itziar')) return 'Dra. Gotxi';
    return String(value || '').trim() || undefined;
};

export const resolveFixedClinicianNameForSpecialty = (
    specialty: ClinicalSpecialtyId,
    psychologyClinician?: string | null
): string => {
    const profile = resolveFixedClinicianProfileForSpecialty(specialty, psychologyClinician);
    return displayClinicianName(profile) || (specialty === 'psicologia' ? 'Ainhoa' : 'Dra. Gotxi');
};
