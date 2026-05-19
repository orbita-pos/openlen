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
import {
  CreateSchema,
  htmlContainsEditorMarker,
} from "../lib/templates/admin-schemas";

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
        // --flag with no value isn't supported; everything is --k=v
        return null;
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
    "  npm run templates:add -- <path/to/template.html> \\",
    "    --id=<slug> \\",
    "    --name=<display name> \\",
    "    --family=<technical-minimal|editorial|commerce> \\",
    "    --accent=#RRGGBB \\",
    "    --mode=<dark|light|cream> \\",
    "    --pitch=<one-line hook> \\",
    "    --description=<full sentence> \\",
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
  const { htmlPath, flags } = parsed;

  const absPath = resolve(htmlPath);
  let html: string;
  try {
    html = await readFile(absPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read ${absPath}: ${msg}`);
    process.exit(1);
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

  if (htmlContainsEditorMarker(result.data.html)) {
    console.error(
      "HTML contains `data-slot-path=` — that marker is only valid in editor-mode workspace output, not in a curated template. Re-export the HTML without it.",
    );
    process.exit(1);
  }

  console.log(`Uploading "${result.data.id}" (${result.data.html.length} bytes)...`);
  const record = await upsertTemplate(result.data);
  console.log("Done.");
  console.log(`  id           : ${record.id}`);
  console.log(`  status       : ${record.status}`);
  console.log(`  contentHash  : ${record.contentHash}`);
  console.log(`  storageUrl   : ${record.storageUrl}`);
  console.log(`  size         : ${record.size} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
