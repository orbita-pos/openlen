# EXODUS — pack de prompts de imagen (ChatGPT / GPT-Image)

Fotos para `templates/starter/exodus.html` (empresa espacial estilo SpaceX). Genera cada una en
ChatGPT y mándame los archivos; yo las optimizo, subo a R2 y cambio los placeholders CSS por `<img>`.

> **Marte ya está hecho en CSS** (la esfera de la sección "A future among the stars") — opcional
> reemplazarlo por foto real. Hacen falta **5 fotos** (las secciones a pantalla completa).
> Todas **horizontales 16:9 (~1920×1080), con su fondo** (no transparentes).

> **ESTILO BASE** (pégalo antes de cada prompt):
> ```
> Fotografía aeroespacial cinematográfica, fotorrealista, el lenguaje visual de SpaceX.
> Cohetes de acero inoxidable pulido, escala enorme, luz dramática (hora dorada o nocturna).
> Alto detalle, atmósfera, sin texto, sin logos, sin marcas de agua, sin personas salvo que se pida.
> ```

---

## Las 5 fotos

- **hero** (sección 1 — el lanzamiento) — *slug `hero`*
  `[ESTILO BASE] Cohete super-pesado de acero inoxidable despegando desde una plataforma costera
  sobre un delta de ríos verdes, columna de escape colosal, vista aérea, de día, escala épica.`

- **vehicle** (sección 3 — "Reusable from the ground up") — *slug `vehicle`*
  `[ESTILO BASE] Un booster super-pesado de acero descendiendo hacia una torre de lanzamiento con
  brazos de captura ("chopsticks") al atardecer, llama de motores, mar en calma al fondo, cinematográfico.`

- **launch** (sección 4 — "...trusted ride to orbit") — *slug `launch`*
  `[ESTILO BASE] Dos boosters reutilizables esbeltos aterrizando simultáneamente, patas desplegadas,
  llamas de motor, sobre una costa al anochecer, simétrico, dramático.`

- **human** (sección 5 — "human spaceflight") — *slug `human`*  (fondo oscuro; el texto va a la DERECHA)
  `[ESTILO BASE] Primer plano de perfil de un astronauta con casco de traje espacial blanco y negro
  dentro de una nave, luz tenue, reflejos en el visor, fondo MAYORMENTE NEGRO al lado derecho.`

- **network** (sección 6 — "internet from space") — *slug `network`*
  `[ESTILO BASE] Primer plano de un panel de satélite negro reflectante / superficie de nave en órbita
  baja terrestre, la curva de la Tierra apenas visible abajo, destello de sol, oscuro, alto detalle.`

- *(opcional)* **mars** — *slug `mars`* — solo si quieres reemplazar la esfera CSS:
  `[ESTILO BASE] Marte fotorrealista sobre espacio negro puro, iluminado desde la izquierda con un
  terminador día/noche nítido a la derecha, superficie rojiza con detalle.`

---

## Dónde caen

| Foto | Sección en `exodus.html` | Cómo |
|---|---|---|
| hero | panel 1 (`.ph-launch`) | cambio el placeholder por `<img>` |
| vehicle | panel 3 (`.ph-sunset`) | `<img>` |
| launch | panel 4 (`.ph-sky`) | `<img>` |
| human | panel 5 (`.ph-dark`) | `<img>` |
| network | panel 6 (`.ph-space`) | `<img>` |
| mars *(opt)* | la esfera `.mars` (panel 2) | `<img>` (si lo quieres real) |

> Tip: para **human** y **network**, el texto va encima — pídele a ChatGPT que deje un lado
> bastante oscuro/vacío (derecha en human, izquierda libre en network) para que el titular se lea.
