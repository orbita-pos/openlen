import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import {
  qualifyVisualEngine2BCohort,
  type VisualEngine2BQualificationManifest,
} from "@/lib/generation/visual-engine-2b-qualification";
import type { SectionRecord } from "@/lib/sections/store";

const execFileAsync = promisify(execFile);

export class VisualEngine2BQualificationError extends Error {
  constructor(readonly code: "section_catalog_failed" | "commit_changed" | "qualification_failed" | "artifact_write_failed") {
    super(`Visual Engine 2B qualification failed: ${code}`);
    this.name = "VisualEngine2BQualificationError";
  }
}

export interface VisualEngine2BQualificationCliDeps {
  listPublishedSections(): Promise<readonly SectionRecord[]>;
  getCommitSha(): Promise<string>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeJsonAtomic(path: string, value: unknown): Promise<unknown>;
  log(line: string): void;
}

export function visualEngine2BQualificationPath(cwd: string): string {
  return join(cwd, "scratch", "visual-engine-2b", "qualification.json");
}

export async function runVisualEngine2BQualification(
  deps: VisualEngine2BQualificationCliDeps,
  cwd = process.cwd(),
): Promise<VisualEngine2BQualificationManifest> {
  try {
    const initialCommit = await deps.getCommitSha();
    let records: readonly SectionRecord[];
    try {
      records = await deps.listPublishedSections();
    } catch {
      throw new VisualEngine2BQualificationError("section_catalog_failed");
    }
    const result = await qualifyVisualEngine2BCohort({
      loadPublishedSections: async () => records,
      commitSha: async () => initialCommit,
    });
    if (!result.ok) throw new VisualEngine2BQualificationError("qualification_failed");
    if (await deps.getCommitSha() !== initialCommit) {
      throw new VisualEngine2BQualificationError("commit_changed");
    }
    const path = visualEngine2BQualificationPath(cwd);
    try {
      await deps.mkdir(dirname(path), { recursive: true });
      await deps.writeJsonAtomic(path, result.manifest);
    } catch {
      throw new VisualEngine2BQualificationError("artifact_write_failed");
    }
    deps.log(JSON.stringify({ event: "visual_engine_2b_qualification", ok: true, cases: 15, inventoryHash: result.manifest.inventoryHash }));
    return result.manifest;
  } catch (error) {
    const code = error instanceof VisualEngine2BQualificationError ? error.code : "qualification_failed";
    deps.log(JSON.stringify({ event: "visual_engine_2b_qualification", ok: false, code }));
    throw new VisualEngine2BQualificationError(code);
  }
}

async function gitCommitSha(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), shell: false });
  return stdout.trim();
}

async function productionDeps(): Promise<VisualEngine2BQualificationCliDeps> {
  const { listSections } = await import("@/lib/sections/store");
  return {
    listPublishedSections: () => listSections({ status: "published" }),
    getCommitSha: gitCommitSha,
    mkdir,
    writeJsonAtomic,
    log: (line) => console.log(line),
  };
}

async function main(): Promise<void> {
  await runVisualEngine2BQualification(await productionDeps());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { process.exitCode = 1; });
}
