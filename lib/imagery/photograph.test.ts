// Tests for the Born With Imagery matcher + apply (lib/imagery/photograph.ts).
// Uses an injected fixture library (no disk, no R2) + the real Rust photo
// pass through @/lib/html-engine. The Flash pick is injected via pickFn so
// these stay offline; `pickFn: async () => null` forces the deterministic
// fallback (env-independent).
//
// Run via: npx tsx --test lib/imagery/photograph.test.ts
//
// Prereq: cd crates/html-engine && npm run build

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { photographHtml, type PickFn } from "./photograph";
import { __setCuratedImagesForTest, type CuratedImage } from "./manifest";

function img(id: string, style: string, family: string[], alt: string): CuratedImage {
  return {
    id,
    promptNum: 1,
    style,
    family,
    alt,
    src: {
      hero: `https://images.openlen.com/${id}-1920.webp`,
      tablet: `https://images.openlen.com/${id}-800.webp`,
      thumb: `https://images.openlen.com/${id}-400.webp`,
    },
  };
}

const LIBRARY: CuratedImage[] = [
  img("tacos", "food-editorial", ["food-beverage"], "Fresh street tacos on a warm wooden board"),
  img("ramen", "food-editorial", ["food-beverage"], "Steaming bowl of dark midnight ramen"),
  img("salad", "food-editorial", ["food-beverage"], "Crisp green salad bowl, washing vegetables"),
  img("office", "interior-editorial", ["saas"], "Bright airy modern open office with daylight"),
  img("forest", "nature-editorial", ["climate"], "Misty green forest at dawn"),
  img("glass", "3d-abstract", ["saas", "portfolio"], "Floating frosted glass forms in soft peach"),
];

// Force the deterministic path (no Flash) for env-independent assertions.
const DET: PickFn = async () => null;

test.afterEach(() => __setCuratedImagesForTest(null));

test("deterministic: matches a subject hint to the right curated photo", async () => {
  __setCuratedImagesForTest(LIBRARY);
  const html = `<!doctype html><html><head><style>:root{--ol-bg:#ffffff}</style></head><body>
    <div class="bg-gradient-to-br h-96" data-ol-photo="fresh street tacos"></div>
  </body></html>`;
  const r = await photographHtml({ html, brief: "a taqueria in Mexico City", pickFn: DET });
  assert.equal(r.applied, 1);
  assert.ok(r.html.includes("tacos-1920.webp"));
  assert.ok(r.html.includes("data-ol-photo-img"));
  assert.ok(!r.html.includes('data-ol-photo="'));
});

// Los sujetos vienen en español y el catálogo está etiquetado en inglés, así
// que el prefijo no es una flexión sino una colisión. Medido en la biblioteca
// real: "pan de masa madre" traía una maqueta de dashboard SaaS, porque
// `"panels".startsWith("pan")`. Un boxeador y unas turbinas eólicas llegaron a
// una panadería por la misma puerta.
test("una palabra corta no casa con otra que sólo la lleva de prefijo", async () => {
  __setCuratedImagesForTest([
    img("ui-panels", "3d-abstract", ["saas"], "Cluster of floating UI panels and rounded cards"),
    img("bread", "food-editorial", ["food-beverage"], "Rustic sourdough bread loaves on linen"),
  ]);
  const html = `<!doctype html><html><head><style>:root{--ol-bg:#ffffff}</style></head><body>
    <div class="bg-gradient-to-br h-96" data-ol-photo="pan de masa madre"></div>
  </body></html>`;
  const r = await photographHtml({ html, brief: "panadería de barrio", pickFn: DET });
  assert.ok(!r.html.includes("ui-panels"), "un dashboard no es una panadería");
});

// El rubro no dice QUÉ se ve, pero sí de qué gremio es. Exigir coincidencia de
// palabras dejaba al elector sin candidatos: medido, un hueco lleno de cuatro.
test("el rubro basta para entrar a la piscina aunque no coincida una palabra", async () => {
  __setCuratedImagesForTest([
    img("ramen", "food-editorial", ["food-beverage"], "Steaming bowl of dark midnight ramen"),
    img("office", "interior-editorial", ["saas"], "Bright airy modern open office"),
  ]);
  const html = `<!doctype html><html><head><style>:root{--ol-bg:#ffffff}</style></head><body>
    <div class="bg-gradient-to-br h-96" data-ol-photo="mostrador del local"></div>
  </body></html>`;
  const r = await photographHtml({ html, brief: "restaurante de ramen", pickFn: DET });
  assert.equal(r.applied, 1);
  assert.ok(r.html.includes("ramen-1920.webp"));
});

test("deterministic: distinct subjects get distinct photos (dedupe)", async () => {
  __setCuratedImagesForTest(LIBRARY);
  const html = `<!doctype html><html><head></head><body>
    <div data-ol-photo="street tacos"></div>
    <div data-ol-photo="modern office"></div>
  </body></html>`;
  const r = await photographHtml({ html, brief: "food and workspace", pickFn: DET });
  assert.equal(r.applied, 2);
  assert.ok(r.html.includes("tacos-1920.webp"));
  assert.ok(r.html.includes("office-1920.webp"));
});

test("text-overlay slots are skipped (gradient kept), marker dropped", async () => {
  __setCuratedImagesForTest(LIBRARY);
  const html = `<!doctype html><html><head></head><body>
    <div class="bg-gradient-to-br" data-ol-photo="tacos"><h1>Eat well</h1></div>
  </body></html>`;
  const r = await photographHtml({ html, brief: "taqueria", pickFn: DET });
  assert.equal(r.applied, 0);
  assert.ok(!r.html.includes("<img"));
  assert.ok(r.html.includes("bg-gradient-to-br"));
  assert.ok(r.html.includes("<h1>Eat well</h1>"));
  assert.ok(!r.html.includes('data-ol-photo="'));
});

test("no good match leaves the gradient (no random photo)", async () => {
  __setCuratedImagesForTest(LIBRARY);
  const html = `<!doctype html><html><head></head><body>
    <div data-ol-photo="quokka riding a unicycle on mars"></div>
  </body></html>`;
  const r = await photographHtml({ html, brief: "zzz qqq xxx", pickFn: DET });
  assert.equal(r.applied, 0);
  assert.ok(!r.html.includes("<img"));
});

test("dark page prefers a dark-toned photo on a tie", async () => {
  __setCuratedImagesForTest(LIBRARY);
  const html = `<!doctype html><html><head><style>:root{--ol-bg:#0b0b0f}</style></head><body>
    <div data-ol-photo="a bowl of noodles"></div>
  </body></html>`;
  const r = await photographHtml({ html, brief: "ramen restaurant", pickFn: DET });
  assert.equal(r.applied, 1);
  assert.ok(r.html.includes("ramen-1920.webp"));
});

test("no slots → input returned verbatim", async () => {
  __setCuratedImagesForTest(LIBRARY);
  const html = "<!doctype html><html><body><p>no photos here</p></body></html>";
  const r = await photographHtml({ html, brief: "anything", pickFn: DET });
  assert.equal(r.applied, 0);
  assert.equal(r.html, html);
});

test("empty library is a no-op", async () => {
  __setCuratedImagesForTest([]);
  const html = `<body><div data-ol-photo="tacos"></div></body>`;
  const r = await photographHtml({ html, brief: "taqueria", pickFn: DET });
  assert.equal(r.applied, 0);
  assert.equal(r.html, html);
});

// ─── Flash pick (the quality lever) ─────────────────────────────────────────

test("smart pick: Flash's choice overrides the deterministic top", async () => {
  __setCuratedImagesForTest(LIBRARY);
  const html = `<body><div data-ol-photo="grilled street food"></div></body>`;
  // Deterministic might land "salad" (has 'washing vegetables'); Flash picks tacos.
  let sawPool: string[] = [];
  const pick: PickFn = async (req) => {
    sawPool = req.pool.map((p) => p.id);
    return { [req.slots[0].index]: "tacos" };
  };
  const r = await photographHtml({ html, brief: "a taqueria", pickFn: pick });
  assert.equal(r.applied, 1);
  assert.ok(r.html.includes("tacos-1920.webp"));
  // The pool sent to Flash was the deterministic shortlist (food photos).
  assert.ok(sawPool.includes("tacos") && sawPool.includes("salad"));
});

test("smart pick: invalid / out-of-pool id falls back to deterministic", async () => {
  __setCuratedImagesForTest(LIBRARY);
  const html = `<body><div data-ol-photo="street tacos"></div></body>`;
  const pick: PickFn = async (req) => ({ [req.slots[0].index]: "does-not-exist" });
  const r = await photographHtml({ html, brief: "taqueria", pickFn: pick });
  assert.equal(r.applied, 1); // fell back, still placed a food photo
  assert.ok(/(?:tacos|salad|ramen)-1920\.webp/.test(r.html));
});

test("smart pick: Flash reusing one id across slots dedupes (2nd falls back)", async () => {
  __setCuratedImagesForTest(LIBRARY);
  const html = `<body>
    <div data-ol-photo="tacos"></div>
    <div data-ol-photo="ramen"></div>
  </body>`;
  const pick: PickFn = async (req) => {
    const out: Record<number, string> = {};
    for (const s of req.slots) out[s.index] = "tacos"; // both → tacos
    return out;
  };
  const r = await photographHtml({ html, brief: "asian and mexican food", pickFn: pick });
  assert.equal(r.applied, 2);
  assert.ok(r.html.includes("tacos-1920.webp"));
  // Second slot couldn't reuse tacos → deterministic fallback (another food photo).
  assert.ok(/(?:ramen|salad)-1920\.webp/.test(r.html));
});

test("smart pick: Flash omitting a slot still fills it deterministically", async () => {
  __setCuratedImagesForTest(LIBRARY);
  const html = `<body><div data-ol-photo="street tacos"></div></body>`;
  const pick: PickFn = async () => ({}); // no picks
  const r = await photographHtml({ html, brief: "taqueria", pickFn: pick });
  assert.equal(r.applied, 1);
});
