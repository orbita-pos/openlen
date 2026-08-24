# Verdades duplicadas

Inventario de los sitios donde OpenLen escribe **el mismo hecho más de una vez**
sin nada que mantenga las copias de acuerdo.

## Por qué este documento

La noche del 2026-08-24 salieron cinco fallos en producción. `tsc` estaba
limpio, 3.879 pruebas en verde y 592 más también. Ninguna prueba vio ninguno de
los cinco, porque **cada copia era correcta por separado** — sólo mentían
juntas:

| lo que se rompió | la verdad | su otra copia |
|---|---|---|
| la interfaz decía openlen.com un día entero | `PUBLISH_BASE_HOST` en el box | ~95 literales en componentes y traducciones |
| `mitienda.openlen.app` se podía reclamar como dominio propio | `publishedBaseHosts()` | `RESERVED_HOST_SUFFIXES` |
| Caddy se negó a recargar con el certificado nuevo | los certificados de `live/` | una lista escrita a mano en el hook |
| los correos de todas las páginas salían como `[email protected]` | la tubería de publicación | un interruptor del panel de Cloudflare |

No es mala suerte cuatro veces. Es **un patrón**, y ninguna cantidad de pruebas
unitarias lo alcanza: hay que ir a mirar los pares.

## Inventario

Estado a 2026-08-24. «Medido» = comprobado con un comando, no recordado.

### 1 · Dónde nacen las páginas — 🟢 cerrado

`PUBLISH_BASE_HOST` (entorno del box) tenía **7 copias del valor por defecto**
en el servidor, ~15 literales en componentes de cliente y **8 cadenas
traducidas × 10 idiomas = 80** más.

Hoy: una constante (`lib/publish/base-host.ts`), `{host}` en las traducciones,
y `publish-host:gate` aborta el deploy si la copia pública falta. Una prueba
recorre los 10 idiomas y falla si alguien vuelve a escribir el dominio dentro
de un texto.

### 2 · Qué dominios son nuestros — 🟢 cerrado

Eran cuatro listas: `publishedBaseHosts()` · `RESERVED_HOST_SUFFIXES` ·
`RESERVED_EXACT_HOSTS` · `RESERVED_BASE_SUFFIXES`. Dos se arreglaron el
2026-08-23 y 24 — **con un día de diferencia, por el mismo motivo, y la segunda
no se descubrió hasta que alguien fue a mirar**.

Hoy hay una: `OPENLEN_PAGE_HOSTS` en `lib/publish/base-host.ts`. Las otras tres
se derivan de ella. Es distinta de `PUBLISHED_BASE_HOST` a propósito: ésa dice
dónde NACE una página y cambia con el entorno; ésta dice qué dominios son
nuestros y no depende de ninguna variable.

### 3 · Las TRES versiones del mismo documento — 🔴 el más caro

Un mismo proyecto se pinta de tres maneras distintas:

| | quién lo arma | sella la CSP |
|---|---|---|
| el taller (iframe) | inyectores de cliente + runtime del modelo | no |
| `/p/[id]` | `preview-bake.ts` | **no** |
| la publicada | `publishToDir` | **sí** |

Medido: `publishToDir` aplica **15 horneados**, `preview-bake` **6**. Faltan en
la vista previa `bakeBehaviors`, `bakeCarousels`, `bakeMotion`, `bakeMusic`,
`bake3dScene`, `bakeGoogleFonts`, `bakeResponsiveImages`, `bakeDocument`.

Algunas ausencias son deliberadas (las que tocan la red). Otras no. **Toda
diferencia entre las tres es un fallo que sólo aparece después de publicar** —
y de ahí salieron los dos peores de esta noche: el JavaScript del modelo que no
corría en el taller, y los correos que se veían bien en la vista previa y
llegaban muertos al visitante.

**Sigue abierto, pero ya no es silencioso.** `lib/publish/bake-surfaces.ts`
declara los ocho horneados que sólo existen al publicar, con el motivo de cada
uno y marcando cuáles son deliberados (`bakeGoogleFonts` toca la red) y cuáles
son huecos de verdad (`bakeCarousels`: la vista previa enseña una lista donde
el visitante recibe un carrusel). `bake-surfaces.test.ts` lee los dos ficheros
y falla si aparece un noveno sin declarar — o si la vista previa llegara a
hornear algo que la publicada no, que es la dirección peor.

Cerrarlo del todo pide una sola lista ordenada de horneados que los dos
llamadores recorran. Eso es refactorizar la ruta de publicación y no se hace de
madrugada.

### 4 · Qué iframes permite una página publicada — 🟢 con guardián

`frame-src` está pinado en **Rust** (`crates/html-engine/src/publish/seal.rs`)
a tres orígenes; quien los usa son **dos ficheros TypeScript**
(`video-embed.ts`, `map-embed.ts`). Añadir un embebido nuevo obliga a tocar los dos lados **y recompilar el módulo
nativo**. Si se olvida el lado de Rust, el resultado es el peor modo de fallo
del sistema: se ve bien en el editor y el navegador lo bloquea al publicar.

Los dos horneados exportan ahora sus orígenes (`VIDEO_FRAME_ORIGINS`,
`MAP_FRAME_ORIGINS`) y `frame-origins.test.ts` lee el `frame-src` de `seal.rs`
y compara. Comprobado en falso: añadir Spotify sólo en TypeScript hace fallar
dos afirmaciones, una por la lista y otra porque el origen quedaría declarado
sin usarse.

### 5 · Qué pruebas existen vs cuáles se ejecutan — 🟢 casi cerrado

Medido: **313 ficheros de prueba en disco**, 272 los corre vitest (cuyo
`include` es una **lista blanca**, no un descubrimiento) y 37 los nombra
`test:node` uno a uno.

Huérfanos reales: **1**. `lib/publish/platforms-band-publish.test.ts` — escrito
para `tsx --test`, con las instrucciones en su propia cabecera, y nunca añadido
a la lista. **Pasa 6/6.** Seis afirmaciones sobre la publicación llevaban meses
sin ejecutarse ni una vez. Registrado el 2026-08-24.

### 6 · La configuración del box vs el repo — 🟢 con mecanismo

Verificado por sha256:

| fichero | repo | box | |
|---|---|---|---|
| `Caddyfile` | `c359dfff6a55` | `c359dfff6a55` | idéntico |
| hook de certificados | `ddce7eb76a02` | `ddce7eb76a02` | idéntico, **con otro nombre** (`openlen-edge-cert.sh`) |
| `reload-caddy.sh` | *(no existía)* | `6d588daa68e2` | **sólo en el box** hasta hoy |

Ya hay mecanismo: `infra/box-files.mjs` es la tabla que sabe qué fichero del
repo es qué fichero del box —incluida la línea que dice que el hook se llama
distinto— y `npm run infra:drift` compara sha256 contra la máquina, normalizando
los finales de línea. **Sólo lee**: desplegar configuración del box sigue siendo
un acto deliberado y a mano.

Primera ejecución: 2 de 4 con deriva, **las dos de comentario**. El `.service`
del box menciona `TOGETHER_API_KEY`, un proveedor que ya no se usa. Sin el
mecanismo, el sha decía «distintos» y no había forma de saber si eso importaba.

### 7 · Las 10 traducciones — 🟢 gobernada

Medido: **paridad completa**. Ninguna clave de `en` falta en ninguno de los
otros nueve idiomas. Esta duplicación —210 ficheros— es la más grande del
sistema y es la única que está sana.

## Una lección del propio guardián

La primera versión del extractor de §3 buscaba `bake[A-Z]` y se dejaba fuera
`bake3dScene` **en silencio**: después de «bake» viene un dígito. El guardián
habría pasado en verde con un horneado sin declarar. Por eso las dos pruebas
nuevas empiezan comprobando que el extractor **encuentra algo** antes de
comparar nada: un guardián que se apaga solo es peor que no tenerlo, porque
además da tranquilidad.

## Lo que todavía no he mirado

- El contrato que se le da al modelo en el prompt vs lo que la tubería
  realmente exige al recibir la respuesta.
- Los interruptores de apagado (`lib/publish/kill-switches.ts`) vs cada sitio
  que los lee.
- El esquema de Drizzle vs las migraciones que corren en el box.
- Los `operation` de `fable-model-policy.ts` vs los llamadores que no declaran
  ninguno y heredan el valor por omisión.
- La unidad de systemd del repo vs la del box (`655a5a9ad9bb`, sin tocar desde
  el 2026-05-31).

## Cómo se lee esto

Una duplicación no es un fallo. Es un **sitio donde puede haber uno**, y donde
las pruebas no van a mirar. Las tres formas de cerrarla, de mejor a peor:

1. **Una sola copia** — las otras se derivan (§1).
2. **Una puerta** que falle ruidosamente si divergen (`publish-host:gate`).
3. **Un comentario** que nombre a la otra copia (§4). Es lo más barato y lo
   único que impidió que §4 ya estuviera roto.

Lo que no vale: acordarse.
