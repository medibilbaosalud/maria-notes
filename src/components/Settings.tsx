import React, { useState, useEffect } from 'react';
import { X, Save, Key } from 'lucide-react';

interface SettingsProps {
  apiKey: string;
  onSave: (key: string) => void;
  onClose: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ apiKey, onSave, onClose }) => {
  const [key, setKey] = useState(apiKey);

  useEffect(() => {
    setKey(apiKey);
  }, [apiKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(key);
    onClose();
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
              <label>Google Gemini API Key</label>
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
