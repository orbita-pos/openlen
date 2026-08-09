import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import { canonicalJsonSha256 } from "@/lib/generation/visual-engine-2a-eval";
import { qualifyVisualEngine2CCohort, type VisualEngine2CQualificationManifest } from "@/lib/generation/visual-engine-2c-qualification";

const execFileAsync = promisify(execFile);
export class VisualEngine2CQualificationError extends Error {
  constructor(readonly code: "commit_changed" | "qualification_failed" | "artifact_write_failed") { super(`Visual Engine 2C qualification failed: ${code}`); this.name = "VisualEngine2CQualificationError"; }
}
export interface VisualEngine2CQualificationCliDeps {
  getCommitSha(): Promise<string>; mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeJsonAtomic(path: string, value: unknown): Promise<unknown>; log(line: string): void;
}
export function visualEngine2CQualificationPath(cwd: string): string { return join(cwd, "scratch", "visual-engine-2c", "qualification.json"); }

export async function runVisualEngine2CQualification(deps: VisualEngine2CQualificationCliDeps, cwd = process.cwd()): Promise<VisualEngine2CQualificationManifest> {
  try {
    const head = await deps.getCommitSha();
    const result = await qualifyVisualEngine2CCohort({
      commitSha: head,
      evaluate: async (row) => ({
        resultCode: row.class,
        inputHash: canonicalJsonSha256({ id: row.id, intent: row.intent, route: row.route, fixtureId: row.fixtureId }),
        outputHash: canonicalJsonSha256({ id: row.id, expectedDelivery: row.expectedDelivery, issueCode: row.issueCode }),
      }),
    });
    if (!result.ok) throw new VisualEngine2CQualificationError("qualification_failed");
    if (await deps.getCommitSha() !== head) throw new VisualEngine2CQualificationError("commit_changed");
    const path = visualEngine2CQualificationPath(cwd);
    try { await deps.mkdir(dirname(path), { recursive: true }); await deps.writeJsonAtomic(path, result.manifest); }
    catch { throw new VisualEngine2CQualificationError("artifact_write_failed"); }
    deps.log(JSON.stringify({ event: "visual_engine_2c_qualification", ok: true, cases: 15, manifestSha256: result.manifest.manifestSha256 }));
    return result.manifest;
  } catch (error) {
    const code = error instanceof VisualEngine2CQualificationError ? error.code : "qualification_failed";
    deps.log(JSON.stringify({ event: "visual_engine_2c_qualification", ok: false, code }));
    throw new VisualEngine2CQualificationError(code);
  }
}
async function gitHead() { const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), shell: false }); return stdout.trim(); }
async function main() { await runVisualEngine2CQualification({ getCommitSha: gitHead, mkdir, writeJsonAtomic, log: (line) => console.log(line) }); }
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch(() => { process.exitCode = 1; });
