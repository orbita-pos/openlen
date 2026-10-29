# Auditoría independiente: entrada, navegación y controles

Fecha: 2026-10-29. Base inspeccionada: c60ce1763 (el coordinador puede aplicar cambios mientras esta auditoría corre). Sólo se añadieron scripts y evidencia en reports. No se modificó producción.

## Cobertura y aislamiento

- Edge headless aislado, origen local http://127.0.0.1:5175, fixture DEV ?muestra=1.
- Se bloquearon solicitudes externas. Sin cuentas, tokens, publicaciones, mensajes, micrófono, audio real ni modelos.
- 390×844, 360×640 y 320×568, claro y oscuro. Oscuro usa reduced motion. 78 capturas del recorrido principal.
- Entrada visible sin pulsar Entrar; principal; selector; 18 proyectos con título largo; scroll hasta Salir; cambio al proyecto 18; tamaño Compu; menú tamaños; lista vacía; error lista y reintento; error preview; carga lista retardada 8 segundos.
- Tema: cambio a oscuro y persistencia después de reload correctos. Atrás cierra selector.
- Llamada: hook useLlamada sustituido en esa sesión por estado local en_llamada. Capturas en 3 tamaños; minimizar, Audio, Silenciar y Colgar funcionan en el mock. No demuestra funcionamiento nativo ni conexión de voz.
- Avisos: hook sustituido por estados locales cargando/desactivados/activando/activos/denegados/error y aviso recibido a 320×568. Disabled y aria-pressed responden al estado.

## Hallazgos

1. **P1 — Lista vacía negra e ilegible en claro.** principal.tsx devuelve sección ent-empty sin fondo de capa. app.css define negro para html/body/raiz; ent-empty sólo da padding (entrega.css). Texto y Salir heredan marrón oscuro. Reproducir con lista projects:[]; ver 390-light-empty.png. Mínimo: contenedor de pantalla con fondo/color del tema y acciones claras. Oscuro tiene texto visible, pero la pantalla vacía tampoco tiene una composición consistente.
2. **P2 — Carga muda.** principal.tsx retorna null mientras lista/id faltan; app.tsx hace lo mismo al leer llave. Lista retardada muestra negro completo: 390-light-loading.png. Mínimo: estado visible de carga con role=status, fondo del tema. La lectura de un proyecto lento también deja título vacío e iframe sin contenido.
3. **P2 — Preview fallida sin recuperación visible.** principal.tsx sólo muestra vistaNoCarga con vistaFallo; no hay Reintentar para esa petición. 390-light-preview-error.png. Volver de background sólo recarga proyecto/iframe existente, no vuelve a pedir enlace preview fallido. Mínimo: acción que repida enlaceDeVistaPrevia y permita recuperar sin reiniciar/cambiar de proyecto.
4. **P2 — Palabras de subtítulo pegadas.** llamada.tsx renderiza el espacio dentro de cada span lm-w; prototipo.css:211 da display:inline-block, que elimina visualmente la separación entre cajas. 390-mock-call.png, 360-mock-call.png y extras-results.json muestran "personasatupáginayseisde...". Mínimo: nodo espacio fuera del span (o separación CSS). Los subtítulos largos sí permanecen por encima de los controles a 360/320.
5. **P2 — Foco y teclado en selector/menú tamaños.** Al abrir selector el foco queda en lm-bar-t; Tab va a lm-dvbtn fuera del role=dialog. Escape no cierra. Menú role=menu no mueve foco a sus items con ArrowDown y Escape no cierra. Ver keyboard-results.json. Mínimo: foco inicial/retorno y Escape en ambas superficies; teclado de menú acorde con los roles. Atrás probado sí cierra.
6. **P2 — Hit area de cierre/gesto demasiado pequeña.** lm-grab es el botón completo de 40×5 px (prototipo.css:447), a 320 mide 32.8×4.1. Es también único botón de cierre del selector. Header cara 32×32, tamaños 34×34; PiP expandir 26.3×26.3 a 320. Mínimo: ampliar área de botón conservando rayita con pseudo-elemento; ajustar targets de cabecera/PiP donde quepa.
7. **P2 — Avisos activos: Desactivar casi invisible.** avisos.css usa #f88d59 para botón aria-pressed=true sobre el naranja. 320-mock-avisos-activos.png y 320-mock-avisos-recibido.png. Mínimo: color de texto con contraste en claro, sin perder distinción activo.
8. **P2 — Toggle de llamada sin estado accesible.** Audio y Silenciar cambian sólo clase e icono, no aria-pressed, en grande y PiP (llamada.tsx botones alternarAudio/alternarMicro). Ver extras-results.json. Mínimo aria-pressed={ll.audio} y aria-pressed={!ll.micro}.

## Evidencia y scripts

- ../movil-audit-navegacion-check.cjs: recorrido 6 combinaciones y escenarios inyectando wrapper de clienteDeMuestra sólo al servir Vite a ese contexto.
- results.json: texto, targets y errores de cada escenario. El error de localStorage dentro data: es del addInitScript de tema del harness aplicado a iframe opaco, no de la app. No atribuirlo a producción.
- keyboard.cjs / keyboard-results.json: teclado, Atrás y tema.
- extras.cjs / extras-results.json: llamada totalmente mock. Import React fijado a la versión prebundle de esta ejecución; si Vite regenera hash se actualiza en el script.
- avisos.cjs / avisos-results.json: estados de avisos totalmente mock.

## Límites

No se validaron OAuth/canje real, almacenamiento seguro, barra nativa, teclado Android real, notificaciones Firebase/permiso Android, entrega push ni llamada WebRTC/hardware. La muestra usa un iframe data: que evita servidor/credenciales. No hay inferencia de que los mocks prueben esas integraciones.
