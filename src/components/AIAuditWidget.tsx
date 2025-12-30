import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AIAuditWidgetProps {
    corrections: number;
    models: {
        generation: string;
        validation: string;
    };
    errorsFixed: number;
    versionsCount: number;
}

export const AIAuditWidget: React.FC<AIAuditWidgetProps> = ({
    corrections,
    models,
    errorsFixed,
    versionsCount
}) => {
    const [isHovered, setIsHovered] = useState(false);

    // Determine status and color
    let status: 'perfect' | 'corrected' | 'error' = 'perfect';
    if (corrections > 0) status = 'corrected';
    // Logic for 'error' would depend on if we flagged it as failed, but currently pipeline doesn't return failed state explicitly here without throwing.
    // We'll stick to perfect/corrected for now as they are the success states.

    const getStatusConfig = () => {
        switch (status) {
            case 'perfect':
                return {
                    icon: ShieldCheck,
                    color: '#10b981', // Emerald 500
                    bg: 'rgba(16, 185, 129, 0.1)',
                    text: 'Verificado',
                    borderColor: 'rgba(16, 185, 129, 0.2)'
                };
            case 'corrected':
                return {
                    icon: ShieldAlert,
                    color: '#f59e0b', // Amber 500
                    bg: 'rgba(245, 158, 11, 0.1)',
                    text: 'Autocorregido',
                    borderColor: 'rgba(245, 158, 11, 0.2)'
                };
            default:
                return {
                    icon: ShieldX,
                    color: '#ef4444',
                    bg: 'rgba(239, 68, 68, 0.1)',
                    text: 'Error',
                    borderColor: 'rgba(239, 68, 68, 0.2)'
                };
        }
    };

    const config = getStatusConfig();
    const Icon = config.icon;

    return (
        <div
            className="ai-audit-widget"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <motion.div
                className="audit-badge"
                style={{
                    backgroundColor: config.bg,
                    borderColor: config.borderColor,
                    color: config.color
                }}
                animate={{ opacity: isHovered ? 1 : 0.7 }}
            >
                <Icon size={14} strokeWidth={2.5} />
                <span className="badge-text">{config.text}</span>
                {corrections > 0 && <span className="correction-count">({corrections})</span>}
                <Info size={12} className="info-icon" style={{ opacity: 0.5 }} />
            </motion.div>

            <AnimatePresence>
                {isHovered && (
                    <motion.div
                        className="audit-tooltip"
                        initial={{ opacity: 0, y: 5, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 5, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                    >
                        <div className="tooltip-header">
                            <h4>Auditoría IA</h4>
                            <span className="version-tag">Humanity Grade v2</span>
                        </div>

                        <div className="tooltip-content">
                            <div className="tooltip-row">
                                <span className="label">Correcciones:</span>
                                <span className={`value ${corrections > 0 ? 'highlight' : ''}`}>
                                    {corrections} ciclos
                                </span>
                            </div>
                            <div className="tooltip-row">
                                <span className="label">Versiones:</span>
                                <span className="value">{versionsCount} borradores</span>
                            </div>

                            <div className="divider"></div>

                            <div className="models-section">
                                <p className="section-title">Modelos Activos:</p>
                                <div className="model-tag">
                                    <span className="role">Generación:</span>
                                    <span className="name">{models.generation}</span>
                                </div>
                                <div className="model-tag">
                                    <span className="role">Validación:</span>
                                    <span className="name">{models.validation}</span>
                                </div>
                            </div>

                            {errorsFixed > 0 && (
                                <div className="errors-prevented">
                                    <ShieldCheck size={12} />
                                    <span>{errorsFixed} errores prevenidos</span>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <style>{`
                .ai-audit-widget {
                    position: absolute;
                    top: 1rem;
                    right: 1rem;
                    z-index: 10;
                }

                .audit-badge {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 10px;
                    border-radius: 20px;
                    font-size: 0.75rem;
                    font-weight: 600;
                    cursor: help;
                    border: 1px solid;
                    backdrop-filter: blur(4px);
                    transition: all 0.2s ease;
                }

                .audit-badge:hover {
                    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                    transform: translateY(-1px);
                }

                .audit-tooltip {
                    position: absolute;
                    top: 100%;
                    right: 0;
                    margin-top: 8px;
                    width: 260px;
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(12px);
                    border-radius: 12px;
                    border: 1px solid rgba(255, 255, 255, 0.5);
                    box-shadow: 
                        0 4px 6px -1px rgba(0, 0, 0, 0.1),
                        0 2px 4px -1px rgba(0, 0, 0, 0.06),
                        0 0 0 1px rgba(0, 0, 0, 0.05);
                    overflow: hidden;
                    font-family: var(--font-sans);
                }

                .tooltip-header {
                    background: linear-gradient(to right, #f8fafc, #f1f5f9);
                    padding: 10px 14px;
                    border-bottom: 1px solid #e2e8f0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .tooltip-header h4 {
                    margin: 0;
                    font-size: 0.85rem;
                    font-weight: 700;
                    color: #334155;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }

                .version-tag {
                    font-size: 0.65rem;
                    color: #64748b;
                    background: #e2e8f0;
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                .tooltip-content {
                    padding: 14px;
                }

                .tooltip-row {
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.85rem;
                    margin-bottom: 6px;
                    color: #475569;
                }

                .tooltip-row .value {
                    font-weight: 600;
                    color: #1e293b;
                    font-variant-numeric: tabular-nums;
                }

                .tooltip-row .value.highlight {
                    color: #d97706;
                }

                .divider {
                    height: 1px;
                    background: #f1f5f9;
                    margin: 10px 0;
                }

                .section-title {
                    font-size: 0.75rem;
                    color: #94a3b8;
                    font-weight: 600;
                    margin: 0 0 6px 0;
                    text-transform: uppercase;
                }

                .model-tag {
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.8rem;
                    margin-bottom: 4px;
                }

                .model-tag .role {
                    color: #64748b;
                }

                .model-tag .name {
                    font-family: monospace;
                    font-size: 0.75rem;
                    color: #0f172a;
                    background: #f1f5f9;
                    padding: 1px 4px;
                    border-radius: 3px;
                }

                .errors-prevented {
                    margin-top: 10px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 0.8rem;
                    color: #059669;
                    background: #ecfdf5;
                    padding: 6px 10px;
                    border-radius: 6px;
                    font-weight: 500;
                }
            `}</style>
        </div>
    );
};
