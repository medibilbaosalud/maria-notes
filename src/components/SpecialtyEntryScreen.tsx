import React from 'react';
import { Brain, Ear, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';

import type { ClinicalSpecialtyId } from '../clinical/specialties';
import { getClinicalSpecialtyOptions } from '../clinical/specialties';
import { MBSLogo } from './MBSLogo';
import './SpecialtyEntryScreen.css';

interface SpecialtyEntryScreenProps {
  selectedSpecialty: ClinicalSpecialtyId;
  onSelectSpecialty: (specialty: ClinicalSpecialtyId) => void;
  psychologyClinicianName: 'Ainhoa' | 'June';
  onSelectPsychologyClinician: (clinicianName: 'Ainhoa' | 'June') => void;
  onContinue: () => void;
}

const iconBySpecialty: Record<ClinicalSpecialtyId, React.ReactNode> = {
  otorrino: <Ear size={22} />,
  psicologia: <Brain size={22} />
};

export const SpecialtyEntryScreen: React.FC<SpecialtyEntryScreenProps> = ({
  selectedSpecialty,
  onSelectSpecialty,
  psychologyClinicianName,
  onSelectPsychologyClinician,
  onContinue
}) => {
  const isPsychology = selectedSpecialty === 'psicologia';

  return (
    <div className="specialty-entry-screen">
      <div className="specialty-entry-backdrop" aria-hidden="true" />

      <motion.section
        className="specialty-entry-card"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="specialty-entry-brand">
          <MBSLogo size={44} />
          <div>
            <p className="specialty-entry-eyebrow">Acceso clinico</p>
            <h1>Selecciona el modo de trabajo</h1>
          </div>
        </div>

        <p className="specialty-entry-copy">
          Elige la especialidad con la que vas a trabajar en esta sesion. La estructura clinica
          y la documentacion se adaptaran desde el inicio.
        </p>

        <div className="specialty-entry-grid" role="radiogroup" aria-label="Seleccionar especialidad">
          {getClinicalSpecialtyOptions().map((option) => {
            const isActive = option.id === selectedSpecialty;
            return (
              <button
                key={option.id}
                type="button"
                className={`specialty-entry-option ${isActive ? 'active' : ''}`}
                aria-pressed={isActive}
                onClick={() => onSelectSpecialty(option.id)}
              >
                <div className="specialty-entry-option-icon">{iconBySpecialty[option.id]}</div>
                <div className="specialty-entry-option-body">
                  <strong>{option.shortLabel}</strong>
                  <span>{option.professionalLabel}</span>
                </div>
              </button>
            );
          })}
        </div>

        {isPsychology && (
          <div className="specialty-entry-clinician-block">
            <div className="specialty-entry-clinician-copy">
              <p className="specialty-entry-clinician-eyebrow">Perfil profesional</p>
              <h2>Elige con quien vas a trabajar</h2>
              <span>La estructura clinica y la documentacion se adaptaran desde el inicio.</span>
            </div>

            <div className="specialty-entry-grid specialty-entry-grid-clinicians" role="radiogroup" aria-label="Seleccionar profesional de psicologia">
              {(['Ainhoa', 'June'] as const).map((clinicianName) => {
                const isActive = clinicianName === psychologyClinicianName;
                return (
                  <button
                    key={clinicianName}
                    type="button"
                    className={`specialty-entry-option specialty-entry-clinician-option ${isActive ? 'active' : ''}`}
                    aria-pressed={isActive}
                    onClick={() => onSelectPsychologyClinician(clinicianName)}
                  >
                    <div className="specialty-entry-option-icon specialty-entry-clinician-icon">
                      {clinicianName.slice(0, 1)}
                    </div>
                    <div className="specialty-entry-option-body">
                      <strong>{clinicianName}</strong>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="specialty-entry-actions">
          <button type="button" className="specialty-entry-continue" onClick={onContinue}>
            Entrar en modo {selectedSpecialty === 'psicologia' ? `Psicologia · ${psychologyClinicianName}` : 'Otorrino'}
            <ChevronRight size={16} />
          </button>
        </div>
      </motion.section>
    </div>
  );
};
