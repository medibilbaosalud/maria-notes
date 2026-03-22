# Estrategia de producto para psicologia

Fecha: 2026-03-21

## Punto de partida

La app ya resuelve bien una parte importante del trabajo:

- grabar o introducir la sesion
- generar una historia psicologica estructurada
- editarla, corregirla y guardarla
- reutilizar historiales previos
- aprender de las correcciones de las psicologas

Eso significa que no conviene competir en "mas IA que redacta mas texto". El siguiente salto de valor no esta en escribir mejor una nota aislada, sino en dar continuidad clinica real entre sesiones y a lo largo del caso.

## Lo que hacen las apps parecidas

Patron 1. Portal y operaciones

- TherapyNotes y SimplePractice empujan fuerte portal del paciente, formularios previos, recordatorios, mensajeria segura, documentos y firmas.
- Esto reduce friccion administrativa, pero no siempre mejora mucho la calidad clinica.

Patron 2. Measurement-based care

- TherapyNotes y SimplePractice permiten enviar medidas recurrentes como PHQ-9 o GAD-7 y ver puntuaciones a lo largo del tiempo.
- Esto aporta estructura y seguimiento, sobre todo en ansiedad, depresion y cribado.

Patron 3. Trabajo entre sesiones

- Quenza destaca en continuidad terapeutica: tareas, psicoeducacion, ejercicios, pathways y seguimiento de cumplimiento.
- No gana por escribir notas; gana por ayudar a que la terapia siga viva entre una sesion y la siguiente.

Patron 4. IA con continuidad

- Mentalyc empuja una idea interesante: no solo notas, sino progreso entre sesiones, tratamiento y patrones longitudinales.
- La intuicion potente aqui es correcta: el verdadero valor esta en conectar sesiones, no en tratarlas como episodios aislados.

## Conclusión de mercado

El mercado converge en cuatro bloques:

1. documentacion
2. portal / operativa
3. medidas y escalas
4. continuidad terapeutica entre sesiones

Vosotros ya teneis una base fuerte en documentacion. La oportunidad diferencial esta en continuidad terapeutica y memoria clinica util.

## Tesis de producto

No construir un "todo en uno" gigante.

Construir un "copiloto de continuidad clinica" para psicologas:

- que recuerde lo importante de cada caso
- que prepare la siguiente sesion
- que ayude a decidir que hacer entre sesiones
- que convierta historias pasadas en contexto accionable

## Qué NO haría ahora

- chat genérico con pacientes dentro de la app
- mil dashboards bonitos pero vacios
- automatizaciones complejas sin uso claro
- resumenes largos de IA que nadie lee
- recomendadores opacos que parezcan diagnosticar
- un portal enorme con pagos, agenda, facturas y telemedicina si vuestro foco es clinico

Eso os meteria en sobreingenieria y os aleja de la parte que una psicologa realmente valora cada dia.

## La gran idea: convertir historias pasadas en memoria clinica viva

Tu intuicion de subir a Supabase las historias historicas del centro es buena, pero no como archivo muerto.

Las historias pasadas deben servir para cuatro cosas:

1. preparar mejor la siguiente sesion
2. no perder hilos terapeuticos
3. detectar patrones longitudinales
4. ayudar a decidir el siguiente micro-paso clinico

Si solo se pueden buscar, aportan poco.
Si se convierten en memoria util, pueden ser un diferencial enorme.

## Propuestas de alto valor

### 1. Brief de continuidad antes de cada sesion

Una vista de 30 segundos antes de empezar:

- que paso en la sesion anterior
- que objetivos estaban abiertos
- que tarea o compromiso se llevo la paciente
- que se cumplio y que no
- temas sensibles pendientes
- frase literal o insight clave de sesiones anteriores
- riesgos o alertas de seguimiento marcados por la profesional

Esto ahorra muchisima carga mental y hace que la psicologa sienta que nunca "empieza de cero".

Valor:

- altisimo
- poco intrusivo
- muy alineado con vuestra base actual

### 2. Hilos clinicos persistentes

En vez de solo guardar historias por fecha, extraer y mantener "hilos" del caso:

- relaciones familiares
- trabajo / estudios
- pareja
- autoestima
- sueño
- ansiedad social
- duelo
- adherencia
- evitacion
- consumo
- autolesion / ideacion, si aplica

Cada sesion puede tocar varios hilos. La app no necesita diagnosticar; solo ayudar a recordar como evolucionan.

Esto cambia totalmente la experiencia. La psicologa no relee diez historias, sino que ve como va cada hilo vital y terapeutico.

### 3. Plan terapeutico vivo, no documento estatico

La mayoria de herramientas tratan el plan terapeutico como un formulario. Error.

Mejor:

- objetivos activos
- micro-objetivo de esta semana
- barreras detectadas
- intervenciones probadas
- señales de avance
- señales de bloqueo

El plan se actualiza desde las notas reales, no obliga a rellenar otra pantalla enorme.

Si lo hace bien, la psicologa siente que la herramienta piensa "en proceso" y no "en papel".

### 4. Tareas entre sesiones ligeras y muy humanas

No montaria un portal gigante al principio.

Si haria un modulo minimo de "continuidad entre sesiones" con tres tipos de envio:

- ejercicio / tarea
- recordatorio personalizado
- check-in breve

Ejemplos:

- registro de pensamiento automatico
- escala 0-10 de ansiedad
- "esta semana observa cuando aparece la evitacion"
- audio breve de grounding o respiracion grabado por la psicologa
- mini psicoeducacion adaptada al caso

La clave no es cantidad. La clave es que la psicologa pueda mandar algo util en 20 segundos y luego ver si la paciente lo hizo.

### 5. Check-in pre-sesion ultra corto

Antes de la consulta, la paciente responde 3 a 5 items maximo:

- estado de animo
- ansiedad / activacion
- si hizo la tarea
- evento importante de la semana
- si hay algo urgente que quiera tratar

Esto da foco a la sesion y evita perder 15 minutos en aterrizar.

Importante: no lo convertiria en cuestionario largo ni burocratico.

### 6. Progreso visible sin convertir la terapia en Excel

No un dashboard medico frio.

Si una vista simple:

- sintomas o malestar percibido a lo largo del tiempo
- cumplimiento de tareas
- hilos clinicos que mejoran / empeoran / estan bloqueados
- momentos de recaida o estancamiento
- citas perdidas o semanas sin respuesta

La psicologa puede usarlo en supervision, en revision de caso o para devolver progreso a la paciente.

### 7. Preparacion inteligente de la siguiente sesion

Despues de cerrar una historia, la app puede ofrecer:

- "para la proxima sesion conviene revisar..."
- preguntas pendientes
- hipotesis de trabajo abiertas
- tarea asignada
- marcador de temas delicados que no conviene olvidar

No como verdad clinica, sino como borrador editable de preparacion.

Esto tiene muchisimo valor porque convierte una nota en accion.

### 8. Biblioteca viva del centro

Aqui entra tu idea de las historias historicas del centro, pero bien usada.

No haria que la IA mezcle historias de otros pacientes con un caso actual.
Eso es delicado y puede contaminar criterio.

Si haria una "biblioteca agregada" anonimizando y aprendiendo patrones a nivel de centro:

- frases y estilos preferidos por cada psicologa
- estructuras de formulacion que se repiten
- tipos de objetivos terapeuticos usados en casos similares
- ejercicios que mas se asignan para ciertos problemas
- patrones de continuidad que las psicologas suelen revisar

Es decir:

- no usar otras historias para sugerir contenido clinico especifico de un paciente
- si usar el historico para mejorar estilo, estructura, continuidad y ayudas de proceso

### 9. Resumen de caso para derivaciones, interconsulta o retomar tras meses

Casos largos generan fatiga documental.

Una funcion de mucho valor:

- "resumen clinico acumulado"
- "linea temporal del caso"
- "que se ha intentado y con que respuesta"
- "estado actual de objetivos"

Sirve para:

- retomar un paciente tras pausa
- traspasar entre profesionales
- preparar informes
- supervision

### 10. Supervisión silenciosa para la psicologa

Una idea mas diferencial y elegante:

la app no solo ayuda con el paciente, tambien ayuda a la profesional a pensar mejor.

Ejemplos:

- "llevas 4 sesiones volviendo al mismo bloqueo sin una tarea nueva"
- "hay un objetivo abierto desde hace 8 semanas sin criterio de avance"
- "se mencionan problemas de sueño en varias sesiones pero no aparecen en el plan"
- "hay mucha narrativa y poca concrecion de cambio observable"

Esto no sustituye supervision, pero si actua como espejo clinico suave.

Si se hace con tacto, enamora.

## Cómo usar bien las historias pasadas

### Uso correcto

- construir una linea temporal del paciente
- detectar temas recurrentes
- recordar compromisos y tareas
- ver que intervenciones se probaron
- preparar la siguiente sesion
- resumir casos largos

### Uso peligroso

- sacar conclusiones automaticas de diagnostico
- mezclar contenido de un paciente con otro
- sugerir intervenciones como si fueran protocolos universales
- presentar inferencias como hechos clinicos

La regla:

historias pasadas si, pero como memoria y contexto, no como autoridad clinica automatica.

## Mi recomendación priorizada

Si hubiese que elegir solo una direccion para los proximos meses:

### Fase 1. Memoria clinica viva

- brief pre-sesion
- linea temporal del caso
- objetivos activos
- tareas pendientes
- temas / hilos clinicos persistentes

### Fase 2. Continuidad entre sesiones

- check-in breve
- tareas ligeras
- materiales o audios personalizados
- confirmacion de realizacion

### Fase 3. Progreso y supervision suave

- vista de evolucion por hilos
- progreso de objetivos
- alertas suaves de estancamiento o lagunas

## La apuesta mas Steve Jobs

No es hacer mas cosas.

Es hacer que la psicologa sienta:

"esta app me conoce, conoce a mi paciente, me recuerda lo importante, me prepara la sesion y me ayuda a sostener el proceso terapeutico sin cargarme de burocracia."

Eso es un producto amado.

No "mas features".
No "mas IA".

Mas continuidad.
Mas criterio.
Mas sensacion de control.

## Propuesta concreta para empezar

La primera feature que yo prototiparia es:

### Centro del caso

Una nueva vista por paciente con:

- resumen vivo del caso
- objetivos activos
- hilos clinicos
- ultima sesion
- tarea actual
- check-in reciente
- proximos focos sugeridos

Si esto sale bien, luego todo lo demas encaja alrededor.

## Fuentes consultadas

- Quenza for Therapists: https://quenza.com/quenza-for-therapists
- Quenza product overview: https://quenza.com/1/
- TherapyPortal client portal: https://support.therapynotes.com/article/104-therapyportal-client-portal
- TherapyNotes outcome measures: https://support.therapynotes.com/hc/en-us/articles/30661471510299-Outcome-Measures
- TherapyFuel overview: https://support.therapynotes.com/hc/en-us/articles/34844327115291-TherapyFuel-Overview
- SimplePractice scored measures: https://support.simplepractice.com/hc/en-us/articles/18314732128653-Getting-started-with-measurement-based-care
- SimplePractice client portal mobile app: https://support.simplepractice.com/hc/en-us/articles/9651784620045-The-SimplePractice-Client-Portal-mobile-app
- SimplePractice paperless intakes: https://www.simplepractice.com/features/paperless-intakes/
- Mentalyc AI progress tracker: https://www.mentalyc.com/ai-progress-tracker
- Mentalyc how it works: https://www.mentalyc.com/how-it-works
