// Publish-time in-page maps for Google Maps links.
//
// MODELO DE SEGURIDAD — el mismo que `video-embed.ts`, y por los mismos motivos:
// el CSP de la página publicada pina `frame-src` a los orígenes exactos que
// construye ESTE fichero (`seal.rs`), así que cualquier otro iframe lo bloquea
// la propia política de la página. El saneador quita los iframes del HTML del
// usuario; este horneado corre DESPUÉS de sanear y ANTES de sellar, y el sellado
// no toca iframes — por eso el mapa que inyectamos sobrevive y carga.
//
// NUNCA metemos una URL del creador dentro de un `src`. Se extrae la consulta en
// el servidor (lista blanca de host EXACTA + limpieza de caracteres) y el runtime
// reconstruye el embebido desde un origen FIJO con esa consulta ya validada.
//
// POR QUÉ FACHADA Y NO IFRAME DIRECTO: un iframe de Google cargado en cada visita
// son ~1 MB y cookies de Google en la página de todos los visitantes. Con la
// fachada no se hace NI UNA petición a Google hasta que alguien pulsa. El enlace
// original se conserva, así que sin JavaScript sigue llevando a Google Maps.
//
// VERIFICADO el 2026-08-23 con Chrome real: `?output=embed` redirige 301 a
// `www.google.com/maps/embed` —mismo origen, un solo `frame-src` cubre las dos—
// y pinta el mapa sin ninguna clave de API (24 peticiones de tiles, 0 errores).

/** Hosts que pueden llevar un mapa. EXACTOS: `google.com.evil.com` no entra. */
const MAP_HOSTS = new Set(["maps.google.com", "www.google.com", "google.com"]);

/** El origen FIJO desde el que se construye el embebido. Nunca sale del creador. */
const EMBED_ORIGIN = "https://www.google.com";

/** El origen que este horneado mete en un <iframe>. Pinado en `frame-src` por
 *  `seal.rs`; `frame-origins.test.ts` vigila que las dos listas no se separen. */
export const MAP_FRAME_ORIGINS: readonly string[] = [EMBED_ORIGIN];

/**
 * Lo que se permite dentro de una dirección, y nada más.
 *
 * Una consulta de mapa es texto libre (una dirección), al revés que el id de
 * vídeo, que es `[A-Za-z0-9_-]{11}` y no necesita limpieza. Aquí hay que
 * limpiar: se aceptan letras —acentos y ñ incluidos—, dígitos, espacios y la
 * puntuación que aparece en direcciones de verdad. Todo lo demás CAE, incluidos
 * `<`, `>`, `"` y `&`, que son justo los que podrían escaparse del atributo.
 */
const PERMITIDO = /[^\p{L}\p{N} ,.\-#/()'’ºª+]/gu;
const MAX_CONSULTA = 200;

/** Limpia y acota. Devuelve null si no queda nada utilizable. */
function limpiarConsulta(raw: string): string | null {
  const limpia = raw
    .replace(PERMITIDO, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONSULTA)
    .trim();
  // Una consulta de dos caracteres no es una dirección: sería un mapa del mundo
  // con un pin en cualquier parte, que es peor que no poner mapa.
  return limpia.length >= 4 ? limpia : null;
}

/**
 * Saca la consulta de una URL de Google Maps del creador, o null.
 *
 * Espejo de `extractVideoId`. Estricto a propósito:
 * - host EXACTO de la lista;
 * - en `google.com` / `www.google.com` la ruta TIENE que empezar por `/maps`,
 *   porque ese host sirve medio internet y `?q=` es también la búsqueda normal;
 * - los enlaces cortos (`maps.app.goo.gl`) se RECHAZAN: sin resolver la
 *   redirección no sabemos a dónde apuntan, y resolverla sería una petición de
 *   red en la ruta de publicación. El `<a>` se queda tal cual y sigue llevando
 *   al mapa; simplemente no se hornea.
 */
export function extractMapQuery(raw: string): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const host = u.hostname.toLowerCase();
  if (!MAP_HOSTS.has(host)) return null;
  if (host !== "maps.google.com" && !/^\/maps(\/|$)/.test(u.pathname)) return null;

  // `?q=` es la forma que ya emite `lib/business-profiles/contact-widget.ts:82`.
  const q = u.searchParams.get("q") ?? u.searchParams.get("query");
  if (q) return limpiarConsulta(q);

  // `/maps/place/<nombre>` — la que sale de copiar la barra de direcciones.
  const segs = u.pathname.split("/").filter(Boolean);
  const i = segs.indexOf("place");
  if (i !== -1 && segs[i + 1]) {
    try {
      return limpiarConsulta(decodeURIComponent(segs[i + 1]).replace(/\+/g, " "));
    } catch {
      return limpiarConsulta(segs[i + 1].replace(/\+/g, " "));
    }
  }
  return null;
}

/** La URL canónica del embebido, construida SÓLO con la consulta ya validada. */
export function buildMapEmbedUrl(query: string): string {
  return `${EMBED_ORIGIN}/maps?q=${encodeURIComponent(query)}&output=embed`;
}

/** Escapa para un atributo entre comillas dobles. La limpieza de arriba ya quita
 *  estos caracteres; esto es la segunda mitad del cinturón. */
function attr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const MAP_CSS =
  `[data-ol-map]{cursor:pointer}` +
  `[data-ol-map-frame]{margin-top:12px;width:100%;aspect-ratio:16/10;border-radius:12px;overflow:hidden;background:#e8eaed;box-shadow:0 1px 3px rgba(0,0,0,.12)}` +
  `[data-ol-map-frame] iframe{width:100%;height:100%;border:0;display:block}`;

// Runtime ESTÁTICO — los datos por mapa viven en el atributo del ancla, así que
// su sha256 no cambia entre publicaciones y el sellado sigue siendo idempotente.
// Mismo motivo que el runtime del vídeo; está escrito en su cabecera.
//
// La comprobación de caracteres se repite AQUÍ además de en el servidor: es la
// misma doble validación que hace el runtime del vídeo con su id.
const MAP_JS =
  `(function(){` +
  `function abrir(a,q){` +
  `var n=a.nextElementSibling;` +
  `if(n&&n.hasAttribute("data-ol-map-frame")){n.remove();return;}` +
  `if(!/^[\\p{L}\\p{N} ,.\\-#/()'’ºª+]{4,200}$/u.test(q))return;` +
  `var d=document.createElement("div");d.setAttribute("data-ol-map-frame","");` +
  `var f=document.createElement("iframe");` +
  `f.src="${EMBED_ORIGIN}/maps?q="+encodeURIComponent(q)+"&output=embed";` +
  `f.setAttribute("loading","lazy");f.setAttribute("referrerpolicy","no-referrer-when-downgrade");` +
  `f.setAttribute("title","Mapa");f.setAttribute("allowfullscreen","");` +
  `d.appendChild(f);a.parentNode.insertBefore(d,a.nextSibling);` +
  `d.scrollIntoView({behavior:"smooth",block:"nearest"});` +
  `}` +
  `document.addEventListener("click",function(e){` +
  `var t=e.target;var a=t&&t.closest?t.closest("[data-ol-map]"):null;if(!a)return;` +
  `var q=a.getAttribute("data-ol-map")||"";if(!q)return;` +
  `e.preventDefault();abrir(a,q);` +
  `});` +
  `})();`;

const MARKER = "data-ol-map-embed";

/**
 * Marca cada `<a href>` a Google Maps con su consulta ya validada e inyecta el
 * CSS + el runtime de la fachada.
 *
 * El `href` se CONSERVA: sin JavaScript el enlace sigue llevando a Google Maps
 * (mejora progresiva, idéntico al vídeo). Sin enlaces reconocidos, o ya
 * horneado, devuelve el HTML BYTE A BYTE igual.
 */
export function bakeMapEmbeds(html: string): string {
  if (html.includes(MARKER)) return html;

  let marcados = 0;
  const out = html.replace(/<a\b([^>]*)>/gi, (full, attrs: string) => {
    if (/\bdata-ol-map\s*=/i.test(attrs)) return full;
    const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!m) return full;
    const href = (m[2] ?? m[3] ?? "").trim();
    // El href viaja escapado dentro del HTML; sin des-escapar, un `&amp;` parte
    // la query y `?q=` se pierde.
    const query = extractMapQuery(href.replace(/&amp;/gi, "&"));
    if (!query) return full;
    marcados++;
    return `<a data-ol-map="${attr(query)}"${attrs}>`;
  });

  if (marcados === 0) return html;

  // SIN `<link rel="preconnect">`, a propósito, y esto merece explicación
  // porque `video-embed.ts` sí lo pone.
  //
  // MEDIDO el 2026-08-23: el recolector de orígenes del sellado clasifica
  // CUALQUIER `<link href>` como origen de ESTILOS, sin mirar el `rel`. Un
  // preconnect a Google metía `https://www.google.com` dentro de `style-src`
  // —permitiendo hojas de estilo desde Google, que nadie usa—. El vídeo arrastra
  // ese mismo defecto desde antes (`style-src … https://www.youtube-nocookie.com`),
  // y el arreglo de verdad está en Rust: mirar el `rel` antes de clasificar.
  //
  // Mientras tanto no se añade un tercer caso. Lo que compra el preconnect es un
  // saludo TLS (~200 ms) en un clic que el usuario ACABA de dar; lo que cuesta es
  // un origen de más en el CSP. Así el mapa toca UNA sola directiva: `frame-src`.
  const style = `<style ${MARKER}>${MAP_CSS}</style>`;
  const script = `<script ${MARKER}>${MAP_JS}</script>`;

  const headClose = /<\/head\s*>/i;
  let withStyle = headClose.test(out)
    ? out.replace(headClose, (c) => `${style}${c}`)
    : out.replace(/<body\b[^>]*>/i, (b) => `${b}${style}`);
  if (!headClose.test(out) && !/<body\b/i.test(out)) withStyle = style + out;

  const idx = withStyle.lastIndexOf("</body>");
  return idx === -1
    ? withStyle + script
    : withStyle.slice(0, idx) + script + withStyle.slice(idx);
}
