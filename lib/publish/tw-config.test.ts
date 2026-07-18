import { describe, expect, test } from "vitest";
import {
  extractTwConfig,
  injectTwCarrier,
  readTwCarrier,
  stripTwCarrier,
} from "./tw-config";

// Unit puro del módulo (sin binding nativo — la integración con
// sanitizeForPublish + bakeTailwind vive en tw-config-pipeline.test.ts
// bajo node:test, ver el split de runners en vitest.config.ts).

const LUME_LIKE = `<!doctype html><html><head>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          cream: '#FBFBF6',
          lime: '#A8E40B',
          ink: '#0A0A0A',
        },
        fontFamily: {
          display: ['"Archivo Black"', 'Inter', 'sans-serif'],
        },
      },
    },
  }
</script>
</head><body>
<section class="bg-ink text-white"><div class="text-lime">0g</div></section>
</body></html>`;

describe("extractTwConfig", () => {
  test("extrae y valida el extend de un config real (llaves anidadas balanceadas)", () => {
    const r = extractTwConfig(LUME_LIKE);
    expect(r.extend).not.toBeNull();
    expect((r.extend!.colors as Record<string, unknown>).ink).toBe("#0A0A0A");
    expect((r.extend!.fontFamily as Record<string, unknown>).display).toEqual([
      '"Archivo Black"',
      "Inter",
      "sans-serif",
    ]);
    expect(r.html).not.toContain("tailwind.config");
    expect(r.html).toContain("cdn.tailwindcss.com");
  });

  test("config con código ejecutable (plugins/require/funciones) → null, jamás passthrough", () => {
    const bad = `<script>tailwind.config = { plugins: [require('x')], theme: { extend: { colors: { a: '#fff' } } } }</script>`;
    expect(extractTwConfig(bad).extend).toBeNull();
    const fn = `<script>tailwind.config = { theme: { extend: { colors: { a: (function(){return '#fff'})() } } } }</script>`;
    expect(extractTwConfig(fn).extend).toBeNull();
  });

  test("claves peligrosas y valores hostiles se descartan por entrada (salvage granular)", () => {
    const literal = `<script>tailwind.config = { theme: { extend: { colors: {
      good: '#123456',
      __proto__: '#bad',
      evil: 'javascript:alert(1)'
    } } } }</script>`;
    const r = extractTwConfig(literal);
    expect(r.extend).not.toBeNull();
    const colors = r.extend!.colors as Record<string, unknown>;
    expect(colors.good).toBe("#123456");
    expect(Object.prototype.hasOwnProperty.call(colors, "__proto__")).toBe(false);
    expect(colors.evil).toBeUndefined();
  });

  test("secciones fuera del allowlist se ignoran; sin config → extend null y html intacto", () => {
    const odd = `<script>tailwind.config = { darkMode: 'class', theme: { extend: { screens: { xs: '400px' }, colors: { a: '#000' } } } }</script>`;
    const r = extractTwConfig(odd);
    expect(r.extend).not.toBeNull();
    expect(r.extend!.screens).toBeUndefined();
    expect((r.extend!.colors as Record<string, unknown>).a).toBe("#000");

    const none = "<p>hola</p>";
    const r2 = extractTwConfig(none);
    expect(r2.extend).toBeNull();
    expect(r2.html).toBe(none);
  });

  test("nuestro propio carrier también cuenta como fuente (round-trip por re-sanitize)", () => {
    const withCarrier = injectTwCarrier(
      `<head><script src="https://cdn.tailwindcss.com"></script></head>`,
      { colors: { ink: "#0A0A0A" } },
    );
    const r = extractTwConfig(withCarrier);
    expect(r.extend).toEqual({ colors: { ink: "#0A0A0A" } });
    expect(r.html).not.toContain("data-ol-tw");
  });
});

describe("carrier", () => {
  test("inject → read round-trip; los `<` viajan escapados (\\u003C) y strip lo quita", () => {
    // "<" benigno (no script-like): el validador lo permite y el escape del
    // inject evita cualquier cierre prematuro de la etiqueta.
    const extend = { colors: { weird: "a<b>c", ink: "#0A0A0A" } };
    const html = injectTwCarrier("<head></head><body></body>", extend);
    expect(html).not.toContain("a<b>c"); // escapado en el HTML
    expect(html).toContain("\\u003C");
    expect(readTwCarrier(html)).toEqual(extend);
    expect(stripTwCarrier(html)).not.toContain("data-ol-tw");
  });

  test("un valor con </script> lo RECHAZA el validador (defensa en profundidad, no round-trip)", () => {
    const src = `<script>tailwind.config = { theme: { extend: { colors: { evil: 'a</scr' } } } }</script>`;
    // (cerrar el literal con </script> real rompería el propio <script> del
    // fixture — basta el prefijo para el HOSTILE_VALUE_RE)
    expect(extractTwConfig(src.replace("</scr", "</script x"))).toMatchObject({ extend: null });
    // y un carrier inyectado a mano con ese valor tampoco pasa el read:
    const forged = `<script data-ol-tw="1">tailwind.config={"colors":{"e":"a\\u003C/script>"}}</script>`;
    expect(readTwCarrier(forged)).toBeNull();
  });

  test("el carrier se inyecta DESPUÉS del script del CDN (patrón oficial del Play CDN)", () => {
    const html = injectTwCarrier(
      `<head><script src="https://cdn.tailwindcss.com"></script><style>x</style></head>`,
      { colors: { a: "#000" } },
    );
    const cdnIdx = html.indexOf("cdn.tailwindcss.com");
    const carrierIdx = html.indexOf("data-ol-tw");
    expect(carrierIdx).toBeGreaterThan(cdnIdx);
  });

  test("un carrier manipulado con contenido no-JSON no revienta: read → null", () => {
    const forged = `<head><script data-ol-tw="1">tailwind.config=alert(1)</script></head>`;
    expect(readTwCarrier(forged)).toBeNull();
  });

  test("payload gigante → se descarta (límite de bytes)", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) big[`c${i}`] = "#123456789012345678901234567890";
    const src = `<script>tailwind.config = { theme: { extend: { colors: ${JSON.stringify(big)} } } }</script>`;
    expect(extractTwConfig(src).extend).toBeNull();
  });
});

describe("seguridad (hallazgos del security review 2026-07-17)", () => {
  test("ReDoS: 80k <script sin cerrar se procesa en < 1s (era O(n²), ~59s)", () => {
    const payload = "<script>tailwind.config=".repeat(80_000);
    const t0 = Date.now();
    const r = extractTwConfig(payload);
    const ms = Date.now() - t0;
    expect(r.extend).toBeNull(); // ninguna config válida
    expect(ms).toBeLessThan(1000); // lineal, no cuadrático
  });

  test("slot-path: data-slot-path en un valor → extend RECHAZADO (no llega al carrier)", () => {
    const src = `<script>tailwind.config = { theme: { extend: { colors: { note: "data-slot-path=hero.title" } } } }</script>`;
    expect(extractTwConfig(src).extend).toBeNull();
  });

  test("slot-path: un carrier forjado con el marcador → readTwCarrier null", () => {
    const forged = `<script data-ol-tw="1">tailwind.config={"colors":{"n":"data-slot-path=x"}}</script>`;
    expect(readTwCarrier(forged)).toBeNull();
  });

  test("stripTwCarrier quita SOLO el carrier y preserva el CDN + otros scripts", () => {
    const html =
      `<head><script src="https://cdn.tailwindcss.com"></script>` +
      `<script data-ol-tw="1">tailwind.config={"colors":{"a":"#000"}}</script>` +
      `<script>console.log(1)</script></head>`;
    const out = stripTwCarrier(html);
    expect(out).not.toContain("data-ol-tw");
    expect(out).toContain("cdn.tailwindcss.com");
    expect(out).toContain("console.log(1)");
  });

  test("un <script sin </script> no cuelga ni rompe el resto", () => {
    const src = `<p>a</p><script>tailwind.config = { theme: { extend: { colors: { a: '#000' } } } }`;
    const r = extractTwConfig(src);
    expect(r.html).toContain("<p>a</p>");
    expect(() => extractTwConfig(src)).not.toThrow();
  });
});
