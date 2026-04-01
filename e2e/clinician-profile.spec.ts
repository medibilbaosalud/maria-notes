import { expect, test } from '@playwright/test';
import {
  displayClinicianName,
  normalizeClinicianProfileForSpecialty,
  resolveFixedClinicianNameForSpecialty,
  resolveFixedClinicianProfileForSpecialty
} from '../src/clinical/clinicians';

test.describe('clinician profile resolution', () => {
  test('resolves ORL to fixed gotxi profile and display name', () => {
    expect(resolveFixedClinicianProfileForSpecialty('otorrino')).toBe('gotxi');
    expect(resolveFixedClinicianNameForSpecialty('otorrino')).toBe('Dra. Gotxi');
    expect(normalizeClinicianProfileForSpecialty('otorrino', 'Itziar Gotxi')).toBe('gotxi');
    expect(displayClinicianName('gotxi')).toBe('Dra. Gotxi');
  });

  test('keeps psychology clinician resolution intact', () => {
    expect(resolveFixedClinicianProfileForSpecialty('psicologia', 'June')).toBe('june');
    expect(resolveFixedClinicianNameForSpecialty('psicologia', 'June')).toBe('June');
    expect(normalizeClinicianProfileForSpecialty('psicologia', 'Ainhoa')).toBe('ainhoa');
    expect(displayClinicianName('ainhoa')).toBe('Ainhoa');
  });
});
