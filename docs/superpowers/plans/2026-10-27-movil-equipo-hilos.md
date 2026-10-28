# Equipo y menciones de Len Móvil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Permitir mensajes a miembros con @ y leer/responder los hilos existentes desde Len Móvil.

**Architecture:** Añadir una ruta exclusiva `/api/movil/equipo` con llave Bearer, CORS restringido y los servicios de colaboración ya existentes. La app incorpora un panel de equipo con mensajes y hilos; las funciones puras de menciones de la web se importan sin modificarlas. Los pedidos a Len siguen sus rutas actuales.

**Tech Stack:** React 19, Vite, Capacitor 8, use-intl, Next route handlers, servicios Drizzle existentes, Vitest y Edge/Playwright.

**Spec:** Conversación: portar la función existente; conservar pantallas/comportamiento web; avisar de adaptaciones necesarias del servidor antes de incluirlas. El usuario indicó «ok comienza». Se comunicó la necesidad de un acceso nuevo exclusivo de móvil y su publicación posterior.

## Global Constraints

- No modificar `components/workspace-v2`, `app/api/projects` ni los servicios compartidos de proyectos/hilos/chat.
- Añadir sólo el puente de servidor de móvil, sin migraciones ni despliegue.
- Mensajes de equipo visibles al proyecto, igual que en la web; no ofrecerlos como privados.
- Lector: comentar/mencionar personas. Dueño/editor: también pedir trabajo a Len. Resolver: editor/dueño o autor del hilo.
- Verificar acceso antes de leer participantes/mensajes y antes de mutar un hilo. Ningún hilo de otro proyecto.
- Datos de muestra exclusivamente DEV. Sin envíos reales de mensajes/avisos en QA.
- Mantener los diez idiomas soportados y las correcciones pendientes de barras/fecha/panel.
- Trabajar en el checkout existente: las dependencias de móvil y sus correcciones previas aún no están confirmadas en Git. No perderlas creando un checkout desde HEAD.
- No hacer commit, push, instalación ni despliegue sin petición posterior.

## Review Focus

- Llave ausente/inválida y usuario ajeno: 401/404 sin lecturas ni escrituras de datos del equipo.
- Cambio de proyecto durante carga/envío: ignorar respuestas viejas y no mostrar datos del proyecto anterior.
- Lectores y `@Len`: ni pedir turnos ni resolver hilos ajenos; validar en servidor aunque se manipule la interfaz.
- Un fallo de red conserva el borrador; doble toque no duplica mensajes; actualización no borra lo escrito.
- Mensajes entre personas no se presentan como respuestas de Len ni disparan la entrega visual de una página.

## Task 1 — Puente móvil de colaboración

**Files:** `app/api/movil/equipo/route.ts`, `app/api/movil/equipo/route.test.ts`, `lib/movil/rutas-de-la-app.ts`.

**Interfaces:** GET `?project=<id>` devuelve identidad, rol, personas, mensajes de equipo e hilos. POST recibe `{projectId, accion}`: `mensaje` con texto/menciones; `respuesta` con hiloId/texto/menciones/len; `estado` con hiloId/estado; `vistas` con chat/hilos. Reutiliza permisos, escritura, marcado y avisos existentes.

- [x] Escribir y ver fallar pruebas de autorización, CORS, aislamiento de hilo/proyecto, menciones y permisos de lector/editor.
- [x] Implementar ruta exclusiva de móvil y registrar contrato; no editar rutas web.
- [x] Verificar pruebas y tipos. Las pruebas mockean la cola de avisos y el lanzamiento de Len.

## Task 2 — Cliente, estado y composición de menciones

**Files:** `movil/src/equipo/api.ts`, `tipos.ts`, `use-equipo.ts`, `menciones.tsx` y sus pruebas.

**Interfaces:** DTOs móviles; carga protegida por época; actualizar/mandar/responder/resolver/ver; borradores por proyecto. Selector con funciones compartidas `arrobaEnCurso`, `opcionesDeMencion`, `ponerMencion`, `trozosConMenciones`.

- [x] Pruebas en rojo: selección y cursor, nombres/Len, fallo conservando borrador, cargas cruzadas, doble envío y solo lectura.
- [x] Implementar API y hook de equipo; cancelar temporizadores al cerrar y pausar sondeo si la app está oculta.
- [x] Implementar caja de texto y menciones accesibles, sin HTML inyectado ni importación de UI web.

## Task 3 — Panel móvil y conexión con el chat

**Files:** `movil/src/equipo/equipo.tsx`, `equipo.css`, `movil/src/textos-equipo.ts`, `textos.tsx`, `pantallas/principal.tsx`, `chat/chat.tsx`, `chat/hilo.ts`, `hoja.ts`, `entrega/entrega.tsx`, `muestra.ts` y pruebas del alcance.

- [x] Probar mensajes con autor correcto, panel/hilo/reintento, textos en diez idiomas y ausencia de falsas entregas por mensajes persona.
- [x] Añadir acceso desde principal y chat; pestañas Mensajes/Hilos, destinatarios y contexto de hilo sin editor de código nuevo.
- [x] Pedidos @Len del chat usan el chat existente; en hilos los inicia el servicio existente con sus permisos.
- [x] Mantener visible el aviso de que el equipo ve los mensajes; estado de error claro si el servidor aún no ofrece la ruta.

## Task 4 — Verificación y revisión

- [x] Pruebas de alcance, TypeScript raíz/móvil, lint y build web.
- [x] QA táctil 390×844 y 360×640 con DEV: @persona, respuesta de hilo, permisos de lector, fallo/reintento, scroll/teclado y accesibilidad básica.
- [x] Revisión independiente del cambio completo y corrección de defectos importantes.
- [x] Registrar evidencias y límites: puente aún no desplegado, avisos reales pendientes de prueba, web sin modificaciones.

## Ledger

- Ruling: ejecutar en línea y conservar el checkout actual — la petición es continuar sobre la app ya probada, con muchas correcciones locales previas necesarias.
- Ruling: acceso nuevo en `/api/movil/equipo` — las rutas web usan cookies; así no se altera su contrato ni su interfaz.
- Ruling: hilos existentes se leen/responden/resuelven; no se añade un editor de código móvil para crear comentarios por línea.
