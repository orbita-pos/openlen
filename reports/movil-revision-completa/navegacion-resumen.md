# Revalidación final: navegación, llamada y avisos

2026-10-29. Ejecutado `node reports/movil-audit-navegacion/revalidacion.cjs` contra Vite local con solicitudes externas bloqueadas. El proceso terminó con código 0.

Las cuatro combinaciones (390×844 y 320×568, claro/oscuro, reduced motion) pasaron los asserts y no registraron pageerrors. Detalle en navegacion-resultados.json.

Verificado:
- Carga lista visible con role=status y texto; ya no pantalla negra.
- Vacío visible con fondo temático; Avisos hereda la tinta de la pantalla (assert específico) y Salir es visible. Captura navegacion-vacio-320-light.png inspeccionada después del último arreglo.
- Preview falla una vez y Reintentar obtiene iframe sin reiniciar app.
- Selector aria-modal/current, foco inicial, Shift+Tab/Tab circular, Escape y retorno al título.
- Menú tamaños: foco inicial en tamaño seleccionado, Home/End/ArrowDown, Enter selecciona y devuelve foco al botón. Reapertura enfoca tamaño nuevo, Escape vuelve al botón. Cerrado inert.
- Grab 64×44 CSS; a320 queda52.5×36.1 por escala del lienzo (antes4.1px de alto).
- Subtítulos incluyen espacios entre palabras (assert texto + inspección visual). Audio y Silenciar exponen aria-pressed, cambian en grande y PiP.
- Avisos activos conservan tinta heredada en ambos temas y botón responde a desactivación mock.

La llamada y los avisos usan hooks locales simulados: no se utilizaron micrófono, audio real, WebRTC ni Firebase. No se validan integraciones nativas por esta evidencia.

Los ocho hallazgos originales del dominio quedaron corregidos; no se observaron nuevas regresiones en esta revalidación.
