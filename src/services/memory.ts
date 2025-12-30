
import { supabase } from './supabase';
import { GroqService } from './groq';

// Initialize Groq specifically for memory operations (lighter model if possible)
const MEMORY_MODEL = 'llama-3.1-70b-versatile'; // Good balance for summarization

export interface ActiveMemoryContext {
    global_rules: string;
    daily_lessons: string;
    total_lessons_count: number;
}

export class MemoryService {

    // ═══════════════════════════════════════════════════════════════
    // HYBRID MEMORY: Fetch Global Rules + Active Daily Lessons
    // ═══════════════════════════════════════════════════════════════
    static async getHybridContext(): Promise<ActiveMemoryContext> {
        if (!supabase) return { global_rules: '', daily_lessons: '', total_lessons_count: 0 };

        try {
            // 1. Fetch Global Rules (Long-Term Memory)
            const { data: globalData } = await supabase
                .from('ai_long_term_memory')
                .select('global_rules')
                .limit(1)
                .single();

            const globalRules = globalData?.global_rules || '';

            // 2. Fetch Daily Lessons (Working Memory) - NO LIMIT as requested
            // Only fetch lessons that are NOT yet consolidated
            const { data: dailyData } = await supabase
                .from('ai_improvement_lessons')
                .select('lesson_summary, improvement_category, status, created_at')
                .eq('consolidated', false)
                .neq('status', 'rejected') // Don't show rejected
                .order('created_at', { ascending: true }); // Chronological order

            const dailyLessons = dailyData || [];

            // Format daily lessons for the prompt
            const formattedDailyParams = dailyLessons.map((l, i) => {
                return `- [NUEVA LECCIÓN ${i + 1}]: ${l.lesson_summary}`;
            }).join('\n');

            return {
                global_rules: globalRules,
                daily_lessons: formattedDailyParams,
                total_lessons_count: dailyLessons.length
            };

        } catch (error) {
            console.error('[MemoryService] Error fetching memory:', error);
            return { global_rules: '', daily_lessons: '', total_lessons_count: 0 };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // CONSOLIDATION: The "Sleep" Mechanism
    // ═══════════════════════════════════════════════════════════════
    static async consolidateDailyLessons(groqApiKey: string): Promise<void> {
        if (!supabase) return;

        try {
            console.log('[MemoryService] Checking for lessons to consolidate...');

            // 1. Get unconsolidated lessons from PREVIOUS days (created_at < today)
            // Ideally we do this by checking date, but for simplicity we'll check all 'consolidated: false' 
            // and relying on the app logic to run this only once per/day or on startup.
            // To be safe, we only consolidate lessons older than 12 hours or just "all unconsolidated"
            // Let's implement the "Sleep" metaphor: Consolidate EVERYTHING that is 'active' and not consolidated.

            const { data: lessonsToConsolidate } = await supabase
                .from('ai_improvement_lessons')
                .select('*')
                .eq('consolidated', false)
                .eq('status', 'active'); // Only consolidate ACTIVE (approved/verified) lessons

            if (!lessonsToConsolidate || lessonsToConsolidate.length === 0) {
                console.log('[MemoryService] No active lessons to consolidate.');
                return;
            }

            console.log(`[MemoryService] Found ${lessonsToConsolidate.length} lessons to consolidate.`);

            // 2. Get current Global Rules
            const { data: globalData } = await supabase
                .from('ai_long_term_memory')
                .select('*')
                .limit(1)
                .single();

            const currentGlobalRules = globalData?.global_rules || '';
            const memoryId = globalData?.id;

            // 3. LLM Consolidation Task
            // const groq = new GroqService(groqApiKey); // Temporary instance
            const prompt = `Actúa como SISTEMA DE MEMORIA A LARGO PLAZO para un Asistente Médico.
Tu tarea es CONSOLIDAR nuevas lecciones aprendidas en el conocimiento global existente.

CONOCIMIENTO GLOBAL ACTUAL:
${currentGlobalRules || "(Vacío)"}

NUEVAS LECCIONES APRENDIDAS (Dra. Gotxi):
${lessonsToConsolidate.map(l => `- ${l.lesson_summary}`).join('\n')}

TAREA:
Fusiona las nuevas lecciones con el conocimiento actual.
1. Elimina redundancias.
2. Si una nueva lección contradice una antigua, la NUEVA prevalece (actualiza la regla).
3. Agrupa por categorías (TERMINOLOGÍA, FORMATO, ESTILO).
4. Genera un texto conciso, directo y técnico.
5. NO uses markdown complejo, solo texto plano con secciones claras.

SALIDA (Solo el nuevo texto de reglas globales):`;

            // We use a "direct API call" helper here or reuse GroqService if exposed, 
            // but GroqService methods are specific to medical history. 
            // We'll assume we can use a raw generic call logic here or modify GroqService.
            // For now, let's assume we can import the generic call method or duplicate it lightly. 
            // Since we don't have a generic "chat" method exposed public in GroqService, 
            // we will fetch via fetch directly here for simplicity to avoid refactoring GroqService heavily yet.

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: MEMORY_MODEL,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1
                })
            });

            const result = await response.json();
            const newGlobalRules = result.choices?.[0]?.message?.content || currentGlobalRules;

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
            const lessonIds = lessonsToConsolidate.map(l => l.id);
            await supabase
                .from('ai_improvement_lessons')
                .update({ consolidated: true })
                .in('id', lessonIds);

            console.log('[MemoryService] Consolidation complete. Global rules updated.');

        } catch (error) {
            console.error('[MemoryService] Consolidation failed:', error);
        }
    }
}
