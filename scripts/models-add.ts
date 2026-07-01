// CLI: add (or replace) a single curated GLB model by file + flags.
//
// Run:
//   npm run models:add -- path/to/model.glb \
//     --id=glass-sphere \
//     --name="Glass Sphere" \
//     --family=decorative \
//     --pitch="Refractive glass orb for hero depth" \
//     --description="A hollow glass sphere with environment reflections." \
//     [--author="Artist Name"] \
//     [--tags=glass,sphere,transparent] \
//     [--license=cc0] \
//     [--status=draft]
//
// Validates input via the same Zod schemas as POST /api/admin/models,
// so behavior is identical to the HTTP path. Talks directly to DB + storage
// — no HTTP, no auth — because it runs locally with full DB credentials.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { upsertModel } from "../lib/models/store";
import { CreateSchema } from "../lib/models/admin-schemas";

interface ParsedFlags {
  glbPath: string;
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
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) return null;
  return { glbPath: positional[0], flags };
}

function usage(): string {
  return [
    "Usage:",
    "  npm run models:add -- <path/to/model.glb> \\",
    "    --id=<slug> \\",
    "    --name=<display name> \\",
    "    --family=<product|decorative|prop|character|mechanical> \\",
    "    --pitch=<one-line hook> \\",
    "    --description=<full sentence> \\",
    "    [--author=<artist name>] \\",
    "    [--tags=<comma-separated>] \\",
    "    [--license=cc0|cc-by-4.0] \\",
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
  const { glbPath, flags } = parsed;

  const absPath = resolve(glbPath);
  let glb: Buffer;
  try {
    glb = await readFile(absPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read ${absPath}: ${msg}`);
    process.exit(1);
  }

  const tags = flags.tags
    ? flags.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  const payload = {
    id: flags.id,
    name: flags.name,
    family: flags.family,
    pitch: flags.pitch,
    description: flags.description,
    glb,
    ...(flags.author ? { author: flags.author } : {}),
    ...(tags ? { tags } : {}),
    ...(flags.license ? { license: flags.license } : {}),
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

  console.log(`Uploading "${result.data.id}" (${result.data.glb.byteLength} bytes)...`);
  const record = await upsertModel(result.data);
  console.log("Uploaded.");
  console.log(`  id           : ${record.id}`);
  console.log(`  family       : ${record.family}`);
  console.log(`  status       : ${record.status}`);
  console.log(`  contentHash  : ${record.contentHash}`);
  console.log(`  storageUrl   : ${record.storageUrl}`);
  console.log(`  size         : ${record.size} bytes`);
  console.log(`  license      : ${record.license}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
