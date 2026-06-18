# LIEBRE — brief de diseño para claude.ai (claude design) · estilo "Inner Circle"

Marca de **ropa / streetwear** premium con un **mascota 3D (una liebre)** que viste las prendas a la
venta. Referencia de energía: la landing "Inner Circle" (3D character vibrante, hero color-block
magenta con patrón sutil, wordmark gigante con glow, cards tipo píldora que se expanden, sección
manifiesto oscura + logo cloud). Marca ORIGINAL. Familia de galería: `fashion`. Slug: `liebre`.

## ⚠️ REGLA DE ORO (feedback del user)
El **logo/mark de marca y los renders del personaje y los productos** NO se dibujan en CSS — **van
como IMÁGENES** (`<img>`). claude design SOLO arma layout, nav, cards, patrón de fondo, hovers,
tipografía. El **wordmark gigante "LIEBRE"** sí puede ser texto CSS (fuente pesada con outline/glow),
porque es texto, no un emblema.

## Cómo usarlo
1. claude.ai → modelo Opus más reciente. Pega el bloque PROMPT entero. Pide UN artifact `text/html`.
2. Pásame el `.html`. Las imágenes salen de `docs/liebre-image-prompts.md` (ChatGPT, render 3D).

> Imágenes reales vía `<img src="https://images.openlen.com/liebre/<slug>.webp">`: `logo` (mark
> transparente), `hero` / `point` / `chill` (mascota 3D transparente, distintas poses), y 4 productos
> (`prod-tee`, `prod-hoodie`, `prod-cap`, `prod-kicks`) — **TODO transparente** (recortado). Mientras no existan, caen a un fallback.

---

## PROMPT (pégalo entero en claude.ai)

```
Diseña UNA landing premium, en UN solo artifact de tipo `text/html` (NO React, NO JSX, NO MDX).
Es la web de una marca de ROPA / STREETWEAR llamada LIEBRE, con una mascota 3D (una liebre con
gafas de sol) que viste las prendas. Toma como referencia de ESTRUCTURA y ENERGÍA visual la landing
"Inner Circle": hero color-block vibrante con un personaje 3D y un patrón sutil de fondo, un wordmark
gigante con glow, tarjetas tipo píldora redondeadas que se expanden, y una sección manifiesto oscura.

⚠️ REGLA CRÍTICA — NO dibujes el logo-mark ni el personaje ni los productos en CSS/SVG. Esos son
IMÁGENES (`<img>`). Tú construyes layout, nav, cards, el patrón de fondo, hovers y tipografía. El
wordmark gigante "LIEBRE" SÍ es texto CSS (fuente pesada con outline/glow).

FORMATO DE SALIDA:
- Un único archivo `<!doctype html>` self-contained.
- Tailwind por CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts por <link> en <head>: Space Grotesk (500,600,700) + Inter (400,500,600,700).
- Todo el CSS propio inline en <style> en <head> (patrón de fondo, cards, glow, utilidades).
- JS vanilla en UN <script> al final (menú móvil + expandir cards + render de productos). Sin frameworks.
- NO uses `data-slot-path=`. NO login/signup/dashboard. Copy real en ESPAÑOL. Nada de Lorem ipsum.
- Responsive desde 360px. Lift-on-hover (90-160ms). Una sola moda. Sin toggle.

DESIGN TOKENS (contrato OpenLen — todo color/radio/fuente sale de una var; nada de hex crudo fuera de
:root salvo texturas rgba neutras y atributos de SVG). IMPORTANTE: --fg-muted y --fg-faint DEBEN
pasar contraste AA (≥4.5:1) sobre los fondos donde lleven texto con significado.
  --bg:#0E0A0D;            /* casi negro, tinte cálido */
  --surface:#171218;
  --surface-2:#221A22;
  --fg:#FBF5F8;            /* blanco cálido */
  --fg-muted:#BCAEB6;
  --fg-faint:#94909A;      /* ya AA-safe sobre --bg/--surface */
  --border:rgba(255,255,255,0.10);
  --border-strong:rgba(255,255,255,0.20);
  --accent:#FF1F6B;        /* magenta caliente — el ÚNICO acento */
  --accent-r:255,31,107;
  --accent-ink:#1A0410;    /* texto/iconos SOBRE el magenta (oscuro, para AA) */
  --radius:16px;           /* TODO muy redondeado: cards, pills, botones */
  --font-display:'Space Grotesk', sans-serif;
  --font-body:'Inter', system-ui, sans-serif;
- UN solo acento = magenta (--accent): hero color-block, pills, botones, links activos, glow, badges.
- Base OSCURA; el HERO es un bloque magenta a sangre completa. Cards de beneficios = blancas redondeadas.
- Titulares en --font-display, pesados (600-700), tracking ligeramente negativo. Mucho aire, redondeado, juguetón pero premium.

DIRECCIÓN VISUAL (clava esto):
- HERO = panel magenta (--accent) a pantalla casi completa, con un PATRÓN sutil de fondo (glifos /
  monograma "L" / siluetas de liebre repetidas en blanco al ~7% de opacidad, vía repeating background
  o un SVG tileado — esto SÍ es CSS). Encima, el <img> del personaje (transparente) centrado y grande,
  y debajo el wordmark gigante "LIEBRE" en texto CSS (Space Grotesk 700, tamaño clamp enorme, BLANCO
  con un glow magenta/blanco y/o -webkit-text-stroke fino; estilo letrero neón, como "INNER CIRCLE").
- Personaje 3D = estrella de la marca: aparece en el hero (look completo), señalando las cards de
  beneficios, y en la sección manifiesto. Siempre con drop-shadow para que flote.
- Cards redondeadas grandes (radius), sombras suaves, lift + leve escala en hover. Botones tipo pill.
- Detalles: tag de "DROP 01", precios con tipografía clara, un badge "AGOTADO/ÚLTIMAS" en algún producto.

ESTRUCTURA (en este orden):

1) NAV (sticky, sobre el hero, translúcida con blur):
   - Izq: <img> del logo-mark (pequeño) + nombre "LIEBRE" + micro-tagline ("Streetwear en ediciones
     limitadas. Hecho para los que saltan primero.").
   - Der: enlaces "TIENDA · COLECCIÓN · MANIFIESTO · COMUNIDAD" + un botón redondeado (carrito o menú,
     icono SVG) estilo el botón redondo de la referencia. Hamburguesa en móvil.

2) HERO (min-height 92svh): el panel magenta + patrón + el <img> `hero` del personaje (look completo)
   centrado + el wordmark "LIEBRE" gigante abajo. Un sub corto arriba ("NUEVA TEMPORADA · DROP 07") y
   un par de botones pill ("Comprar el drop" relleno blanco, "Ver colección" outline). 

3) BENEFICIOS (cards expandibles): 3 cards blancas redondeadas en una columna/lista, y el <img> `point`
   del personaje señalándolas a un lado (como en la referencia). Cada card: título + (al hover/expandir)
   un párrafo. Beneficios:
   - "Drops semanales en cantidad limitada"  → "Cada semana una cápsula nueva, numerada y sin restock."
   - "Acceso anticipado para miembros"        → "Únete al Círculo y compra 24h antes que nadie."
   - "Envío gratis + cambios fáciles"         → "Envío gratis desde 50€ y 30 días para cambios."

4) DROPS / TIENDA: título "EL DROP" + grid de 4 PRODUCTOS (en desktop 4 col, móvil 2). Render desde JS.
   Cada card de producto: fondo de card oscuro suave (gradiente de --surface-2 a --surface con un glow
   magenta tenue arriba, radius), y el <img> del producto TRANSPARENTE flotando con drop-shadow; debajo,
   nombre, precio, un tag (DROP 0X / ÚLTIMAS / NUEVO), y un botón pill "Añadir". Hover: la card sube +
   sombra, el producto hace un leve zoom y el botón se tiñe de magenta. Los 4 productos son las prendas
   que viste el personaje (recortados, mismo lenguaje visual que la mascota).

5) MANIFIESTO (sección OSCURA, --bg): a un lado el <img> `chill` del personaje (pose relajada), al otro
   un bloque de texto manifiesto con PALABRAS CLAVE resaltadas en magenta o en --fg fuerte (estilo el
   manifiesto de la referencia): habla de ediciones limitadas, comunidad, hecho a mano, cultura de calle.
   Debajo, un LOGO CLOUD pequeño en gris (marcas/medios FICTICIOS pero creíbles donde aparece la marca:
   p.ej. "URBE", "Asfalto Mag", "Drift", "Calle 9", "Hypeficticio") en una fila tenue.

6) COMUNIDAD / NEWSLETTER (banda magenta): "ÚNETE AL CÍRCULO" + "Entérate de cada drop antes que nadie"
   + un input de email redondeado + botón pill "Apuntarme" (estético, sin backend).

7) FOOTER (oscuro): <img> del logo-mark + "LIEBRE", columnas de enlaces (Tienda · Colección · Ayuda ·
   Legal), iconos sociales (Instagram, TikTok, X — SVG inline), y "© LIEBRE — Salta primero."

LOS 4 PRODUCTOS (úsalos tal cual en el JS):
{ slug, nombre, precio, tag }
  1. prod-tee    — "Camiseta Calavera"  — "34€"  — "DROP 07"
  2. prod-hoodie — "Hoodie Madriguera"  — "79€"  — "NUEVO"
  3. prod-cap    — "Gorra Oreja Larga"  — "29€"  — "ÚLTIMAS"
  4. prod-kicks  — "Zapatillas Brinco"  — "120€" — "DROP 07"

IMÁGENES (cablea las URLs para que solo haya que subir los archivos):
- logo-mark:  https://images.openlen.com/liebre/logo.webp     (nav + footer; transparente)
- personaje:  https://images.openlen.com/liebre/hero.webp     (hero, look completo; transparente)
               https://images.openlen.com/liebre/point.webp    (señalando; transparente)
               https://images.openlen.com/liebre/chill.webp    (manifiesto; transparente)
- productos:  https://images.openlen.com/liebre/<slug>.webp    (prod-tee, prod-hoodie, prod-cap, prod-kicks; TRANSPARENTES, recortados)
- FALLBACK elegante para CADA <img>: detrás, un contenedor con gradiente/relleno suave (para el
  personaje, un círculo magenta translúcido; para productos, el gradiente de card --surface) + al <img> ponle
  onerror="this.style.opacity=0". Para el logo-mark, fallback = la inicial "L" en --font-display.

JS (vanilla, un bloque):
- Array PRODUCTS con los 4 objetos → render del grid de tienda.
- Cards de beneficios: expandir/colapsar al hover o click (accesible, aria-expanded).
- Menú móvil toggle. Respeta prefers-reduced-motion.

CALIDAD: marca de streetwear AAA — magenta eléctrico, 3D character con carácter, tipografía pesada y
redondeada, cards jugosas, mucho contraste y energía. Accesible: AA en texto, focus-visible magenta,
aria-labels en botones de solo icono, alt en imágenes. Devuélveme UN solo artifact html.
```
