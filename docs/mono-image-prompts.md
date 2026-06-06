# MONO — pack de prompts de imagen (ChatGPT / GPT-Image)

Imágenes para `templates/starter/mono.html` (estudio de casas prefab/modulares).
Genera cada una en ChatGPT y mándame los archivos (o súbelos a R2); yo las cableo.

> **Importante:** los **bocetos a línea** (sección "From sketch to structure") **YA están hechos
> como SVG original** — NO necesitas generarlos. Solo hacen falta las **fotos** del edificio.

> Estilo: **fotografía de arquitectura, minimal, monocroma + acento corten (acero oxidado naranja).**
> Pega el bloque **ESTILO BASE** antes de cada prompt para coherencia.

---

## ESTILO BASE (pégalo antes de cada prompt)

```
Fotografía de arquitectura premium, minimalista y editorial. Casa modular prefabricada de
acero corten (oxidado naranja) y concreto, líneas limpias, volumen rectangular abierto al
frente con interior de lamas verticales. Paisaje natural (dunas / costa / pradera), luz de
hora dorada (atardecer), reflejo en agua o suelo húmedo. Paleta sobria: corten + blancos +
grises + negro. Sin texto, sin logos, sin personas, sin marcas de agua.
```

---

## 1) Hero — la foto principal (paisaje, con fondo)

**Formato:** horizontal 16:10 (~1600×1000). Va encajada sobre el wordmark gigante "MONO".
**Slug destino:** `hero.webp`

```
[ESTILO BASE] Plano frontal centrado de una sola casa modular de acero corten abierta al
frente, en dunas de arena con un espejo de agua delante que la refleja. Atardecer, cielo
suave. Encuadre simétrico, el edificio centrado, mucho aire arriba. Estilo de las imágenes
de referencia de MONO.
```

## 2) Modelos — 3 fotos (con fondo)

**Formato:** 4:3 (~1200×900). **Slugs:** `m01.webp`, `m02.webp`, `m03.webp`.

- **M01 — Dune** (la más pequeña, 28 m²)
  `[ESTILO BASE] Cabaña modular corten compacta de un solo volumen sobre dunas de arena,
  vista 3/4, atardecer. Minimal, una sola pieza.`
- **M02 — Ridge** (42 m², techo inclinado)
  `[ESTILO BASE] Casa modular corten con techo ligeramente inclinado en una loma con pasto
  alto, vista en perspectiva, hora dorada.`
- **M03 — Shore** (56 m² + deck)
  `[ESTILO BASE] Casa modular corten más larga con terraza de madera (deck) frente al mar /
  costa, reflejo en suelo mojado, atardecer.`

## 3) Galería "In the wild" — 2-3 fotos (con fondo, panorámicas)

**Formato:** 16:11 (~1400×960) y una panorámica 21:9 (~1680×720).
**Slugs:** `wild-1.webp`, `wild-2.webp`, `wild-3.webp` (la 21:9).

- `[ESTILO BASE] Casa modular corten en un campo de pasto al amanecer, niebla baja, atmosférica.`
- `[ESTILO BASE] Casa modular de CONCRETO claro (gris) en un paisaje rocoso/desértico, mediodía suave.`
- `[ESTILO BASE] Toma panorámica amplia: casa modular corten diminuta en un valle enorme, escala dramática, atardecer.` (21:9)

---

## Dónde caen en la plantilla

| Imagen | Slot en `mono.html` | Cómo |
|---|---|---|
| Hero | `.hero-photo` (la `.struct-scene` placeholder) | reemplazo el placeholder por `<img>` |
| M01/M02/M03 | los 3 `.img-ph` de la sección **Models** | reemplazo cada uno por `<img>` (quito el SVG de muestra) |
| wild-1/2/3 | los 3 `.struct-scene` de **In the wild** | reemplazo por `<img>` |

> Las **fotos NO necesitan fondo transparente** (van con su paisaje). Si ChatGPT te mete el
> damero otra vez, da igual aquí — pero pídele "fotografía realista con fondo de paisaje", no transparente.
> Y como aprendimos: **revisa que no horneé texto/nombres** en la imagen.

---

## 4) "From sketch to structure" — 6 bocetos a línea (REEMPLAZAN los SVG actuales)

**Formato:** horizontal **3:2** (~1200×800), **fondo BLANCO** (no transparente). **Slugs:** `sketch-1` … `sketch-6`.

> **ESTILO BASE bocetos** (pega antes de cada uno):
> ```
> Dibujo arquitectónico a línea, boceto técnico a lápiz/tinta fino, líneas grises oscuras
> precisas sobre fondo BLANCO liso. Sin sombreado, sin relleno, sin color, minimalista.
> Casa modular rectangular de acero corten (solo el contorno/estructura, estilo plano de
> arquitecto). Sin texto, sin cotas escritas, sin marcas de agua.
> ```

- **sketch-1 — Perspectiva** `[ESTILO BASE] Vista en perspectiva frontal del pabellón abierto al frente, con lamas verticales del interior, sobre una línea de suelo mínima con un par de matas de pasto a línea.`
- **sketch-2 — Axonometría** `[ESTILO BASE] Vista axonométrica (isométrica) del volumen como una caja 3D, mostrando techo, frente y costado.`
- **sketch-3 — Alzado** `[ESTILO BASE] Alzado frontal de una casa modular larga y baja, con un alero fino arriba y divisiones de ventana.`
- **sketch-4 — Cubierta inclinada** `[ESTILO BASE] Perspectiva de una variante con cubierta inclinada en cuña, líneas siguiendo la pendiente.`
- **sketch-5 — Sección** `[ESTILO BASE] Sección/corte del volumen mostrando el interior, una línea de piso y una pequeña figura humana a escala dibujada a línea.`
- **sketch-6 — Planta** `[ESTILO BASE] Planta cenital (vista superior) de la huella de la casa, con divisiones de habitaciones y ticks de dimensión.`

> Consejo: pídele a ChatGPT el **mismo estilo de línea** en los 6 (mismo grosor, mismo lápiz)
> para que la cuadrícula se vea coherente, igual que tu imagen de referencia.
