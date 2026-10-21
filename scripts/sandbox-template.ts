// scripts/sandbox-template.ts
// Builds the real terminal's E2B template (infra/e2b/openlen-terminal/template.ts) under the name
// in SANDBOX_TEMPLATE, 2 vCPU and 4 GiB (lib/agent/sandbox/size.ts). Writes OpenLen's box scripts
// to infra/e2b/openlen-terminal/.build/ first (git-ignored): E2B's `copy` takes local files.
//
// Needs the `e2b` package (Jesús installs it) and E2B_API_KEY. Costs E2B build time (cents).
//
// Run: npm run sandbox:template

import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { basename, join } from "node:path";

import { SANDBOX_TEMPLATE } from "../lib/agent/sandbox/config";
import { SANDBOX_MEMORY_GIB, SANDBOX_VCPU } from "../lib/agent/sandbox/size";
import { templateFiles } from "../lib/agent/sandbox/template-files";
import { defineTemplate, type TemplateBuilderLike } from "../infra/e2b/openlen-terminal/template";

async function main() {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) throw new Error("E2B_API_KEY is not set");
  const filesDir = join("infra", "e2b", "openlen-terminal", ".build");
  mkdirSync(filesDir, { recursive: true });
  for (const [boxPath, f] of Object.entries(templateFiles())) {
    const local = join(filesDir, basename(boxPath));
    writeFileSync(local, f.content);
    chmodSync(local, f.mode);
  }
  const name = "e2b";
  const e2b = (await import(/* @vite-ignore */ name)) as {
    Template: (() => TemplateBuilderLike) & {
      build(t: TemplateBuilderLike, name: string, o: Record<string, unknown>): Promise<{ name: string; templateId: string; buildId: string }>;
    };
    defaultBuildLogger?: () => unknown;
  };
  const info = await e2b.Template.build(defineTemplate(e2b.Template, filesDir), SANDBOX_TEMPLATE, {
    apiKey,
    cpuCount: SANDBOX_VCPU,
    memoryMB: SANDBOX_MEMORY_GIB * 1024,
    ...(e2b.defaultBuildLogger ? { onBuildLogs: e2b.defaultBuildLogger() } : {}),
  });
  console.log(`template ${info.name} built: id=${info.templateId} build=${info.buildId}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
