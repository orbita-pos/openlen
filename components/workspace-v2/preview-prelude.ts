// Prólogo del preview de generación (hallazgo de Jesús, 2026-07-29).
//
// PageAssembling pinta el HTML CRUDO del modelo, token a token, con
// doc.write() sobre contentDocument — y eso EXIGE mismo origen, así que
// quitar `allow-same-origin` no es una opción ahí (rompería el streaming
// progresivo, que es toda la superficie "mira cómo nace tu página").
//
// El riesgo es real: el brief entra por ?mode=ai&brief=…&autostart=1, o sea
// que un link enviado a una víctima puede envenenar lo que el modelo emite.
// Un <script> suyo corría con el origen de openlen.com — cookies, localStorage
// y la API como el usuario logueado. Que después no se persista da igual: ya
// se ejecutó al pintarse.
//
// Solución: el navegador lo prohíbe, no un filtro nuestro. Este prólogo se
// escribe ANTES del primer byte del modelo, así que la política ya rige
// cuando el parser llega a su primer <script>. Cero costo en la ruta caliente
// (una escritura por documento) y sin parser propio que alguien pueda evadir.
//
// Medido en navegador (scratch/csp-prelude-probe.mts):
//   · sin CSP  → el script forjado EJECUTA (window.__pwn, document.title)
//   · con esta → bloqueado; el CDN de Tailwind sigue compilando (p-4=16px,
//     text-2xl=24px) y el contenido pinta igual. 'unsafe-eval' NO hace falta.
//
// Contrapartida conocida: el `tailwind.config` inline del modelo tampoco
// corre, así que una paleta declarada ahí muestra colores base DURANTE el
// streaming (en el editor sí sale, vía el carrier). Es un costo mínimo
// medido: el contrato de generación (lib/design-guidance.ts) manda tokens
// :root + var(), no paletas de config — 4/4 páginas generadas reales en prod
// tienen CERO clases de paleta propia y cientos de var(--…).

/** `script-src` cerrado al CDN de Tailwind: sin inline, sin eval, sin otros
 *  hosts. Los estilos quedan libres a propósito — los <style> del modelo son
 *  la mitad del diseño y no ejecutan código. */
export const PREVIEW_CSP =
  "script-src https://cdn.tailwindcss.com; object-src 'none'; base-uri 'none'";

/** Doctype PRIMERO (un meta antes lo tiraría a quirks mode y cambiaría el
 *  layout que el usuario está viendo nacer), luego la política. El <html> que
 *  emita el modelo después se fusiona con el elemento ya abierto. */
export const PREVIEW_PRELUDE = buildPrelude(PREVIEW_CSP);

function buildPrelude(csp: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}">`;
}

// ── Snapshot de curación ────────────────────────────────────────────────────
//
// La ruta gratis (/api/curate) pinta plantillas curadas, y esas SÍ declaran su
// paleta en un carrier (Lume = ink/lime/cream). Con la CSP a secas el carrier
// tampoco corre y el preview saldría en blanco y negro — una regresión visible
// justo en el camino del usuario gratis.
//
// Se recupera re-emitiendo el carrier con un nonce, bajo tres condiciones que
// lo mantienen cerrado:
//   1. Su contenido debe ser `tailwind.config=` + algo que JSON.parse acepte.
//      JSON no puede contener llamadas, así que lo que se re-emite es
//      probablemente inerte por construcción (misma regla que readCarrierBody).
//   2. Se re-emite desde el objeto PARSEADO, nunca los bytes originales, con
//      los '<' escapados — igual que injectTwCarrier.
//   3. El nonce lo generamos nosotros por documento y va en UNA sola etiqueta.
//      El carrier original se queda sin él: la CSP lo bloquea igual.
//
// Solo para el snapshot (documento completo de una vez). El streaming bespoke
// no lo necesita: el contrato de generación usa tokens :root + var(), no
// paletas de config (4/4 páginas generadas reales en prod, cero clases de
// paleta propia).
const CARRIER_RE = /<script data-ol-tw\b[^>]*>\s*tailwind\.config\s*=([\s\S]*?)<\/script>/i;
const CDN_TAG_RE =
  /<script\b[^>]*\bsrc\s*=\s*["']https:\/\/cdn\.tailwindcss\.com[^"']*["'][^>]*>\s*<\/script\s*>/i;

export interface PreviewSnapshot {
  /** Prólogo a escribir ANTES del primer byte del modelo. */
  prelude: string;
  /** HTML a escribir después (con el carrier re-emitido si aplicaba). */
  html: string;
}

/** Prepara un documento COMPLETO para el preview. `nonce` se inyecta solo para
 *  hacerlo determinista en tests; en producción se genera aquí. */
export function preparePreviewSnapshot(
  html: string,
  nonce: string = randomNonce(),
): PreviewSnapshot {
  const carrier = CARRIER_RE.exec(html);
  const cdn = CDN_TAG_RE.exec(html);
  // Sin CDN no hay quién lea la config: re-emitirla sería un script inerte.
  if (!carrier || !cdn) return { prelude: PREVIEW_PRELUDE, html };

  let parsed: unknown;
  try {
    parsed = JSON.parse(carrier[1].trim());
  } catch {
    return { prelude: PREVIEW_PRELUDE, html }; // no era JSON puro → no se toca
  }
  const json = JSON.stringify(parsed).replace(/</g, "\\u003C");
  const tag = `<script nonce="${nonce}">tailwind.config=${json}</script>`;
  // Después del CDN: el Play CDN pisa window.tailwind al cargar.
  const at = cdn.index + cdn[0].length;
  return {
    prelude: buildPrelude(`script-src https://cdn.tailwindcss.com 'nonce-${nonce}'; object-src 'none'; base-uri 'none'`),
    html: html.slice(0, at) + tag + html.slice(at),
  };
}

function randomNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
