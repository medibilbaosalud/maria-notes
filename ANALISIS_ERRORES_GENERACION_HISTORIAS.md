# Análisis de Errores en Generación de Historias Clínicas

## Problemas Identificados

### 1. **Problema Principal: Extracción de Transcripciones Muy Largas**

**Ubicación**: `src/App.tsx:1074-1084` en `finalizePipeline()`

**Problema**:
- Para consultas de más de 15 minutos, la transcripción completa puede ser muy larga (potencialmente >50,000 tokens)
- Se hace una extracción única de toda la transcripción sin truncamiento
- Esto puede causar:
  - Timeouts en la API (timeout actual: 90 segundos para extracción)
  - Errores de límite de tokens del modelo
  - Bloqueos del proceso

**Evidencia**:
```typescript
// Línea 1071: Se concatena toda la transcripción sin límites
const fullTranscription = sortedIndexes.map((index) => 
    transcriptionPartsRef.current.get(index) || ''
).join(' ').trim();

// Línea 1084: Se intenta extraer de toda la transcripción
fullExtraction = await aiService.extractOnly(extractionInput);
```

### 2. **Timeouts Insuficientes para Consultas Largas**

**Ubicación**: `src/services/reliability/retry-policy.ts`

**Problema**:
- Timeout de extracción: 90 segundos (puede ser insuficiente para transcripciones muy largas)
- Timeout de generación: 45-90 segundos (puede fallar con transcripciones largas)
- No hay timeouts adaptativos basados en la longitud de la transcripción

**Configuración actual**:
```typescript
extraction: {
    retries: 4,
    timeoutMs: 90_000,  // 90 segundos - puede ser insuficiente
    ...
},
generation: {
    retries: FAST_PATH_RETRY_TUNING ? 2 : 4,
    timeoutMs: FAST_PATH_RETRY_TUNING ? 45_000 : 90_000,  // 45-90 segundos
    ...
}
```

### 3. **Falta de Truncamiento Inteligente**

**Ubicación**: `src/services/groq.ts` - método `extractMedicalData()`

**Problema**:
- El método `extractMedicalData()` divide en chunks pero no hay lógica especial para consultas muy largas
- No se prioriza información reciente vs antigua
- No hay límite máximo de tokens para la transcripción completa antes de extracción

**Código relevante**:
```typescript
// Línea 1251-1253: Divide en chunks pero sin límite total
const maxInputTokens = this.getMaxInputTokens(primaryModel, maxOutputTokens);
const chunks = this.splitTextIntoChunks(transcription, maxInputTokens);
```

### 4. **Procesamiento Secuencial de Batches**

**Ubicación**: `src/App.tsx:746-956` en `processPartialBatch()`

**Problema**:
- Los batches se procesan secuencialmente uno tras otro
- Si un batch falla, puede bloquear todo el proceso
- No hay procesamiento paralelo de batches independientes
- Para consultas de 15+ minutos (5+ batches), esto puede tomar mucho tiempo

### 5. **Falta de Manejo de Errores Específicos para Consultas Largas**

**Problema**:
- No hay detección de consultas largas (>15 minutos)
- No hay estrategias alternativas cuando la transcripción es muy larga
- Los errores no distinguen entre problemas de longitud vs otros problemas

## Soluciones Propuestas

### Solución 1: Truncamiento Inteligente de Transcripciones Largas

**Implementar en**: `src/App.tsx:finalizePipeline()`

```typescript
// Antes de la extracción, truncar si es muy larga
const MAX_EXTRACTION_TOKENS = 30000; // ~120,000 caracteres
const estimatedTokens = estimateTokens(fullTranscription);

if (estimatedTokens > MAX_EXTRACTION_TOKENS) {
    // Priorizar información reciente (últimos 2/3 de la transcripción)
    const keepRatio = 0.67;
    const keepChars = Math.floor(fullTranscription.length * keepRatio);
    extractionInput = fullTranscription.slice(-keepChars);
    console.warn(`[App] Transcripción truncada de ${fullTranscription.length} a ${extractionInput.length} caracteres para extracción`);
}
```

### Solución 2: Timeouts Adaptativos

**Implementar en**: `src/services/reliability/retry-policy.ts`

```typescript
export const getAdaptiveTimeout = (
    stage: RetryStage, 
    transcriptionLength: number
): number => {
    const basePolicy = getRetryPolicy(stage);
    const estimatedTokens = Math.ceil(transcriptionLength / 4);
    
    // Aumentar timeout para transcripciones largas
    if (estimatedTokens > 20000) {
        return basePolicy.timeoutMs * 2; // Doblar timeout
    } else if (estimatedTokens > 10000) {
        return Math.floor(basePolicy.timeoutMs * 1.5); // 50% más
    }
    
    return basePolicy.timeoutMs;
};
```

### Solución 3: Extracción por Chunks con Resumen

**Implementar en**: `src/services/groq.ts:extractMedicalData()`

```typescript
// Si la transcripción es muy larga, hacer extracción en chunks y luego merge
if (estimatedTokens > 25000) {
    // Dividir en chunks de ~15k tokens cada uno
    const chunks = this.splitTextIntoChunks(transcription, 15000);
    const chunkExtractions: ExtractionResult[] = [];
    
    for (const chunk of chunks) {
        const chunkResult = await this.extractMedicalData(chunk);
        chunkExtractions.push(chunkResult.data);
    }
    
    // Merge de extracciones
    return this.mergeMultipleExtractions(chunkExtractions, transcription);
}
```

### Solución 4: Procesamiento Paralelo de Batches (Opcional)

**Implementar en**: `src/App.tsx`

```typescript
// Procesar batches en paralelo cuando sea posible
const batchPromises = batches.map((blob, index) => 
    processPartialBatch(aiService, blob, index)
);
await Promise.allSettled(batchPromises);
```

### Solución 5: Detección y Manejo de Consultas Largas

**Implementar en**: `src/App.tsx:finalizePipeline()`

```typescript
// Detectar consultas largas
const isLongConsultation = sortedIndexes.length > 3 || 
    fullTranscription.length > 50000;

if (isLongConsultation) {
    setProcessingStatus('Consultación larga detectada. Procesando con estrategia optimizada...');
    // Aplicar estrategias especiales
}
```

## Priorización de Soluciones

1. **ALTA PRIORIDAD**: Solución 1 (Truncamiento Inteligente) - Soluciona el problema inmediato
2. **ALTA PRIORIDAD**: Solución 2 (Timeouts Adaptativos) - Previene timeouts prematuros
3. **MEDIA PRIORIDAD**: Solución 3 (Extracción por Chunks) - Mejora calidad para consultas largas
4. **BAJA PRIORIDAD**: Solución 4 (Procesamiento Paralelo) - Optimización avanzada
5. **MEDIA PRIORIDAD**: Solución 5 (Detección de Consultas Largas) - Mejora UX

## Métricas para Monitorear

- Tiempo promedio de extracción por longitud de transcripción
- Tasa de errores de timeout por longitud
- Tiempo total de procesamiento para consultas >15 minutos
- Tasa de éxito de generación de historias para consultas largas

## Notas Adicionales

- El problema es más evidente con consultas de más de 15 minutos porque:
  - Generan 5+ batches (cada batch = 3 minutos de audio)
  - La transcripción completa puede exceder 50,000 caracteres
  - El modelo Gemini tiene límite de contexto, aunque es alto (128k tokens)

- El sistema actual ya tiene:
  - División de audio en chunks de 3 minutos
  - Procesamiento de batches parciales
  - Manejo de errores básico
  
- Lo que falta:
  - Optimización específica para transcripciones muy largas
  - Timeouts adaptativos
  - Estrategias de truncamiento inteligente
