
// Doctor Feedback Learning Service
// Detects changes between AI-generated history and doctor's edited version
// Analyzes changes using Qwen3-32b and stores lessons in Supabase

import { supabase } from './supabase';

const GROQ_API_URL = 'https://api.groq.com/openai/v1';
const ANALYZER_MODEL = 'qwen/qwen3-32b';

export interface ChangeDetected {
    section: string;
    original: string;
    edited: string;
    type: 'added' | 'removed' | 'modified';
}

export async function getLessonsFromDB(): Promise<ImprovementLesson[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('ai_improvement_lessons')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) throw error;
    return data || [];
}

export interface ImprovementLesson {
    id?: string;
    created_at?: string;
    original_transcription: string;
    ai_generated_history: string;
    doctor_edited_history: string;
    changes_detected: ChangeDetected[];
    lesson_summary: string;
    improvement_category: 'formatting' | 'terminology' | 'missing_data' | 'hallucination' | 'style';
    status: 'active' | 'rejected' | 'learning';
    is_format: boolean;
    recurrence_count: number;
    doctor_comment?: string;
    last_seen_at?: string;
    consolidated?: boolean;
    doctor_id?: string;
    record_id?: string;
}

// ═══════════════════════════════════════════════════════════════
// DIFF ENGINE: Detect changes between AI output and doctor's edit
// ═══════════════════════════════════════════════════════════════

export function detectChanges(aiHistory: string, doctorHistory: string): ChangeDetected[] {
    const changes: ChangeDetected[] = [];

    const aiSections = parseSections(aiHistory);
    const doctorSections = parseSections(doctorHistory);

    const allSectionNames = new Set([...Object.keys(aiSections), ...Object.keys(doctorSections)]);

    for (const section of allSectionNames) {
        const aiContent = aiSections[section]?.trim() || '';
        const doctorContent = doctorSections[section]?.trim() || '';

        if (aiContent !== doctorContent) {
            if (!aiContent && doctorContent) {
                changes.push({ section, original: '', edited: doctorContent, type: 'added' });
            } else if (aiContent && !doctorContent) {
                changes.push({ section, original: aiContent, edited: '', type: 'removed' });
            } else {
                changes.push({ section, original: aiContent, edited: doctorContent, type: 'modified' });
            }
        }
    }

    return changes;
}

function parseSections(text: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const lines = text.split('\n');
    let currentSection = 'HEADER';
    let currentContent: string[] = [];

    for (const line of lines) {
        if (/^[A-ZÁÉÍÓÚÑ\s]{3,}$/.test(line.trim()) && line.trim().length > 2) {
            if (currentContent.length > 0) {
                sections[currentSection] = currentContent.join('\n');
            }
            currentSection = line.trim();
            currentContent = [];
        } else {
            currentContent.push(line);
        }
    }

    if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n');
    }

    return sections;
}

// ═══════════════════════════════════════════════════════════════
// AI ANALYZER: Enhanced for Content vs Format classification
// ═══════════════════════════════════════════════════════════════

export async function analyzeChangesWithAI(
    _transcription: string,
    changes: ChangeDetected[],
    groqApiKey: string
): Promise<{ summary: string; category: ImprovementLesson['improvement_category']; isFormat: boolean }> {

    const changesDescription = changes.map(c =>
        `Sección: ${c.section}\nOriginal: ${c.original.substring(0, 150)}...\nEditado: ${c.edited.substring(0, 150)}...`
    ).join('\n\n');

    const prompt = `Analiza estas correcciones médicas:
${changesDescription}

TAREA:
1. Resume la lección en una frase técnica (ej: "Usar 'Niega' en lugar de 'No refiere'").
2. Clasifica en categoría: 'formatting', 'terminology', 'missing_data', 'hallucination', 'style'.
3. Indica si es un cambio de FORMATO/ESTILO (true) o de CONTENIDO MÉDICO (false).

Responde JSON: { "lesson": "...", "category": "...", "is_format": boolean }`;

    try {
        const response = await fetch(`${GROQ_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: ANALYZER_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            }),
        });

        const data = await response.json();
        const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');

        return {
            summary: parsed.lesson || 'Corrección de estilo',
            category: (parsed.category || 'style') as ImprovementLesson['improvement_category'],
            isFormat: parsed.is_format ?? (parsed.category === 'formatting' || parsed.category === 'style')
        };
    } catch (e) {
        return { summary: 'Ajuste de contenido', category: 'style', isFormat: true };
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN FLOW: Process doctor's save action with 2x Rule
// ═══════════════════════════════════════════════════════════════

export async function processDoctorFeedback(
    transcription: string,
    aiHistory: string,
    doctorHistory: string,
    groqApiKey: string,
    recordId?: string
): Promise<ImprovementLesson | null> {

    if (!supabase) return null;

    const changes = detectChanges(aiHistory, doctorHistory);
    if (changes.length === 0) return null;

    const analysis = await analyzeChangesWithAI(transcription, changes, groqApiKey);

    // ─────────────────────────────────────────────────────────────
    // SMART LOGIC: 2x Rule & Classification
    // ─────────────────────────────────────────────────────────────
    let status: 'active' | 'learning' = 'learning';
    let recurrenceCount = 1;

    if (!analysis.isFormat) {
        // CONTENT priority: Mark active immediately
        status = 'active';
    } else {
        // FORMAT caution: Search for similarity in 'learning' or 'active'
        const { data: similarLessons } = await supabase
            .from('ai_improvement_lessons')
            .select('*')
            .eq('is_format', true)
            .neq('status', 'rejected')
            .order('created_at', { ascending: false })
            .limit(20);

        // Simple string similarity or fuzzy check (here we'll use a basic inclusion check or just rely on categorization)
        // For a more robust production app, we would use embeddings.
        const similar = similarLessons?.find(l =>
            l.lesson_summary.toLowerCase().includes(analysis.summary.toLowerCase().split(' ')[0]) ||
            analysis.summary.toLowerCase().includes(l.lesson_summary.toLowerCase().split(' ')[0])
        );

        if (similar) {
            recurrenceCount = (similar.recurrence_count || 1) + 1;
            // Promote to active if 2nd occurrence
            if (recurrenceCount >= 2) status = 'active';

            // Optional: Update the existing one instead of creating a new one to keep DB clean
            // But usually we keep history. Let's create a new one for audit trail.
        }
    }

    const lesson: Omit<ImprovementLesson, 'id' | 'created_at'> = {
        original_transcription: transcription,
        ai_generated_history: aiHistory,
        doctor_edited_history: doctorHistory,
        changes_detected: changes,
        lesson_summary: analysis.summary,
        improvement_category: analysis.category,
        is_format: analysis.isFormat,
        status,
        recurrence_count: recurrenceCount,
        record_id: recordId,
        last_seen_at: new Date().toISOString()
    };

    await supabase.from('ai_improvement_lessons').insert([lesson]);
    return lesson as ImprovementLesson;
}

export async function getRelevantLessonsForPrompt(): Promise<string> {
    // Note: Migration to MemoryService complete. This is kept for compatibility if needed.
    return '';
}
