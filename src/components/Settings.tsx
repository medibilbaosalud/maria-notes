import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Key, Download, Upload, Check, AlertCircle, Cloud, CloudOff } from 'lucide-react';
import { downloadBackup, importRecords } from '../services/backup';
import { useCloudSync } from '../hooks/useCloudSync';

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
    } catch (err) {
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
    } catch (err) {
      setBackupStatus('error');
      setBackupMessage('Error al importar: archivo inválido');
      setTimeout(() => setBackupStatus('idle'), 3000);
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <div className="header-title">
            <div className="icon-bg">
              <Key size={20} />
            </div>
            <h2>Configuración</h2>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Groq API Key</label>
              <div className="input-wrapper">
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Pegar tu API Key aquí (AIza...)"
                  className="text-input"
                />
              </div>
              <p className="help-text">
                Tu clave se almacena localmente en tu dispositivo y nunca se comparte.
              </p>
            </div>

            {/* Backup Section */}
            <div className="form-group backup-section">
              <label>Copia de Seguridad</label>
              <p className="help-text" style={{ marginTop: 0, marginBottom: '1rem' }}>
                Exporta o importa tus datos médicos como archivo JSON.
              </p>
              <div className="backup-buttons">
                <button
                  type="button"
                  className="btn-backup"
                  onClick={handleExport}
                  disabled={backupStatus === 'exporting' || backupStatus === 'importing'}
                >
                  <Download size={18} />
                  {backupStatus === 'exporting' ? 'Exportando...' : 'Exportar Datos'}
                </button>
                <button
                  type="button"
                  className="btn-backup"
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
                  style={{ display: 'none' }}
                  onChange={handleImport}
                />
              </div>
              {backupStatus !== 'idle' && backupStatus !== 'exporting' && backupStatus !== 'importing' && (
                <div className={`backup-feedback ${backupStatus}`}>
                  {backupStatus === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
                  <span>{backupMessage}</span>
                </div>
              )}
            </div>

            {/* Cloud Sync Section */}
            <div className="form-group cloud-section">
              <label>Sincronización en la Nube</label>
              <div className="cloud-toggle-row">
                <div className="cloud-info">
                  {isCloudEnabled ? <Cloud size={20} /> : <CloudOff size={20} />}
                  <div className="cloud-text">
                    <span className="cloud-status">{isCloudEnabled ? 'Activado' : 'Desactivado'}</span>
                    <span className="cloud-desc">
                      {isCloudEnabled
                        ? 'Los datos se guardan localmente Y en Supabase'
                        : 'Los datos solo se guardan localmente'
                      }
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className={`toggle-btn ${isCloudEnabled ? 'active' : ''}`}
                  onClick={toggleCloud}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              {isCloudEnabled && (
                <p className="help-text cloud-warning">
                  ⚠️ Al activar esto, los datos médicos saldrán de este dispositivo.
                </p>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">
              <Save size={18} />
              Guardar Cambios
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .modal-overlay {
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
          z-index: 2000;
          animation: fade-in 0.2s ease-out;
        }

        .modal-card {
          background: white;
          width: 100%;
          max-width: 500px;
          border-radius: 24px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
          overflow: hidden;
          animation: slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          border: 1px solid rgba(0,0,0,0.05);
        }

        .modal-header {
          padding: 1.5rem 2rem;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #fff;
        }

        .header-title {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .icon-bg {
          width: 40px;
          height: 40px;
          background: #f0fdfa;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--brand-primary);
        }

        .modal-header h2 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 700;
          color: #1e293b;
          font-family: var(--font-display);
        }

        .close-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 8px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .close-btn:hover {
          background: #f1f5f9;
          color: #ef4444;
        }

        .modal-body {
          padding: 2rem;
          background: #fff;
        }

        .form-group label {
          display: block;
          font-size: 0.95rem;
          font-weight: 600;
          margin-bottom: 0.75rem;
          color: #334155;
        }

        .text-input {
          width: 100%;
          padding: 1rem 1.25rem;
          border-radius: 12px;
          border: 2px solid #e2e8f0;
          background: #fff;
          color: #1e293b;
          font-size: 1rem;
          transition: all 0.2s;
          box-sizing: border-box;
          font-family: monospace; /* Better for API keys */
        }

        .text-input:focus {
          outline: none;
          border-color: var(--brand-primary);
          box-shadow: 0 0 0 4px rgba(38, 166, 154, 0.1);
        }

        .help-text {
          font-size: 0.85rem;
          color: #64748b;
          margin-top: 0.75rem;
          line-height: 1.5;
        }

        .modal-footer {
          padding: 1.5rem 2rem;
          background: #f8fafc;
          border-top: 1px solid #f1f5f9;
          display: flex;
          justify-content: flex-end;
          gap: 1rem;
        }

        .btn-primary, .btn-secondary {
          padding: 0.75rem 1.5rem;
          border-radius: 12px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.2s;
          border: none;
        }

        .btn-primary {
          background: var(--brand-gradient);
          color: white;
          box-shadow: 0 4px 12px rgba(38, 166, 154, 0.25);
        }

        .btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 16px rgba(38, 166, 154, 0.3);
        }

        .btn-secondary {
          background: white;
          color: #64748b;
          border: 1px solid #e2e8f0;
        }

        .btn-secondary:hover {
          background: #f1f5f9;
          color: #334155;
          border-color: #cbd5e1;
        }

        .backup-section {
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid #f1f5f9;
        }

        .backup-buttons {
          display: flex;
          gap: 1rem;
        }

        .btn-backup {
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
          transition: all 0.2s;
          border: 1px solid #e2e8f0;
          background: white;
          color: #475569;
        }

        .btn-backup:hover:not(:disabled) {
          background: #f8fafc;
          border-color: var(--brand-primary);
          color: var(--brand-primary);
        }

        .btn-backup:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .backup-feedback {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 1rem;
          padding: 0.75rem 1rem;
          border-radius: 10px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .backup-feedback.success {
          background: #f0fdf4;
          color: #16a34a;
        }

        .backup-feedback.error {
          background: #fef2f2;
          color: #dc2626;
        }

        .cloud-section {
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid #f1f5f9;
        }

        .cloud-toggle-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          background: #f8fafc;
          border-radius: 12px;
          margin-top: 0.5rem;
        }

        .cloud-info {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: var(--text-secondary);
        }

        .cloud-text {
          display: flex;
          flex-direction: column;
        }

        .cloud-status {
          font-weight: 600;
          color: var(--text-primary);
          font-size: 0.95rem;
        }

        .cloud-desc {
          font-size: 0.8rem;
          color: var(--text-tertiary);
        }

        .toggle-btn {
          width: 48px;
          height: 26px;
          border-radius: 13px;
          background: #e2e8f0;
          border: none;
          cursor: pointer;
          position: relative;
          transition: background 0.2s;
        }

        .toggle-btn.active {
          background: var(--brand-primary);
        }

        .toggle-knob {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          transition: transform 0.2s;
        }

        .toggle-btn.active .toggle-knob {
          transform: translateX(22px);
        }

        .cloud-warning {
          color: #f59e0b !important;
          margin-top: 0.75rem;
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slide-up {
          from { transform: translateY(20px) scale(0.95); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};
