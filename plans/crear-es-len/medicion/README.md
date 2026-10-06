# Tarea 11 — Crear contra Len, lado a lado

Estado: **pasos 1 y 2 hechos; parado en el paso 3, esperando el OK de Jesús.**
No se ha corrido nada ni se ha gastado un céntimo.

## 1 · Los seis briefs

Del juego fijo del repo (`lib/evals/page-cohort.ts`, `page-cohort/1.6`, el que
usa `scripts/evals-pages.ts`), para que la medición se pueda repetir con los
mismos textos. Uno por cada tipo que pide el plan:

| Tipo | id | Brief | Por qué éste |
|---|---|---|---|
| Restaurante | `comida` | «Taquería de barrio en la Roma. Diez guisos diarios, salsas de la casa, y servicio hasta las 3 de la mañana los fines de semana.» | El cotidiano de siempre. |
| Portafolio | `referencia-calida` | «Estudio de diseño de interiores en Guadalajara. Proyectos residenciales, asesoría de color y un formulario para pedir cita. Que la página siga el estilo de la imagen que adjunto.» + `designs/creator/img/warm/openlen.webp` | Prueba el camino de las fotos adjuntas (Tarea 7). |
| Producto | `saas` | «Herramienta para que equipos de soporte respondan tickets más rápido. Bandeja unificada, respuestas guardadas, e informes de tiempo de respuesta. Prueba gratis 14 días.» | Producto digital. |
| Evento | `sorteo` | «Página para una rifa de fin de año de una tienda de bicicletas. Que tenga los nombres de los participantes y un botón que elija a uno al azar delante de todos.» | Pide JavaScript que funcione: es donde Len puede usar `use_page` y Crear no comprueba nada. |
| Servicio local | `multipagina` | «Clínica veterinaria en Guadalajara. Consulta general, vacunas, cirugía y urgencias 24 horas. Quiero un sitio con páginas separadas: una para los servicios, otra para el equipo de veterinarios y otra para contacto — no quiero que todo esté en la misma.» | Prueba «una página es un fichero más» contra las subpáginas declaradas de Crear (una llamada y un crédito por cada una). |
| Muy vago | `minimo` | «Vendo miel de abeja» | El brief vago. |

## 2 · Presupuesto

Los dos caminos escriben con **el mismo modelo**: DeepSeek V4.1 Flash
(`model-policy.ts`: Crear por `ESCRITOR_POR_DEFECTO_DE_CREAR` / el papel con
visión; Len por el papel `agent`). Tarifa (`lib/ai/tarifas.ts`):
**0,30 $ entrada · 0,006 $ entrada en caché · 1,20 $ salida**, por millón de
tokens.

Tamaños medidos hoy en el código (≈4 caracteres por token):

- Crear: el mensaje de sistema son ~2.900 tokens. Una llamada.
- Len: instrucciones ~7.200 + declaraciones de herramientas ~5.800 =
  **~13.000 tokens que van en cada vuelta del bucle** (en caché desde la
  segunda), más el contexto del proyecto.
- Una página entera de salida: ~9.000 tokens (la cifra del plan).
- Referencia medida de un turno de Len: 0,0042 $ (`lib/len-bench/coste.ts`,
  humo del 23/09), pero sobre una página de 1 KB; aquí se escribe una entera.

| Camino | Por creación | Los 6 briefs |
|---|---|---|
| **Crear** | ~3k de entrada + ~9k de salida ≈ **0,012 $**; `multipagina` = portada + 3 subpáginas ≈ 0,05 $ | **≈ 0,11 $** |
| **Len** | ~5 vueltas (leer la guía, `Write`, `view_page`, quizá un arreglo, cerrar): ~20k de entrada nueva + ~25k de salida (página + pensamiento) ≈ **0,04 $**, pesimista 0,08 $; `multipagina` (4 ficheros) pesimista 0,15 $ | **≈ 0,25 $, pesimista 0,55 $** |
| **Total** | | **≈ 0,36 $, pesimista ≈ 0,70 $** |

**Techo propuesto: 2,00 $** para las 12 creaciones (≈3× el pesimista). Si el
gasto acumulado lo toca, se para y se avisa, como las guardas de
`scripts/len-bench.ts`.

⚠️ **Una corrida por brief y camino es n=1**: sirve para ver las páginas y
el orden de magnitud del tiempo y del coste, no para afirmar diferencias
finas. Tres corridas por brief costarían ≈ 2,10 $ pesimista, con un techo de
5 $.

## Cómo se corre (paso 4, cuando haya OK)

El plan pide «todo en local, con la base de 5546 y el servidor de build de
producción en 127.0.0.1»:

- **Crear**: `POST /api/generate` (sigue vivo hasta la Tarea 12).
- **Len**: `/new` → proyecto en blanco → primer mensaje (`POST /api/agent`).
- **De cada uno**: el tiempo hasta el primer trozo pintado (primer `html` de
  Crear / primer `page_preview` de Len), el tiempo total, el coste (el que
  graba cada camino), los pasos de Len y si miró la página.
- **Paso 5**: capturas de escritorio y móvil, una al lado de la otra, antes
  que la tabla de números.

**En esta sesión de la nube no hay clave de Fireworks** (ni `.env.local`).
Para correrlo aquí haría falta añadir `FIREWORKS_API_KEY` en los ajustes del
entorno y abrir una sesión nueva. Y aun así, la base de pruebas de aquí no
tiene el catálogo de fotos de producción, así que `find_photo` de Len
encontraría menos que en tu máquina. En local la comparación es más fiel.
