# Temáticas — art briefs (fondos full-page por kit)

Prompts para **ChatGPT (GPT-Image-2 / Images 2.0, modo thinking)**. Cada kit
necesita 3-4 fondos en dos orientaciones. El modelo genera hasta 8 imágenes
coherentes por prompt — un kit sale en ~2 generaciones.

## Cómo usar este doc

1. Abre un chat nuevo POR KIT (la coherencia de estilo vive dentro de la
   conversación).
2. Pega el **prompt maestro** del kit → genera las 4 escenas en 16:9.
3. Follow-up en el mismo chat: `Now recompose each of these four scenes as
   9:16 portrait for mobile — same world, same palette, same style.`
4. Máxima resolución/calidad (2K). Descarga PNG.
5. Guarda en `.tematicas-art/<kit>/<escena>-<desktop|mobile>.png`
   (ej. `.tematicas-art/coquette/satin-desktop.png`). La carpeta es local,
   no se commitea; el processor a R2 viene después.
6. Genera de más y descarta sin piedad — entran 3-4 por kit, las mejores.

## Reglas duras (van en TODOS los prompts — ya incluidas abajo)

- **Cero texto, logos, marcas de agua, UI**. El texto lo pone la página.
- **Cero personajes/franquicias reconocibles** y cero "estilo de [estudio o
  personaje]" en el prompt. Solo descripciones de estilo. (Hasta el
  "parecido" pierde juicios — caso Cathy/Miffy.)
- **Centro compositivo tranquilo**: el contenido de la página vive encima.
- **Contraste suave**: nada de blancos quemados ni negros duros en áreas
  grandes; el scrim del motor hace el resto.
- Sin personas reales ni caras fotorrealistas.

## Filtro de calidad (antes de dar una imagen por buena)

- [ ] ¿El tercio central aguanta un titular encima? (squint test)
- [ ] ¿Sin texto/glifos accidentales? (revisa esquinas y "letreros")
- [ ] ¿Funciona también ligeramente difuminada? (así se usará a veces)
- [ ] ¿Se siente premium y específica, no "wallpaper genérico de stock AI"?
- [ ] ¿La versión móvil 9:16 mantiene la zona tranquila en el centro?

---

## Kit 1 — Coquette

**Mundo**: hiper-femenino romántico soñado. Rosa bebé, marfil, rubor. Satén,
moños, perlas, grano de película. Sin personajes — pura atmósfera (la
referencia guns.lol era una foto difuminada: la atmósfera gana).
**Acento previsto del kit**: rosa `#e85d8a` aprox (el motor lo deriva del
fondo elegido).

**Prompt maestro** (genera 4 escenas, 16:9, una pasada):

> Create 4 coherent background images sharing one visual world: a soft,
> romantic, hyper-feminine dreamscape. Palette: baby pink, ivory, warm
> blush. Style: shot-on-film softness, 35mm grain, hazy dreamy blur, pastel
> color grading, gentle window light. Composition rule for ALL images: the
> center third stays calm and low-detail so interface text can sit on top;
> soft contrast, no pure white or pure black areas. Strictly no text, no
> letters, no watermarks, no logos, no people.
>
> 1. Flowing satin fabric folds with a few scattered silk bows and loose
>    pearls, extreme soft focus, pale pink and cream.
> 2. Dreamy out-of-focus bokeh of fairy lights and rose petals drifting over
>    a blush gradient.
> 3. A sheer lace curtain backlit by warm morning sun, floating dust motes,
>    pink haze.
> 4. A cloud of pink tulle fabric filling the frame, airy and weightless,
>    soft shadows.
>
> Landscape 16:9, highest resolution.

---

## Kit 2 — Y2K Chrome

**Mundo**: cromo líquido iridiscente, nostalgia cyber 2001, holográfico,
brillante. Sin UI retro (genera texto) — solo materia y luz.
**Acento previsto**: cian-lavanda iridiscente `#7dd3fc` / `#c4b5fd`.

**Prompt maestro**:

> Create 4 coherent background images sharing one visual world: glossy Y2K
> chrome futurism. Palette: liquid silver chrome with pink-cyan-lavender
> iridescent reflections. Style: hyper-glossy 3D render, holographic sheen,
> subtle lens-flare star sparkles, clean and luminous. Composition rule for
> ALL images: the center third stays calm and low-detail for interface text;
> soft contrast. Strictly no text, no letters, no UI elements, no watermarks,
> no logos, no people.
>
> 1. Slow liquid-chrome waves with pink and blue iridescent reflections.
> 2. A holographic gradient field with a few star-shaped lens sparkles and a
>    very subtle perspective grid fading at the horizon.
> 3. Molten metallic blobs floating over a soft lavender-to-cyan gradient.
> 4. Brushed chrome surface with prismatic light streaks, edges falling to a
>    soft dark vignette.
>
> Landscape 16:9, highest resolution.

---

## Kit 3 — Anime Dream

**Mundo**: cielo pintado estilo película de animación, celestial pastel
(yume-kawaii). 3 escenas de atmósfera + 1 opción con personaje **original**.
**Acento previsto**: rosa-lavanda `#f0a6ca` / menta `#a7e8d0`.

**Prompt maestro**:

> Create 4 coherent background images sharing one visual world: hand-painted
> anime-film background art, soft watercolor gradients, pastel celestial
> mood. Palette: pastel pink, lavender, mint, warm gold. Composition rule
> for ALL images: the center third stays calm and low-detail for interface
> text; soft contrast. Strictly no text, no letters, no watermarks, no
> logos. Original artwork only — do not imitate any existing studio,
> franchise or character.
>
> 1. A painted sky with towering cumulus clouds at pink-gold sunset, tiny
>    distant stars appearing.
> 2. A pastel night sky with a large dreamy moon, drifting translucent
>    clouds, fine star glitter, mint and lavender tones.
> 3. A sea of clouds seen from above at dawn, soft pink-to-blue gradient.
> 4. An ORIGINAL anime girl seen from behind (face not visible), small in
>    the lower-left of the frame, looking up at a pastel starry sky — your
>    own original character design: long soft pink-gradient hair, simple
>    white dress; she must not resemble any existing anime or game
>    character.
>
> Landscape 16:9, highest resolution.

---

## Kit 4 — Anime Noir (herencia japan-dark)

**Mundo**: noche de Tokio cinematográfica — neón, lluvia, bruma. Hermana
oscura del drop `japan-*` de la librería de imágenes.
**Acento previsto**: magenta neón `#e879f9` / teal `#2dd4bf`.

**Prompt maestro**:

> Create 4 coherent background images sharing one visual world: cinematic
> Tokyo night, neon and rain, moody anime-film atmosphere. Palette: deep
> blue-black, neon magenta, teal, warm amber accents. Composition rule for
> ALL images: the center third stays calm and low-detail for interface text;
> avoid large pure-black areas — keep a soft ambient glow. CRITICAL: all
> neon signs must be ABSTRACT GLOWING SHAPES with no readable characters or
> letters of any language. Strictly no text, no watermarks, no logos, no
> brands, no people.
>
> 1. A rainy narrow alley at night, abstract neon glow reflecting on wet
>    asphalt, cinematic haze.
> 2. A dark rooftop view over a city at night, distant neon shimmer, light
>    rain streaks, blue-pink rim light on the skyline.
> 3. Close-up rain droplets on glass with blurred neon bokeh behind, dark
>    teal and magenta.
> 4. The lone warm glow of an unbranded vending machine in a dark foggy
>    street, light pooling on wet ground.
>
> Landscape 16:9, highest resolution.

---

## Kit 5 — Wanderlust (hotel / viajes) — NO se genera con IA

Fotografía real (el fotorrealismo AI de hoteles cae en uncanny; la foto real
es mejor y gratis). Fuentes: el pipeline de Unsplash del producto (acredita
solo) + la categoría `travel` de la librería (24 fotos) como semilla.

**Checklist de curación** — buscar pares horizontal + vertical de:

- [ ] Piscina infinita a la hora dorada, mar al fondo, agua en calma.
- [ ] Textura de agua turquesa (aérea o cercana) — funciona difuminada.
- [ ] Suite de lino blanco al amanecer, luz suave, sin gente.
- [ ] Carretera costera o costa desde acantilado, bruma cálida.

**Criterios**: luminosa y calmada (no saturación de postal), centro
tranquilo, sin caras, vertical real (no recorte forzado del horizontal).
**Acento previsto**: arena/terracota `#d9956b` o azul mar `#3b82a0` según
foto.

---

## Qué pasa después con las imágenes

1. Me avisas cuando haya carpeta → processor (AVIF multi-tamaño) → R2.
2. El motor deriva la paleta real de cada fondo elegido (palette-gen) y yo
   afino tokens/scrim/fuente por kit.
3. Gate de legibilidad con los 70 tests de contraste + render-verify sobre
   templates reales antes de exponer las bolas en el inspector.
