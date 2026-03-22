import React from 'react';
import { motion } from 'framer-motion';
import { Settings, Mic, FileText, FileBarChart, FlaskConical, Lightbulb, BookOpen } from 'lucide-react';
import { MBSLogo } from './MBSLogo';
import { motionTransitions } from '../features/ui/motion-tokens';
import type { ClinicalSpecialtyId } from '../clinical/specialties';
import { getClinicalSpecialtyOptions } from '../clinical/specialties';
import '../design-system.css';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
  onOpenSettings: () => void;
  onOpenLessons?: () => void;
  onOpenGuide?: () => void;
  currentView: 'record' | 'history' | 'reports' | 'test-lab' | 'result';
  onNavigate: (view: 'record' | 'history' | 'reports' | 'test-lab' | 'result') => void;
  activeSpecialty: ClinicalSpecialtyId;
  onSpecialtyChange: (specialty: ClinicalSpecialtyId) => void;
  psychologyClinicianName?: 'Ainhoa' | 'June';
  onPsychologyClinicianChange?: (clinicianName: 'Ainhoa' | 'June') => void;
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  onOpenSettings,
  onOpenLessons,
  onOpenGuide,
  currentView,
  onNavigate,
  activeSpecialty,
  onSpecialtyChange,
  psychologyClinicianName = 'Ainhoa',
  onPsychologyClinicianChange
}) => {
  return (
    <div className="app-layout">
      <motion.aside
        className="sidebar"
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={motionTransitions.slow}
      >
        <div className="brand-area">
          <div className="brand-lockup">
            <h1 className="app-name">Maria Notes</h1>
            <div className="brand-sub-row">
              <span className="brand-by">BY</span>
              <div className="brand-logo-group">
                <MBSLogo size={20} />
                <span className="brand-company">MediBilbao Salud</span>
              </div>
            </div>
          </div>
          {activeSpecialty === 'psicologia' && onPsychologyClinicianChange && (
            <div className="workspace-specialty-switcher" role="radiogroup" aria-label="Profesional de psicologia activo">
              {(['Ainhoa', 'June'] as const).map((clinicianName) => {
                const active = clinicianName === psychologyClinicianName;
                return (
                  <button
                    key={clinicianName}
                    type="button"
                    className={`workspace-specialty-pill ${active ? 'active' : ''}`}
                    onClick={() => onPsychologyClinicianChange(clinicianName)}
                    aria-pressed={active}
                    title={`Cambiar perfil a ${clinicianName}`}
                  >
                    {clinicianName}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <nav className="nav-menu" aria-label="Navegacion principal">
          <NavItem
            id="nav-record-btn"
            icon={<Mic size={20} />}
            label="Consulta"
            isActive={currentView === 'record'}
            onClick={() => onNavigate('record')}
          />
          <NavItem
            id="nav-history-btn"
            icon={<FileText size={20} />}
            label="Historial"
            isActive={currentView === 'history'}
            onClick={() => onNavigate('history')}
          />
          <NavItem
            id="nav-reports-btn"
            icon={<FileBarChart size={20} />}
            label="Informes"
            isActive={currentView === 'reports'}
            onClick={() => onNavigate('reports')}
          />
          <NavItem
            id="nav-test-lab-btn"
            icon={<FlaskConical size={20} />}
            label="Zona Test"
            isActive={currentView === 'test-lab'}
            onClick={() => onNavigate('test-lab')}
          />
        </nav>

        <div className="sidebar-footer">
          {onOpenGuide && activeSpecialty === 'psicologia' && (
            <button className="settings-btn guide-btn" onClick={onOpenGuide} aria-label={`Abrir guia de ${psychologyClinicianName}`}>
              <BookOpen size={20} />
              <span>{`Guia ${psychologyClinicianName}`}</span>
            </button>
          )}
          {onOpenLessons && (
            <button className="settings-btn lessons-btn" onClick={onOpenLessons} aria-label="Abrir lecciones IA">
              <Lightbulb size={20} />
              <span>Lecciones IA</span>
            </button>
          )}
          <button className="settings-btn" onClick={onOpenSettings} aria-label="Abrir configuracion">
            <Settings size={20} />
            <span>Configuracion</span>
          </button>
        </div>
      </motion.aside>

      <main className="main-content">
        <div className="workspace-utility-bar">
          <div className="workspace-specialty-switcher" role="radiogroup" aria-label="Modo clínico activo">
            {getClinicalSpecialtyOptions().map((option) => {
              const active = option.id === activeSpecialty;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`workspace-specialty-pill ${active ? 'active' : ''}`}
                  onClick={() => onSpecialtyChange(option.id)}
                  aria-pressed={active}
                  title={`Cambiar a modo ${option.shortLabel}`}
                >
                  {option.shortLabel}
                </button>
              );
            })}
          </div>
        </div>
        <div className="content-wrapper">{children}</div>
      </main>
    </div>
  );
};

interface NavItemProps {
  id?: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ id, icon, label, isActive, onClick }) => {
  return (
    <button
      id={id}
      className={`nav-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      data-ui-state={isActive ? 'active' : 'idle'}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </button>
  );
};
