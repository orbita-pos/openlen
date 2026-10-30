# Len Móvil: revisión completa de uso y diseño

29 de octubre de 2026. Rama `feat/len-movil-2`, base `c60ce1763`.

## Entrega

[Comparación visual Antes/Ahora](antes-ahora.html). Son capturas locales de navegador con datos de muestra. No se actualizó la APK ni se desplegó el servidor.

Se recorrieron entrada y carga, proyectos, vista previa y tamaños, chat y respuestas, adjuntos, Equipo/hilos, publicación y compartir, Tus números, encargos, comparación Antes/Ahora, Tu Len, temas, hoja, llamada y avisos simulados. Se revisaron pantallas claras/oscuras, tamaños 390×844, 360×640 y 320×568, altura de teclado, movimiento reducido y navegación por teclado. No todos los cruces de escenario/tamaño se duplican: el detalle está debajo.

## Problemas corregidos

| Área | Antes | Ahora |
|---|---|---|
| Composición | Texto largo oculto en una línea; alturas del pie calculadas con relleno fijo. | Campo de hasta 132 px, scroll interno y pie con su alto real para texto/adjuntos/errores. |
| Respuestas | El mismo párrafo en streaming podía quedar debajo del pie; otro párrafo forzaba el final aunque se leyera arriba. | Sigue el final mientras se lee allí, respeta lectura antigua y ofrece botón para regresar. |
| Envío | «Leído» podía aparecer antes del ACK del servidor o durante una subida fallida. | Enviando hasta confirmar recepción; estado de voz y archivo coherente; fallos conservan reintento. |
| Teclado | Chat/selector/menú podían dejar foco detrás, y Escape no cerraba varias superficies. | Foco inicial/retorno y navegación de teclado; chat cerrado y menú cerrado inertes; composición IME no envía por error. |
| Carga y vacío | Esperas negras, vacío ilegible y sin acción útil para volver a cargar proyectos. | Estado de carga con Len, vacío temático, Abrir OpenLen y Actualizar páginas; lista actualizada al regresar. |
| Vista previa | Fallo sin reintento directo. | Reintenta el enlace sin recargar la lista ni cerrar conversación. |
| Proyecto/llamada | Cambio de id y relectura podían mezclar contexto o desmontar/reiniciar llamada. | Contexto filtrado por id, cambio de página termina la llamada anterior; relectura del mismo proyecto conserva capas, incluso si falla. |
| Contraste y tacto | Texto blanco de poco contraste sobre naranja, avisos activos difíciles de leer, rayita de 5 px y botones pequeños. | Tinta oscura sobre naranja claro, burbujas naranjas más profundas, avisos adaptados a su superficie, áreas táctiles ampliadas sin perder el gesto. |
| Gestión | Cifras/títulos largos recortaban contenido; códigos técnicos visibles. | Cifras compactas con valor exacto accesible, unidades enteras, títulos ajustados y errores humanos conservando detalles y consentimiento de publicación. |
| Llamada | Palabras del subtítulo pegadas y toggles sin estado accesible. | Espacios reales y aria-pressed en Audio/Silenciar, en grande y PiP. |
| Tarjetas | Visitas podían desaparecer al fallar; editar durante un envío podía confundir el texto enviado; fallo de Copiar sin mensaje. | Carga/error/reintento visibles, borrador protegido durante envío, errores de copia visibles y Copiado se borra al editar. |
| Fotos locales | Sustituir o abandonar una previsualización podía dejar su URL local sin liberar. | La previsualización se libera al sustituir, cambiar proyecto o desmontar. |

## Verificación final

- **48 archivos y 371 pruebas aprobadas**, con `vitest run movil/src app/api/movil lib/movil lib/notifications/fcm.test.ts lib/notifications/dispatch-fcm.test.ts --exclude '**/*.pg.test.ts'`.
- Tipos de móvil y raíz aprobados; lint de archivos modificados/nuevos sin advertencias de código. El ejecutable sólo avisa del formato antiguo de configuración ESLint del repositorio.
- Build Vite de producción aprobado: 145 módulos; sin dependencias nuevas.
- Revisión independiente: se detectaron y corrigieron dos regresiones de relectura del mismo proyecto. Las pruebas en rojo/verde cubren respuesta 200 y 503 conservando el nodo de llamada. Sin pendientes confirmados al cerrar la revisión.

| Recorrido reproducible | Alcance y resultado |
|---|---|
| `../movil-audit-chat-check.cjs` | 390/360/320: campo largo, ACK pendiente, párrafo en vivo, lectura antigua, regreso al final, adjunto con teclado; capturas oscuras. 18 comprobaciones, cero fallos/errores JS. |
| `entrega-visual-check.cjs` | Capturas finales, IME sin envío y recuperación desde vacío. Aprobado. |
| `tarjetas-check.cjs` | 390/320 × claro/oscuro: visitas, borradores y portapapeles con error/reintento. Aprobado, sin envíos reales. |
| `gestion-final-check.cjs` | 390/320 × claro/oscuro: cifras, títulos, detalles y confirmación de seguridad. Aprobado. |
| `../movil-audit-navegacion/revalidacion.cjs` | 390/320 × claro/oscuro: carga/vacío, foco, menú, preview, avisos y llamada mock. Aprobado. |
| `../movil-atras-dedo-check.cjs` | 390/360, normal/reducido: cuatro paneles, scroll/carrusel, cancelar/completar, hilo → lista → proyecto y chat con teclado. Aprobado. |
| `../movil-adjuntos-check.cjs` | 390/360: selectores de cámara/fotos simulados, PDF/Excel, límites y reintento parcial sin duplicación. Aprobado. |
| `../movil-sheet-check.cjs` | Hoja desde botón/borde, scroll, cancelar, ratón y movimiento reducido. Aprobado. |
| `../movil-movimiento-check.cjs` | Cuatro paneles, cierre inerte, foco, historial y preferencia de movimiento en vivo. Aprobado. |
| `../movil-equipo-check.cjs` | Menciones, mensaje/respuesta/resolver, Atrás por niveles, borrador de error y lector. Aprobado. |
| `../movil-chat-cabecera-check.cjs` | Fecha, cabecera dinámica, insets Android y teclado 390/360. Aprobado. |

Se corrigieron dos supuestos de los scripts de regresión: esperar el resize real antes de medir el pie y comenzar el gesto desde el encabezado estable tras hacer scroll. No se amplió ningún tiempo de espera para ocultar un fallo de producto.

Las matrices iniciales, métricas y hallazgos se conservan en `../movil-audit-gestion/` y `../movil-audit-navegacion/`; se seleccionaron capturas representativas para no guardar todas las combinaciones duplicadas. Los scripts pueden regenerar la matriz completa.

## Límites de esta entrega

Pendiente en el Samsung con la APK actualizada: cámara y selector nativos, micrófono/altavoz/Bluetooth y llamada WebRTC real, notificaciones Firebase y apertura al tocarlas, teclado Android real, barras del sistema y percepción de fluidez. La pantalla de entrada se inspeccionó, sin completar OAuth/canje real. Los datos y errores de los recorridos fueron simulados; no se publicaron páginas, enviaron mensajes externos ni consumieron llamadas reales a modelos. No se ejecutaron pruebas de integración PostgreSQL.

Sólo se modificó móvil y su documentación/pruebas. Web, servidor, dependencias, master y despliegue no cambian.
