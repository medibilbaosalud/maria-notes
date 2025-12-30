// Doctor Feedback Learning Service
// Detects changes between AI-generated history and doctor's edited version
// Analyzes changes using Qwen3-32b and stores lessons in Supabase

import { supabase } from './supabase';

const GROQ_API_URL = 'https://api.groq.com/openai/v1';
const ANALYZER_MODEL = 'qwen/qwen3-32b'; // Lightweight model for analysis

export interface ChangeDetected {
    section: string;
    original: string;
    edited: string;
    type: 'added' | 'removed' | 'modified';
}

export interface ImprovementLesson {
    id?: string;
    created_at?: string;
    original_transcription: string;
    ai_generated_history: string;
    doctor_edited_history: string;
    changes_detected: ChangeDetected[];
    lesson_summary?: string;
    improvement_category?: 'formatting' | 'terminology' | 'missing_data' | 'hallucination' | 'style';
    doctor_id?: string;
    record_id?: string;
}

// ═══════════════════════════════════════════════════════════════
// DIFF ENGINE: Detect changes between AI output and doctor's edit
// ═══════════════════════════════════════════════════════════════

export function detectChanges(aiHistory: string, doctorHistory: string): ChangeDetected[] {
    const changes: ChangeDetected[] = [];

    // Split into sections by uppercase headers
    const sectionRegex = /^([A-ZÁÉÍÓÚÑ\s]+)$/gm;

    const aiSections = parseSections(aiHistory);
    const doctorSections = parseSections(doctorHistory);

    // Compare each section
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
        // Check if line is an uppercase header (at least 3 uppercase letters)
        if (/^[A-ZÁÉÍÓÚÑ\s]{3,}$/.test(line.trim()) && line.trim().length > 2) {
            // Save previous section
            if (currentContent.length > 0) {
                sections[currentSection] = currentContent.join('\n');
            }
            currentSection = line.trim();
            currentContent = [];
        } else {
            currentContent.push(line);
        }
    }

    // Save last section
    if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n');
    }

    return sections;
}

// ═══════════════════════════════════════════════════════════════
// AI ANALYZER: Use Qwen3-32b to interpret why changes were made
// ═══════════════════════════════════════════════════════════════

export async function analyzeChangesWithAI(
    transcription: string,
    changes: ChangeDetected[],
    groqApiKey: string
): Promise<{ summary: string; category: ImprovementLesson['improvement_category'] }> {

    if (changes.length === 0) {
        return { summary: 'No changes detected', category: 'style' };
    }

    const changesDescription = changes.map(c =>
        `Sección: ${c.section}\nOriginal (IA): ${c.original.substring(0, 200)}...\nEditado (Doctor): ${c.edited.substring(0, 200)}...`
    ).join('\n\n');

    const prompt = `Eres un analista de calidad de historias clínicas.
El médico ha corregido la historia generada por IA. Analiza los cambios y explica:
1. ¿Qué tipo de error cometió la IA? (formatting, terminology, missing_data, hallucination, style)
2. ¿Qué lección debe aprender el sistema para no repetir este error?

TRANSCRIPCIÓN ORIGINAL:
${transcription.substring(0, 500)}...

CAMBIOS DETECTADOS:
${changesDescription}

Responde en JSON: { "category": "...", "lesson": "..." }`;

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
                temperature: 0.3,
                max_tokens: 500,
            }),
        });

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        // Parse JSON response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                summary: parsed.lesson || 'No lesson extracted',
                category: parsed.category || 'style',
            };
        }

        return { summary: content, category: 'style' };
    } catch (error) {
        console.error('[DoctorFeedback] Error analyzing changes:', error);
        return { summary: 'Error analyzing changes', category: 'style' };
    }
}

// ═══════════════════════════════════════════════════════════════
// DATABASE: Save and retrieve lessons from Supabase
// ═══════════════════════════════════════════════════════════════

export async function saveLessonToDB(lesson: Omit<ImprovementLesson, 'id' | 'created_at'>): Promise<void> {
    if (!supabase) {
        console.error('[DoctorFeedback] Supabase not initialized');
        return;
    }
    try {
        const { error } = await supabase.from('ai_improvement_lessons').insert([{
            original_transcription: lesson.original_transcription,
            ai_generated_history: lesson.ai_generated_history,
            doctor_edited_history: lesson.doctor_edited_history,
            changes_detected: lesson.changes_detected,
            lesson_summary: lesson.lesson_summary,
            improvement_category: lesson.improvement_category,
            doctor_id: lesson.doctor_id,
            record_id: lesson.record_id,
        }]);

        if (error) throw error;
        console.log('[DoctorFeedback] Lesson saved to database');
    } catch (error) {
        console.error('[DoctorFeedback] Error saving lesson:', error);
    }
}

export async function getLessonsFromDB(): Promise<ImprovementLesson[]> {
    if (!supabase) {
        console.error('[DoctorFeedback] Supabase not initialized');
        return [];
    }
    try {
        const { data, error } = await supabase
            .from('ai_improvement_lessons')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('[DoctorFeedback] Error fetching lessons:', error);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN FLOW: Process doctor's save action
// ═══════════════════════════════════════════════════════════════

export async function processDoctorFeedback(
    transcription: string,
    aiHistory: string,
    doctorHistory: string,
    groqApiKey: string,
    recordId?: string
): Promise<ImprovementLesson | null> {

    // 1. Detect changes
    const changes = detectChanges(aiHistory, doctorHistory);

    if (changes.length === 0) {
        console.log('[DoctorFeedback] No changes detected, skipping analysis');
        return null;
    }

    console.log(`[DoctorFeedback] Detected ${changes.length} changes, analyzing...`);

    // 2. Analyze with AI
    const analysis = await analyzeChangesWithAI(transcription, changes, groqApiKey);

    // 3. Build lesson object
    const lesson: Omit<ImprovementLesson, 'id' | 'created_at'> = {
        original_transcription: transcription,
        ai_generated_history: aiHistory,
        doctor_edited_history: doctorHistory,
        changes_detected: changes,
        lesson_summary: analysis.summary,
        improvement_category: analysis.category,
        record_id: recordId,
    };

    // 4. Save to database
    await saveLessonToDB(lesson);

    return lesson as ImprovementLesson;
}
