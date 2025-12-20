import React, { useState, useEffect } from 'react';
import { Search, FileOutput, ChevronRight, Printer, Copy, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { searchMedicalRecords, MedicalRecord } from '../services/supabase';

export const ReportsView: React.FC = () => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MedicalRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
    const [copied, setCopied] = useState(false);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            const data = await searchMedicalRecords(query);
            setResults(data || []);
        } catch (error) {
            console.error('Search error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        handleSearch({ preventDefault: () => { } } as React.FormEvent);
    }, []);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handlePrint = (content: string, patientName: string) => {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
            const htmlContent = content
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

    return (
        <div className="reports-container">
            <div className="search-header">
                <h2>Informes Médicos</h2>
                <form onSubmit={handleSearch} className="search-bar">
                    <Search size={20} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Buscar informe por paciente..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="search-input"
                    />
                </form>
            </div>

            <div className="reports-content">
                <div className="results-list">
                    {isLoading ? (
                        <div className="loading">Cargando...</div>
                    ) : results.length === 0 ? (
                        <div className="no-results">No se encontraron registros</div>
                    ) : (
                        results.map((record) => (
                            <motion.div
                                key={record.id}
                                className={`result-card ${selectedRecord?.id === record.id ? 'active' : ''}`}
                                onClick={() => setSelectedRecord(record)}
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                            >
                                <div className="card-header">
                                    <span className="patient-name">{record.patient_name}</span>
                                    <span className="date">
                                        {new Date(record.created_at || '').toLocaleDateString()}
                                    </span>
                                </div>
                                <div className="card-meta">
                                    {record.medical_report ? (
                                        <span className="status-badge success">Informe Disponible</span>
                                    ) : (
                                        <span className="status-badge pending">Sin Informe</span>
                                    )}
                                </div>
                                <ChevronRight size={16} className="chevron" />
                            </motion.div>
                        ))
                    )}
                </div>

                <div className="preview-panel">
                    {selectedRecord ? (
                        selectedRecord.medical_report ? (
                            <div className="report-preview">
                                <div className="preview-header">
                                    <h3>Informe: {selectedRecord.patient_name}</h3>
                                    <div className="actions">
                                        <button
                                            className="action-button primary"
                                            onClick={() => handleCopy(selectedRecord.medical_report!)}
                                        >
                                            {copied ? <Check size={16} /> : <Copy size={16} />}
                                            {copied ? 'Copiado' : 'Copiar'}
                                        </button>
                                        <button
                                            className="action-button success"
                                            onClick={() => handlePrint(selectedRecord.medical_report!, selectedRecord.patient_name)}
                                        >
                                            <Printer size={16} /> Imprimir
                                        </button>
                                    </div>
                                </div>
                                <div className="report-body">
                                    <div className="markdown-content">
                                        <ReactMarkdown>{selectedRecord.medical_report}</ReactMarkdown>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="empty-preview">
                                <FileOutput size={48} />
                                <p>Este paciente no tiene un informe generado.</p>
                                <p className="sub-text">Ve al Historial para generar uno.</p>
                            </div>
                        )
                    ) : (
                        <div className="empty-preview">
                            <FileOutput size={48} />
                            <p>Selecciona un paciente para ver su informe</p>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .reports-container {
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    gap: 2rem;
                }
                
                /* Reusing styles from SearchHistory for consistency */
                .search-header h2 { margin: 0 0 1.5rem 0; color: var(--text-primary); }
                .search-bar { position: relative; max-width: 600px; }
                .search-icon { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: var(--text-secondary); }
                .search-input {
                    width: 100%; padding: 1rem 1rem 1rem 3rem; border-radius: 16px;
                    border: 1px solid var(--glass-border); background: var(--bg-primary);
                    font-size: 1rem; color: var(--text-primary); box-shadow: var(--shadow-sm);
                    transition: all 0.2s;
                }
                .search-input:focus { outline: none; box-shadow: var(--shadow-md); border-color: var(--brand-primary); }

                .reports-content {
                    display: grid; grid-template-columns: 350px 1fr; gap: 2rem; flex: 1; overflow: hidden;
                }

                .results-list { overflow-y: auto; padding-right: 0.5rem; display: flex; flex-direction: column; gap: 1rem; }

                .result-card {
                    background: var(--bg-primary); padding: 1.25rem; border-radius: 16px;
                    cursor: pointer; border: 1px solid transparent; transition: all 0.2s;
                    position: relative; box-shadow: var(--shadow-sm);
                }
                .result-card:hover { box-shadow: var(--shadow-md); }
                .result-card.active { border-color: var(--brand-primary); background: rgba(38, 166, 154, 0.05); }

                .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
                .patient-name { font-weight: 600; color: var(--text-primary); }
                .date { font-size: 0.8rem; color: var(--text-tertiary); }

                .status-badge {
                    font-size: 0.75rem; padding: 4px 8px; border-radius: 8px; font-weight: 500;
                }
                .status-badge.success { background: #dcfce7; color: #166534; }
                .status-badge.pending { background: #f1f5f9; color: #64748b; }

                .chevron { position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); opacity: 0; transition: opacity 0.2s; }
                .result-card:hover .chevron { opacity: 1; }

                .preview-panel {
                    background: var(--bg-primary); border-radius: 24px; padding: 2rem;
                    box-shadow: var(--shadow-md); overflow-y: auto; border: 1px solid var(--glass-border);
                }

                .preview-header {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--glass-border);
                }
                .preview-header h3 { margin: 0; color: var(--text-primary); }
                
                .actions { display: flex; gap: 1rem; }

                .report-body {
                    background: white;
                    padding: 3rem;
                    border-radius: 8px;
                    box-shadow: var(--shadow-sm);
                    min-height: 500px;
                }

                .markdown-content {
                    font-family: 'Georgia', serif;
                    line-height: 1.8;
                    color: var(--text-primary);
                    font-size: 1.1rem;
                }

                .markdown-content strong {
                    font-weight: bold;
                    color: #000;
                }

                .markdown-content h1, .markdown-content h2, .markdown-content h3 {
                    margin-top: 1.5rem;
                    margin-bottom: 1rem;
                    color: #2c3e50;
                }

                .markdown-content p {
                    margin-bottom: 1rem;
                    white-space: pre-wrap;
                }
                
                .markdown-content ul, .markdown-content ol {
                    padding-left: 1.5rem;
                    margin-bottom: 1rem;
                }

                .empty-preview {
                    height: 100%; display: flex; flex-direction: column; align-items: center;
                    justify-content: center; color: var(--text-tertiary); gap: 1rem;
                }
                .sub-text { font-size: 0.9rem; color: var(--text-secondary); }

                .action-button {
                    display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;
                    border-radius: 8px; border: none; font-size: 0.9rem; font-weight: 500;
                    cursor: pointer; transition: all 0.2s;
                }
                .action-button.primary { background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--glass-border); }
                .action-button.success { background: #10b981; color: white; }
            `}</style>
        </div>
    );
};
