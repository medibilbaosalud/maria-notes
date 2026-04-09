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
  const psychologyProfiles = [
    {
      name: 'Ainhoa' as const,
      hint: 'Con onboarding guiado y demo interactiva',
      accent: 'Guiado'
    },
    {
      name: 'June' as const,
      hint: 'Acceso directo, sin onboarding ni demo',
      accent: 'Directo'
    }
  ];

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
          Elige la especialidad con la que vas a trabajar en esta sesion. Despues podras pegar una
          historia de referencia para ajustar la estructura de redaccion a tu forma de escribir.
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
              <p className="specialty-entry-clinician-eyebrow">Perfil activo</p>
              <h2>Elige el perfil con el que vas a trabajar hoy</h2>
              <span>Ainhoa mantiene onboarding guiado y demo. June entra directa a consulta, con la interfaz ya lista.</span>
            </div>

            <div className="specialty-entry-grid specialty-entry-grid-clinicians" role="radiogroup" aria-label="Seleccionar perfil de psicologia">
              {psychologyProfiles.map((profile) => {
                const isActive = psychologyClinicianName === profile.name;
                return (
                  <button
                    key={profile.name}
                    type="button"
                    className={`specialty-entry-option specialty-entry-clinician-option ${isActive ? 'active' : ''}`}
                    aria-pressed={isActive}
                    onClick={() => onSelectPsychologyClinician(profile.name)}
                  >
                    <div className="specialty-entry-option-icon specialty-entry-clinician-icon">{profile.name[0]}</div>
                    <div className="specialty-entry-option-body">
                      <div className="specialty-entry-clinician-row">
                        <strong>{profile.name}</strong>
                        <span className={`specialty-entry-clinician-badge ${profile.name === 'June' ? 'direct' : 'guided'}`}>
                          {profile.accent}
                        </span>
                      </div>
                      <span>{profile.hint}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="specialty-entry-actions">
          <button type="button" className="specialty-entry-continue" onClick={onContinue}>
            Entrar en modo {isPsychology ? `Psicologia · ${psychologyClinicianName}` : 'Otorrino'}
            <ChevronRight size={16} />
          </button>
        </div>
      </motion.section>
    </div>
  );
};
