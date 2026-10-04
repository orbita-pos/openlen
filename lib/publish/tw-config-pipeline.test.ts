// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/tw-config-pipeline.test.ts
//
// node:test, not vitest — exercises the native @/lib/html-engine (Rust)
// sanitize + the tailwind bake. Integración del fix del bug lume/hovers:
// la paleta del tailwind.config debe sobrevivir la ingestión como carrier
// y el bake del publish debe compilarla a CSS real.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeForPublish } from "@/lib/html-engine";
import { bakeTailwind } from "./optimize-html";
import { readTwCarrier } from "./tw-config";

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
      },
    },
  }
</script>
</head><body>
<section class="bg-ink text-white"><div class="text-lime">0g</div><div class="text-white/60">Sugar</div></section>
</body></html>`;

describe("sanitizeForPublish conserva la paleta como carrier (bug lume)", () => {
  it("el clonado trae carrier con ink/lime y cero JS del template", () => {
    const out = sanitizeForPublish(LUME_LIKE);
    assert.ok(out.html);
    const html = out.html!;
    const extend = readTwCarrier(html);
    assert.ok(extend, "el carrier debe existir tras sanitizar");
    assert.equal((extend!.colors as Record<string, string>).ink, "#0A0A0A");
    assert.equal((extend!.colors as Record<string, string>).lime, "#A8E40B");
    // Un solo script inline permitido: el carrier (bytes nuestros).
    const inlineScripts = html.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) ?? [];
    assert.equal(inlineScripts.length, 1);
    assert.match(inlineScripts[0]!, /data-ol-tw/);
  });

  it("re-sanitizar (Chat re-pasa el HTML) es idempotente: el carrier sobrevive igual", () => {
    const once = sanitizeForPublish(LUME_LIKE).html!;
    const twice = sanitizeForPublish(once).html!;
    assert.deepEqual(readTwCarrier(twice), readTwCarrier(once));
  });

  it("HTML sin config queda como siempre (sin carrier, byte-estable)", () => {
    const plain = `<!doctype html><html><head></head><body><p class="text-zinc-600">hola</p></body></html>`;
    const out = sanitizeForPublish(plain).html!;
    assert.equal(readTwCarrier(out), null);
    assert.ok(!out.includes("data-ol-tw"));
  });
});

describe("bakeTailwind honra el carrier (publish con paleta real)", () => {
  it("bg-ink y text-lime generan CSS con los hex del template; el carrier no llega al horneado", async () => {
    const sanitized = sanitizeForPublish(LUME_LIKE).html!;
    const baked = await bakeTailwind(sanitized);
    assert.equal(baked.baked, true);
    // Tailwind v3 emite los hex como rgb(): #0A0A0A → rgb(10 10 10), #A8E40B → rgb(168 228 11)
    assert.match(baked.html, /\.bg-ink\s*\{[^}]*rgb\(10 10 10/);
    assert.match(baked.html, /\.text-lime\s*\{[^}]*rgb\(168 228 11/);
    assert.ok(!baked.html.includes("data-ol-tw"));
    assert.ok(!baked.html.includes("cdn.tailwindcss.com"));
  });

  // 🔴 LA ENTRADA COMO VERCEL (2026-10-04): pegar, clonar y sembrar ya no pasan
  // `sanitizeForPublish`, así que el carrier no nace y la página llega a
  // publicar con su `<script>tailwind.config=…</script>` tal cual. El horneado
  // sólo leía el carrier: la paleta se perdía (lo vio el revisor de
  // publicación en lume, marea y hornada) y el script de config se quedaba
  // vivo sin el CDN, lanzando ReferenceError.
  it("🔴 sin carrier, lee el tailwind.config de la página, y lo quita con el CDN", async () => {
    const baked = await bakeTailwind(LUME_LIKE);
    assert.equal(baked.baked, true);
    assert.match(baked.html, /\.bg-ink\s*\{[^}]*rgb\(10 10 10/);
    assert.match(baked.html, /\.text-lime\s*\{[^}]*rgb\(168 228 11/);
    assert.ok(!baked.html.includes("tailwind.config"), "el script de config no sobrevive sin el CDN");
    assert.ok(!baked.html.includes("cdn.tailwindcss.com"));
  });

  // Y SI LA CONFIG NO SE PUEDE LEER (lógica en el mismo script, valores que se
  // calculan al cargar), NO SE HORNEA: se queda el CDN y el script, como con
  // `?plugins=`. Hornear la quitaba entera —paleta Y lógica— (lo vio el revisor
  // de publicación en la segunda pasada, medido el 2026-10-04).
  for (const [caso, script] of [
    ["config y lógica en el mismo script", `tailwind.config={theme:{extend:{colors:{ink:"#0a0a0a"}}}}; window.__logica = 1;`],
    ["config calculada", `var c = "#0a0a0a"; tailwind.config={theme:{extend:{colors:{ink:c}}}}; window.__logica = 1;`],
  ] as const) {
    it(`🔴 ${caso}: no hornea, deja el CDN y el script`, async () => {
      const html = `<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script><script>${script}</script></head><body><p class="bg-ink">x</p></body></html>`;
      const baked = await bakeTailwind(html);
      assert.equal(baked.baked, false);
      assert.equal(baked.html, html);
    });
  }

  it("sin carrier el bake sigue idéntico a hoy (core-only)", async () => {
    const plain = `<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><p class="text-red-500">x</p></body></html>`;
    const baked = await bakeTailwind(plain);
    assert.equal(baked.baked, true);
    assert.match(baked.html, /\.text-red-500/);
  });
});

describe("seguridad end-to-end (security review)", () => {
  it("data-slot-path colado en un color → sanitizeForPublish RECHAZA (html null, no llega a la DB)", () => {
    const evil = `<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { theme: { extend: { colors: { note: "data-slot-path=hero.title" } } } }</script>
</head><body><p class="text-note">x</p></body></html>`;
    const out = sanitizeForPublish(evil);
    // El marcador NO sobrevive: o extend rechazado (sin carrier, html limpio sin
    // el marcador) o el guard final devuelve null. En ningún caso el output lo trae.
    if (out.html !== null) {
      assert.ok(!out.html.includes("data-slot-path="), "el marcador jamás en el output");
    }
    assert.equal(readTwCarrier(out.html ?? "")?.colors?.note, undefined);
  });

  // 🔴 Y CODIFICADO. El validador del extend y el guard final miraban el literal,
  // así que `&#100;ata-slot-path=` en un valor volvía en el carrier y llegaba a
  // la base por autofill o re-estilar (revisor de publicación, 2026-10-04). La
  // puerta de Rust, que sí ve las variantes, no lo había mirado: se extrae antes.
  it("una variante CODIFICADA del marcador en un color → RECHAZA", () => {
    const evil = `<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { theme: { extend: { colors: { ink: "&#100;ata-slot-path=x" } } } }</script>
</head><body><p class="text-ink">x</p></body></html>`;
    assert.equal(sanitizeForPublish(evil).html, null);
  });

  it("CONTRA-PRUEBA: una paleta limpia sigue pasando, con su carrier", () => {
    const out = sanitizeForPublish(LUME_LIKE);
    assert.ok(out.html);
    assert.equal((readTwCarrier(out.html!)?.colors as Record<string, string>).ink, "#0A0A0A");
  });

  it("ReDoS: from-html-style payload gigante sanitiza en tiempo lineal", () => {
    const payload = "<script>tailwind.config=".repeat(60_000);
    const t0 = Date.now();
    sanitizeForPublish(payload);
    assert.ok(Date.now() - t0 < 2000, "sanitize lineal, no cuadrático");
  });
});
