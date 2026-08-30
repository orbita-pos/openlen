import { describe, expect, test } from "vitest";

import { bakeAssistantWidget } from "./assistant-widget";
import { bakeChatWidget } from "./chat-widget";
import { bakeCollections } from "./collections-block";
import { buildModuleSection } from "./module-sections";

// ─────────────────────────────────────────────────────────────────────────────
// La red del bake.
//
// bakeDocument compila el CSS de Tailwind PRIMERO (filesystem.ts:571 →
// optimize-html.ts, que escanea las clases presentes EN ESE MOMENTO) y recién
// después inyecta los ~21 módulos (filesystem.ts:623-990). O sea: una utility
// de Tailwind que aparezca en el markup de un módulo NO existe en el CSS
// horneado y sale sin estilo en la página publicada — en silencio, porque el
// editor sí tiene el CDN y ahí se ve bien.
//
// Hoy se cumple por disciplina (todo va con inline styles o clases propias),
// no por invariante. Esta prueba lo convierte en invariante: renderiza cada
// inyector sobre un documento SIN una sola clase, así cualquier `class` en la
// salida es suya, y falla nombrando módulo y clase.
//
// Si rompiste esto: o pasás el estilo a inline/clase propia, o movés tu
// inyección ANTES del bake en bakeDocument.
// ─────────────────────────────────────────────────────────────────────────────

/** Documento base sin NINGUNA clase: lo que salga es del inyector. */
const BASE =
  '<!doctype html><html><head><title>t</title></head><body><div id="host"></div></body></html>';

// Namespaces propios: no son utilities de Tailwind aunque lo parezcan.
const FIRST_PARTY = /^(ol-|olc-|olmp-|openlen-|pa-)/;

/** Patrones de utilities de Tailwind. Deliberadamente específicos: `ol-cart`
 *  o `hairline` no deben disparar, `p-4` o `text-sm` sí. */
const TAILWIND_PATTERNS: RegExp[] = [
  /^-?[mp][xytrbl]?-(\d+(\.\d+)?|px|auto|full)$/, // p-4 mx-auto -mt-2
  /^(gap|space)-([xy]-)?\d+(\.\d+)?$/,
  /^(w|h|min-w|min-h|max-w|max-h)-(\d+(\.\d+)?|full|screen|auto|px|fit)$/,
  /^text-(xs|sm|base|lg|\d?xl|left|center|right|justify)$/,
  /^font-(thin|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono)$/,
  /^(leading|tracking)-[a-z]+$/,
  /^(bg|text|border|ring|fill|stroke|from|to|via)-(white|black|transparent|current|inherit|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d{2,3})?(\/\d{1,3})?$/,
  /^rounded(-(sm|md|lg|xl|2xl|3xl|full|none))?$/,
  /^shadow(-(sm|md|lg|xl|2xl|inner|none))?$/,
  /^border(-(\d|x|y|t|r|b|l))?$/,
  /^(flex|grid|block|inline|inline-block|inline-flex|hidden|contents)$/,
  /^(flex|grid)-(row|col|wrap|nowrap|1|auto|none|cols-\d+|rows-\d+)$/,
  /^(items|justify|self|content|place)-[a-z]+$/,
  /^(absolute|relative|fixed|sticky|static)$/,
  /^(top|right|bottom|left|inset)-(\d+|auto|full|px|0)$/,
  /^z-(\d+|auto)$/,
  /^opacity-\d{1,3}$/,
  /^(overflow|object)-[a-z]+$/,
  /^(uppercase|lowercase|capitalize|truncate|italic|underline|antialiased)$/,
  /^(cursor|select|pointer-events)-[a-z]+$/,
  /^transition(-[a-z]+)?$/,
  /-\[.+\]$/, // valores arbitrarios: text-[13px], bg-[#0F0F0F]
];

/** Prefijos responsive/estado que Tailwind admite delante de una utility. */
const VARIANT = /^([a-z]{2}|hover|focus|active|group-hover|dark|first|last|odd|even):/;

function tailwindUtilitiesIn(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/\sclass\s*=\s*"([^"]*)"/gi)) {
    for (const raw of m[1].split(/\s+/)) {
      if (!raw) continue;
      let token = raw;
      while (VARIANT.test(token)) token = token.slice(token.indexOf(":") + 1);
      if (FIRST_PARTY.test(token)) continue;
      if (TAILWIND_PATTERNS.some((re) => re.test(token))) found.add(raw);
    }
  }
  return [...found];
}

// ── Cada módulo, con el input mínimo que lo hace emitir de verdad ───────────

const CATALOG_HOST = BASE.replace(
  '<div id="host"></div>',
  '<div data-ol-collections></div>',
);

const CATALOG_ITEM = {
  id: "i1",
  title: "Tacos al pastor",
  description: "Con piña",
  priceDisplay: "$90",
  imageUrl: null,
  ctaLabel: "Pedir",
  ctaUrl: "https://example.com",
  badge: "Nuevo",
};

// Cada layout es una rama de markup distinta: si solo se renderiza una, la red
// no ve la otra (lo comprobé mutando `list` mientras el fixture usaba `grid`).
const catalog = (layout: "grid" | "list") => () =>
  bakeCollections(
    CATALOG_HOST,
    { items: [CATALOG_ITEM], layout } as never,
    true,
  );

const MODULES: Array<[string, () => string]> = [
  ["collections (catálogo, grid)", catalog("grid")],
  ["collections (catálogo, list)", catalog("list")],
  [
    "assistant (burbuja IA)",
    () =>
      bakeAssistantWidget(BASE, {
        sub: "demo",
        apiBase: "https://openlen.com",
        businessName: "Demo",
      } as never),
  ],
  [
    "chat (mensajería)",
    () =>
      bakeChatWidget(BASE, {
        sub: "demo",
        mount: "both",
        selfServeJoin: true,
      } as never),
  ],
  [
    "module-sections (banda de módulo)",
    () => buildModuleSection("chat") ?? "",
  ],
];

describe("markup de módulos: sin utilities de Tailwind (el bake ya compiló)", () => {
  test.each(MODULES)("%s", (name, render) => {
    let html: string;
    try {
      html = render();
    } catch (err) {
      throw new Error(
        `El inyector de "${name}" lanzó al renderizar — ajusta su fixture en este test: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const hits = tailwindUtilitiesIn(html);
    expect(
      hits,
      `El módulo "${name}" emite utilities de Tailwind: ${hits.join(", ")}\n\n` +
        `El bake compila el CSS ANTES de inyectar los módulos (filesystem.ts:571 vs :623-990),\n` +
        `así que esas clases NO existen en la publicada y el módulo sale sin estilo — y no se\n` +
        `nota, porque el editor sí trae el CDN de Tailwind.\n` +
        `Arreglo: usa inline styles o una clase propia (ol-*), o mueve la inyección antes del bake.`,
    ).toEqual([]);
  });
});

describe("la detección sirve (si no, la red no protege nada)", () => {
  test("cazaría utilities reales, con y sin variantes", () => {
    const malo =
      '<div class="flex items-center gap-2 p-4 text-sm bg-white rounded-lg md:grid hover:bg-slate-100 text-[13px]"></div>';
    const hits = tailwindUtilitiesIn(malo);
    for (const esperado of [
      "flex",
      "items-center",
      "gap-2",
      "p-4",
      "text-sm",
      "bg-white",
      "rounded-lg",
      "md:grid",
      "hover:bg-slate-100",
      "text-[13px]",
    ]) {
      expect(hits).toContain(esperado);
    }
  });

  test("NO confunde clases propias ni nombres cualesquiera", () => {
    const bueno =
      '<div class="ol-cart olc-card olmp-bar openlen-widget hairline display marquee brand-title"></div>';
    expect(tailwindUtilitiesIn(bueno)).toEqual([]);
  });

  test("ignora el markup sin atributo class", () => {
    expect(tailwindUtilitiesIn('<div style="padding:16px"></div>')).toEqual([]);
  });
});
