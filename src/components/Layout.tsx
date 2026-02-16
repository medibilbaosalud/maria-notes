import React from 'react';
import { motion } from 'framer-motion';
import { Settings, Mic, FileText, FileBarChart, FlaskConical, Lightbulb } from 'lucide-react';
import { MBSLogo } from './MBSLogo';
import { motionTransitions } from '../features/ui/motion-tokens';
import '../design-system.css';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
  onOpenSettings: () => void;
  onOpenLessons?: () => void;
  currentView: 'record' | 'history' | 'reports' | 'test-lab' | 'result';
  onNavigate: (view: 'record' | 'history' | 'reports' | 'test-lab' | 'result') => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, onOpenSettings, onOpenLessons, currentView, onNavigate }) => {
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
        </div>

        <nav className="nav-menu" aria-label="Navegacion principal">
          <NavItem
            icon={<Mic size={20} />}
            label="Consulta"
            isActive={currentView === 'record'}
            onClick={() => onNavigate('record')}
          />
          <NavItem
            icon={<FileText size={20} />}
            label="Historial"
            isActive={currentView === 'history'}
            onClick={() => onNavigate('history')}
          />
          <NavItem
            icon={<FileBarChart size={20} />}
            label="Informes"
            isActive={currentView === 'reports'}
            onClick={() => onNavigate('reports')}
          />
          <NavItem
            icon={<FlaskConical size={20} />}
            label="Zona Test"
            isActive={currentView === 'test-lab'}
            onClick={() => onNavigate('test-lab')}
          />
        </nav>

        <div className="sidebar-footer">
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
        <div className="content-wrapper">{children}</div>
      </main>
    </div>
  );
};

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, isActive, onClick }) => {
  return (
    <button
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
