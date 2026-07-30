import { describe, expect, test } from "vitest";
import {
  PREVIEW_CSP,
  PREVIEW_PRELUDE,
  buildUntrustedSrcDoc,
  preparePreviewSnapshot,
} from "./preview-prelude";

// El preview de generación (page-assembling.tsx) pinta HTML CRUDO del modelo
// por doc.write() en un iframe de MISMO ORIGEN (doc.write lo exige). Sin una
// CSP, un <script> que el modelo emitiera bajo prompt-injection corre con el
// origen de openlen.com — cookies, localStorage y API como el usuario. El
// prólogo es lo único que se interpone, así que su forma es load-bearing.

describe("prólogo del preview de generación", () => {
  test("el doctype va PRIMERO — un meta antes lo tiraría a quirks mode", () => {
    expect(PREVIEW_PRELUDE.startsWith("<!doctype html>")).toBe(true);
  });

  test("declara la CSP como meta http-equiv y nada más", () => {
    expect(PREVIEW_PRELUDE).toContain('http-equiv="Content-Security-Policy"');
    expect(PREVIEW_PRELUDE).toContain(PREVIEW_CSP);
    // Sin etiquetas ejecutables propias: el prólogo no es una superficie.
    expect(PREVIEW_PRELUDE).not.toMatch(/<script/i);
  });

  test("script-src permite SOLO el CDN de Tailwind — ni inline ni eval ni otros hosts", () => {
    const scriptSrc = /script-src ([^;]+)/.exec(PREVIEW_CSP)?.[1]?.trim();
    expect(scriptSrc).toBe("https://cdn.tailwindcss.com");
    expect(PREVIEW_CSP).not.toContain("unsafe-inline");
    expect(PREVIEW_CSP).not.toContain("unsafe-eval");
    expect(PREVIEW_CSP).not.toContain("*");
  });

  test("cierra object-src y base-uri (un <base> reescribiría cada URL relativa)", () => {
    expect(PREVIEW_CSP).toContain("object-src 'none'");
    expect(PREVIEW_CSP).toContain("base-uri 'none'");
  });

  test("no restringe estilos: los <style> del modelo son la mitad del diseño", () => {
    expect(PREVIEW_CSP).not.toContain("style-src");
    expect(PREVIEW_CSP).not.toContain("default-src");
  });

  test("las comillas del content no rompen el atributo al interpolarse", () => {
    expect(PREVIEW_CSP).not.toContain('"');
  });
});

// La ruta de CURACIÓN (usuario gratis) pinta plantillas curadas que SÍ llevan
// paleta propia en un carrier (Lume usa ink/lime/cream). Con la CSP a secas la
// perdería y el preview saldría en blanco y negro. Se recupera re-emitiendo el
// carrier con un nonce — pero SOLO si su contenido es JSON puro (JSON no puede
// contener llamadas) y re-serializado desde el objeto parseado, nunca los
// bytes originales.

const CDN = '<script src="https://cdn.tailwindcss.com"></script>';
const carrierDoc = (body: string) =>
  `<!doctype html><html><head><title>t</title>${CDN}<script data-ol-tw="1">${body}</script></head><body><p class="text-lime">x</p></body></html>`;

describe("snapshot de curación: recuperar la paleta sin abrir la puerta", () => {
  test("con carrier válido: nonce en la CSP y re-emisión DESPUÉS del CDN", () => {
    const html = carrierDoc(
      'tailwind.config={"theme":{"extend":{"colors":{"lime":"#A8E40B"}}}}',
    );
    const r = preparePreviewSnapshot(html, "N1");
    expect(r.prelude).toContain("'nonce-N1'");
    expect(r.html).toContain('<script nonce="N1">tailwind.config=');
    expect(r.html).toContain("#A8E40B");
    // El Play CDN pisa window.tailwind al cargar: la config DEBE ir después.
    expect(r.html.indexOf('nonce="N1"')).toBeGreaterThan(
      r.html.indexOf("cdn.tailwindcss.com"),
    );
  });

  test("sin carrier: prólogo plano y html intacto byte a byte", () => {
    const html = `<!doctype html><html><head>${CDN}</head><body>x</body></html>`;
    const r = preparePreviewSnapshot(html, "N1");
    expect(r.prelude).toBe(PREVIEW_PRELUDE);
    expect(r.prelude).not.toContain("nonce");
    expect(r.html).toBe(html);
  });

  test("carrier con CÓDIGO en vez de JSON → no se re-emite y no hay nonce", () => {
    const html = carrierDoc("tailwind.config=alert(1)");
    const r = preparePreviewSnapshot(html, "N1");
    expect(r.prelude).toBe(PREVIEW_PRELUDE);
    expect(r.html).not.toContain('nonce="N1"');
    expect(r.html).toBe(html);
  });

  test("no se confía en los bytes: se re-serializa y todo '<' sale escapado", () => {
    // Un '<' dentro de un valor no puede volverse etiqueta al re-emitirse.
    const html = carrierDoc(
      'tailwind.config={"theme":{"extend":{"colors":{"x":"a<b"}}}}',
    );
    const r = preparePreviewSnapshot(html, "N1");
    const emitted = /<script nonce="N1">([\s\S]*?)<\/script>/.exec(r.html)?.[1];
    expect(emitted).toBeTruthy();
    expect(emitted).not.toContain("<"); // ni un '<' crudo
    expect(emitted).toContain("u003C"); // escapado, igual que injectTwCarrier
  });

  test("sin CDN no se inyecta nada: no habría quién leyera la config", () => {
    const html = `<!doctype html><html><head><script data-ol-tw="1">tailwind.config={"a":1}</script></head><body>x</body></html>`;
    const r = preparePreviewSnapshot(html, "N1");
    expect(r.prelude).toBe(PREVIEW_PRELUDE);
    expect(r.html).toBe(html);
  });

  test("el carrier ORIGINAL se queda sin nonce — lo bloquea la CSP igual", () => {
    const html = carrierDoc(
      'tailwind.config={"theme":{"extend":{"colors":{"lime":"#A8E40B"}}}}',
    );
    const r = preparePreviewSnapshot(html, "N1");
    expect(r.html).toContain('<script data-ol-tw="1">'); // intacto, inerte
    expect(r.html.match(/nonce="N1"/g)).toHaveLength(1); // el nonce va en UNA etiqueta
  });

  test("un <script data-ol-pwn> forjado jamás recibe nonce", () => {
    const html = carrierDoc('tailwind.config={"a":1}').replace(
      "</head>",
      "<script data-ol-pwn>evil()</script></head>",
    );
    const r = preparePreviewSnapshot(html, "N1");
    expect(r.html).toContain("<script data-ol-pwn>evil()</script>");
    expect(/nonce="N1"[^>]*>\s*evil/.test(r.html)).toBe(false);
  });
});

// El chat (ai-design Modo B) dripea al iframe del EDITOR la salida CRUDA del
// modelo, chunk a chunk, antes de que el servidor la sanitice (el sanitize de
// esa ruta corre al final, sobre el `done`). Ese iframe corre con
// allow-same-origin y sin CSP, así que un <script> del modelo ejecutaba con el
// origen de openlen.com. Durante esa ventana el documento se pinta SIN los
// inyectores del editor y CON el prólogo: el usuario mira, no edita.

describe("srcDoc de una ventana no confiable (drip del chat)", () => {
  const MODEL = '<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>';

  test("antepone el prólogo con CSP al HTML del modelo", () => {
    const out = buildUntrustedSrcDoc(MODEL);
    expect(out.startsWith(PREVIEW_PRELUDE)).toBe(true);
    expect(out).toContain(PREVIEW_CSP);
    expect(out.endsWith(MODEL)).toBe(true);
  });

  test("la CSP va ANTES del primer byte del modelo — si no, no rige", () => {
    const hostile = MODEL.replace("<body>", "<body><script>evil()</script>");
    const out = buildUntrustedSrcDoc(hostile);
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<script>evil()"));
  });

  test("no inyecta scripts propios: en esa ventana no hay edición que instrumentar", () => {
    const out = buildUntrustedSrcDoc(MODEL);
    expect(out).not.toMatch(/<script(?![^>]*src=)/i);
  });

  test("no altera el HTML del modelo (se pinta lo que el modelo va emitiendo)", () => {
    const partial = '<!doctype html><html><head><title>a medias';
    expect(buildUntrustedSrcDoc(partial).slice(PREVIEW_PRELUDE.length)).toBe(partial);
  });
});
