import React from 'react';
import { motion } from 'framer-motion';
import { Settings, Mic, FileText, FileBarChart } from 'lucide-react';
import { MBSLogo } from './MBSLogo';
import '../design-system.css';

interface LayoutProps {
  children: React.ReactNode;
  onOpenSettings: () => void;
  currentView: 'record' | 'history' | 'reports';
  onNavigate: (view: 'record' | 'history' | 'reports') => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, onOpenSettings, currentView, onNavigate }) => {
  return (
    <div className="app-layout">
      <motion.aside
        className="sidebar"
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
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

        <nav className="nav-menu">
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
        </nav>

        <div className="sidebar-footer">
          <button className="settings-btn" onClick={onOpenSettings}>
            <Settings size={20} />
            <span>Configuración</span>
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

        /* Sidebar Styles - Clean & Solid */
        .sidebar {
          width: 260px;
          background-color: var(--bg-sidebar);
          display: flex;
          flex-direction: column;
          padding: 2rem 1.5rem;
          border-right: 1px solid rgba(0,0,0,0.05);
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

        /* Navigation */
        .nav-menu {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          flex: 1;
        }

        .sidebar-footer {
          margin-top: auto;
          padding-top: 1rem;
          border-top: 1px solid rgba(0,0,0,0.05);
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
            transition: all 0.2s;
            border-radius: var(--radius-md);
        }
        
        .settings-btn:hover {
            background-color: rgba(0,0,0,0.03);
            color: var(--text-primary);
        }

        /* Main Content */
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
    <button
      className={`nav-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
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
          border-radius: var(--radius-full); /* Pill shape */
          cursor: pointer;
          transition: all 0.2s ease;
          color: var(--text-secondary);
          font-family: var(--font-body);
          font-size: 0.95rem;
          font-weight: 500;
          text-align: left;
        }

        .nav-item:hover {
          background-color: rgba(0,0,0,0.03);
          color: var(--text-primary);
        }

        .nav-item.active {
          background-color: rgba(38, 166, 154, 0.1); /* Light teal background */
          color: var(--brand-dark);
          font-weight: 600;
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
      `}</style>
    </button>
  );
};
