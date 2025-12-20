import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, FileText, Sparkles, FileOutput, X, Printer, Plus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { MBSLogo } from './MBSLogo';

interface HistoryViewProps {
  content: string;
  isLoading: boolean;
  patientName?: string;
  onGenerateReport?: () => Promise<string>;
  onNewConsultation?: () => void;
}

const LoadingMessages = () => {
  const messages = [
    "Analizando audio...",
    "Identificando hablantes...",
    "Transcribiendo consulta...",
    "Detectando síntomas...",
    "Estructurando historia clínica...",
    "Redactando informe preliminar...",
    "Finalizando..."
  ];
  const [index, setIndex] = useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % messages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return createPortal(
    <div className="loading-container">
      <div className="background-shapes">
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
      </div>
      <div className="spinner-wrapper">
        <motion.div
          className="loading-ring"
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />
        <div className="logo-center">
          <MBSLogo size={50} />
        </div>
      </div>

      <div className="loading-text-wrapper">
        <AnimatePresence mode="wait">
          <motion.p
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5 }}
            className="loading-text"
          >
            {messages[index]}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>,
    document.body
  );
};

export const HistoryView: React.FC<HistoryViewProps> = ({
  content,
  isLoading,
  patientName,
  onGenerateReport,
  onNewConsultation
}) => {
  // ... (existing state)
  const [copied, setCopied] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // Split content into History and Maria Notes
  const [historyText, mariaNotes] = content ? content.split('---MARIA_NOTES---') : ['', ''];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenReport = async () => {
    setShowReportModal(true);
    if (!reportContent && onGenerateReport) {
      setIsGeneratingReport(true);
      try {
        const report = await onGenerateReport();
        setReportContent(report);
      } catch (error) {
        console.error("Error generating report:", error);
        setReportContent("Error al generar el informe. Inténtelo de nuevo.");
      } finally {
        setIsGeneratingReport(false);
      }
    }
  };

  const handlePrintReport = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const htmlContent = reportContent
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

      printWindow.document.write(`
        <html>
          <head>
            <title>Informe Médico - ${patientName}</title>
            <style>
              body { font-family: 'Georgia', serif; padding: 40px; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
              .header-container { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 60px; }
              .logo-img { width: 180px; height: auto; }
              .doctor-info { text-align: right; font-family: 'Arial', sans-serif; font-size: 14px; color: #000; }
              .doctor-name { font-weight: bold; font-size: 16px; margin-bottom: 4px; }
              .report-title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 18px; margin-bottom: 40px; text-transform: uppercase; }
              .patient-info { margin-bottom: 30px; font-size: 16px; }
              .content { font-size: 16px; text-align: justify; }
              .footer { margin-top: 80px; text-align: center; font-size: 12px; color: #000; font-family: 'Arial', sans-serif; }
              strong { font-weight: bold; color: #000; }
            </style>
          </head>
          <body>
            <div class="header-container">
              <img src="${window.location.origin}/medibilbao_logo.png" alt="MediBilbao Salud" class="logo-img" />
              <div class="doctor-info">
                <div class="doctor-name">Dra. Itziar Gotxi</div>
                <div>Especialista en</div>
                <div>Otorrinolaringología</div>
                <br/>
                <div>Nº. Col. 484809757</div>
              </div>
            </div>

            <div class="report-title">INFORME MEDICO</div>

            <div class="patient-info">
              <strong>Paciente:</strong> ${patientName}
            </div>

            <div class="content">
              ${htmlContent}
            </div>

            <div class="footer">
              <div>MediSalud Bilbao Gran Vía 63bis 2º dpto.6 48011 BILBAO Tel: 944329670</div>
              <div>Email:info@medibilbaosalud.com www.medibilbaosalud.com</div>
            </div>

            <script>
              window.onload = function() { window.print(); window.close(); }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  if (isLoading) {
    return <LoadingMessages />;
  }

  if (!content) {
    return (
      <div className="empty-state">
        <FileText size={48} className="empty-icon" />
        <p>No hay historia clínica generada aún.</p>
      </div>
    );
  }

  return (
    <div className="history-view-container">
      <div className="history-layout">
        {/* Main Document Column */}
        <div className="document-column">
          <motion.div
            className="document-card"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="document-header">
              <div className="doc-title">
                <FileText size={20} className="doc-icon" />
                <span>Historia Clínica</span>
              </div>
              <div className="doc-actions">
                {onNewConsultation && (
                  <button
                    className="action-button new-consultation"
                    onClick={onNewConsultation}
                  >
                    <Plus size={18} />
                    <span>Nueva Consulta</span>
                  </button>
                )}
                <button
                  className="action-button secondary"
                  onClick={handleOpenReport}
                  title="Generar Informe Médico Formal"
                >
                  <FileOutput size={16} />
                  <span>Informe</span>
                </button>
                <button
                  className={`action-button copy-btn ${copied ? 'success' : ''}`}
                  onClick={() => handleCopy(historyText)}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  <span>{copied ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
            </div>

            <div className="document-content markdown-body">
              <ReactMarkdown>{historyText}</ReactMarkdown>
            </div>
          </motion.div>
        </div>

        {/* Maria Notes Column */}
        {mariaNotes && (
          <div className="notes-column">
            <motion.div
              className="maria-notes-card"
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <div className="notes-header">
                <Sparkles size={18} className="notes-icon" />
                <span>Notas de Maria AI</span>
              </div>
              <div className="notes-content">
                <ReactMarkdown>{mariaNotes}</ReactMarkdown>
              </div>
            </motion.div>
          </div>
        )}
      </div>

      {/* Report Modal */}
      <AnimatePresence>
        {showReportModal && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="modal-header">
                <h3>Informe Médico Formal</h3>
                <button className="close-btn" onClick={() => setShowReportModal(false)}>
                  <X size={20} />
                </button>
              </div>

              <div className="modal-body">
                {isGeneratingReport ? (
                  <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Redactando informe...</p>
                  </div>
                ) : (
                  <textarea
                    className="report-editor"
                    value={reportContent}
                    onChange={(e) => setReportContent(e.target.value)}
                  />
                )}
              </div>

              <div className="modal-footer">
                {isGeneratingReport ? null : (
                  <>
                    <button className="action-button primary" onClick={() => handleCopy(reportContent)}>
                      <Copy size={16} /> Copiar
                    </button>
                    <button className="action-button success" onClick={handlePrintReport}>
                      <Printer size={16} /> Imprimir
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .history-view-container {
          height: 100%;
          width: 100%; /* Ensure full width */
          overflow-y: auto;
          padding-bottom: 2rem;
        }

        .history-layout {
          display: flex;
          gap: 2rem;
          align-items: flex-start;
          max-width: 1200px;
          margin: 0 auto;
        }

        .document-column {
          flex: 3;
          min-width: 0;
        }

        .notes-column {
          flex: 1;
          min-width: 280px;
          position: sticky;
          top: 0;
        }

        .document-card {
          background: white;
          border-radius: 16px;
          box-shadow: var(--shadow-md);
          /* overflow: hidden; Removed to prevent clipping */
          border: 1px solid var(--glass-border);
        }

        .document-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 2rem;
          background: #f8fafc;
          border-bottom: 1px solid var(--glass-border);
        }

        .doc-title {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-weight: 600;
          color: var(--text-primary);
          font-size: 1.1rem;
        }

        .doc-icon {
          color: var(--brand-primary);
        }

        .doc-actions {
          display: flex;
          gap: 0.75rem;
        }

        .action-button {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.6rem 1.2rem;
          border-radius: 12px;
          border: none;
          font-size: 0.95rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        .action-button.new-consultation {
          background: var(--brand-gradient);
          color: white;
          box-shadow: 0 4px 12px rgba(38, 166, 154, 0.3);
          font-weight: 600;
        }
        
        .action-button.new-consultation:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(38, 166, 154, 0.4);
        }

        .action-button.copy-btn {
          background: white;
          color: var(--text-secondary);
          border: 1px solid var(--glass-border);
          box-shadow: var(--shadow-sm);
        }
        
        .action-button.copy-btn:hover {
          border-color: var(--brand-primary);
          color: var(--brand-primary);
          background: #f0fdfa;
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .action-button.primary {
          background: var(--bg-secondary);
          color: var(--text-primary);
          border: 1px solid var(--glass-border);
        }

        .action-button.primary:hover {
          background: var(--bg-tertiary);
        }

        .action-button.secondary {
          background: transparent;
          color: var(--brand-primary);
          border: 1px solid var(--brand-primary);
        }
        
        .action-button.secondary:hover {
          background: rgba(38, 166, 154, 0.05);
        }

        .action-button.success {
          background: #10b981;
          color: white;
        }

        .document-content {
          padding: 3rem;
          font-family: 'Georgia', serif;
          color: #334155;
          line-height: 1.6;
          font-size: 1.05rem;
        }

        /* Markdown Styles */
        .markdown-body h1, .markdown-body h2, .markdown-body h3 {
          margin-top: 1.5em;
          margin-bottom: 0.75em;
          color: #1e293b;
          font-family: var(--font-sans);
        }
        
        .markdown-body h1 { font-size: 1.5em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
        .markdown-body h2 { font-size: 1.25em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--brand-primary); margin-top: 2em; }
        .markdown-body p { margin-bottom: 1em; }
        .markdown-body ul { padding-left: 1.5em; margin-bottom: 1em; }

        /* Maria Notes Styles */
        .maria-notes-card {
          background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow: var(--shadow-sm);
          border: 1px solid rgba(251, 191, 36, 0.2);
        }

        .notes-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 600;
          color: #92400e;
          margin-bottom: 1rem;
          font-size: 0.95rem;
        }

        .notes-content {
          font-size: 0.9rem;
          color: #78350f;
          line-height: 1.5;
        }

        .loading-container {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 50%, #f0fdfa 100%);
          z-index: 2000;
          gap: 2.5rem;
          overflow: hidden;
        }

        .background-shapes {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            z-index: -1;
        }

        .shape {
            position: absolute;
            border-radius: 50%;
            filter: blur(80px);
            opacity: 0.6;
            animation: float 20s infinite ease-in-out;
        }

        .shape-1 {
            top: -10%;
            left: -10%;
            width: 500px;
            height: 500px;
            background: rgba(38, 166, 154, 0.15);
            animation-delay: 0s;
        }

        .shape-2 {
            bottom: -20%;
            right: -10%;
            width: 600px;
            height: 600px;
            background: rgba(0, 191, 165, 0.1);
            animation-delay: -5s;
        }

        .shape-3 {
            top: 40%;
            left: 40%;
            width: 300px;
            height: 300px;
            background: rgba(128, 203, 196, 0.15);
            animation-delay: -10s;
        }

        @keyframes float {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(30px, -50px) scale(1.1); }
            66% { transform: translate(-20px, 20px) scale(0.9); }
        }

        .spinner-wrapper {
            position: relative;
            width: 100px;
            height: 100px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .loading-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border: 3px solid transparent;
          border-top-color: var(--brand-primary);
          border-right-color: var(--brand-secondary);
          border-radius: 50%;
        }
        
        .logo-center {
            z-index: 2;
        }
        
        .loading-text-wrapper {
            height: 32px;
            overflow: hidden;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 300px;
        }
        
        .loading-text {
            font-size: 1.2rem;
            font-weight: 500;
            color: var(--text-primary);
            letter-spacing: 0.3px;
            background: linear-gradient(90deg, var(--brand-dark), var(--brand-primary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          min-height: 400px;
          gap: 1rem;
          color: var(--text-tertiary);
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }

        .modal-content {
          background: white;
          width: 90%;
          max-width: 800px;
          height: 85vh;
          border-radius: 20px;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-lg);
        }

        .modal-header {
          padding: 1.5rem;
          border-bottom: 1px solid var(--glass-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .modal-header h3 {
          margin: 0;
          color: var(--text-primary);
        }

        .close-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
        }

        .modal-body {
          flex: 1;
          padding: 1.5rem;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .report-editor {
          width: 100%;
          height: 100%;
          border: 1px solid var(--glass-border);
          border-radius: 12px;
          padding: 2rem;
          font-family: 'Georgia', serif;
          font-size: 1.1rem;
          line-height: 1.6;
          resize: none;
          outline: none;
          background: #fdfdfd;
        }

        .report-editor:focus {
          border-color: var(--brand-primary);
        }

        .modal-footer {
          padding: 1.5rem;
          border-top: 1px solid var(--glass-border);
          display: flex;
          justify-content: flex-end;
          gap: 1rem;
        }

        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 1rem;
          color: var(--text-secondary);
        }

        .spinner {
          width: 30px;
          height: 30px;
          border: 3px solid var(--bg-tertiary);
          border-top-color: var(--brand-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
