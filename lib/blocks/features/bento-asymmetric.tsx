/**
 * Source: Magic UI (MIT) — <BentoGrid> pattern
 *   https://github.com/magicuidesign/magicui
 *   https://magicui.design/docs/components/bento-grid
 * License: MIT — see /LICENSES/magic-ui.MIT.txt
 *
 * Adapted: tokens substituted; tile visual variants kept enum-driven (the AI
 * picks 'code' / 'stats' / 'image' / none, never JSX). The "visual" slot is
 * purely decorative — the orchestrator can layer in real images later via
 * `imageSrc` once image generation lands.
 */
import { z } from "zod";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

const TILE_SIZE = ["large", "medium", "small"] as const;
const TILE_VISUAL = ["code", "stats", "image", "none"] as const;

export const slotsSchema = z.object({
  eyebrow: z.string().max(40).optional(),
  title: z.string().max(80),
  sub: z.string().max(200).optional(),
  tiles: z
    .array(
      z.object({
        size: z.enum(TILE_SIZE),
        title: z.string().max(60),
        body: z.string().max(200),
        visual: z.enum(TILE_VISUAL).optional(),
        imageSrc: z.string().optional(),
        imageAlt: z.string().max(140).optional(),
        // Session 7: code-visual tiles can now carry a slot-driven snippet.
        // Each tile decides independently — when `visual: "code"` AND a
        // `codeSnippet` is provided, it renders. Otherwise the tile falls
        // back to a contextual template by `codeKind` (see below) or a
        // generic placeholder. The hardcoded `search("latency")` snippet that
        // shipped in S6 is gone — it was unrelated to product context and
        // read as filler text.
        //
        // Constraints kept tight so the model can't dump a 200-line snippet
        // that breaks the tile layout.
        codeSnippet: z
          .object({
            language: z.enum(["js", "ts", "py", "sh", "sql", "go", "rust"]).optional(),
            // 4 lines max keeps the snippet fitting the small tile region.
            // Each line ≤ 80 chars so it doesn't horizontal-scroll.
            lines: z.array(z.string().max(80)).min(1).max(4),
            // Optional summary echoed under the snippet (the original visual
            // had "→ 247 matches · 184ms"). Strict cap — it's a caption, not
            // a paragraph.
            caption: z.string().max(60).optional(),
          })
          .optional(),
        codeKind: z
          .enum(["api", "database", "monitoring", "shell", "default"])
          .optional(),
      })
    )
    .min(4)
    .max(7),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "features/bento-asymmetric",
  displayName: "Asymmetric bento grid",
  description:
    "Asymmetric grid of feature tiles — one large tile anchors, smaller tiles fill around it. Use when you want hierarchy across features (one hero capability + supporting ones).",
  aesthetics: ["technical-minimal", "editorial-maximalist"],
  slotsSchema,
  exampleSlots: {
    eyebrow: "Why teams switch",
    title: "Built for the way you actually work.",
    sub: "Glass replaces the three tools you patched together. One canvas, end-to-end.",
    tiles: [
      {
        size: "large",
        title: "End-to-end planning, one canvas",
        body: "Roadmap, sprint, and changelog live in the same view. No swivel-chair between four tools.",
        visual: "image",
      },
      {
        size: "medium",
        title: "Sub-second search",
        body: "Local index, encrypted at rest. Find any ticket from the last two years in under 300ms.",
        visual: "code",
        codeKind: "api",
        codeSnippet: {
          language: "ts",
          lines: [
            `const hits = await glass.search({`,
            `  query: "shipped:true",`,
            `});`,
          ],
          caption: "→ 247 matches · 184ms",
        },
      },
      {
        size: "medium",
        title: "Real numbers, real time",
        body: "Velocity, cycle time, WIP. Live updates, no SQL needed.",
        visual: "stats",
      },
      {
        size: "small",
        title: "API-first",
        body: "Everything you see is REST + webhooks.",
      },
      {
        size: "small",
        title: "Imports in 90 seconds",
        body: "Jira, Linear, GitHub — bring everything.",
      },
    ],
  },
};

// Industry-keyed code templates. Used when the model picks visual="code" but
// doesn't (yet) emit a slot-driven `codeSnippet`. The fill prompt's slot
// example already shows the new shape, but older mocks and refine retries
// may not populate it.
const CODE_TEMPLATES: Record<
  NonNullable<z.infer<typeof slotsSchema>["tiles"][number]["codeKind"]>,
  { lines: string[]; caption?: string }
> = {
  api: {
    lines: [`const result = await client.query({`, `  filter: "active",`, `});`],
    caption: "→ 47 records · 92ms",
  },
  database: {
    lines: [
      `SELECT id, name`,
      `FROM accounts`,
      `WHERE active = true;`,
    ],
    caption: "→ 1,284 rows · 14ms",
  },
  monitoring: {
    lines: [
      `tide.trace({`,
      `  session_id: req.id,`,
      `});`,
    ],
    caption: "→ uploaded · 38ms",
  },
  shell: {
    lines: [
      `$ openlen deploy ./site`,
      `building...`,
      `live at example.com`,
    ],
    caption: "→ 22s end-to-end",
  },
  default: {
    lines: [
      `import { generate } from "./api";`,
      `await generate({ brief });`,
    ],
  },
};

function VisualBackdrop({
  visual,
  tokens,
  imageSrc,
  imageAlt,
  codeSnippet,
  codeKind,
}: {
  visual: (typeof TILE_VISUAL)[number] | undefined;
  tokens: BlockComponentProps<typeof slotsSchema>["tokens"];
  imageSrc?: string;
  imageAlt?: string;
  codeSnippet?: z.infer<typeof slotsSchema>["tiles"][number]["codeSnippet"];
  codeKind?: z.infer<typeof slotsSchema>["tiles"][number]["codeKind"];
}) {
  if (visual === "image" && imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={imageAlt ?? ""}
        className="block h-40 w-full object-cover"
        loading="lazy"
      />
    );
  }
  if (visual === "code") {
    // Resolution order: slot-driven snippet > industry template > default.
    // The slot-driven path lets the fill step emit syntactically-valid code
    // that references productName / actual capabilities; templates are a
    // safety net for old briefs or refine retries that don't populate the
    // snippet slot.
    const snippet =
      codeSnippet ?? CODE_TEMPLATES[codeKind ?? "default"] ?? CODE_TEMPLATES.default;
    return (
      <div
        className="px-5 pt-4"
        style={{ fontFamily: tokens.fontMono, color: tokens.textMuted }}
      >
        {/* High-contrast text + monospace handles syntax visually — no
            hardcoded keyword highlighting (the snippet may be in JS / SQL /
            sh / SQL all in one bento, so a single highlight rule lies as
            often as it helps). `tokens.text` keeps contrast in all five
            palettes; brand `accent` would fail WCAG AA (#5E6AD2 = 3.66:1
            on dark surfaces). */}
        <pre
          className="m-0 whitespace-pre text-xs leading-relaxed"
          style={{ color: tokens.text, fontFamily: tokens.fontMono }}
        >
          {snippet.lines.join("\n")}
        </pre>
        {snippet.caption ? (
          <div
            className="mt-1 text-xs"
            style={{ color: tokens.textDim, fontFamily: tokens.fontMono }}
          >
            {snippet.caption}
          </div>
        ) : null}
      </div>
    );
  }
  if (visual === "stats") {
    return (
      <div className="px-5 pt-4">
        <div
          className="text-3xl font-medium tracking-tight"
          style={{ fontFamily: tokens.fontDisplay, color: tokens.text }}
        >
          4.7d
        </div>
        <div className="text-xs" style={{ color: tokens.textDim }}>
          median cycle time · ↓ 38% vs last quarter
        </div>
      </div>
    );
  }
  return null;
}

function tileSpan(size: (typeof TILE_SIZE)[number]) {
  switch (size) {
    case "large":
      return "lg:col-span-2 lg:row-span-2";
    case "medium":
      return "lg:col-span-2";
    case "small":
    default:
      return "lg:col-span-1";
  }
}

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  return (
    <section
      aria-labelledby="features-bento-headline"
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-20 sm:py-28 lg:py-32">
        <div className="mx-auto max-w-[720px] text-center">
          {slots.eyebrow ? (
            <span
              className="mb-5 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wider uppercase"
              style={{
                background: tokens.surfaceElevated,
                border: `1px solid ${tokens.border}`,
                color: tokens.textMuted,
              }}
            >
              {slots.eyebrow}
            </span>
          ) : null}
          <h2
            id="features-bento-headline"
            className="text-balance text-3xl leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl"
            style={{
              fontFamily: tokens.fontDisplay,
              letterSpacing: "-0.025em",
              fontWeight: 600,
            }}
          >
            {slots.title}
          </h2>
          {slots.sub ? (
            <p
              className="mt-5 text-pretty text-base leading-relaxed sm:text-lg"
              style={{ color: tokens.textMuted }}
            >
              {slots.sub}
            </p>
          ) : null}
        </div>

        <div className="mt-14 grid auto-rows-[minmax(220px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {slots.tiles.map((tile, i) => (
            <article
              key={i}
              className={`flex flex-col overflow-hidden ${tileSpan(tile.size)}`}
              style={{
                background: tokens.surface,
                border: `1px solid ${tokens.border}`,
                borderRadius: tokens.radius,
              }}
            >
              <VisualBackdrop
                visual={tile.visual}
                tokens={tokens}
                imageSrc={tile.imageSrc}
                imageAlt={tile.imageAlt}
                codeSnippet={tile.codeSnippet}
                codeKind={tile.codeKind}
              />
              <div className="flex flex-1 flex-col p-5">
                <h3
                  className="text-lg font-medium leading-tight tracking-tight"
                  style={{
                    fontFamily: tokens.fontDisplay,
                    letterSpacing: "-0.01em",
                    color: tokens.text,
                  }}
                >
                  {tile.title}
                </h3>
                <p
                  className="mt-2 text-sm leading-relaxed"
                  style={{ color: tokens.textMuted }}
                >
                  {tile.body}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
