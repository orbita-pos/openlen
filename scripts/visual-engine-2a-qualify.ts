import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import { VISUAL_ENGINE_2A_PILOT_CASES } from "@/lib/generation/visual-engine-2a-cohort";
import {
  qualifyVisualEngine2ACohort,
  type SelectionCatalogTemplate,
  type TemplateMaterial,
  type VisualEngine2AQualificationManifest,
} from "@/lib/generation/visual-engine-2a-qualification";
import { buildSkeletonInventory } from "@/lib/generation/skeleton-inventory";

const execFileAsync = promisify(execFile);

export type QualificationCliFailureCode =
  | "catalog_load_failed"
  | "template_html_unavailable"
  | "commit_lookup_failed"
  | "commit_changed"
  | "qualification_failed"
  | "artifact_write_failed";

export class QualificationCliError extends Error {
  constructor(readonly code: QualificationCliFailureCode) {
    super(`Visual Engine 2A qualification failed: ${code}`);
    this.name = "QualificationCliError";
  }
}

export interface QualificationCliDependencies {
  listTemplates: (options: { status: "published" }) => Promise<readonly SelectionCatalogTemplate[]>;
  getTemplateHtml: (id: string) => Promise<string | null>;
  getCommitSha: () => Promise<string>;
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>;
  writeJsonAtomic: (path: string, value: unknown) => Promise<unknown>;
  log: (line: string) => void;
}

function failure(code: QualificationCliFailureCode): never {
  throw new QualificationCliError(code);
}

function qualificationArtifactPath(cwd: string): string {
  return join(cwd, "scratch", "visual-engine-2a", "qualification.json");
}

function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

async function captureCommitSha(getCommitSha: QualificationCliDependencies["getCommitSha"]): Promise<string> {
  try {
    const commitSha = await getCommitSha();
    return isCommitSha(commitSha) ? commitSha : failure("commit_lookup_failed");
  } catch {
    return failure("commit_lookup_failed");
  }
}

async function loadTemplateMaterials(
  ids: readonly string[],
  getHtml: QualificationCliDependencies["getTemplateHtml"],
): Promise<TemplateMaterial[]> {
  return Promise.all(ids.map(async (id) => {
    let html: string | null;
    try {
      html = await getHtml(id);
    } catch {
      return failure("template_html_unavailable");
    }
    if (typeof html !== "string") return failure("template_html_unavailable");
    try {
      return { id, html, inventory: buildSkeletonInventory(html, id) };
    } catch {
      return failure("template_html_unavailable");
    }
  }));
}

export async function runVisualEngine2AQualification(
  deps: QualificationCliDependencies,
  cwd = process.cwd(),
): Promise<VisualEngine2AQualificationManifest> {
  try {
    const initialCommitSha = await captureCommitSha(deps.getCommitSha);
    let selectionCatalog: readonly SelectionCatalogTemplate[];
    try {
      selectionCatalog = await deps.listTemplates({ status: "published" });
    } catch {
      return failure("catalog_load_failed");
    }
    const allowedIds = [...new Set(VISUAL_ENGINE_2A_PILOT_CASES.flatMap((caseRow) => caseRow.allowedSkeletonTemplateIds))];
    const templateMaterials = await loadTemplateMaterials(allowedIds, deps.getTemplateHtml);
    const result = qualifyVisualEngine2ACohort({
      cases: VISUAL_ENGINE_2A_PILOT_CASES,
      selectionCatalog,
      templateMaterials,
      commitSha: initialCommitSha,
    });
    if (!result.ok) return failure("qualification_failed");

    const finalCommitSha = await captureCommitSha(deps.getCommitSha);
    if (finalCommitSha !== initialCommitSha) return failure("commit_changed");

    const targetPath = qualificationArtifactPath(cwd);
    try {
      await deps.mkdir(dirname(targetPath), { recursive: true });
      await deps.writeJsonAtomic(targetPath, result.manifest);
    } catch {
      return failure("artifact_write_failed");
    }
    deps.log(JSON.stringify({ event: "visual_engine_2a_qualification", ok: true, templateCount: templateMaterials.length }));
    return result.manifest;
  } catch (error) {
    const code = error instanceof QualificationCliError ? error.code : "qualification_failed";
    deps.log(JSON.stringify({ event: "visual_engine_2a_qualification", ok: false, code }));
    throw new QualificationCliError(code);
  }
}

async function gitCommitSha(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), shell: false });
  return stdout.trim();
}

async function productionDependencies(): Promise<QualificationCliDependencies> {
  const { getTemplateHtml, listTemplates } = await import("@/lib/templates/store");
  return {
    listTemplates: async (options) => (await listTemplates(options)).map((template) => ({
      id: template.id,
      status: template.status,
      visualMetadata: template.visualMetadata,
    })),
    getTemplateHtml,
    getCommitSha: gitCommitSha,
    mkdir,
    writeJsonAtomic,
    log: (line) => console.log(line),
  };
}

async function main(): Promise<void> {
  await runVisualEngine2AQualification(await productionDependencies());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { process.exitCode = 1; });
}
