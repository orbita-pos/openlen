// CLI: add (or replace) a single template by file + flags.
//
// Run:
//   npm run templates:add -- path/to/foo.html \
//     --id=foo \
//     --name="Foo" \
//     --family=technical-minimal \
//     --accent="#5E6AD2" \
//     --mode=dark \
//     --pitch="One-line product hook" \
//     --description="A complete sentence for SEO + card subtitle." \
//     [--status=draft]
//
// Validates input via the same Zod schemas as POST /api/admin/templates,
// so behavior is identical to the HTTP path. The CLI talks directly to
// the DB + storage adapter — no HTTP, no auth — because it runs locally
// with full DB credentials.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { upsertTemplate } from "../lib/templates/store";
import { captureScreenshotForTemplate } from "../lib/templates/capture-screenshot";
import {
  CreateSchema,
  findTemplateHtmlIssue,
  findTemplateHtmlWarnings,
} from "../lib/templates/admin-schemas";
import { lintContract } from "../lib/contract/lint";

interface ParsedFlags {
  htmlPath: string;
  flags: Record<string, string>;
  pages: string[]; // raw "<slug>:<path>" specs from repeatable --page=
}

function parseArgs(argv: string[]): ParsedFlags | null {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const pages: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--page=")) {
      pages.push(a.slice("--page=".length));
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) {
        // bare flag (e.g. --enforce-contract) → boolean "true"
        flags[a.slice(2)] = "true";
        continue;
      }
      const key = a.slice(2, eq);
      const value = a.slice(eq + 1);
      flags[key] = value;
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) return null;
  return { htmlPath: positional[0], flags, pages };
}

function usage(): string {
  return [
    "Usage:",
    "  npm run templates:add -- <path/to/template.html> \\",
    "    --id=<slug> \\",
    "    --name=<display name> \\",
    "    --family=<technical-minimal|editorial|commerce> \\",
    "    --accent=#RRGGBB \\",
    "    --mode=<dark|light|cream> \\",
    "    --pitch=<one-line hook> \\",
    "    --description=<full sentence> \\",
    "    [--page=<slug>:<path/to/page.html> ...]  (repeatable — multi-page template) \\",
    "    [--status=draft|published|archived]",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);
  if (!parsed) {
    console.error(usage());
    process.exit(2);
  }
  const { htmlPath, flags, pages: pageSpecs } = parsed;

  const absPath = resolve(htmlPath);
  let html: string;
  try {
    html = await readFile(absPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read ${absPath}: ${msg}`);
    process.exit(1);
  }

  // Extra pages for a multi-page template: --page=<slug>:<file>, repeatable.
  const pages: Array<{ slug: string; html: string }> = [];
  for (const spec of pageSpecs) {
    const ci = spec.indexOf(":");
    if (ci < 1) {
      console.error(`Invalid --page "${spec}" — use --page=<slug>:<path/to/page.html>`);
      process.exit(2);
    }
    const slug = spec.slice(0, ci);
    const pPath = spec.slice(ci + 1);
    try {
      pages.push({ slug, html: await readFile(resolve(pPath), "utf8") });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to read page "${pPath}": ${msg}`);
      process.exit(1);
    }
  }

  // Build the payload then run it through the same Zod schema the HTTP
  // POST handler uses. Single source of validation truth.
  const payload = {
    id: flags.id,
    name: flags.name,
    family: flags.family,
    accent: flags.accent,
    pitch: flags.pitch,
    description: flags.description,
    mode: flags.mode,
    html,
    ...(pages.length ? { pages } : {}),
    ...(flags.status ? { status: flags.status } : {}),
  };

  const result = CreateSchema.safeParse(payload);
  if (!result.success) {
    console.error("Invalid input:");
    const flat = result.error.flatten();
    for (const [field, errs] of Object.entries(flat.fieldErrors)) {
      for (const e of errs ?? []) {
        console.error(`  --${field}: ${e}`);
      }
    }
    if (flat.formErrors.length > 0) {
      for (const e of flat.formErrors) console.error(`  (form): ${e}`);
    }
    console.error("");
    console.error(usage());
    process.exit(2);
  }

  // Mismo validador que las dos rutas de admin (lib/templates/admin-schemas.ts):
  // RECHAZA en vez de sanitizar, porque la copia cruda en R2 es la que después
  // se puede re-derivar. Acepta scripts inline y handlers on* (89% y 13% del
  // corpus curado los traen) y corta con javascript:, iframes, meta refresh y
  // el marcador de modo-editor.
  //
  // ⚠️ Los scripts YA NO se los lleva el clon (2026-08-31): llegan vivos a la
  // página del usuario. Los `on*` sí, y por eso avisan aquí abajo.
  const issue = findTemplateHtmlIssue(result.data);
  if (issue) {
    console.error(`HTML rechazado en ${issue.where}: ${issue.reason}`);
    console.error("Corrige el archivo fuente y vuelve a registrarlo — aquí no se limpia nada por ti.");
    process.exit(1);
  }

  // Avisos: no bloquean, pero el curador tiene que verlos ANTES de publicar la
  // plantilla, no descubrirlos en el primer clon. Ver `findTemplateHtmlWarnings`
  // para por qué esto avisa en vez de rechazar — y por qué este aviso ES, de
  // momento, la medida que decidirá si hace falta un convertidor.
  for (const w of findTemplateHtmlWarnings(result.data)) {
    console.warn(`⚠ Aviso en ${w.where}: ${w.reason}`);
  }

  // Design-contract check (docs/openlen-contract.md). Warns by default so the
  // pre-contract library can still be (re-)added; pass --enforce-contract to
  // BLOCK on errors and guarantee a new template is born contract-clean.
  const docsToLint = [
    { label: "home", html: result.data.html },
    ...(result.data.pages ?? []).map((p) => ({ label: p.slug, html: p.html })),
  ];
  let lintHadErrors = false;
  for (const d of docsToLint) {
    const lint = lintContract(d.html, {
      kind: "document",
      mode: result.data.mode as "dark" | "light" | "cream",
    });
    if (lint.violations.length > 0) {
      const errs = lint.violations.filter((v) => v.level === "error");
      const warns = lint.violations.filter((v) => v.level === "warning");
      console.log(`Contract lint [${d.label}]: ${errs.length} errors, ${warns.length} warnings`);
      for (const v of lint.violations) {
        console.log(`  ${v.level === "error" ? "x" : "!"} [${v.rule}] ${v.detail}`);
      }
      if (!lint.ok) lintHadErrors = true;
    }
  }
  if (lintHadErrors && flags["enforce-contract"] === "true") {
    console.error(
      "\nAborting — contract errors with --enforce-contract. Fix the HTML, or drop the flag to add anyway.",
    );
    process.exit(1);
  }
  if (lintHadErrors) {
    console.log("(adding despite contract errors — pass --enforce-contract to block)\n");
  }

  console.log(`Uploading "${result.data.id}" (${result.data.html.length} bytes)...`);
  const record = await upsertTemplate(result.data);
  console.log("Uploaded.");
  console.log(`  id           : ${record.id}`);
  console.log(`  status       : ${record.status}`);
  console.log(`  contentHash  : ${record.contentHash}`);
  console.log(`  storageUrl   : ${record.storageUrl}`);
  console.log(`  size         : ${record.size} bytes`);

  // Capture the full-page reference screenshot inline (Quality S2). A
  // template without a screenshot silently loses the multimodal vision
  // boost in /api/generate, so a capture failure fails the whole add —
  // re-run after fixing (or run `templates:capture-screenshots` for a
  // one-off backfill).
  console.log(`Capturing full-page reference screenshot...`);
  const screenshotUrl = await captureScreenshotForTemplate(record.id);
  console.log(`  screenshotUrl: ${screenshotUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
