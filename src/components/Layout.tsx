import React from 'react';
import { motion } from 'framer-motion';
import { Settings, Mic, FileText, FileBarChart, FlaskConical, Lightbulb } from 'lucide-react';
import { MBSLogo } from './MBSLogo';
import '../design-system.css';

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
        transition={{ duration: 0.4, ease: 'easeOut' }}
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
        <motion.div
          className="content-wrapper"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          {children}
        </motion.div>
      </main>

      <style>{`
        .app-layout {
          display: flex;
          height: 100vh;
          width: 100vw;
          background-color: var(--bg-app);
          overflow: hidden;
        }

        .sidebar {
          width: 268px;
          background-color: var(--bg-sidebar);
          display: flex;
          flex-direction: column;
          padding: 1.6rem 1.15rem;
          border-right: 1px solid var(--border-soft);
          flex-shrink: 0;
          z-index: 10;
        }

        .brand-area {
          margin-bottom: 3rem;
          padding-left: 0.5rem;
        }

        .brand-lockup {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .app-name {
          font-family: var(--font-display);
          font-size: 1.5rem;
          font-weight: 800;
          color: var(--text-primary);
          letter-spacing: -0.03em;
          margin: 0;
          line-height: 1.1;
        }

        .brand-sub-row {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .brand-by {
          font-size: 0.6rem;
          color: var(--text-tertiary);
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .brand-logo-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .brand-company {
          font-size: 0.8rem;
          color: var(--brand-primary);
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        .nav-menu {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          flex: 1;
        }

        .sidebar-footer {
          margin-top: auto;
          padding-top: 1rem;
          border-top: 1px solid var(--border-soft);
          display: grid;
          gap: 0.3rem;
        }

        .settings-btn {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          width: 100%;
          padding: 0.75rem 1rem;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-family: var(--font-body);
          font-size: 0.95rem;
          font-weight: 500;
          cursor: pointer;
          border-radius: var(--radius-md);
        }

        .settings-btn:hover {
          background-color: rgba(0, 0, 0, 0.03);
          color: var(--text-primary);
        }

        .settings-btn:focus-visible {
          box-shadow: var(--focus-ring);
        }

        .main-content {
          flex: 1;
          position: relative;
          overflow: hidden;
          background-color: var(--bg-app);
        }

        .content-wrapper {
          height: 100%;
          width: 100%;
          overflow: hidden;
          padding: 2rem;
        }

        @media (max-width: 1200px) {
          .sidebar {
            width: 226px;
            padding: 1.3rem 0.95rem;
          }

          .app-name {
            font-size: 1.34rem;
          }
        }

        @media (max-width: 1024px) {
          .sidebar {
            width: 92px;
            padding: 1rem 0.6rem;
            align-items: center;
          }

          .brand-area {
            margin-bottom: 1.5rem;
            padding-left: 0;
            text-align: center;
          }

          .app-name,
          .brand-sub-row,
          .settings-btn span,
          .nav-label {
            display: none;
          }

          .nav-menu,
          .sidebar-footer {
            width: 100%;
          }

          .settings-btn {
            justify-content: center;
            padding: 0.75rem;
            border-radius: 12px;
          }

          .content-wrapper {
            padding: 1.25rem;
          }
        }
      `}</style>
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
    <button className={`nav-item ${isActive ? 'active' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>

      <style>{`
        .nav-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          width: 100%;
          padding: 0.85rem 1.25rem;
          background: transparent;
          border: none;
          border-radius: var(--radius-full);
          cursor: pointer;
          color: var(--text-secondary);
          font-family: var(--font-body);
          font-size: 0.95rem;
          font-weight: 500;
          text-align: left;
          position: relative;
        }

        .nav-item:hover {
          background-color: rgba(0, 0, 0, 0.03);
          color: var(--text-primary);
        }

        .nav-item.active {
          background-color: rgba(38, 166, 154, 0.1);
          color: var(--brand-dark);
          font-weight: 600;
        }

        .nav-item.active::before {
          content: '';
          position: absolute;
          left: 0.4rem;
          top: 20%;
          bottom: 20%;
          width: 3px;
          border-radius: 999px;
          background: var(--brand-primary);
        }

        .nav-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.8;
        }

        .nav-item.active .nav-icon {
          opacity: 1;
          color: var(--brand-primary);
        }

        .nav-item:focus-visible {
          box-shadow: var(--focus-ring);
        }
      `}</style>
    </button>
  );
};
