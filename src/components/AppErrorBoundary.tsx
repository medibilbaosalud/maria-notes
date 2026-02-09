import React from 'react';
import { AlertTriangle, RefreshCw, Copy, Check } from 'lucide-react';
import { safeCopyToClipboard } from '../utils/safeBrowser';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  copied: boolean;
}

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      copied: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error?.stack || error?.message || 'Unknown UI error'
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[AppErrorBoundary] UI crash captured', { error, errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleCopy = async () => {
    const copied = await safeCopyToClipboard(this.state.errorMessage);
    if (!copied) return;
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 1500);
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="error-boundary-root" role="alert" aria-live="assertive">
        <div className="error-boundary-card">
          <div className="error-boundary-icon">
            <AlertTriangle size={30} />
          </div>
          <h1>Se produjo un error inesperado</h1>
          <p>
            La aplicacion detecto un fallo de interfaz y se detuvo para evitar comportamiento incorrecto.
          </p>

          <div className="error-boundary-actions">
            <button type="button" onClick={this.handleReload} className="error-boundary-btn primary">
              <RefreshCw size={16} /> Reiniciar aplicacion
            </button>
            <button type="button" onClick={this.handleCopy} className="error-boundary-btn secondary">
              {this.state.copied ? <Check size={16} /> : <Copy size={16} />}
              {this.state.copied ? 'Copiado' : 'Copiar detalles'}
            </button>
          </div>

          <pre className="error-boundary-log">{this.state.errorMessage}</pre>
        </div>

        <style>{`
          .error-boundary-root {
            min-height: 100vh;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            background: linear-gradient(120deg, #eff6ff 0%, #f8fafc 48%, #f0fdfa 100%);
            font-family: var(--font-sans);
          }

          .error-boundary-card {
            width: min(760px, 100%);
            background: white;
            border: 1px solid rgba(148, 163, 184, 0.28);
            border-radius: 18px;
            box-shadow: 0 20px 50px -30px rgba(15, 23, 42, 0.45);
            padding: 1.5rem;
            display: grid;
            gap: 0.9rem;
          }

          .error-boundary-icon {
            width: 54px;
            height: 54px;
            border-radius: 14px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #b91c1c;
            background: #fee2e2;
          }

          .error-boundary-card h1 {
            margin: 0;
            font-size: 1.35rem;
            color: #0f172a;
          }

          .error-boundary-card p {
            margin: 0;
            color: #334155;
            line-height: 1.5;
          }

          .error-boundary-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 0.6rem;
          }

          .error-boundary-btn {
            min-height: 40px;
            border-radius: 10px;
            border: none;
            padding: 0.55rem 0.95rem;
            font-size: 0.9rem;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            gap: 0.45rem;
            cursor: pointer;
          }

          .error-boundary-btn.primary {
            background: #1d4ed8;
            color: white;
          }

          .error-boundary-btn.secondary {
            background: #f8fafc;
            border: 1px solid rgba(148, 163, 184, 0.35);
            color: #1e293b;
          }

          .error-boundary-log {
            max-height: 230px;
            overflow: auto;
            padding: 0.8rem;
            border-radius: 10px;
            border: 1px solid rgba(148, 163, 184, 0.3);
            background: #f8fafc;
            color: #0f172a;
            font-size: 0.74rem;
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
          }
        `}</style>
      </div>
    );
  }
}
