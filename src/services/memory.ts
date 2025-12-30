import { supabase } from './supabase';
import { GroqService } from './groq';

// Initialize Groq specifically for memory operations (lighter model if possible)
const MEMORY_MODEL = 'llama-3.1-70b-versatile';

export class MemoryService {
    static async consolidateDailyLessons(groqApiKey: string | string[]): Promise<void> {
        if (!supabase) return;

        try {
            console.log('[MemoryService] Checking for lessons to consolidate...');

            // 1. Fetch lessons from yesterday or older that are NOT consolidated
            // For now, we fetch ALL unconsolidated lessons to ensure nothing is left behind
            const { data: lessonsToConsolidate, error } = await supabase
                .from('ai_improvement_lessons')
                .select('*')
                .eq('consolidated', false);

            if (error) {
                console.error('[MemoryService] Error fetching lessons:', error);
                return;
            }

            if (!lessonsToConsolidate || lessonsToConsolidate.length === 0) {
                console.log('[MemoryService] No valid lessons to consolidate.');
                return;
            }

            console.log(`[MemoryService] Found ${lessonsToConsolidate.length} lessons to consolidate.`);

            // 2. Fetch current Global Rules
            let currentGlobalRules = '';
            let memoryId: string | null = null;

            const { data: memoryData } = await supabase
                .from('ai_long_term_memory')
                .select('*')
                .limit(1)
                .single();

            if (memoryData) {
                currentGlobalRules = memoryData.global_rules || '';
                memoryId = memoryData.id;
            }

            // 3. LLM Consolidation Task
            const groq = new GroqService(groqApiKey);
            const prompt = `Actúa como SISTEMA DE MEMORIA A LARGO PLAZO para un Asistente Médico.
Tu tarea es CONSOLIDAR nuevas lecciones aprendidas en el conocimiento global existente.

CONOCIMIENTO GLOBAL ACTUAL:
${currentGlobalRules || "(Vacío)"}

NUEVAS LECCIONES APRENDIDAS (Dra. Gotxi):
${lessonsToConsolidate.map((l: any) => `- ${l.lesson_summary}`).join('\n')}

TAREA:
Fusiona las nuevas lecciones con el conocimiento actual.
1. Elimina redundancias.
2. Si una nueva lección contradice una antigua, la NUEVA prevalece (actualiza la regla).
3. Agrupa por categorías (TERMINOLOGÍA, FORMATO, ESTILO).
4. Genera un texto conciso, directo y técnico.
5. NO uses markdown complejo, solo texto plano con secciones claras.

SALIDA (Solo el nuevo texto de reglas globales):`;

            // Use generic chat method with rotation
            const newGlobalRules = await groq.chat(prompt, MEMORY_MODEL, { jsonMode: false });


            // 4. Update Database
            if (memoryId) {
                await supabase
                    .from('ai_long_term_memory')
                    .update({
                        global_rules: newGlobalRules,
                        last_consolidated_at: new Date().toISOString()
                    })
                    .eq('id', memoryId);
            } else {
                await supabase
                    .from('ai_long_term_memory')
                    .insert([{
                        global_rules: newGlobalRules,
                        last_consolidated_at: new Date().toISOString()
                    }]);
            }

            // 5. Mark lessons as consolidated
            const lessonIds = lessonsToConsolidate.map((l: any) => l.id);
            await supabase
                .from('ai_improvement_lessons')
                .update({ consolidated: true })
                .in('id', lessonIds);

            console.log('[MemoryService] Consolidation complete. Global rules updated.');

        } catch (error) {
            console.error('[MemoryService] Consolidation failed:', error);
        }
    }

    static async getHybridContext(): Promise<{ global_rules: string; daily_lessons: string; total_lessons_count: number }> {
        if (!supabase) return { global_rules: "", daily_lessons: "", total_lessons_count: 0 };

        try {
            // 1. Fetch Global Rules
            const { data: memory } = await supabase
                .from('ai_long_term_memory')
                .select('global_rules')
                .limit(1)
                .single();

            const globalRules = memory?.global_rules || "";

            // 2. Fetch Unconsolidated Lessons (Active Working Memory)
            const { data: lessons } = await supabase
                .from('ai_improvement_lessons')
                .select('lesson_summary')
                .eq('consolidated', false);

            const activeLessons = lessons && lessons.length > 0
                ? lessons.map((l: any) => `- ${l.lesson_summary}`).join('\n')
                : "";

            return {
                global_rules: globalRules,
                daily_lessons: activeLessons,
                total_lessons_count: lessons ? lessons.length : 0
            };
        } catch (error) {
            console.error('[MemoryService] Failed to fetch context:', error);
            return { global_rules: "", daily_lessons: "", total_lessons_count: 0 };
        }
    }
}
