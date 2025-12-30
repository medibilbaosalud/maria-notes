import { useState, useEffect } from 'react';
import { BookOpen, AlertTriangle, CheckCircle, Lightbulb, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { getLessonsFromDB, ImprovementLesson } from '../services/doctor-feedback';

interface LessonsPanelProps {
    onClose: () => void;
}

export default function LessonsPanel({ onClose }: LessonsPanelProps) {
    const [lessons, setLessons] = useState<ImprovementLesson[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    useEffect(() => {
        loadLessons();
    }, []);

    const loadLessons = async () => {
        setLoading(true);
        const data = await getLessonsFromDB();
        setLessons(data);
        setLoading(false);
    };

    const getCategoryIcon = (category?: string) => {
        switch (category) {
            case 'hallucination': return <AlertTriangle size={16} className="text-red-500" />;
            case 'missing_data': return <AlertTriangle size={16} className="text-orange-500" />;
            case 'terminology': return <BookOpen size={16} className="text-blue-500" />;
            case 'formatting': return <CheckCircle size={16} className="text-green-500" />;
            default: return <Lightbulb size={16} className="text-yellow-500" />;
        }
    };

    const getCategoryLabel = (category?: string) => {
        const labels: Record<string, string> = {
            hallucination: 'Alucinación',
            missing_data: 'Datos Faltantes',
            terminology: 'Terminología',
            formatting: 'Formato',
            style: 'Estilo',
        };
        return labels[category || 'style'] || 'Otro';
    };

    return (
        <div className="lessons-panel">
            <div className="lessons-header">
                <h2><Lightbulb size={24} /> Lecciones Aprendidas</h2>
                <div className="header-actions">
                    <button onClick={loadLessons} className="refresh-btn">
                        <RefreshCw size={16} /> Actualizar
                    </button>
                    <button onClick={onClose} className="close-btn">✕</button>
                </div>
            </div>

            <div className="lessons-stats">
                <div className="stat">
                    <span className="stat-value">{lessons.length}</span>
                    <span className="stat-label">Total Lecciones</span>
                </div>
                <div className="stat">
                    <span className="stat-value">{lessons.filter(l => l.improvement_category === 'hallucination').length}</span>
                    <span className="stat-label">Alucinaciones</span>
                </div>
                <div className="stat">
                    <span className="stat-value">{lessons.filter(l => l.improvement_category === 'terminology').length}</span>
                    <span className="stat-label">Terminología</span>
                </div>
            </div>

            {loading ? (
                <div className="loading-state">Cargando lecciones...</div>
            ) : lessons.length === 0 ? (
                <div className="empty-state">
                    <Lightbulb size={48} />
                    <p>No hay lecciones aún.</p>
                    <span>Las lecciones se crearán automáticamente cuando edites y guardes una historia clínica.</span>
                </div>
            ) : (
                <div className="lessons-list">
                    {lessons.map((lesson) => (
                        <div key={lesson.id} className="lesson-card">
                            <div
                                className="lesson-header"
                                onClick={() => setExpandedId(expandedId === lesson.id ? null : lesson.id!)}
                            >
                                <div className="lesson-meta">
                                    {getCategoryIcon(lesson.improvement_category)}
                                    <span className="category-badge">{getCategoryLabel(lesson.improvement_category)}</span>
                                    <span className="lesson-date">
                                        {new Date(lesson.created_at!).toLocaleDateString('es-ES', {
                                            day: 'numeric',
                                            month: 'short',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </span>
                                </div>
                                <div className="lesson-summary">
                                    {lesson.lesson_summary?.substring(0, 100)}...
                                </div>
                                {expandedId === lesson.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            </div>

                            {expandedId === lesson.id && (
                                <div className="lesson-details">
                                    <div className="detail-section">
                                        <h4>Resumen de la Lección</h4>
                                        <p>{lesson.lesson_summary}</p>
                                    </div>

                                    <div className="detail-section">
                                        <h4>Cambios Detectados ({lesson.changes_detected?.length || 0})</h4>
                                        {lesson.changes_detected?.map((change, idx) => (
                                            <div key={idx} className="change-item">
                                                <span className={`change-type ${change.type}`}>{change.type}</span>
                                                <strong>{change.section}</strong>
                                                <div className="change-diff">
                                                    <div className="original">
                                                        <span>IA:</span> {change.original.substring(0, 150)}...
                                                    </div>
                                                    <div className="edited">
                                                        <span>Doctor:</span> {change.edited.substring(0, 150)}...
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <style>{`
                .lessons-panel {
                    background: white;
                    border-radius: 16px;
                    box-shadow: 0 4px 24px rgba(0,0,0,0.15);
                    max-width: 800px;
                    margin: 0 auto;
                    overflow: hidden;
                }
                .lessons-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 1.5rem;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                }
                .lessons-header h2 {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    margin: 0;
                    font-size: 1.25rem;
                }
                .header-actions {
                    display: flex;
                    gap: 0.5rem;
                }
                .refresh-btn, .close-btn {
                    background: rgba(255,255,255,0.2);
                    border: none;
                    color: white;
                    padding: 0.5rem 0.75rem;
                    border-radius: 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                }
                .refresh-btn:hover, .close-btn:hover {
                    background: rgba(255,255,255,0.3);
                }
                .lessons-stats {
                    display: flex;
                    justify-content: space-around;
                    padding: 1rem;
                    background: #f8fafc;
                    border-bottom: 1px solid #e2e8f0;
                }
                .stat {
                    text-align: center;
                }
                .stat-value {
                    display: block;
                    font-size: 1.5rem;
                    font-weight: 700;
                    color: #1e293b;
                }
                .stat-label {
                    font-size: 0.75rem;
                    color: #64748b;
                }
                .loading-state, .empty-state {
                    padding: 3rem;
                    text-align: center;
                    color: #64748b;
                }
                .empty-state svg {
                    opacity: 0.3;
                    margin-bottom: 1rem;
                }
                .lessons-list {
                    max-height: 500px;
                    overflow-y: auto;
                }
                .lesson-card {
                    border-bottom: 1px solid #e2e8f0;
                }
                .lesson-header {
                    padding: 1rem 1.5rem;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                    position: relative;
                }
                .lesson-header:hover {
                    background: #f8fafc;
                }
                .lesson-header > svg {
                    position: absolute;
                    right: 1rem;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #94a3b8;
                }
                .lesson-meta {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                .category-badge {
                    background: #f1f5f9;
                    padding: 0.25rem 0.5rem;
                    border-radius: 4px;
                    font-size: 0.75rem;
                    font-weight: 600;
                    color: #475569;
                }
                .lesson-date {
                    font-size: 0.75rem;
                    color: #94a3b8;
                    margin-left: auto;
                    padding-right: 2rem;
                }
                .lesson-summary {
                    font-size: 0.9rem;
                    color: #334155;
                }
                .lesson-details {
                    padding: 1rem 1.5rem;
                    background: #f8fafc;
                    border-top: 1px solid #e2e8f0;
                }
                .detail-section {
                    margin-bottom: 1rem;
                }
                .detail-section h4 {
                    font-size: 0.85rem;
                    color: #64748b;
                    margin-bottom: 0.5rem;
                }
                .detail-section p {
                    margin: 0;
                    color: #1e293b;
                }
                .change-item {
                    background: white;
                    padding: 0.75rem;
                    border-radius: 8px;
                    margin-bottom: 0.5rem;
                    border: 1px solid #e2e8f0;
                }
                .change-type {
                    display: inline-block;
                    padding: 0.125rem 0.375rem;
                    border-radius: 4px;
                    font-size: 0.7rem;
                    font-weight: 600;
                    margin-right: 0.5rem;
                }
                .change-type.added { background: #dcfce7; color: #166534; }
                .change-type.removed { background: #fee2e2; color: #991b1b; }
                .change-type.modified { background: #fef3c7; color: #92400e; }
                .change-diff {
                    margin-top: 0.5rem;
                    font-size: 0.8rem;
                }
                .original, .edited {
                    padding: 0.375rem 0.5rem;
                    border-radius: 4px;
                    margin-bottom: 0.25rem;
                }
                .original {
                    background: #fee2e2;
                    color: #991b1b;
                }
                .edited {
                    background: #dcfce7;
                    color: #166534;
                }
                .original span, .edited span {
                    font-weight: 600;
                    margin-right: 0.5rem;
                }
            `}</style>
        </div>
    );
}
