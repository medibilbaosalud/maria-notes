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
  onContinue: () => void;
}

const iconBySpecialty: Record<ClinicalSpecialtyId, React.ReactNode> = {
  otorrino: <Ear size={22} />,
  psicologia: <Brain size={22} />
};

export const SpecialtyEntryScreen: React.FC<SpecialtyEntryScreenProps> = ({
  selectedSpecialty,
  onSelectSpecialty,
  onContinue
}) => {
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
            <p className="specialty-entry-eyebrow">Acceso clínico</p>
            <h1>Selecciona el modo de trabajo</h1>
          </div>
        </div>

        <p className="specialty-entry-copy">
          Elige la especialidad con la que vas a trabajar en esta sesión. La estructura clínica,
          los prompts y la documentación se adaptarán desde el inicio.
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

        <div className="specialty-entry-actions">
          <button type="button" className="specialty-entry-continue" onClick={onContinue}>
            Entrar en modo {selectedSpecialty === 'psicologia' ? 'Psicología' : 'Otorrino'}
            <ChevronRight size={16} />
          </button>
        </div>
      </motion.section>
    </div>
  );
};
