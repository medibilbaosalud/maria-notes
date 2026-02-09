import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Key, Download, Upload, Check, AlertCircle, Cloud, CloudOff, Play } from 'lucide-react';
import { downloadBackup, importRecords } from '../services/backup';
import { useCloudSync } from '../hooks/useCloudSync';
import { syncFromCloud } from '../services/storage';
import { useSimulation } from './Simulation/SimulationContext';

interface SettingsProps {
  apiKey: string;
  onSave: (key: string) => void;
  onClose: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ apiKey, onSave, onClose }) => {
  const [key, setKey] = useState(apiKey);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backupStatus, setBackupStatus] = useState<'idle' | 'exporting' | 'importing' | 'success' | 'error'>('idle');
  const [backupMessage, setBackupMessage] = useState('');
  const { isCloudEnabled, toggleCloud } = useCloudSync();
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [cloudSyncMessage, setCloudSyncMessage] = useState('');
  const { startSimulation } = useSimulation();

  useEffect(() => {
    setKey(apiKey);
  }, [apiKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(key);
    onClose();
  };

  const handleExport = async () => {
    setBackupStatus('exporting');
    try {
      await downloadBackup();
      setBackupStatus('success');
      setBackupMessage('Copia de seguridad descargada');
      setTimeout(() => setBackupStatus('idle'), 3000);
    } catch {
      setBackupStatus('error');
      setBackupMessage('Error al exportar');
      setTimeout(() => setBackupStatus('idle'), 3000);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBackupStatus('importing');
    try {
      const result = await importRecords(file);
      setBackupStatus('success');
      setBackupMessage(`Importados ${result.imported} registros${result.errors > 0 ? `, ${result.errors} errores` : ''}`);
      setTimeout(() => setBackupStatus('idle'), 4000);
    } catch {
      setBackupStatus('error');
      setBackupMessage('Error al importar: archivo invalido');
      setTimeout(() => setBackupStatus('idle'), 3000);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runCloudSync = async () => {
    setCloudSyncStatus('syncing');
    setCloudSyncMessage('Sincronizando desde la nube...');
    try {
      const imported = await syncFromCloud();
      setCloudSyncStatus('success');
      setCloudSyncMessage(imported > 0 ? `Sincronizado: ${imported} registros nuevos` : 'Sincronizado: sin cambios');
      setTimeout(() => setCloudSyncStatus('idle'), 4000);
    } catch {
      setCloudSyncStatus('error');
      setCloudSyncMessage('Error al sincronizar');
      setTimeout(() => setCloudSyncStatus('idle'), 4000);
    }
  };

  const handleToggleCloud = () => {
    const willEnable = !isCloudEnabled;
    toggleCloud();
    if (willEnable) {
      setTimeout(() => {
        void runCloudSync();
      }, 0);
    }
  };

  return (
    <div className="settings-modal-overlay">
      <div className="settings-modal-card">
        <div className="settings-modal-header">
          <div className="settings-header-title">
            <div className="settings-icon-bg">
              <Key size={20} />
            </div>
            <h2>Configuracion</h2>
          </div>
          <button className="settings-close-btn" onClick={onClose} aria-label="Cerrar configuracion">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="settings-modal-body">
            <div className="settings-form-group">
              <label>Groq API Key</label>
              <div className="settings-input-wrapper">
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Pegar tu API Key aqui (gsk_...)"
                  className="settings-text-input"
                />
              </div>
              <p className="settings-help-text">
                Tu clave se almacena localmente en tu dispositivo y nunca se comparte.
              </p>
            </div>

            <div className="settings-form-group settings-backup-section">
              <label>Copia de Seguridad</label>
              <p className="settings-help-text settings-help-compact">
                Exporta o importa tus datos medicos como archivo JSON.
              </p>
              <div className="settings-backup-buttons">
                <button
                  type="button"
                  className="settings-btn-backup"
                  onClick={handleExport}
                  disabled={backupStatus === 'exporting' || backupStatus === 'importing'}
                >
                  <Download size={18} />
                  {backupStatus === 'exporting' ? 'Exportando...' : 'Exportar Datos'}
                </button>
                <button
                  type="button"
                  className="settings-btn-backup"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={backupStatus === 'exporting' || backupStatus === 'importing'}
                >
                  <Upload size={18} />
                  {backupStatus === 'importing' ? 'Importando...' : 'Importar Datos'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="settings-hidden-file-input"
                  onChange={handleImport}
                />
              </div>

              {backupStatus !== 'idle' && backupStatus !== 'exporting' && backupStatus !== 'importing' && (
                <div className={`settings-backup-feedback ${backupStatus}`}>
                  {backupStatus === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
                  <span>{backupMessage}</span>
                </div>
              )}

              {isCloudEnabled && (
                <div className="settings-cloud-sync-row">
                  <button
                    type="button"
                    className="settings-btn-backup settings-btn-full"
                    onClick={() => void runCloudSync()}
                    disabled={cloudSyncStatus === 'syncing'}
                  >
                    {cloudSyncStatus === 'syncing' ? 'Sincronizando...' : 'Sincronizar ahora'}
                  </button>
                  {cloudSyncStatus !== 'idle' && cloudSyncMessage && (
                    <p className="settings-help-text settings-help-tight">{cloudSyncMessage}</p>
                  )}
                </div>
              )}
            </div>

            <div className="settings-form-group settings-cloud-section">
              <label>Sincronizacion en la Nube</label>
              <div className="settings-cloud-toggle-row">
                <div className="settings-cloud-info">
                  {isCloudEnabled ? <Cloud size={20} /> : <CloudOff size={20} />}
                  <div className="settings-cloud-text">
                    <span className="settings-cloud-status">{isCloudEnabled ? 'Activado' : 'Desactivado'}</span>
                    <span className="settings-cloud-desc">
                      {isCloudEnabled
                        ? 'Los datos se guardan localmente y en Supabase'
                        : 'Los datos solo se guardan localmente'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className={`settings-toggle-btn ${isCloudEnabled ? 'active' : ''}`}
                  onClick={handleToggleCloud}
                  aria-label="Activar o desactivar sincronizacion en la nube"
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>
              {isCloudEnabled && (
                <p className="settings-help-text settings-cloud-warning">
                  Atencion: al activar esto, los datos medicos saldran de este dispositivo.
                </p>
              )}
            </div>

            <div className="settings-form-group settings-help-section">
              <label>Ayuda y Tutoriales</label>
              <button
                type="button"
                className="settings-btn-backup settings-demo-btn"
                onClick={() => {
                  startSimulation();
                  onClose();
                }}
              >
                <Play size={18} />
                Ver Demo Interactiva (Auto-Pilot)
              </button>
            </div>
          </div>

          <div className="settings-modal-footer">
            <button type="button" onClick={onClose} className="settings-btn-secondary">Cancelar</button>
            <button type="submit" className="settings-btn-primary">
              <Save size={18} />
              Guardar Cambios
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .settings-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: var(--z-modal);
          animation: fade-in 0.2s ease-out;
          padding: 1rem;
        }

        .settings-modal-card {
          background: white;
          width: 100%;
          max-width: 560px;
          border-radius: 24px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
          overflow: hidden;
          animation: slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          border: 1px solid rgba(0, 0, 0, 0.05);
        }

        .settings-modal-header {
          padding: 1.3rem 1.5rem;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #fff;
        }

        .settings-header-title {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .settings-icon-bg {
          width: 40px;
          height: 40px;
          background: #f0fdfa;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--brand-primary);
        }

        .settings-modal-header h2 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 700;
          color: #1e293b;
          font-family: var(--font-display);
        }

        .settings-close-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 8px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .settings-close-btn:hover {
          background: #f1f5f9;
          color: #ef4444;
        }

        .settings-modal-body {
          padding: 1.5rem;
          background: #fff;
          max-height: 65vh;
          overflow: auto;
        }

        .settings-form-group label {
          display: block;
          font-size: 0.95rem;
          font-weight: 600;
          margin-bottom: 0.75rem;
          color: #334155;
        }

        .settings-text-input {
          width: 100%;
          padding: 1rem 1.25rem;
          border-radius: 12px;
          border: 2px solid #e2e8f0;
          background: #fff;
          color: #1e293b;
          font-size: 1rem;
          box-sizing: border-box;
          font-family: monospace;
        }

        .settings-text-input:focus {
          outline: none;
          border-color: var(--brand-primary);
          box-shadow: 0 0 0 4px rgba(38, 166, 154, 0.1);
        }

        .settings-help-text {
          font-size: 0.85rem;
          color: #64748b;
          margin-top: 0.75rem;
          line-height: 1.5;
        }

        .settings-help-compact {
          margin-top: 0;
          margin-bottom: 1rem;
        }

        .settings-help-tight {
          margin-top: 0.5rem;
        }

        .settings-modal-footer {
          padding: 1.2rem 1.5rem;
          background: #f8fafc;
          border-top: 1px solid #f1f5f9;
          display: flex;
          justify-content: flex-end;
          gap: 1rem;
        }

        .settings-btn-primary,
        .settings-btn-secondary {
          padding: 0.75rem 1.5rem;
          border-radius: 12px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          border: none;
        }

        .settings-btn-primary {
          background: var(--brand-gradient);
          color: white;
          box-shadow: 0 4px 12px rgba(38, 166, 154, 0.25);
        }

        .settings-btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 16px rgba(38, 166, 154, 0.3);
        }

        .settings-btn-secondary {
          background: white;
          color: #64748b;
          border: 1px solid #e2e8f0;
        }

        .settings-btn-secondary:hover {
          background: #f1f5f9;
          color: #334155;
          border-color: #cbd5e1;
        }

        .settings-backup-section,
        .settings-cloud-section,
        .settings-help-section {
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid #f1f5f9;
        }

        .settings-backup-buttons {
          display: flex;
          gap: 0.8rem;
        }

        .settings-btn-backup {
          flex: 1;
          padding: 0.75rem 1rem;
          border-radius: 12px;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          border: 1px solid #e2e8f0;
          background: white;
          color: #475569;
        }

        .settings-btn-backup:hover:not(:disabled) {
          background: #f8fafc;
          border-color: var(--brand-primary);
          color: var(--brand-primary);
        }

        .settings-btn-backup:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .settings-hidden-file-input {
          display: none;
        }

        .settings-backup-feedback {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 1rem;
          padding: 0.75rem 1rem;
          border-radius: 10px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .settings-backup-feedback.success {
          background: #f0fdf4;
          color: #16a34a;
        }

        .settings-backup-feedback.error {
          background: #fef2f2;
          color: #dc2626;
        }

        .settings-cloud-sync-row {
          margin-top: 0.75rem;
        }

        .settings-btn-full {
          width: 100%;
          justify-content: center;
        }

        .settings-cloud-toggle-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          background: #f8fafc;
          border-radius: 12px;
          margin-top: 0.5rem;
        }

        .settings-cloud-info {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: var(--text-secondary);
        }

        .settings-cloud-text {
          display: flex;
          flex-direction: column;
        }

        .settings-cloud-status {
          font-weight: 600;
          color: var(--text-primary);
          font-size: 0.95rem;
        }

        .settings-cloud-desc {
          font-size: 0.8rem;
          color: var(--text-tertiary);
        }

        .settings-toggle-btn {
          width: 48px;
          height: 26px;
          border-radius: 13px;
          background: #e2e8f0;
          border: none;
          cursor: pointer;
          position: relative;
        }

        .settings-toggle-btn.active {
          background: var(--brand-primary);
        }

        .settings-toggle-knob {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: white;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          transition: transform 0.2s;
        }

        .settings-toggle-btn.active .settings-toggle-knob {
          transform: translateX(22px);
        }

        .settings-cloud-warning {
          color: #b45309;
          margin-top: 0.75rem;
        }

        .settings-demo-btn {
          width: 100%;
          justify-content: center;
          margin-top: 0.5rem;
          background: #f0fdfa;
          border-color: #ccfbf1;
          color: #0f766e;
        }

        @keyframes fade-in {
          from {
            opacity: 0;
          }

          to {
            opacity: 1;
          }
        }

        @keyframes slide-up {
          from {
            transform: translateY(20px) scale(0.95);
            opacity: 0;
          }

          to {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }

        @media (max-width: 1024px) {
          .settings-modal-card {
            max-width: 94vw;
          }

          .settings-backup-buttons {
            flex-direction: column;
          }

          .settings-modal-footer {
            flex-wrap: wrap;
          }

          .settings-modal-footer button {
            flex: 1;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
};
