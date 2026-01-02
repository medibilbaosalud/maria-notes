import { supabase } from './supabase';
import { GroqService } from './groq';
import { getTaskModels } from './model-registry';

// Initialize Groq specifically for memory operations
const MEMORY_MODEL = getTaskModels('memory')[0] || 'llama-3.3-70b-versatile';

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
                .eq('consolidated', false)
                .neq('status', 'rejected')
                .order('created_at', { ascending: true })
                .limit(200);

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
            const prompt = `Actua como SISTEMA DE MEMORIA A LARGO PLAZO para un asistente medico.
Tu tarea es consolidar nuevas lecciones aprendidas en el conocimiento global existente.

CONOCIMIENTO GLOBAL ACTUAL:
${currentGlobalRules || "(Vacio)"}

NUEVAS LECCIONES APRENDIDAS:
${lessonsToConsolidate.map((l: any) => `- ${l.lesson_summary}`).join('\n')}

TAREA:
1. Elimina redundancias.
2. Si una nueva leccion contradice una antigua, la nueva prevalece.
3. Agrupa por categorias (TERMINOLOGIA, FORMATO, ESTILO).
4. Genera un texto conciso, directo y tecnico.
5. No uses markdown complejo, solo texto plano con secciones claras.

SALIDA (solo el nuevo texto de reglas globales):`;

            // Use generic chat method with rotation
            const newGlobalRules = await groq.chat(prompt, MEMORY_MODEL, { jsonMode: false, temperature: 0, maxTokens: 1200, task: 'memory' });

            const rulesSchema = `{
  "terminology": [],
  "formatting": [],
  "style": [],
  "clinical": []
}`;
            const categorizePrompt = `Convierte estas reglas en JSON por categoria. Responde SOLO JSON.

REGLAS:
${newGlobalRules}

ESQUEMA:
${rulesSchema}`;

            let globalRulesJson = '';
            try {
                globalRulesJson = await groq.chat(categorizePrompt, MEMORY_MODEL, { jsonMode: true, temperature: 0, maxTokens: 900, task: 'rule_categorization' });
            } catch (error) {
                console.warn('[MemoryService] Failed to categorize rules:', error);
                globalRulesJson = '';
            }


            // 4. Update Database
            let memoryError: any = null;
            if (memoryId) {
                const { error } = await supabase
                    .from('ai_long_term_memory')
                    .update({
                        global_rules: newGlobalRules,
                        global_rules_json: globalRulesJson,
                        last_consolidated_at: new Date().toISOString()
                    })
                    .eq('id', memoryId);
                memoryError = error;
            } else {
                const { error } = await supabase
                    .from('ai_long_term_memory')
                    .insert([{
                        global_rules: newGlobalRules,
                        global_rules_json: globalRulesJson,
                        last_consolidated_at: new Date().toISOString()
                    }]);
                memoryError = error;
            }

            if (memoryError) {
                console.error('[MemoryService] Failed to update long term memory:', memoryError);
                return;
            }

            const lessonIds = lessonsToConsolidate.map((l: any) => l.id);
            const { data: lastVersion } = await supabase
                .from('ai_rule_versions')
                .select('version')
                .order('version', { ascending: false })
                .limit(1)
                .maybeSingle();

            const nextVersion = (lastVersion?.version || 0) + 1;
            await supabase.from('ai_rule_versions').update({ is_active: false }).eq('is_active', true);

            const { error: versionError } = await supabase
                .from('ai_rule_versions')
                .insert([{
                    version: nextVersion,
                    global_rules: newGlobalRules,
                    global_rules_json: globalRulesJson,
                    source_lesson_ids: lessonIds,
                    model: MEMORY_MODEL,
                    is_active: true,
                    created_at: new Date().toISOString()
                }]);

            if (versionError) {
                console.warn('[MemoryService] Failed to record rule version:', versionError);
            }

            // 5. Mark lessons as consolidated
            const { error: lessonsError } = await supabase
                .from('ai_improvement_lessons')
                .update({ consolidated: true })
                .in('id', lessonIds);

            if (lessonsError) {
                console.error('[MemoryService] Failed to mark lessons as consolidated:', lessonsError);
            }

            console.log('[MemoryService] Consolidation complete. Global rules updated.');

        } catch (error) {
            console.error('[MemoryService] Consolidation failed:', error);
        }
    }

    static async getHybridContext(): Promise<{ global_rules: string; daily_lessons: string; total_lessons_count: number; global_rules_json?: any }> {
        if (!supabase) return { global_rules: "", daily_lessons: "", total_lessons_count: 0 };

        try {
            // 1. Fetch Global Rules
            const { data: memory } = await supabase
                .from('ai_long_term_memory')
                .select('global_rules, global_rules_json')
                .limit(1)
                .single();

            const globalRules = memory?.global_rules || "";
            const rawRulesJson = memory?.global_rules_json || "";
            let parsedRulesJson: any = undefined;
            if (rawRulesJson && typeof rawRulesJson === 'string') {
                try {
                    parsedRulesJson = JSON.parse(rawRulesJson);
                } catch {
                    parsedRulesJson = undefined;
                }
            } else if (rawRulesJson && typeof rawRulesJson === 'object') {
                parsedRulesJson = rawRulesJson;
            }

            // 2. Fetch Unconsolidated Lessons (Active Working Memory)
            const { data: lessons } = await supabase
                .from('ai_improvement_lessons')
                .select('lesson_summary, status')
                .eq('consolidated', false)
                .neq('status', 'rejected')
                .order('created_at', { ascending: false })
                .limit(50);

            const activeLessons = lessons && lessons.length > 0
                ? lessons.map((l: any) => `- ${l.lesson_summary}`).join('\n')
                : "";

            const trimText = (value: string, maxChars: number) =>
                value.length > maxChars ? value.slice(0, maxChars) : value;

            const trimmedGlobalRules = trimText(globalRules, 4000);
            const trimmedLessons = trimText(activeLessons, 2000);

            return {
                global_rules: trimmedGlobalRules,
                daily_lessons: trimmedLessons,
                total_lessons_count: lessons ? lessons.length : 0,
                global_rules_json: parsedRulesJson
            };
        } catch (error) {
            console.error('[MemoryService] Failed to fetch context:', error);
            return { global_rules: "", daily_lessons: "", total_lessons_count: 0 };
        }
    }
}
