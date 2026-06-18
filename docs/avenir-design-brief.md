# AVENIR — brief de diseño para claude.ai (claude design) · estilo Tesla

Página de producto de un **coche eléctrico de lujo** estilo la web del Tesla Model S — minimalismo,
foto a sangre completa, tipografía limpia y ligera, mucho aire, secciones blanco/oscuro alternadas,
un único acento azul, banda de stats, carruseles e imágenes inmersivas. Marca ORIGINAL: **AVENIR**,
modelo flagship **Aurora**. Familia de galería: `hardware`. Slug: `avenir`.

## ⚠️ REGLA DE ORO (feedback del user)
Las **fotos del coche** van como IMÁGENES (`<img>`). El **wordmark "AVENIR"** y el nombre del modelo
sí son texto CSS (tipografía con tracking, como el "TESLA" — es texto, no un emblema). No hay logo
emblema que dibujar. Todas las imágenes llevan su fondo (NO transparentes).

## Cómo usarlo
1. claude.ai → modelo Opus más reciente. Pega el bloque PROMPT entero. Pide UN artifact `text/html`.
2. **Importante:** si te lo da como descarga "bundled" (etiquetas `<x-dc>`, ~400KB), pídele el código
   limpio: *"dame el HTML completo en un único bloque ```html``` (no artifact, sin bundler)"*.
3. Pásame el `.html`. Las imágenes salen de `docs/avenir-image-prompts.md` (ChatGPT, fotos de coche).

> Imágenes reales vía `<img src="https://images.openlen.com/avenir/<slug>.webp">` (todas CON fondo):
> hero, interior, cockpit, screen, rear, trunk, wheel, aero, light, aerial. Mientras no existan, cae a fallback.

---

## PROMPT (pégalo entero en claude.ai)

```
Diseña UNA landing premium, en UN solo artifact de tipo `text/html` (NO React, NO JSX, NO MDX, NO
bundler, NO etiquetas <x-dc>). Es la página de producto de un coche eléctrico de lujo ORIGINAL
llamado AVENIR Aurora. Toma como referencia de ESTRUCTURA y minimalismo la web del Tesla Model S:
foto cinematográfica a sangre completa, tipografía limpia y ligera, muchísimo aire en blanco, un
único acento azul, banda de stats con números enormes, e imágenes inmersivas con carruseles.

⚠️ Las fotos del coche son IMÁGENES (`<img>`). El wordmark "AVENIR" y el nombre del modelo son TEXTO
CSS con letter-spacing (estilo el wordmark de Tesla). No dibujes emblemas/logos en SVG.

FORMATO DE SALIDA:
- Un único archivo `<!doctype html>` self-contained.
- Tailwind por CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts por <link> en <head>: Manrope (400,500,600,700) + Inter (400,500,600,700).
- Todo el CSS propio inline en <style> en <head>. JS vanilla en UN <script> al final (menú móvil +
  carruseles con flechas + scroll-snap). Sin frameworks.
- NO uses `data-slot-path=`. NO login real/dashboard (los iconos de cuenta/idioma son decorativos).
- Copy real en ESPAÑOL. Nada de Lorem ipsum. Números específicos y creíbles (métricos).
- Responsive desde 360px. Transiciones suaves (120-200ms). Una sola moda: CLARA (base blanca). Sin toggle.

DESIGN TOKENS (contrato OpenLen — todo color/radio/fuente sale de una var; nada de hex crudo fuera de
:root salvo texturas rgba neutras y atributos de SVG). --fg-muted/--fg-faint DEBEN pasar AA (≥4.5:1).
  --bg:#FFFFFF;
  --surface:#F4F4F4;
  --surface-2:#EAEAEA;
  --fg:#181A1F;            /* casi negro */
  --fg-muted:#5C5E63;
  --fg-faint:#74767C;      /* AA-safe sobre blanco */
  --border:rgba(0,0,0,0.10);
  --border-strong:rgba(0,0,0,0.22);
  --accent:#2C5BE6;        /* azul eléctrico — ÚNICO acento (botón CTA) */
  --accent-r:44,91,230;
  --accent-ink:#FFFFFF;    /* texto SOBRE el azul */
  --dark:#16181D;          /* fondo de las secciones oscuras */
  --dark-fg:#F4F4F6;       /* texto sobre --dark */
  --dark-muted:#A9ABB2;    /* muted sobre --dark (AA) */
  --radius:6px;
  --font-display:'Manrope', sans-serif;
  --font-body:'Inter', system-ui, sans-serif;
- UN solo acento = azul (--accent): el botón principal, links activos, detalles. Lo demás es B/N + grises.
- Titulares en --font-display, peso medio (500-600), grandes y limpios, tracking ligeramente negativo.
  El wordmark "AVENIR" del nav: mayúsculas con letter-spacing ~0.35em (look Tesla).

ESTRUCTURA (en este orden):

1) NAV transparente sobre el hero (se vuelve sólida blanca al hacer scroll si puedes, si no, fija
   translúcida): izq wordmark "AVENIR" (texto, tracking ancho, blanco sobre el hero). Centro: enlaces
   "Modelos · Carga · Energía · Descubre · Tienda". Der: 3 iconos SVG (ayuda ?, idioma 🌐, cuenta 👤).
   Hamburguesa en móvil.

2) HERO a sangre completa (min-height 100svh): el <img> `hero` (coche en carretera escénica) de fondo
   (object-cover) + un degradado oscuro arriba para que el nav y el texto se lean. Centrado-arriba:
   el nombre del modelo "Aurora" gigante en blanco (Manrope, peso 600, clamp grande), un subtítulo
   corto ("Gran turismo eléctrico") y dos botones: "Ver inventario" (relleno azul --accent) y
   "Reservar" (relleno blanco translúcido o outline). Abajo, un chevron de "scroll".

3) STATS (banda blanca, mucho aire): 3 métricas enormes en una fila con separadores verticales finos.
   Número grande en --fg + unidad pequeña al lado + label debajo en --fg-muted:
   - "660" km — "Autonomía (WLTP)"
   - "2,1" s — "0–100 km/h"
   - "1.020" cv — "Potencia máxima"

4) INTERIOR a sangre completa: el <img> `interior` (cabina clara, pantalla central, vistas al exterior)
   ocupando el ancho, con un titular discreto encima o debajo ("El interior, reinventado").

5) "INTERIOR DE OTRO NIVEL" (carrusel): título centrado. Carrusel horizontal scroll-snap de tarjetas
   de imagen (slides: `cockpit`, `screen`, `rear`, `interior`), con un caption por slide y botones de
   flecha ‹ › (accesibles, aria-label). Una pequeña barra inferior estética "Pregunta algo".

6) CARRUSEL DE CARACTERÍSTICAS: tarjetas grandes imagen-arriba / texto-abajo, scroll-snap + flechas:
   - `trunk` — "Guárdalo todo" — "Portón trasero manos libres y maletero gigante; asientos abatibles para llevar la bici, el equipaje y más."
   - `rear` — "Siempre conectado" — "Pantalla trasera, Bluetooth y conectividad de segunda fila para que cada viaje sea suyo."
   - `cockpit` — "Sonido de estudio" — "Sistema envolvente de 22 altavoces con audio inmersivo y cancelación activa de ruido."

7) DETALLES (sección OSCURA --dark): un trío de imágenes en grid (3 col desktop, scroll/stack móvil),
   cada una con título + descripción corta en --dark-fg/--dark-muted:
   - `wheel` — "Rendimiento optimizado" — "Llantas y neumáticos escalonados + frenos cerámicos para un agarre y una frenada de otro nivel."
   - `aero` — "Aerodinámica avanzada" — "Detalles exteriores que reducen la resistencia y un alerón que mejora la eficiencia y la estabilidad."
   - `light` — "Faros adaptativos" — "Los faros reaccionan a la vía y al tráfico para máxima visibilidad sin deslumbrar."

8) "VE A CUALQUIER PARTE" (Go Anywhere): el <img> `aerial` (vista aérea del coche en una carretera de
   montaña junto a un lago) grande, y debajo un bloque con titular + párrafo + 3 mini-stats
   ("660 km Autonomía", "15 min Recarga +280 km", "12.500 Supercargadores") + botón azul "Planifica tu ruta".

9) FOOTER minimalista (gris claro): grid de columnas de enlaces (Modelos · Carga · Energía · Empresa ·
   Legal), wordmark "AVENIR", selector de idioma y "© AVENIR. Todos los derechos reservados."

IMÁGENES (cablea las URLs; todas CON fondo):
- hero:     https://images.openlen.com/avenir/hero.webp     (exterior en carretera, a sangre)
- interior: https://images.openlen.com/avenir/interior.webp (cabina clara amplia)
- cockpit / screen / rear: https://images.openlen.com/avenir/<slug>.webp (carrusel interior)
- trunk / : feature "Guárdalo todo"
- wheel / aero / light: trío de detalles (sección oscura)
- aerial:   https://images.openlen.com/avenir/aerial.webp   (aéreo carretera de montaña)
- FALLBACK para CADA <img>: detrás un relleno --surface (o --dark en la sección oscura) + al <img>
  onerror="this.style.opacity=0", para que sin las fotos el layout siga limpio.

JS (vanilla, un bloque):
- Carruseles: contenedor con overflow-x + scroll-snap; los botones ‹ › hacen scrollBy de un slide;
  estado de flechas según posición. Accesible (role/aria-label). Respeta prefers-reduced-motion.
- Menú móvil toggle (aria-expanded). Nav que se vuelve sólida al scrollear (opcional, IntersectionObserver).

CALIDAD: página de coche premium AAA — minimalista, fotográfica, blanca y luminosa con un azul
preciso, números enormes, secciones a sangre, carruseles suaves. Accesible: AA en texto,
focus-visible azul, aria-labels en iconos/flechas, alt descriptivo en imágenes. UN solo artifact html.
```
