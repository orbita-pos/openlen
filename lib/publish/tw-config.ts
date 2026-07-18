import "server-only";
import JSON5 from "json5";

// ─────────────────────────────────────────────────────────────────────────────
// tailwind.config → carrier de datos (fix del bug lume/hovers, 2026-07-17).
//
// El sanitizer borra todo <script> inline — incluida la config del Play CDN
// que DEFINE las clases extendidas (bg-ink, text-lime…) que el markup usa.
// Sin compensación, 53/450 templates del catálogo (y cualquier generación
// donde el modelo emita config) pierden su paleta al ingerir: fondos que
// desaparecen, blanco-sobre-blanco, hovers rotos.
//
// El contrato: la config JAMÁS pasa como JS del usuario. Se parsea como
// LITERAL (json5, sin eval), se filtra por un allowlist de theme.extend con
// valores primitivos, y se re-emite como un <script data-ol-tw> generado por
// nosotros desde el JSON validado — bytes nuestros. El preview del editor lo
// ejecuta (el Play CDN lee tailwind.config); el bake del publish lo LEE como
// datos para compilar theme.extend real y lo retira del HTML final.
//
// Todo lo que no pase el validador se descarta: quedamos como hoy, nunca peor.
// ─────────────────────────────────────────────────────────────────────────────

export type TwExtendValue =
  | string
  | number
  | TwExtendValue[]
  | { [key: string]: TwExtendValue };

export type TwExtend = Record<string, Record<string, TwExtendValue>>;

export interface ExtractResult {
  html: string;
  extend: TwExtend | null;
}

// Secciones de theme.extend que viajan. Fuera del set = se ignora (screens
// alteraría los breakpoints core; plugins/presets/content ni se consideran).
const ALLOWED_SECTIONS = new Set([
  "colors",
  "fontFamily",
  "fontSize",
  "letterSpacing",
  "lineHeight",
  "borderRadius",
  "boxShadow",
  "dropShadow",
  "spacing",
  "maxWidth",
  "animation",
  "keyframes",
  "backgroundImage",
  "gradientColorStops",
  "transitionTimingFunction",
  "transitionDuration",
  "zIndex",
  "opacity",
  "blur",
]);

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
// Claves de secciones/entradas: nombres de utilidades y de pasos de keyframes
// ("0%, 100%") y propiedades CSS. Nada exótico.
const KEY_RE = /^[\w.,%()#/\s-]{1,80}$/;
const VALUE_MAX_LEN = 400;
const MAX_NODES = 600;
const MAX_DEPTH = 4;
const MAX_SERIALIZED_BYTES = 20_000;
const HOSTILE_VALUE_RE =
  /javascript:|expression\s*\(|<\s*\/?\s*script|url\s*\(\s*['"]?\s*(?:javascript|data:text\/html)|data-slot-path\s*=/i;
// ↑ data-slot-path: el marcador de modo-editor. Como extractTwConfig corre
// ANTES del gate slot-path de Rust (que ya no ve el script de la config), un
// valor con el marcador se colaría al carrier → a la DB. Rechazarlo aquí lo
// mata en la validación (invariante #4; cazado en el security review).

function validValue(v: unknown, depth: number, budget: { nodes: number }): TwExtendValue | undefined {
  if (budget.nodes-- <= 0 || depth > MAX_DEPTH) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    if (v.length > VALUE_MAX_LEN) return undefined;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(v)) return undefined;
    if (HOSTILE_VALUE_RE.test(v)) return undefined;
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length > 24) return undefined;
    const out: TwExtendValue[] = [];
    for (const item of v) {
      const ok = validValue(item, depth + 1, budget);
      if (ok === undefined) return undefined; // un tuple a medias no sirve
      out.push(ok);
    }
    return out;
  }
  if (v !== null && typeof v === "object") {
    const out: Record<string, TwExtendValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k) || !KEY_RE.test(k)) continue;
      const ok = validValue(val, depth + 1, budget);
      if (ok !== undefined) out[k] = ok;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

function validateExtend(raw: unknown): TwExtend | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const budget = { nodes: MAX_NODES };
  const out: TwExtend = {};
  for (const [section, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_SECTIONS.has(section)) continue;
    const ok = validValue(value, 1, budget);
    if (ok !== undefined && typeof ok === "object" && !Array.isArray(ok)) {
      out[section] = ok as Record<string, TwExtendValue>;
    }
  }
  if (Object.keys(out).length === 0) return null;
  if (JSON.stringify(out).length > MAX_SERIALIZED_BYTES) return null;
  return out;
}

// Escanea el objeto literal desde el primer `{` tras `tailwind.config =`,
// respetando strings y comentarios. Backtick = template literal = ejecutable
// en potencia → se aborta ese script (config inválida).
function scanObjectLiteral(src: string, start: number): string | null {
  let depth = 0;
  let i = start;
  type Mode = "code" | "squote" | "dquote" | "line" | "block";
  let mode: Mode = "code";
  for (; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === "code") {
      if (c === "`") return null;
      if (c === "'") mode = "squote";
      else if (c === '"') mode = "dquote";
      else if (c === "/" && next === "/") { mode = "line"; i++; }
      else if (c === "/" && next === "*") { mode = "block"; i++; }
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      }
    } else if (mode === "squote") {
      if (c === "\\") i++;
      else if (c === "'") mode = "code";
    } else if (mode === "dquote") {
      if (c === "\\") i++;
      else if (c === '"') mode = "code";
    } else if (mode === "line") {
      if (c === "\n") mode = "code";
    } else if (mode === "block") {
      if (c === "*" && next === "/") { mode = "code"; i++; }
    }
  }
  return null;
}

const CONFIG_ASSIGN_RE = /(?:^|[\s;])tailwind\.config\s*=/;
// Carrier reconocible sobre un openTag ya aislado (no sobre el HTML entero:
// un `([\s\S]*?)</script>` global retrocede O(n²) con muchos <script sin
// cerrar → DoS del event loop; cazado en el security review 2026-07-17).
const CARRIER_ATTR_RE = /\bdata-ol-tw\b/i;
const HAS_SRC_RE = /\bsrc\s*=/i;

// Recorre los <script>…</script> del HTML de forma LINEAL (indexOf, sin
// backtracking). Por cada script inline (sin src) llama a onInline con su
// openTag + cuerpo; devolver un string lo REEMPLAZA (y marca touched);
// devolver null lo PRESERVA byte-exacto (para dejar que el sanitizer de Rust
// lo maneje/cuente). Los scripts CON src (el CDN) siempre se preservan. Un
// <script sin </script> se trata como resto del documento.
function rewriteInlineScripts(
  html: string,
  onInline: (openTag: string, body: string) => string | null,
): { out: string; touched: boolean } {
  const lower = html.toLowerCase();
  let out = "";
  let touched = false;
  let i = 0;
  while (i < html.length) {
    const open = lower.indexOf("<script", i);
    if (open === -1) {
      out += html.slice(i);
      break;
    }
    // El char tras "<script" debe delimitar la etiqueta (espacio, >, /) —
    // evita casar <scripting> u otros.
    const after = html[open + 7];
    if (after !== undefined && !/[\s/>]/.test(after)) {
      out += html.slice(i, open + 7);
      i = open + 7;
      continue;
    }
    const gt = html.indexOf(">", open);
    if (gt === -1) {
      out += html.slice(i);
      break;
    }
    const openTag = html.slice(open, gt + 1);
    out += html.slice(i, open); // texto antes del <script
    const bodyStart = gt + 1;
    const close = lower.indexOf("</script", bodyStart);
    const closeEnd = close === -1 ? html.length : (html.indexOf(">", close) + 1 || html.length);
    const body = html.slice(bodyStart, close === -1 ? html.length : close);
    const original = html.slice(open, closeEnd);

    if (HAS_SRC_RE.test(openTag)) {
      out += original; // preservar (p.ej. el CDN)
    } else {
      const rep = onInline(openTag, body);
      if (rep === null) {
        out += original; // preservar byte-exacto
      } else {
        out += rep;
        touched = true;
      }
    }
    if (close === -1) break;
    i = closeEnd;
  }
  return { out, touched };
}

function readCarrierBody(body: string): TwExtend | null {
  const eq = body.indexOf("=");
  if (eq === -1) return null;
  try {
    const parsed = JSON.parse(body.slice(eq + 1).trim()) as {
      theme?: { extend?: unknown };
    };
    // Formato válido de config (theme.extend) — el que el CDN lee. Fallback al
    // objeto plano por si sobrevive un carrier del formato transitorio viejo.
    return validateExtend(parsed?.theme?.extend ?? parsed);
  } catch {
    return null;
  }
}

function parseConfigScript(body: string): TwExtend | null {
  const assign = CONFIG_ASSIGN_RE.exec(body);
  if (!assign) return null;
  const braceStart = body.indexOf("{", assign.index + assign[0].length);
  if (braceStart === -1) return null;
  const literal = scanObjectLiteral(body, braceStart);
  if (literal === null) return null;
  // Si tras el objeto hay más código que un cierre trivial, la config hace
  // algo más que declarar datos → inválida (p.ej. `tailwind.config={…}; hack()`).
  const tail = body.slice(braceStart + literal.length).replace(/[\s;]/g, "");
  if (tail.length > 0) return null;
  const head = body.slice(0, assign.index).replace(/[\s;]/g, "");
  if (head.length > 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON5.parse(literal);
  } catch {
    return null;
  }
  const theme = (parsed as { theme?: { extend?: unknown } })?.theme;
  return validateExtend(theme?.extend);
}

/**
 * Extrae (y remueve) toda fuente de tailwind.config del HTML — el script
 * original del template Y nuestro propio carrier (para round-trips por
 * re-sanitize). Devuelve el primer extend VÁLIDO; los scripts se remueven
 * siempre (válidos o no: son JS inline y el sanitizer los mataría igual).
 * HTML sin fuentes → se devuelve intacto (byte-igual).
 */
export function extractTwConfig(html: string): ExtractResult {
  let extend: TwExtend | null = null;

  const { out, touched } = rewriteInlineScripts(html, (openTag, body) => {
    // Solo tocamos el carrier propio y los scripts de config del template;
    // cualquier OTRO script inline se PRESERVA (null) para que el sanitizer
    // de Rust lo maneje y lo CUENTE (la lógica de avisos depende de ese conteo).
    if (CARRIER_ATTR_RE.test(openTag)) {
      if (extend === null) extend = readCarrierBody(body);
      return "";
    }
    if (CONFIG_ASSIGN_RE.test(body)) {
      if (extend === null) extend = parseConfigScript(body);
      return "";
    }
    return null; // no es config → preservar byte-exacto
  });

  return { html: touched ? out : html, extend };
}

const CDN_TAG_RE =
  /<script\b[^>]*\bsrc\s*=\s*"https:\/\/cdn\.tailwindcss\.com[^"]*"[^>]*>\s*<\/script\s*>/i;

/** Inyecta el carrier (bytes nuestros desde JSON validado). Tras el CDN si
 *  existe — el patrón oficial del Play CDN — o antes de </head>. El JSON es una
 *  config VÁLIDA de Tailwind ({theme:{extend}}) para que el CDN del preview la
 *  lea tal cual; el bake la vuelve a extraer con readTwCarrier. Sin el wrapper
 *  theme.extend el CDN ignora los colores (preview blanco-sobre-blanco aunque
 *  el bake funcione — cazado por Jesús 2026-07-18). */
export function injectTwCarrier(html: string, extend: TwExtend): string {
  const json = JSON.stringify({ theme: { extend } }).replace(/</g, "\\u003C");
  const tag = `<script data-ol-tw="1">tailwind.config=${json}</script>`;
  const cdn = CDN_TAG_RE.exec(html);
  if (cdn) {
    const end = cdn.index + cdn[0].length;
    return html.slice(0, end) + tag + html.slice(end);
  }
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, (close) => `${tag}${close}`);
  }
  return tag + html;
}

/** Lee el extend del carrier. Re-valida SIEMPRE (defensa en profundidad:
 *  un from-html podría traer un carrier forjado a mano). Escaneo lineal. */
export function readTwCarrier(html: string): TwExtend | null {
  let result: TwExtend | null = null;
  rewriteInlineScripts(html, (openTag, body) => {
    if (result === null && CARRIER_ATTR_RE.test(openTag)) {
      result = readCarrierBody(body);
    }
    return null; // solo lectura; no modificamos nada
  });
  return result;
}

/** Quita SOLO el carrier; preserva byte-exacto cualquier otro script y el CDN. */
export function stripTwCarrier(html: string): string {
  return rewriteInlineScripts(html, (openTag) =>
    CARRIER_ATTR_RE.test(openTag) ? "" : null,
  ).out;
}
