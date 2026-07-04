// CLI: add (or replace) a single post template by file + flags.
//
// Run:
//   npm run post-templates:add -- path/to/post.html \
//     --id=<slug> \
//     --name="<display name>" \
//     --register=<restaurante|belleza|gym|consultorio|tienda|oficios|general> \
//     --format=<square|story> \
//     --goal=<promo|anuncio|testimonio|info> \
//     [--status=draft|published|archived]
//
// Validates input via the same Zod schemas as the store layer,
// talks directly to the DB + storage adapter with full credentials.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { upsertPostTemplate, getPostTemplate } from "../lib/marketing/post-templates/store";
import { PostCreateSchema, htmlContainsEditorMarker } from "../lib/marketing/post-templates/admin-schemas";

interface ParsedFlags {
  htmlPath: string;
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedFlags | null {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) {
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
  return { htmlPath: positional[0], flags };
}

function usage(): string {
  return [
    "Usage:",
    "  npm run post-templates:add -- <path/to/post.html> \\",
    "    --id=<slug> \\",
    "    --name=<display name> \\",
    "    --register=<restaurante|belleza|gym|consultorio|tienda|oficios|general> \\",
    "    --format=<square|story> \\",
    "    --goal=<promo|anuncio|testimonio|info> \\",
    "    [--status=draft|published|archived] \\",
    "    [--allow-overwrite=true]",
  ].join("\n");
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(usage());
    process.exit(1);
  }

  const absPath = resolve(parsed.htmlPath);
  let html: string;
  try {
    html = await readFile(absPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read ${absPath}: ${msg}`);
    process.exit(1);
  }

  if (htmlContainsEditorMarker(html)) {
    console.error("HTML contains data-slot-path= — rejected.");
    process.exit(1);
  }

  const result = PostCreateSchema.safeParse({ ...parsed.flags, html });
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
    process.exit(1);
  }
  const input = result.data;

  // Id-collision gate: publishing over an existing id is opt-in, never silent.
  const existing = await getPostTemplate(input.id);
  if (existing && parsed.flags["allow-overwrite"] !== "true") {
    console.error(
      `id "${input.id}" already exists (created ${existing.createdAt.toISOString()}). Re-run with --allow-overwrite=true to replace it.`,
    );
    process.exit(1);
  }

  const rec = await upsertPostTemplate(input);
  console.log(`ok: ${rec.id} → ${rec.storageUrl} [${rec.status}]`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
