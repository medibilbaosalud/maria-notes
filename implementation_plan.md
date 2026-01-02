# Implementation Plan — Roadmap “Next Level” (ENT, producción médica)

Rol: Arquitecto de IA con experiencia en sistemas médicos en producción, LLMOps y diseño de producto.

Regla de oro: **NO escribir ni modificar código en este documento**. Esto es un plan de implementación y análisis.

---

## 0) Constraints (no negociables)

- Especialidad: **Otorrinolaringología (ENT)**.
- Duración: consultas típicas 45 min; soportar **hasta 60 min** sin romper límites de `tokens/minuto` y `requests/minuto`.
- Formato: **no cambiar el formato de la historia clínica** (secciones/títulos).
- Veracidad: **no inventar** (si no hay evidencia, dejar vacío o `null` según el esquema).
- Operación: se pueden usar tantos modelos Groq como sea necesario, pero **siempre** con fallback (≥2 niveles) y control de cuota.
- Auditoría: diseñar para trazabilidad y uso médico‑legal.

Nota de realismo: no existe garantía de “100% nunca falla” en términos absolutos (audio malo, transcripción errónea, outages). Lo que sí es exigible en producción es: **fail‑safe** (no pasar como “válido” algo no validado), degradación elegante y mejora continua medible.

---

## 1) Estado actual (as‑is) y resumen del pipeline multi‑fase

El sistema ya es robusto: validación dual, rate limiting, chunking, merge determinista, corrección en bucle y memoria a largo plazo. Flujo general:

1) Transcripción de audio.
2) Extracción estructurada (JSON).
3) Merge de extracciones (multi‑segmento).
4) Generación narrativa en formato fijo.
5) Validación (dual) y bucle de corrección.
6) Feedback del médico (diff) → lecciones.
7) Consolidación de lecciones → memoria global.

Esto cubre los fallos críticos iniciales (truncados, validación que “pasa” si el JSON se rompe, etc.). Ahora el objetivo es “siguiente nivel”: semántica clínica, trazabilidad por campo, aprendizaje proactivo y observabilidad.

---

## 2) Revisión crítica del sistema multi‑fase (posibles fallos y mejoras)

### 2.1 Evidencia “literal” vs semántica clínica (principal riesgo restante)

Incluso con chunking/validación dual, si la verificación de evidencia depende de coincidencias literales o fragmentos sin contexto, falla en:
- **Negaciones**: “No tiene fiebre” vs “Fiebre”.
- **Temporalidad**: “Tuvo fiebre ayer” vs “Tiene fiebre ahora”.
- **Sinónimos**: “cefalea” vs “dolor de cabeza”.
- **Contexto**: la evidencia existe pero en otra forma o con matices.

Por qué el enfoque actual no es óptimo: el matching léxico es barato, pero en clínica el significado (negación/tiempo) es crítico. Esto produce falsos positivos (marcar alucinación cuando no lo es) y falsos negativos (aceptar datos contradictorios).

### 2.2 Falta de linaje por campo (data lineage)

Hoy hay auditoría por extracción y versiones, pero no se puede responder de forma consistente:
“¿De qué segmento/minuto salió este diagnóstico/antecedente?”.

Impacto:
- Médico‑legal: menor trazabilidad.
- UX: el médico tarda más en verificar.
- ML/LLMOps: difícil identificar qué parte del audio provoca el error.

### 2.3 Aprendizaje reactivo (se aprende tarde)

Aprender tras editar es útil, pero se pierden señales baratas:
- Confirmaciones rápidas (1 clic) en campos dudosos.
- Etiquetado semántico (negación/tiempo) antes de guardar.

### 2.4 Validación dual no necesariamente adversarial

Dos validadores “amables” pueden compartir sesgos y dejar pasar lo mismo. Falta un modo explícito “abogado del diablo” para elevar la barra sin aumentar mucho la latencia.

### 2.5 Riesgo de “memory drift”

La memoria global mejora prompts, pero puede degradar si:
- Entra una regla mala (o demasiado específica).
- No existe medición de impacto por regla ni rollback.

---

## 3) Propuestas “Outside the Box” (alto impacto, estilo inversor)

Para cada propuesta: **qué resuelve**, **si merece la pena**, **plan de implementación (archivos/tablas)** y **trade‑offs/riesgos**.

### Propuesta A — Micro‑validador semántico (8B) para conflictos y negación/tiempo

**Qué es**  
Un “micro‑validador” muy barato (p.ej., `llama-3.1-8b-instant`) que solo se ejecuta cuando:
- hay conflicto en merge (valor A vs B), o
- el validador detecta posible alucinación/inconsistencia pero la evidencia es ambigua.

**Qué mejora**  
Resuelve lo que el matching literal no puede: negación, temporalidad, sinónimos y contradicciones.

**¿Merece la pena?**  
Sí. Es el tipo de mejora que reduce errores clínicos “sutiles” y mejora confianza del médico, con coste controlado (se ejecuta solo en casos raros).

**Plan de implementación**
- `src/services/groq.ts`: añadir una función “semantic_disambiguate”:
  - Inputs: `field_path`, `valueA`, `valueB`, ventanas de transcripción alrededor del hallazgo (no todo el texto).
  - Output JSON: `{ chosen: "A|B|both|unknown", polarity: "affirmed|negated", temporality: "current|past|unknown", evidence: "..." }`.
- Integrar en:
  - Merge (solo si hay conflicto).
  - Validación (solo para errores “borderline”).
- UI:
  - Si `unknown`, disparar confirmación (Propuesta C).

**Supabase**
- Tabla `ai_semantic_checks`:
  - `record_id`, `field_path`, `valueA`, `valueB`, `chosen`, `polarity`, `temporality`, `evidence`, `model`, `created_at`.

**Trade‑offs y riesgos**
- Latencia extra en conflictos; mitigación: límite de campos y ventanas pequeñas.
- Riesgo de que el micro‑validador “alucine evidencia”; mitigación: exigir cita literal + “unknown” permitido.

---

### Propuesta B — Data Lineage por campo (evidence‑first)

**Qué es**  
Adjuntar a cada campo extraído metadatos de origen:
- `source_chunk_id`
- `evidence_snippet` (cita corta)
- (si se puede) offsets/timestamp aproximado
- `confidence`, `polarity`, `temporality`

**Qué mejora**  
Trazabilidad médico‑legal + UX premium: “clic en DIAGNÓSTICO → ver evidencia”.

**¿Merece la pena?**  
Sí. Esto es defensible como producto (compliance‑ready) y acelera verificación humana.

**Plan de implementación**
- Mantener el formato de la historia final intacto.
- `src/services/groq.ts`: la extracción devuelve:
  - `ExtractionResult` normal (compatibilidad)
  - `ExtractionMeta` (nuevo): mapa `field_path → evidence`.
- `src/services/ai.ts` y `src/services/supabase.ts`: guardar `ExtractionMeta` en auditoría.
- UI: panel “Fuentes” por sección/campo.

**Supabase (schema nuevo)**
- `ai_field_lineage`:
  - `id`, `record_id`, `field_path`, `value`, `chunk_id`, `evidence`, `polarity`, `temporality`, `confidence`, `created_at`
- `ai_chunks`:
  - `record_id`, `chunk_id`, `text`, `created_at`

**Trade‑offs y riesgos**
- Almacenamiento extra + PHI: requiere RLS y evitar exposición indebida.
- Implementación incremental recomendada (empezar por campos críticos: diagnóstico, plan, alergias).

---

### Propuesta C — Aprendizaje proactivo (Active Learning): “el sistema que pregunta”

**Qué es**  
Cuando hay baja confianza o ambigüedad, la UI pide confirmación mínima (1 clic) antes de guardar definitivo.

Ejemplos:
- “¿DIAGNÓSTICO correcto?” Sí/No
- “¿Alergias: ninguna?” Confirmar
- “¿Fiebre: negada?” Confirmar

**Qué mejora**  
Reduce errores antes de persistir y genera dataset de etiquetas humanas “gratis”.

**¿Merece la pena?**  
Sí, si se diseña sin fricción: 3–5 preguntas máximo por consulta y solo campos críticos.

**Plan de implementación**
- `src/services/groq.ts`: exponer “dudas” como lista de `uncertainty_flags` (por validación/semantic checks).
- UI: badges y un panel de confirmación.
- Guardar confirmaciones y usarlas para memoria/metrics.

**Supabase**
- `ai_field_confirmations`:
  - `record_id`, `field_path`, `suggested_value`, `doctor_value`, `confirmed:boolean`, `created_at`

**Trade‑offs y riesgos**
- Fatiga de confirmación: mitigación con priorización + “snooze” + aprendizaje de qué preguntar.

---

### Propuesta D — “Modo Skeptical” (validador adversarial)

**Qué es**  
Un validador con prompt “abogado del diablo”: intenta demostrar que la historia es incorrecta, y solo acepta si no encuentra nada y puede justificarlo con evidencia.

**Qué mejora**  
Sube la barra de calidad sin añadir arquitectura compleja (principalmente prompt + agregación).

**¿Merece la pena?**  
Sí. Es barato y aumenta detección de alucinaciones sutiles.

**Plan de implementación**
- `src/services/groq.ts`: prompt adversarial para `VALIDATOR_B`.
- Reglas de consenso:
  - Si el adversarial encuentra error con evidencia → tratar como crítico y forzar corrección/confirmación.

**Trade‑offs y riesgos**
- Puede aumentar falsos positivos; mitigación: exigir evidencia concreta y permitir “unknown”.

---

### Propuesta E — Degradación elegante (Offline‑first “Draft Mode”)

**Qué es**  
Si Groq cae, el sistema no bloquea al médico:
- Fallback local (Ollama + 8B cuantizado) para un **borrador**.
- Banner “No validado” + bloqueo de “guardar definitivo” hasta revalidación cloud.

**¿Merece la pena?**  
Depende del entorno (clínicas con mala conectividad: sí; siempre online: opcional).

**Plan de implementación**
- Nuevo conector `src/services/local-llm.ts`.
- UI: modo borrador con señalización fuerte + botón “Revalidar”.

**Trade‑offs y riesgos**
- Soporte e instalación.
- Calidad inferior: por eso se restringe a borrador.

---

### Propuesta F — Observabilidad semántica (LLMOps dentro del producto)

**Qué es**  
Métricas accionables y dashboard:
- % historias editadas por sección
- campos más corregidos
- correlación duración‑errores (45 vs 60)
- alucinaciones detectadas/corregidas
- impacto de reglas de memoria por versión

**¿Merece la pena?**  
Sí. Convierte el sistema en “producción” de verdad y genera narrativa de inversor (“mejora continua medible”).

**Plan de implementación**
- `src/services/supabase.ts`: ampliar auditoría con métricas (sin texto, solo contadores/hashes).
- UI: vista “Calidad” (gráficas simples).

**Supabase**
- `ai_quality_events` (eventos por consulta) + `ai_quality_metrics_daily` (agregados).

**Trade‑offs y riesgos**
- PHI: no guardar texto; guardar solo metadata.
- Necesita disciplina de instrumentación.

---

### Propuesta G — Prompt auto‑optimizado (meta‑learning con reglas versionadas)

**Qué es**  
La memoria global se vuelve estructurada:
- reglas por categoría (terminología/formato/estilo/criterio clínico)
- inyección dinámica en extracción/generación/validación según aplique
- versionado + rollback + A/B

**¿Merece la pena?**  
Sí, si y solo si se acompaña de métricas (Propuesta F) y rollback para evitar “memory drift”.

**Plan de implementación**
- `src/services/memory.ts`: consolidar a JSON categorizado.
- `src/services/groq.ts`: inyectar categorías donde corresponda.

**Supabase**
- `ai_long_term_memory.global_rules_json`
- `ai_rule_versions` (histórico + rollout)

**Trade‑offs y riesgos**
- Riesgo: reglas malas empeoran todo; mitigación: versionado, rollback, A/B y métricas.

---

### Propuesta H — Especialización por tipo de consulta ENT (sin cambiar formato final)

**Qué es**  
Clasificador ligero al inicio:
- tipo de visita (urgencia/seguimiento/primera visita)
- área ENT (oído/nariz/garganta/voz/vértigo)

Luego:
- extracción enfocada y más completa
- sin cambiar el formato final, se pueden añadir claves ENT estándar dentro de `exploraciones_realizadas`.

**¿Merece la pena?**  
Sí. ENT tiene patrones repetibles y esto sube la completitud y calidad percibida.

**Plan de implementación**
- `src/services/groq.ts`: fase “classifier” (8B) que devuelve `{ visit_type, ent_area }`.
- prompts condicionados por el clasificador (sin tocar secciones de la historia final).
- UI: permitir override manual.

**Trade‑offs y riesgos**
- Clasificación incorrecta: mitigación con fallback “general ENT” y override manual.

---

## 4) Propuesta: “Sistema multi‑fase 2.0” (la versión que impresiona)

Sin cambiar el formato final de la historia, el salto es pasar a un sistema “evidence‑first” con aprendizaje activo:

1) Fase 0 — Clasificación ligera ENT + sanitización (anti prompt‑injection en transcripción).
2) Fase 1 — Extracción incremental durante la grabación (cada 5–10 min) para controlar TPM y evitar bursts.
3) Fase 2 — Linaje por campo: chunk_id + evidence + negación/tiempo.
4) Fase 3 — Merge semántico: determinista + micro‑validador solo en conflictos.
5) Fase 4 — Generación desde JSON + reglas (formato fijo).
6) Fase 5 — Validación claim‑level:
   - Validador A conservador
   - Validador B skeptical/adversarial
   - Ambos obligados a citar evidencia
7) Fase 6 — Corrección automática + si persiste: preguntas al médico (Propuesta C).
8) Fase 7 — Feedback + memoria versionada + métricas de impacto.

Por qué mejora al sistema actual:
- Reduce errores por negación/tiempo/sinónimos.
- Introduce trazabilidad médico‑legal por campo (diferenciador).
- Aprende antes de persistir (menos correcciones y menos riesgo).
- Añade LLMOps real (métricas + rollback) y resiliencia (offline draft opcional).

---

## 5) Plan de ejecución (paso a paso, sin código)

### Fase 1 (1–2 semanas): Semántica + evidencia
- Implementar micro‑validador semántico (Propuesta A) y guardarlo en `ai_semantic_checks`.
- Añadir `ai_field_lineage` + `ai_chunks` y UI “Fuentes” (Propuesta B).
- Añadir prompt adversarial para validador B (Propuesta D).

Archivos principales a editar:
- `src/services/groq.ts`, `src/services/ai.ts`, `src/services/supabase.ts`
- UI: `src/components/HistoryView.tsx` (panel “Fuentes/Confirmaciones”)
- SQL: nuevas tablas en `src/sql/*`

### Fase 2 (1–2 semanas): Aprendizaje proactivo
- Añadir `uncertainty_flags` y UI de confirmación 1 clic (Propuesta C).
- Persistir `ai_field_confirmations` y usarlo para memoria/metrics.

### Fase 3 (2–4 semanas): Observabilidad + meta‑learning
- Instrumentar métricas (Propuesta F) y dashboard.
- Versionado/rollback de reglas (Propuesta G) + A/B básico.
- Inyección de reglas categorizadas en extracción/generación/validación.

### Fase 4 (opcional, 2–4 semanas): Offline draft
- Integración Ollama (Propuesta E) con modo borrador y revalidación.

---

## 6) Checklist de inversor técnico (“esto es impresionante”)

- Trazabilidad por campo con evidencia (audit‑ready).
- Validación adversarial + semántica clínica real (negación/tiempo).
- Active learning sin fricción (1 clic) → mejora continua medible.
- Observabilidad semántica integrada (LLMOps + producto).
- Resiliencia (degradación elegante) para continuidad clínica.

