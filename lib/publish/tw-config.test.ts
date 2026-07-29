import { describe, expect, test, vi } from "vitest";
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

describe("claves numéricas sin comillas (bug 2026-07-29: JSON5 las rechaza)", () => {
  test("escala numérica sin comillas ({400:...}) — la forma de TODA paleta real", () => {
    const src = `<script>tailwind.config = { theme: { extend: { colors: { blood: { 400: '#f87171', 500: '#ef4444', 600: '#dc2626' } } } } }</script>`;
    const r = extractTwConfig(src);
    expect(r.extend).not.toBeNull();
    const blood = (r.extend!.colors as Record<string, Record<string, string>>).blood;
    expect(blood["400"]).toBe("#f87171");
    expect(blood["500"]).toBe("#ef4444");
    expect(blood["600"]).toBe("#dc2626");
    expect(r.html).not.toContain("tailwind.config");
  });

  test("mezcla de claves planas y numéricas (+ decimales tipo spacing) en el mismo objeto", () => {
    const src = `<script>tailwind.config = { theme: { extend: { colors: { ink: '#0a0a0a', blood: { 500: '#ef4444' } }, spacing: { 1.5: '0.375rem', 18: '4.5rem' } } } }</script>`;
    const r = extractTwConfig(src);
    expect(r.extend).not.toBeNull();
    expect((r.extend!.colors as Record<string, unknown>).ink).toBe("#0a0a0a");
    expect((r.extend!.colors as Record<string, Record<string, string>>).blood["500"]).toBe("#ef4444");
    expect((r.extend!.spacing as Record<string, unknown>)["1.5"]).toBe("0.375rem");
    expect((r.extend!.spacing as Record<string, unknown>)["18"]).toBe("4.5rem");
  });

  test("una entrada mala NO tumba el config: hermanas planas y numéricas sobreviven", () => {
    const src = `<script>tailwind.config = { theme: { extend: { colors: { good: '#123456', evil: 'javascript:alert(1)', blood: { 400: '#f87171' } } } } }</script>`;
    const r = extractTwConfig(src);
    expect(r.extend).not.toBeNull();
    const colors = r.extend!.colors as Record<string, unknown>;
    expect(colors.good).toBe("#123456");
    expect(colors.evil).toBeUndefined();
    expect((colors.blood as Record<string, string>)["400"]).toBe("#f87171");
  });

  test("números en posición de VALOR o dentro de strings NO se tocan", () => {
    const src = `<script>tailwind.config = { theme: { extend: { zIndex: { modal: 400 }, fontFamily: { display: ['A 400, "B"', 'sans-serif'] }, colors: { blood: { 400: '#f87171' }, note: 'usa {400: x} literal' } } } }</script>`;
    const r = extractTwConfig(src);
    expect(r.extend).not.toBeNull();
    expect((r.extend!.zIndex as Record<string, unknown>).modal).toBe(400);
    expect((r.extend!.fontFamily as Record<string, unknown>).display).toEqual(['A 400, "B"', "sans-serif"]);
    expect((r.extend!.colors as Record<string, unknown>).note).toBe("usa {400: x} literal");
    expect((r.extend!.colors as Record<string, Record<string, string>>).blood["400"]).toBe("#f87171");
  });
});

describe("telemetría de la pérdida silenciosa (config presente pero descartado)", () => {
  test("config imparseable → console.warn con tag [tw-config]", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const src = `<script>const c={ink:'#0a0a0a'};tailwind.config={theme:{extend:{colors:c}}}</script>`;
      expect(extractTwConfig(src).extend).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("[tw-config]");
    } finally {
      warn.mockRestore();
    }
  });

  test("config válida (incluida numérica) NO loguea", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const src = `<script>tailwind.config={theme:{extend:{colors:{blood:{400:'#f87171'}}}}}</script>`;
      expect(extractTwConfig(src).extend).not.toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("se loguea UNA vez por documento aunque fallen varios scripts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const bad = `<script>const a=1;tailwind.config={theme:{}}</script>`;
      expect(extractTwConfig(bad + bad + bad).extend).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("el carrier es una config VÁLIDA de Tailwind para el CDN (bug del preview 2026-07-18)", () => {
  test("inject emite tailwind.config={theme:{extend:{...}}}, no el extend plano", () => {
    const html = injectTwCarrier("<head></head>", { colors: { ink: "#0A0A0A" } });
    const body = html.match(/data-ol-tw="1">tailwind\.config=([\s\S]*?)<\/script>/)![1];
    const cfg = JSON.parse(body);
    // Lo que el CDN de Tailwind consume: theme.extend.colors
    expect(cfg.theme.extend.colors.ink).toBe("#0A0A0A");
    expect(cfg.colors).toBeUndefined(); // NO plano
    // …y el bake lo vuelve a extraer igual
    expect(readTwCarrier(html)).toEqual({ colors: { ink: "#0A0A0A" } });
  });

  test("compat hacia atrás: un carrier del formato viejo (plano) todavía se lee", () => {
    const oldFormat = `<script data-ol-tw="1">tailwind.config={"colors":{"lime":"#A8E40B"}}</script>`;
    expect(readTwCarrier(oldFormat)).toEqual({ colors: { lime: "#A8E40B" } });
  });
})
