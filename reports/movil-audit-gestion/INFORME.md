# Auditoría independiente: Gestión, Comparación, Tu Len

Sólo fixture local `http://127.0.0.1:5175/?muestra=1`, Edge headless y contexto independiente. Ningún cambio de producto, servidor, dependencias o git. Requests de red externos abortados; no se publicó ni envió información real. Las acciones de publicar/encargo usan clienteDeMuestra; compartir/copiar utilizan clipboard simulado.

## Hallazgos

1. **P2: los números grandes desplazan tarjetas fuera del panel.** En Tus números devolver `vistas:1234567, personas:123456, hoy:12345`. A 390 px la tercera tarjeta sale del área y su cifra queda cortada; la columna de visitas también ocupa más ancho que sus pares. Fuente `movil/src/gestion/gestion.css:25-27`: `repeat(3,1fr)` conserva el mínimo intrínseco de cada número a 36px. Evidencia `huge-numbers.png`. Cambio mínimo: tracks `minmax(0,1fr)`, hijos con `min-width:0` y estrategia legible para cifras grandes (formato compacto o tamaño adaptado). Mantener valor exacto accesible si se compacta.

2. **P2/P3: nombres sin espacios provocan scroll horizontal y recorte.** Abrir gestión con título `PanaderiaLunaUnNombreExcesivamenteLargoSinEspaciosParaComprobarElAjusteDelTitulo`. La línea del proyecto queda cortada por la derecha. Fuente `movil/src/gestion/gestion.css:15`, título renderizado en `gestion.tsx:136`. Evidencia `long-title.png`. Cambio mínimo: `overflow-wrap:anywhere` para `.gestion-proyecto`; también comprobar texto de servidor de encargos.

3. **P3: errores muestran identificadores internos.** Un fallo de estadísticas `{error:'stats_unavailable'}` muestra esa cadena debajo de la explicación, y publicación con hallazgos muestra `security_findings`. Fuente `movil/src/gestion/gestion.tsx:149` imprime siempre `problema.codigo` y a veces `error.message` crudo. Evidencia `visits-error.png`, `publish-security-confirm.png`, `project-error.png`. Cambio mínimo: preservar explicación localizada/detalles de riesgo y omitir códigos técnicos crudos; usar mensajes humanos conocidos o fallback. El reintento sigue funcionando.

## Cobertura comprobada

- Publicar, Tus números, Encargos, Antes/Ahora y Tu Len: 390×844, 360×640 y 320×568, claro y oscuro. Sin cortes funcionales en datos normales. Cerrar y alternar pestañas operan.
- Comparación: Antes y Ahora; screenshot `compare-settled.png` tras carga real del iframe. Las capturas base iniciales de comparación pueden ser blancas por haberse tomado antes de cargar srcDoc; se descartó como fallo del producto.
- Gestión: fallo de proyecto → reintento/carga → recuperado, fallo de visitas → Actualizar datos → vacío (cero visitas), publicación con detalles de riesgo → checkbox → publicación ficticia, encargo largo/bloqueado → acciones recuperables con scroll → quitar.
- Teclado: `screen.orientation` fijada portrait y viewport 390×400. `keyboard-portrait-encargo.png` muestra textarea de 3.500 caracteres y Enviar encargo accesibles; se conserva cabecera y tabs. La matriz base 390×400 usa orientación desktop y no representa teclado; no se usa para conclusión sobre teclado.
- Compartir/copiar: ambos escriben URL esperada con clipboard stub, y muestran Enlace copiado. No se abre share sheet real.
- Enviar encargo ficticio abre chat, termina y muestra entrega; tocar Ver tu página pliega hoja (`is-min`). `entrega-reveal.png`.
- Tu Len: flechas, elegir Chef/Bigote, opciones desplazables vertical/horizontal, aplicar y persistencia tras reload (`aria-pressed=true` para Bigote).
- Errores JS: sólo errores de red esperados por bloquear Google Fonts; `extended-log.json`. Se verificó con tipografía local/fallback.

## Límites

No se prueban cámara, micrófono, vibración, teclado Android real, insets de hardware ni compartir nativo. Tampoco publicación de producción ni backend real. No se modificó src. Evidencia y scripts en este directorio y `reports/movil-audit-gestion-check.cjs`.
