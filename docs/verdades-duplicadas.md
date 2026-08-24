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

### 2 · Qué dominios son nuestros — 🟡 cuatro listas

`publishedBaseHosts()` · `RESERVED_HOST_SUFFIXES` · `RESERVED_EXACT_HOSTS` ·
`RESERVED_BASE_SUFFIXES`. Cuatro listas que responden a variantes de la misma
pregunta. Dos se arreglaron el 2026-08-23 y 24 — **con un día de diferencia,
por el mismo motivo, y la segunda no se descubrió hasta que alguien fue a
mirar**. Siguen siendo cuatro.

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

### 4 · Qué iframes permite una página publicada — 🟡 de acuerdo, y frágil

`frame-src` está pinado en **Rust** (`crates/html-engine/src/publish/seal.rs`)
a tres orígenes; quien los usa son **dos ficheros TypeScript**
(`video-embed.ts`, `map-embed.ts`). Hoy coinciden — verificado — y el
comentario de Rust nombra los dos ficheros, que es la única cosa que los une.

Añadir un embebido nuevo obliga a tocar los dos lados **y recompilar el módulo
nativo**. Si se olvida el lado de Rust, el resultado es el peor modo de fallo
del sistema: se ve bien en el editor y el navegador lo bloquea al publicar.

### 5 · Qué pruebas existen vs cuáles se ejecutan — 🟢 casi cerrado

Medido: **313 ficheros de prueba en disco**, 272 los corre vitest (cuyo
`include` es una **lista blanca**, no un descubrimiento) y 37 los nombra
`test:node` uno a uno.

Huérfanos reales: **1**. `lib/publish/platforms-band-publish.test.ts` — escrito
para `tsx --test`, con las instrucciones en su propia cabecera, y nunca añadido
a la lista. **Pasa 6/6.** Seis afirmaciones sobre la publicación llevaban meses
sin ejecutarse ni una vez. Registrado el 2026-08-24.

### 6 · La configuración del box vs el repo — 🟡 sin drift, sin vínculo

Verificado por sha256:

| fichero | repo | box | |
|---|---|---|---|
| `Caddyfile` | `c359dfff6a55` | `c359dfff6a55` | idéntico |
| hook de certificados | `ddce7eb76a02` | `ddce7eb76a02` | idéntico, **con otro nombre** (`openlen-edge-cert.sh`) |
| `reload-caddy.sh` | *(no existía)* | `6d588daa68e2` | **sólo en el box** hasta hoy |

No hay drift hoy. Pero nada lo impide: **el deploy no despliega el Caddyfile**,
así que las dos copias coinciden por disciplina, no por mecanismo. Y el nombre
distinto significa que nadie puede comprobar la correspondencia con un `diff`.

### 7 · Las 10 traducciones — 🟢 gobernada

Medido: **paridad completa**. Ninguna clave de `en` falta en ninguno de los
otros nueve idiomas. Esta duplicación —210 ficheros— es la más grande del
sistema y es la única que está sana.

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
