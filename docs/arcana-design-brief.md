# ARCANA — brief de diseño para claude.ai (claude design) · estilo KOF Portal

Plantilla premium tipo **The King of Fighters Portal** (SNK) — portal de una saga de lucha, no un
evento de una noche. Full-bleed cinematográfico, tipografía pesada en itálica, acento amarillo,
textura de semitono, key-art de personajes + filmstrip de roster + base de datos de personajes.
Marca original: **ARCANA**. Familia de galería: `gaming`. Slug: `arcana`.

## ⚠️ REGLA DE ORO (feedback del user)
El **logo, el emblema y el key-art** NO se construyen en CSS/SVG — **van como IMÁGENES** (`<img>`).
En el intento anterior (La Velada) claude design dibujó el emblema (“la V”) en CSS y quedó feo.
claude design SOLO arma el layout, la nav, la barra amarilla, el filmstrip, la textura de semitono,
los hovers y la tipografía. Todo lo gráfico de marca = imagen.

## Cómo usarlo
1. claude.ai → New chat → modelo Opus más reciente. Pega el bloque PROMPT entero. Pide UN artifact `text/html`.
2. Descarga el `.html` y pásamelo.
3. Las imágenes salen del pack `docs/arcana-image-prompts.md` (ChatGPT, estilo KOF).

> Imágenes reales (todas vía `<img src="https://images.openlen.com/arcana/<slug>.webp">`):
> **logo** (emblema transparente), **hero** (key-art cinematográfico ancho con fondo) y **8 personajes**
> (busts transparentes para el filmstrip y la base de datos). Mientras no existan, caen a un fallback.

---

## PROMPT (pégalo entero en claude.ai)

```
Diseña UNA landing premium, en UN solo artifact de tipo `text/html` (NO React, NO JSX, NO MDX).
Es el PORTAL OFICIAL de una saga de videojuego de lucha llamada ARCANA. Toma como referencia de
ESTRUCTURA y ENERGÍA visual el portal de "The King of Fighters" (SNK): full-bleed cinematográfico,
tipografía pesada en itálica, acento amarillo, textura de semitono, y un filmstrip de personajes.

⚠️ REGLA CRÍTICA — NO dibujes el logo ni el emblema ni el key-art en CSS/SVG. Esos son IMÁGENES
(`<img>`). Tú solo construyes el layout, la nav, la barra amarilla, el filmstrip, la textura de
semitono, los hovers y la tipografía. Un emblema hecho a mano en CSS queda mal; usa el <img>.

FORMATO DE SALIDA:
- Un único archivo `<!doctype html>` self-contained.
- Tailwind por CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts por <link> en <head>: Saira Condensed (600,700,800,900 + italic), Inter (400,500,600,700).
- Todo el CSS propio inline en <style> en <head> (semitono, barra amarilla, filmstrip, utilidades).
- JS vanilla en UN <script> al final (menú móvil + scroll/drag del filmstrip + hover de cartas). Sin frameworks.
- NO uses `data-slot-path=` en ningún sitio. NO login/signup/dashboard.
- Copy real en ESPAÑOL. Nada de Lorem ipsum.
- Responsive desde 360px. Lift-on-hover (80-150ms). Una sola moda: OSCURO. Sin toggle.

DESIGN TOKENS (contrato OpenLen — todo color/radio/fuente sale de una var; nada de hex crudo fuera de
:root salvo texturas rgba neutras y atributos de SVG):
  --bg: #0A0A0C;            /* casi negro */
  --surface: #141417;
  --surface-2: #1C1C21;
  --fg: #F4F4F2;            /* blanco */
  --fg-muted: #9B9B98;
  --fg-faint: #5C5C5A;
  --border: rgba(255,255,255,0.10);
  --border-strong: rgba(255,255,255,0.22);
  --accent: #F2C200;        /* amarillo KOF — ÚNICO acento de UI */
  --accent-r: 242,194,0;
  --accent-ink: #0A0A0C;    /* texto/iconos SOBRE el amarillo */
  --radius: 2px;            /* esquinas duras */
  --font-display: 'Saira Condensed', sans-serif;  /* pesada, itálica, gritty */
  --font-body: 'Inter', system-ui, sans-serif;
- UN solo acento = amarillo (--accent): la barra, pills, bordes activos, "INDEX", subrayados, hovers.
- Titulares en --font-display, MAYÚSCULAS, font-weight 800-900, font-style italic, letter-spacing leve
  negativo, con un skew de actitud (como los títulos de KOF). El texto blanco manda; el amarillo acentúa.
- Textura de SEMITONO global: un patrón de puntos (radial-gradient en repeating background, ~3-4px,
  baja opacidad) sobre el fondo y sobre las imágenes oscuras, para el look impreso/gritty de KOF.

ESTRUCTURA (en este orden):

1) TOP BAR fina (sticky, fondo translúcido oscuro con blur):
   - Izq: <img> del logo pequeño (nav) + "ARCANA — PORTAL OFICIAL" en Saira italic.
   - Centro-izq: una pill amarilla "NOVEDAD" + un ticker de noticia ("2026.06.17 · Se abre el Coliseo de ARCANA VII").
   - Der: selector de idioma estético (ESP · EN · JP) + iconos sociales (SVG inline: X, Instagram, YouTube).

2) HERO full-bleed (min-height 100svh): el KEY-ART va como <img> de FONDO que cubre todo
   (object-cover, position center). Encima, un gradiente oscuro inferior + la textura de semitono para
   que el texto se lea. Contenido centrado:
   - El <img> del LOGO/emblema grande (centrado). (NO lo dibujes en CSS.)
   - Debajo: "PORTAL OFICIAL" pequeño tracked + el título "ARCANA" o "ARCANA — LA SAGA" en Saira italic
     pesadísimo (si prefieres, este wordmark también puede salir DENTRO del <img> del logo; deja el
     <h1> como texto accesible aunque visualmente domine el logo-imagen).
   - NAV horizontal de la saga: "HISTORIA · SAGA · PERSONAJES · TORNEO · NOTICIAS" (subrayado amarillo en hover/active).
   - (Opcional, abajo-derecha) una card "ARCANA STUDIO" pequeña con un <img> de mini-logo.
   - Botón hamburguesa en móvil.

3) BARRA AMARILLA + FILMSTRIP (la firma de KOF): una banda de fondo amarillo (--accent) con texto en
   --accent-ink (mini-logo + handles sociales a la izq), y a la derecha un FILMSTRIP horizontal de
   miniaturas-cara de los personajes (los 8 cutouts recortados a la cara, object-position top), con
   scroll/drag horizontal, el rótulo "PERSONAJES · '01–VII" en Saira italic y un botón "INDEX" + icono
   de menú. Hover en cada mini = sube + ligero zoom.

4) PERSONAJES (base de datos): fondo oscuro con semitono. Título "PERSONAJES" gigante (Saira italic).
   Grid de 8 cartas (en desktop 4×2, en móvil 2 col). Cada carta: el <img> del personaje (bust, sobre
   un gradiente oscuro con un glow tenue de su color de elemento), el NOMBRE en Saira italic, su título
   de arcano y una etiqueta de ELEMENTO. Hover: la carta sube, borde amarillo, el personaje hace un
   leve zoom y aparece una flecha "VER". (Sin página de detalle; basta el estado hover.)

5) SAGA / HISTORIA: banda cinematográfica — un <img> de un personaje (reusa el de KORR o KAEL) oscurecido
   a la derecha, y a la izquierda un bloque de texto: titular en Saira italic + 2 párrafos de lore de ARCANA
   (el torneo de los arcanos, la rivalidad KAEL vs KORR) + un botón outline amarillo "LEER LA HISTORIA".

6) TORNEO / NOTICIAS: título "ÚLTIMAS NOTICIAS". 3 cartas de noticia (cada una con un <div> placeholder
   con gradiente — estas SÍ pueden ser CSS, son thumbnails de noticia, no marca): fecha en mono, titular,
   etiqueta (Torneo / Actualización / e-Sports). Hover lift.

7) FOOTER: <img> del logo + "ARCANA", columnas de enlaces (Saga · Personajes · Torneo · Reglas · Contacto),
   iconos sociales, selector de idioma y "© ARCANA — Todos los derechos reservados". Hairline superior.

LOS 8 PERSONAJES (úsalos tal cual en el JS, el filmstrip y la base de datos):
{ slug, NOMBRE, título de arcano, elemento/arquetipo, color de glow (solo decorativo), rival }
  1. kael   — KAEL   — "EL HERALDO"  — Luz / artista marcial (protagonista) — glow #E0B43A — vs KORR
  2. korr   — KORR   — "EL OCASO"    — Sombra carmesí / villano (jefe final) — glow #D63A4A — vs KAEL
  3. mora   — MORA   — "LA SOMBRA"   — Veneno violeta / kunoichi            — glow #8B5CF6 — vs ISOLDE
  4. vesta  — VESTA  — "LA PIRA"     — Fuego / boxeadora                    — glow #F4631E — vs VORN
  5. brann  — BRANN  — "EL YUNQUE"   — Tierra / agarrador colosal           — glow #C97A3A — vs AELITH
  6. aelith — AELITH — "EL JUICIO"   — Viento / luchadora aérea             — glow #38D0C4 — vs BRANN
  7. vorn   — VORN   — "LA SIEGA"    — Toxina / guadañero siniestro         — glow #6FBF3A — vs VESTA
  8. isolde — ISOLDE — "LA ESCARCHA" — Hielo / hechicera de combate         — glow #4FA8E0 — vs MORA

IMÁGENES (clave — cablea las URLs para que solo haya que subir los archivos):
- Logo/emblema:  https://images.openlen.com/arcana/logo.webp   (úsalo en nav pequeño y en el hero grande)
- Key-art hero:  https://images.openlen.com/arcana/hero.webp   (fondo del hero, ancho, con su escena)
- Personajes:    https://images.openlen.com/arcana/<slug>.webp (ej. .../kael.webp) — busts transparentes,
  reusados en el filmstrip (recorte a la cara) y en la base de datos (bust).
- FALLBACK elegante para CADA <img>: detrás, un contenedor con un gradiente oscuro + (para personajes)
  un glow del color del elemento + una silueta SVG genérica a baja opacidad; al <img> ponle
  onerror="this.style.opacity=0". Para el logo, fallback = el texto "ARCANA" en Saira italic. Así el
  diseño se ve completo sin las imágenes y, al subirlas a esas URLs, aparecen solas.

JS (vanilla, un bloque):
- Array CHARS con los 8 objetos. Render del filmstrip y de la base de datos desde el array.
- Filmstrip: drag/scroll horizontal con el ratón/touch; botones de flecha opcionales.
- Menú móvil toggle. Respeta prefers-reduced-motion.

CALIDAD: portal de saga de lucha AAA — cinematográfico, gritty, amarillo eléctrico sobre negro,
tipografía pesada en itálica con actitud, semitono impreso, mucho contraste. Accesible: AA en texto,
focus-visible amarillo, aria-labels en botones de solo icono, alt en imágenes. Devuélveme UN solo artifact html.
```
