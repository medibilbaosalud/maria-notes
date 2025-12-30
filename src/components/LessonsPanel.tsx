
import { useState, useEffect } from 'react';
import {
    BookOpen, AlertTriangle, CheckCircle, Lightbulb,
    RefreshCw, ChevronDown, ChevronUp, Trash2, Edit3,
    MessageSquare, Check, X, Info, Sparkles
} from 'lucide-react';
import { getLessonsFromDB, ImprovementLesson, supabase } from '../services/doctor-feedback';
import { motion, AnimatePresence } from 'framer-motion';

interface LessonsPanelProps {
    onClose: () => void;
    groqApiKey?: string;
}

export default function LessonsPanel({ onClose }: LessonsPanelProps) {
    const [lessons, setLessons] = useState<ImprovementLesson[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'active' | 'learning' | 'rejected'>('active');

    // Edit states
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [commentingId, setCommentingId] = useState<string | null>(null);
    const [commentValue, setCommentValue] = useState('');

    useEffect(() => {
        loadLessons();
    }, []);

    const loadLessons = async () => {
        setLoading(true);
        const data = await getLessonsFromDB();
        // Since we updated the schema, we might need to handle legacy data or just filter
        setLessons(data);
        setLoading(false);
    };

    const handleUpdateStatus = async (id: string, status: 'active' | 'rejected' | 'learning') => {
        if (!supabase) return;
        const { error } = await supabase
            .from('ai_improvement_lessons')
            .update({ status })
            .eq('id', id);

        if (!error) {
            setLessons(lessons.map(l => l.id === id ? { ...l, status } : l));
        }
    };

    const handleSaveEdit = async (id: string) => {
        if (!supabase) return;
        const { error } = await supabase
            .from('ai_improvement_lessons')
            .update({ lesson_summary: editValue })
            .eq('id', id);

        if (!error) {
            setLessons(lessons.map(l => l.id === id ? { ...l, lesson_summary: editValue } : l));
            setEditingId(null);
        }
    };

    const handleSaveComment = async (id: string) => {
        if (!supabase) return;
        const { error } = await supabase
            .from('ai_improvement_lessons')
            .update({ doctor_comment: commentValue })
            .eq('id', id);

        if (!error) {
            setLessons(lessons.map(l => l.id === id ? { ...l, doctor_comment: commentValue } : l));
            setCommentingId(null);
        }
    };

    const getCategoryIcon = (category?: string) => {
        switch (category) {
            case 'hallucination': return <AlertTriangle size={16} className="text-red-500" />;
            case 'missing_data': return <AlertTriangle size={16} className="text-orange-500" />;
            case 'terminology': return <BookOpen size={16} className="text-blue-500" />;
            case 'formatting': return <CheckCircle size={16} className="text-emerald-500" />;
            default: return <Lightbulb size={16} className="text-amber-500" />;
        }
    };

    const filteredLessons = lessons.filter(l => {
        if (activeTab === 'active') return l.status === 'active';
        if (activeTab === 'learning') return l.status === 'learning' || !l.status; // fallback for legacy
        if (activeTab === 'rejected') return l.status === 'rejected';
        return false;
    });

    return (
        <div className="lessons-container">
            <div className="lessons-panel-modern">
                <div className="lessons-header-modern">
                    <div className="header-title">
                        <div className="icon-pulse">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h2>Panel de Aprendizaje</h2>
                            <p className="dra-greeting">Hola, Dra. Gotxi. Aquí vive la memoria de tu asistente.</p>
                        </div>
                    </div>
                    <div className="header-actions">
                        <button onClick={loadLessons} className="btn-icon" title="Sincronizar">
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button onClick={onClose} className="btn-close">✕</button>
                    </div>
                </div>

                <div className="tabs-bar">
                    <button
                        className={`tab-item ${activeTab === 'active' ? 'active' : ''}`}
                        onClick={() => setActiveTab('active')}
                    >
                        <CheckCircle size={16} /> Activas
                        <span className="count-badge">{lessons.filter(l => l.status === 'active').length}</span>
                    </button>
                    <button
                        className={`tab-item ${activeTab === 'learning' ? 'active' : ''}`}
                        onClick={() => setActiveTab('learning')}
                    >
                        <Info size={16} /> En Aprendizaje
                        <span className="count-badge warning">{lessons.filter(l => !l.status || l.status === 'learning').length}</span>
                    </button>
                    <button
                        className={`tab-item ${activeTab === 'rejected' ? 'active' : ''}`}
                        onClick={() => setActiveTab('rejected')}
                    >
                        <Trash2 size={16} /> Rechazadas
                    </button>
                </div>

                <div className="lessons-content">
                    {loading ? (
                        <div className="loading-state-modern">
                            <div className="spinner"></div>
                            <p>Consultando memoria...</p>
                        </div>
                    ) : filteredLessons.length === 0 ? (
                        <div className="empty-state-modern">
                            <img src="https://illustrations.popsy.co/gray/brainstorming.svg" alt="Empty" width="200" />
                            <h3>No hay reglas en esta sección</h3>
                            <p>Tu asistente aprende de cada corrección que haces.</p>
                        </div>
                    ) : (
                        <div className="lessons-scroll">
                            <AnimatePresence>
                                {filteredLessons.map((lesson) => (
                                    <motion.div
                                        key={lesson.id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className={`lesson-card-modern ${expandedId === lesson.id ? 'expanded' : ''}`}
                                    >
                                        <div className="card-main" onClick={() => setExpandedId(expandedId === lesson.id ? null : lesson.id!)}>
                                            <div className="card-top">
                                                <div className="category-tag">
                                                    {getCategoryIcon(lesson.improvement_category)}
                                                    <span>{lesson.improvement_category}</span>
                                                </div>
                                                {lesson.recurrence_count > 1 && (
                                                    <div className="recurrence-badge">
                                                        Visto {lesson.recurrence_count}x
                                                    </div>
                                                )}
                                                <span className="lesson-date-modern">
                                                    {new Date(lesson.created_at!).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                                </span>
                                            </div>

                                            {editingId === lesson.id ? (
                                                <div className="edit-zone" onClick={e => e.stopPropagation()}>
                                                    <input
                                                        value={editValue}
                                                        onChange={e => setEditValue(e.target.value)}
                                                        autoFocus
                                                    />
                                                    <button className="btn-save" onClick={() => handleSaveEdit(lesson.id!)}><Check size={16} /></button>
                                                    <button className="btn-cancel" onClick={() => setEditingId(null)}><X size={16} /></button>
                                                </div>
                                            ) : (
                                                <div className="lesson-text">
                                                    {lesson.lesson_summary}
                                                </div>
                                            )}
                                        </div>

                                        <div className="card-actions-modern">
                                            <div className="main-actions">
                                                <button onClick={() => { setEditingId(lesson.id!); setEditValue(lesson.lesson_summary); }} className="action-link">
                                                    <Edit3 size={14} /> Editar
                                                </button>
                                                <button onClick={() => { setCommentingId(lesson.id!); setCommentValue(lesson.doctor_comment || ''); }} className="action-link">
                                                    <MessageSquare size={14} /> Nota
                                                </button>
                                            </div>
                                            <div className="status-actions">
                                                {activeTab !== 'rejected' && (
                                                    <button onClick={() => handleUpdateStatus(lesson.id!, 'rejected')} className="btn-veto" title="Veto (Rechazar)">
                                                        <Trash2 size={16} /> Rechazar
                                                    </button>
                                                )}
                                                {activeTab === 'rejected' && (
                                                    <button onClick={() => handleUpdateStatus(lesson.id!, 'active')} className="btn-restore">
                                                        Restaurar
                                                    </button>
                                                )}
                                                {activeTab === 'learning' && (
                                                    <button onClick={() => handleUpdateStatus(lesson.id!, 'active')} className="btn-approve">
                                                        Aprobar Manual
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {commentingId === lesson.id && (
                                            <div className="comment-overlay">
                                                <textarea
                                                    placeholder="Añade una nota personal (no visible para la IA)..."
                                                    value={commentValue}
                                                    onChange={e => setCommentValue(e.target.value)}
                                                />
                                                <div className="comment-btns">
                                                    <button onClick={() => handleSaveComment(lesson.id!)}>Guardar Nota</button>
                                                    <button className="cancel" onClick={() => setCommentingId(null)}>Cerrar</button>
                                                </div>
                                            </div>
                                        )}

                                        {lesson.doctor_comment && !commentingId && (
                                            <div className="doctor-note-bubble">
                                                <MessageSquare size={12} />
                                                <span>Mi nota: {lesson.doctor_comment}</span>
                                            </div>
                                        )}
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .lessons-container {
                    position: fixed;
                    inset: 0;
                    background: rgba(15, 23, 42, 0.4);
                    backdrop-filter: blur(8px);
                    z-index: 1000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 2rem;
                }
                .lessons-panel-modern {
                    background: #ffffff;
                    width: 100%;
                    max-width: 650px;
                    border-radius: 24px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    display: flex;
                    flex-direction: column;
                    max-height: 85vh;
                    overflow: hidden;
                    border: 1px solid rgba(226, 232, 240, 0.8);
                }
                .lessons-header-modern {
                    padding: 1.5rem 2rem;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: linear-gradient(to right, #f8fafc, #ffffff);
                    border-bottom: 1px solid #f1f5f9;
                }
                .header-title {
                    display: flex;
                    gap: 1rem;
                    align-items: center;
                }
                .icon-pulse {
                    background: #f0fdf4;
                    color: #22c55e;
                    padding: 10px;
                    border-radius: 12px;
                    box-shadow: 0 0 0 4px #f0fdf4;
                }
                .header-title h2 {
                    margin: 0;
                    font-size: 1.25rem;
                    color: #0f172a;
                    font-weight: 700;
                }
                .dra-greeting {
                    margin: 2px 0 0;
                    font-size: 0.85rem;
                    color: #64748b;
                }
                .header-actions {
                    display: flex;
                    gap: 0.5rem;
                }
                .btn-icon {
                    background: none;
                    border: none;
                    color: #94a3b8;
                    cursor: pointer;
                    padding: 8px;
                    border-radius: 8px;
                    transition: all 0.2s;
                }
                .btn-icon:hover {
                    background: #f1f5f9;
                    color: #475569;
                }
                .btn-close {
                    background: #f1f5f9;
                    border: none;
                    color: #64748b;
                    width: 32px;
                    height: 32px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 700;
                }
                .tabs-bar {
                    display: flex;
                    padding: 0 2rem;
                    background: #f8fafc;
                    border-bottom: 1px solid #f1f5f9;
                    gap: 1.5rem;
                }
                .tab-item {
                    background: none;
                    border: none;
                    padding: 1rem 0;
                    font-size: 0.9rem;
                    font-weight: 600;
                    color: #94a3b8;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    position: relative;
                }
                .tab-item.active {
                    color: #0f766e;
                }
                .tab-item.active::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 2px;
                    background: #0f172a;
                    border-radius: 2px 2px 0 0;
                }
                .count-badge {
                    background: #e2e8f0;
                    color: #475569;
                    padding: 1px 6px;
                    border-radius: 6px;
                    font-size: 0.7rem;
                    font-weight: 700;
                }
                .count-badge.warning {
                    background: #fef3c7;
                    color: #92400e;
                }
                .lessons-scroll {
                    padding: 1.5rem 2rem;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }
                .lesson-card-modern {
                    background: #ffffff;
                    border: 1px solid #f1f5f9;
                    border-radius: 16px;
                    transition: all 0.2s;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
                }
                .lesson-card-modern:hover {
                    border-color: #e2e8f0;
                    transform: translateY(-2px);
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
                }
                .card-main {
                    padding: 1.25rem;
                    cursor: pointer;
                }
                .card-top {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    margin-bottom: 0.75rem;
                }
                .category-tag {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: #f8fafc;
                    padding: 4px 10px;
                    border-radius: 8px;
                    font-size: 0.7rem;
                    font-weight: 700;
                    color: #475569;
                    text-transform: uppercase;
                    letter-spacing: 0.025em;
                }
                .recurrence-badge {
                    background: #eff6ff;
                    color: #2563eb;
                    font-size: 0.7rem;
                    font-weight: 700;
                    padding: 4px 8px;
                    border-radius: 6px;
                }
                .lesson-date-modern {
                    margin-left: auto;
                    font-size: 0.75rem;
                    color: #94a3b8;
                }
                .lesson-text {
                    font-size: 0.95rem;
                    color: #1e293b;
                    line-height: 1.5;
                    font-weight: 500;
                }
                .card-actions-modern {
                    padding: 0.75rem 1.25rem;
                    background: #f8fafc;
                    border-top: 1px solid #f1f5f9;
                    border-radius: 0 0 16px 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .main-actions {
                    display: flex;
                    gap: 1rem;
                }
                .action-link {
                    background: none;
                    border: none;
                    color: #64748b;
                    font-size: 0.8rem;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 0;
                }
                .action-link:hover {
                    color: #1e293b;
                }
                .status-actions {
                    display: flex;
                    gap: 0.5rem;
                }
                .btn-veto {
                    background: #fff1f2;
                    color: #e11d48;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-size: 0.75rem;
                    font-weight: 700;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .btn-veto:hover {
                    background: #ffe4e6;
                }
                .btn-approve {
                    background: #f0fdf4;
                    color: #16a34a;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-size: 0.75rem;
                    font-weight: 700;
                    cursor: pointer;
                }
                .doctor-note-bubble {
                    margin: 10px 20px 20px;
                    background: #fefce8;
                    border: 1px solid #fef08a;
                    padding: 8px 12px;
                    border-radius: 12px;
                    font-size: 0.8rem;
                    color: #854d0e;
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                }
                .edit-zone {
                    display: flex;
                    gap: 0.5rem;
                    width: 100%;
                }
                .edit-zone input {
                    flex: 1;
                    border: 2px solid #0f172a;
                    border-radius: 8px;
                    padding: 6px 10px;
                    font-size: 0.95rem;
                }
                .btn-save { background: #0f172a; color: white; border: none; border-radius: 8px; width: 32px; cursor: pointer; }
                .btn-cancel { background: #f1f5f9; border: none; border-radius: 8px; width: 32px; cursor: pointer; }

                .comment-overlay {
                    padding: 1.25rem;
                    background: #f8fafc;
                    border-top: 1px solid #e2e8f0;
                }
                .comment-overlay textarea {
                    width: 100%;
                    height: 80px;
                    border-radius: 12px;
                    border: 1px solid #e2e8f0;
                    padding: 10px;
                    font-size: 0.9rem;
                    resize: none;
                    margin-bottom: 10px;
                }
                .comment-btns {
                    display: flex;
                    gap: 0.5rem;
                }
                .comment-btns button {
                    background: #0f172a;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 8px;
                    font-size: 0.85rem;
                    font-weight: 600;
                    cursor: pointer;
                }
                .comment-btns button.cancel {
                    background: none;
                    color: #64748b;
                }

                .loading-state-modern {
                    text-align: center;
                    padding: 4rem 0;
                }
                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 4px solid #f1f5f9;
                    border-top-color: #0f172a;
                    border-radius: 50%;
                    margin: 0 auto 1.5rem;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin { to { transform: rotate(360deg); } }

                .empty-state-modern {
                    text-align: center;
                    padding: 3rem 0;
                }
                .empty-state-modern h3 {
                    margin: 1.5rem 0 0.5rem;
                    color: #0f172a;
                }
                .empty-state-modern p {
                    color: #64748b;
                    margin: 0;
                }
            `}</style>
        </div>
    );
}
