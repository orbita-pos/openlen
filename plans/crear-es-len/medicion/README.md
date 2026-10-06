# Tarea 11 — Crear contra Len, lado a lado

Estado: **pasos 1–3 hechos. OK de Jesús el 06/10: una corrida por brief y
camino, techo 2 $, y se corre en su máquina.** El guion (`medir.ts`) está listo
y probado sin gastar (ver abajo); falta lanzarlo (paso 4) y mirar el resultado
(pasos 5 y 6).

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

## Cómo se corre (paso 4)

Con `medir.ts`, contra el servidor de Len-Bench (`npm run bench:len:servidor`:
local, graba los turnos de Len y deja vacías las credenciales de R2,
Cloudflare, Resend y Exa, así que nada toca producción).

**Lo que necesita `.env.local`:** `FIREWORKS_API_KEY` (la de verdad),
`AUTH_SECRET`, `DATABASE_URL` a una base **local** (el guion se niega a correr
contra otra) y `EVAL_USER_EMAIL` con la etiqueta `+openlen-eval` (la identidad
de Len-Bench). Para el dev de siempre antes: el servidor usa el puerto 3007 y la
misma carpeta `.next`.

```bash
# terminal 1
npm run bench:len:servidor

# terminal 2 — primero el estimado (no llama a nadie, 0 $)
npx tsx --tsconfig tsconfig.eval.json --env-file=.env.local \
  --require ./scripts/test-node-server-only-shim.cjs plans/crear-es-len/medicion/medir.ts

# y la corrida (GASTA; techo aprobado: 2 $)
npx tsx --tsconfig tsconfig.eval.json --env-file=.env.local \
  --require ./scripts/test-node-server-only-shim.cjs plans/crear-es-len/medicion/medir.ts --yes --budget-usd=2
```

**Qué hace:**

- **Crear**: `POST /api/generate` con el brief (y la foto como `data:` en
  `referencia-calida`), como el héroe de Crear.
- **Len**: `POST /api/projects` (el proyecto en blanco), la foto por
  `/api/upload` y el primer mensaje a `POST /api/agent`, como `/new`. Esfuerzo
  `auto`, el de un usuario nuevo.
- **El orden se alterna** por brief (Crear→Len, Len→Crear…), para que ningún
  camino vaya siempre segundo.
- **Tiempos**: el primer trozo pintado es el primer `html_chunk` de Crear o el
  primer `page_preview` de Len; el total, hasta que acaba el stream. Antes de
  medir calienta las dos rutas con una petición inválida: `next dev` compila
  la primera vez, la petición se rechaza antes de llamar al modelo y no cuesta
  nada.
- **Coste**: lo que baja el saldo de la identidad de eval. Un crédito es
  0,01 $ de coste de proveedor, así que es la misma vara para los dos caminos;
  de Len se coteja además con el `centicredits` de su `done`.
  - Para que nada mueva el saldo a medias, pone el escritor de Crear en el de
    por defecto (el mismo modelo que Len) y marca el saldo como recién
    renovado. Las dos cosas se devuelven a como estaban al acabar.
  - Si una creación parece costar más de 1 $, el saldo se movió por otra cosa y
    el guion para.
- **El techo**: antes de cada creación mira si el gastado más el pesimista de
  la siguiente pasa de 2 $. Si pasa, para.
- **De Len apunta además** los pasos (`done.toolCalls`), las herramientas, si
  miró (`view_page`/`use_page`) y si preguntó al dueño en vez de construir: con
  «Vendo miel de abeja» puede pasar, y eso también es un resultado.
- **Las capturas**: escritorio (1440) y móvil (390), página entera, de cada
  página guardada (`multipagina`, todas). Lo que se fotografía es el documento
  GUARDADO, abierto en Chromium y bajado como un visitante para que lo que
  aparece con el scroll aparezca (como `lib/len-bench/capturas.ts`).
- **Escribe aquí**: `resultados.md` (las capturas lado a lado, primero, y
  luego la tabla de números), `resultados.json` y `capturas/`.

### Probado sin gastar (en la nube, 06/10)

Con el servidor de Len-Bench y una clave falsa, `--solo=referencia-calida,minimo`:

- **Funcionó todo el camino hasta el modelo**: la cookie, el calentado, el
  proyecto en blanco, la subida de la foto, los dos streams, el orden
  alternado, el informe y el devolver la identidad como estaba. Las llamadas
  murieron en el proxy de la nube, que no deja salir a `api.fireworks.ai`;
  coste 0 $.
- **Ese humo encontró un fallo y ya está arreglado**: la renovación de 30 días
  reescribió el saldo y salieron «49,80 $» de gasto sin ninguna llamada. De ahí
  vienen el saldo marcado como renovado y el corte de más de 1 $.
- **Las capturas** se probaron con una página de muestra. En la nube el proxy
  tampoco deja cargar el Tailwind del CDN; en tu máquina sí carga.

## Después (pasos 5 y 6)

Mirar `resultados.md` **primero por las capturas** y luego por la tabla. Si Len
pierde en belleza o en tiempo hasta ver algo, no se sigue a la Tarea 12: se
arregla en Len y se vuelve a medir, con otro OK. Si gana o empata, sigue.
