import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ─────────────────────────────────────────────────────────────────────────────
// One-shot converter that pulls the 9 hand-crafted React/JSX reference
// variants from ~/Downloads/<direction>/ into the orchestrator's few-shot
// corpus. Run with: `npx tsx scripts/build-few-shots.ts`.
//
// The 9 variants are NOT in the repo because they're authored separately in
// claude.ai artifacts. Each direction lives in its own folder with one or
// more shared dependency files (icons, primitives, helpers) that we
// concatenate in front of each variant so the final .jsx is self-contained
// and the model can read it as a single unit.
//
// Trimming policy: refined-editorial and warm-humanist variants are emitted
// in full — they already fit a 7-9K token budget per example. The three
// technical-minimal variants (tide / arrow / glass) are the heaviest (10K+
// tokens each because of inline SVG-heavy mockups) so we strip the trailing
// Testimonials + FAQ sections from each. The remaining content (nav, hero,
// bento, big-feature, pricing, CTA, footer, composition) demonstrates the
// full craft — testimonials and FAQ are the least distinctive sections.
//
// Without this trim the three-example budget is ~29K tokens; with the trim
// it drops to ~26K, leaving comfortable headroom under the 30K threshold
// where some Together models start to lose recall over the system prompt.
// ─────────────────────────────────────────────────────────────────────────────

interface VariantSpec {
  direction: string;
  variant: string;
  sourceDir: string;     // absolute path to the directory containing the variant
  variantFile: string;   // file name of the variant inside sourceDir
  sharedFiles: string[]; // file names of shared deps, in concat order
  productSummary: string;
  palette: string;
  /**
   * Optional regex to identify the start of the first section we want to
   * remove and the start of the section we want to keep. Everything from
   * `cutFrom` (inclusive) up to `cutUntil` (exclusive) is deleted, replaced
   * by a one-line comment marker.
   */
  trim?: { cutFrom: RegExp; cutUntil: RegExp };
}

const HOME = os.homedir();

const VARIANTS: VariantSpec[] = [
  // technical-minimal — variants live under ~/Downloads/technical-minimal/src/
  {
    direction: "technical-minimal",
    variant: "tide",
    sourceDir: path.join(HOME, "Downloads", "technical-minimal", "src"),
    variantFile: "tide.jsx",
    sharedFiles: ["icons.jsx", "primitives.jsx"],
    productSummary: "Production observability for AI agents (Linear / Vercel / Supabase grade)",
    palette: "emerald-dark — #3ECF8E on #0F0F0F",
    trim: { cutFrom: /^function TideTestimonials\(/m, cutUntil: /^function TideCTA\(/m },
  },
  {
    direction: "technical-minimal",
    variant: "arrow",
    sourceDir: path.join(HOME, "Downloads", "technical-minimal", "src"),
    variantFile: "arrow.jsx",
    sharedFiles: ["icons.jsx", "primitives.jsx"],
    productSummary: "Async standups for distributed engineering teams",
    palette: "indigo-dark — #5E6AD2 on near-black",
    trim: { cutFrom: /^function ArrowTestimonials\(/m, cutUntil: /^function ArrowCTA\(/m },
  },
  {
    direction: "technical-minimal",
    variant: "glass",
    sourceDir: path.join(HOME, "Downloads", "technical-minimal", "src"),
    variantFile: "glass.jsx",
    sharedFiles: ["icons.jsx", "primitives.jsx"],
    productSummary: "Vector database with hairline-borders, brutalist-technical leanings",
    palette: "mono-dark — pure white on pure black",
    trim: { cutFrom: /^function GlassTestimonials\(/m, cutUntil: /^function GlassCTA\(/m },
  },

  // refined-editorial — variants live directly under ~/Downloads/refined-editorial/
  // and have no shared dep files (each variant is fully self-contained).
  {
    direction: "refined-editorial",
    variant: "folio",
    sourceDir: path.join(HOME, "Downloads", "refined-editorial"),
    variantFile: "folio.jsx",
    sharedFiles: [],
    productSummary: "Wealth management for engineers & operators — warm-dark editorial",
    palette: "warm-dark — orange #F97316 on near-black",
  },
  {
    direction: "refined-editorial",
    variant: "brace",
    sourceDir: path.join(HOME, "Downloads", "refined-editorial"),
    variantFile: "brace.jsx",
    sharedFiles: [],
    productSummary: "Customer success platform — mono-light editorial with warm sienna accent",
    palette: "mono-light + sienna accent",
  },
  {
    direction: "refined-editorial",
    variant: "letter",
    sourceDir: path.join(HOME, "Downloads", "refined-editorial"),
    variantFile: "letter.jsx",
    sharedFiles: [],
    productSummary: "Independent newsletter publishing — pure mono-light editorial",
    palette: "mono-light pure",
  },

  // warm-humanist — variants live directly under ~/Downloads/warm-humanist/
  // with one shared.jsx primitives file.
  {
    direction: "warm-humanist",
    variant: "daybreak",
    sourceDir: path.join(HOME, "Downloads", "warm-humanist"),
    variantFile: "daybreak.jsx",
    sharedFiles: ["shared.jsx"],
    productSummary: "Habit tracking — dusty rose accent on warm cream",
    palette: "warm cream + dusty rose #D97A8A",
  },
  {
    direction: "warm-humanist",
    variant: "cohort",
    sourceDir: path.join(HOME, "Downloads", "warm-humanist"),
    variantFile: "cohort.jsx",
    sharedFiles: ["shared.jsx"],
    productSummary: "Community-driven courses — sage green humanist",
    palette: "sage green on warm off-white",
  },
  {
    direction: "warm-humanist",
    variant: "kettle",
    sourceDir: path.join(HOME, "Downloads", "warm-humanist"),
    variantFile: "kettle.jsx",
    sharedFiles: ["shared.jsx"],
    productSummary: "Recipe management — terracotta humanist with paper texture",
    palette: "terracotta on warm cream",
  },
];

const OUT_ROOT = path.join(process.cwd(), "lib", "orchestrator", "few-shots");

async function buildOne(spec: VariantSpec): Promise<{ outPath: string; lines: number; bytes: number }> {
  const sharedContents: string[] = [];
  for (const file of spec.sharedFiles) {
    const fp = path.join(spec.sourceDir, file);
    if (!existsSync(fp)) {
      throw new Error(`Shared dep not found for ${spec.direction}/${spec.variant}: ${fp}`);
    }
    const content = await readFile(fp, "utf8");
    sharedContents.push(`// ─── shared: ${file} ───\n${content.trimEnd()}`);
  }

  const variantPath = path.join(spec.sourceDir, spec.variantFile);
  if (!existsSync(variantPath)) {
    throw new Error(`Variant not found: ${variantPath}`);
  }
  let variantContent = (await readFile(variantPath, "utf8")).trimEnd();

  if (spec.trim) {
    const fromIdx = variantContent.search(spec.trim.cutFrom);
    const untilIdx = variantContent.search(spec.trim.cutUntil);
    if (fromIdx === -1 || untilIdx === -1 || untilIdx <= fromIdx) {
      throw new Error(
        `Trim regex did not match for ${spec.direction}/${spec.variant} (from=${fromIdx}, until=${untilIdx})`,
      );
    }
    const before = variantContent.slice(0, fromIdx).trimEnd();
    const after = variantContent.slice(untilIdx);
    const marker = [
      "",
      "// ─────────────────────────────────────────────────────────────────────",
      "// Testimonials + FAQ sections trimmed from this reference to fit the",
      "// few-shot token budget. The original artifact included two more",
      "// sections between Pricing and CTA (a 3-up testimonial grid and an",
      "// accordion FAQ). The craft patterns shown elsewhere are sufficient",
      "// to demonstrate the aesthetic.",
      "// ─────────────────────────────────────────────────────────────────────",
      "",
    ].join("\n");
    variantContent = `${before}\n${marker}\n${after}`;
  }

  const header =
    `/**\n` +
    ` * Few-shot reference: ${capitalize(spec.direction)} / ${capitalize(spec.variant)}\n` +
    ` * Product: ${spec.productSummary}\n` +
    ` * Palette: ${spec.palette}\n` +
    ` * Aesthetic: Linear / Vercel / Supabase-grade craft demonstration.\n` +
    ` *\n` +
    ` * Authored as a claude.ai artifact (React + Tailwind JSX). Concatenated\n` +
    ` * here with its shared primitives so the model sees one self-contained\n` +
    ` * reference. Loaded by lib/orchestrator/few-shots/index.ts.\n` +
    ` */\n`;

  const body = [header, ...sharedContents, `// ─── variant: ${spec.variantFile} ───`, variantContent].join("\n\n");

  const outDir = path.join(OUT_ROOT, spec.direction);
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  const outPath = path.join(outDir, `${spec.variant}.jsx`);
  await writeFile(outPath, body, "utf8");
  return {
    outPath,
    lines: body.split("\n").length,
    bytes: Buffer.byteLength(body, "utf8"),
  };
}

function capitalize(s: string): string {
  return s
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function main() {
  console.log(`Building few-shot corpus into ${path.relative(process.cwd(), OUT_ROOT)}/\n`);
  let totalBytes = 0;
  let totalLines = 0;
  for (const spec of VARIANTS) {
    const { outPath, lines, bytes } = await buildOne(spec);
    const rel = path.relative(process.cwd(), outPath);
    console.log(
      `  ✓ ${rel.padEnd(56)} ${lines.toString().padStart(4)} lines  ${(bytes / 1024).toFixed(1).padStart(5)} KB`,
    );
    totalBytes += bytes;
    totalLines += lines;
  }
  console.log(
    `\nWrote ${VARIANTS.length} files · ${totalLines} lines total · ${(totalBytes / 1024).toFixed(1)} KB total`,
  );
  console.log(
    `Approx tokens for a single 3-example load (one per direction): ~${Math.ceil(
      totalBytes / VARIANTS.length / 4,
    ).toLocaleString()} per example × 3 = ~${Math.ceil(((totalBytes / VARIANTS.length) * 3) / 4).toLocaleString()} tokens.`,
  );
}

main().catch((err) => {
  console.error("build-few-shots failed:", err);
  process.exit(1);
});
