// A TOOL'S MANIFEST AND DISPLAY RECORD (spec local 2026-11-04-herramientas-hechas-por-len, §4.1). The shape is
// DeepSeek Harness's for a plugin bundle (`host-plugin.md`): `package.json` with a vendor field and `exports`
// for `./locale/*.json` and `./icon`; `meta.title` / `meta.description` in each locale file; an original icon,
// SVG, PNG, JPEG or WebP, at most 256 KiB, inside the package — «never silently accept default artwork».
// Pure: install and Len's `publish` read the project's files through it.
//
// Phase 3 (§4.6): `openlen.tool.jobs` declares the tool's jobs — a script `jobs/<file>.mjs|.py` each, with a ceiling
// of minutes — and each job's title lives beside the display record, in `locale/<lang>.json` → `jobs.<name>`. A job
// that isn't declared never runs.
import { createHash } from "node:crypto";

import { isBlobPointer, sizeOf } from "@/lib/files/blob-pointer";

import { TOOL_PLACEMENTS, type ToolPlacement } from "./types";

export const ICON_MAX_BYTES = 262_144;
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 200;
const ICON_TYPES = [".svg", ".png", ".jpg", ".jpeg", ".webp"] as const;

export const JOB_NAME = /^[a-z][a-z0-9-]{0,39}$/;
export const JOB_SCRIPT = /^\/jobs\/[A-Za-z0-9_.-]+\.(mjs|py)$/;
export const JOB_MAX_MINUTES = 30;
export const JOB_DEFAULT_MINUTES = 10;
export const MAX_JOBS = 8;

/** One declared job: its script in the package, its ceiling of minutes, and its title in each locale. */
export interface ToolJobDeclaration {
  readonly script: string;
  readonly maxMinutes: number;
  readonly titles: Record<string, string>;
}

export interface ToolManifest {
  readonly name: string;
  readonly version: string;
  readonly placement: ToolPlacement;
  readonly titles: Record<string, string>;
  readonly descriptions: Record<string, string>;
  readonly iconPath: string;
  readonly jobs: Record<string, ToolJobDeclaration>;
  /** Its operations for Len: an MCP server in one of its Edge Functions (phase 4, §4.7). */
  readonly mcp: ToolMcpDeclaration | null;
}

/** DeepSeek's `serverName` (Len sees `mcp__<serverName>__<operation>`), and the Edge Function serving it where DeepSeek has a `url`. */
export interface ToolMcpDeclaration {
  readonly serverName: string;
  readonly function: string;
}

/** Short enough that `mcp__<serverName>__<operation>` stays within the 64 characters a tool name may have. */
export const MCP_SERVER_NAME = /^[a-z][a-z0-9_-]{0,23}$/;
const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const FUNCTION_ENTRIES = ["index.ts", "index.tsx", "index.js"];

function readMcp(declared: unknown, files: Readonly<Record<string, string>>, problems: ManifestProblem[]): ToolMcpDeclaration | null {
  const decl = record(declared);
  if (!decl) return null;
  const serverName = typeof decl.serverName === "string" ? decl.serverName : "";
  const fn = typeof decl.function === "string" ? decl.function : "";
  if (!MCP_SERVER_NAME.test(serverName)) problems.push({ code: "mcp_bad_name", file: PACKAGE, detail: serverName });
  if (!FUNCTION_NAME.test(fn) || !FUNCTION_ENTRIES.some((e) => files[`/supabase/functions/${fn}/${e}`] !== undefined)) {
    problems.push({ code: "mcp_function_missing", file: PACKAGE, detail: fn });
  }
  return { serverName, function: fn };
}

export type ManifestProblemCode =
  | "no_package_json"
  | "bad_json"
  | "no_placement"
  | "bad_placement"
  | "no_locale_export"
  | "no_icon_export"
  | "missing_meta"
  | "meta_too_long"
  | "no_icon"
  | "icon_too_big"
  | "icon_bad_type"
  | "icon_not_an_image"
  | "icon_is_placeholder"
  | "job_bad_name"
  | "job_script_missing"
  | "job_script_kind"
  | "job_minutes"
  | "job_title_missing"
  | "job_too_many"
  | "mcp_bad_name"
  | "mcp_function_missing";

export interface ManifestProblem {
  readonly code: ManifestProblemCode;
  readonly file: string;
  readonly detail?: string;
}

export type ManifestResult = { ok: true; manifest: ToolManifest } | { ok: false; problems: ManifestProblem[] };

const PACKAGE = "/package.json";
const SVG_ROOT = /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg[\s>]/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parse(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** `./icon.svg` → `/icon.svg`; a URL, an absolute path or one that climbs out of the package → null. */
function packagePath(spec: string): string | null {
  if (!spec.startsWith("./") || spec.includes("://")) return null;
  const parts = spec.slice(2).split("/");
  if (parts.some((p) => p === ".." || p === "")) return null;
  return `/${parts.join("/")}`;
}

/** The jobs `openlen.tool.jobs` declares, checked against the files and the locale files' `jobs` titles. */
function readJobs(
  declared: unknown,
  files: Readonly<Record<string, string>>,
  problems: ManifestProblem[],
): Record<string, ToolJobDeclaration> {
  const jobs: Record<string, ToolJobDeclaration> = {};
  const entries = Object.entries(record(declared) ?? {});
  if (entries.length > MAX_JOBS) problems.push({ code: "job_too_many", file: PACKAGE, detail: `> ${MAX_JOBS}` });
  const titlesOf = (name: string): Record<string, string> => {
    const titles: Record<string, string> = {};
    for (const [path, text] of Object.entries(files)) {
      const m = /^\/locale\/([A-Za-z-]+)\.json$/.exec(path);
      const title = m ? record(record(parse(text))?.jobs)?.[name] : undefined;
      if (m && typeof title === "string" && title.trim()) titles[m[1]!] = title.trim().slice(0, TITLE_MAX);
    }
    return titles;
  };
  for (const [name, value] of entries.slice(0, MAX_JOBS)) {
    if (!JOB_NAME.test(name)) {
      problems.push({ code: "job_bad_name", file: PACKAGE, detail: name });
      continue;
    }
    const decl = record(value) ?? {};
    const spec = typeof decl.script === "string" ? decl.script : "";
    const script = packagePath(spec.startsWith("./") ? spec : `./${spec}`);
    if (!script || !JOB_SCRIPT.test(script)) {
      problems.push({ code: "job_script_kind", file: PACKAGE, detail: `${name}: ${spec}` });
      continue;
    }
    if (files[script] === undefined) problems.push({ code: "job_script_missing", file: script, detail: name });
    const minutes = decl.maxMinutes === undefined ? JOB_DEFAULT_MINUTES : decl.maxMinutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > JOB_MAX_MINUTES) {
      problems.push({ code: "job_minutes", file: PACKAGE, detail: `${name}: ${String(minutes)}` });
      continue;
    }
    const titles = titlesOf(name);
    if (Object.keys(titles).length === 0) problems.push({ code: "job_title_missing", file: "/locale/en.json", detail: name });
    jobs[name] = { script, maxMinutes: minutes, titles };
  }
  return jobs;
}

function metaOf(text: string | undefined): { title?: unknown; description?: unknown } | null {
  return record(record(parse(text))?.meta) as { title?: unknown; description?: unknown } | null;
}

/** The jobs a version can run (a job's start, §4.6): the ones `openlen.tool.jobs` declares well, with their script
 *  among `files`. Installing already refused a version with problems; a draft is read as it is. */
export function readToolJobs(files: Readonly<Record<string, string>>): Record<string, ToolJobDeclaration> {
  const declared = record(record(record(parse(files[PACKAGE]))?.openlen)?.tool)?.jobs;
  const jobs = readJobs(declared, files, []);
  return Object.fromEntries(Object.entries(jobs).filter(([, job]) => files[job.script] !== undefined));
}

export function readToolManifest(
  files: Readonly<Record<string, string>>,
  o: { readonly personLocale: string; readonly placeholderIconSha: string },
): ManifestResult {
  const raw = files[PACKAGE];
  if (raw === undefined) return { ok: false, problems: [{ code: "no_package_json", file: PACKAGE }] };
  const pkg = record(parse(raw));
  if (!pkg) return { ok: false, problems: [{ code: "bad_json", file: PACKAGE }] };

  const problems: ManifestProblem[] = [];

  const toolField = record(record(pkg.openlen)?.tool);
  const placement = toolField?.placement;
  if (placement === undefined) problems.push({ code: "no_placement", file: PACKAGE });
  else if (!TOOL_PLACEMENTS.includes(placement as ToolPlacement))
    problems.push({ code: "bad_placement", file: PACKAGE, detail: String(placement) });

  const exportsField = record(pkg.exports) ?? {};
  if (typeof exportsField["./locale/*.json"] !== "string") problems.push({ code: "no_locale_export", file: PACKAGE });
  const iconSpec = exportsField["./icon"];
  if (typeof iconSpec !== "string") problems.push({ code: "no_icon_export", file: PACKAGE });

  // The display record: English and the person's language are required; every locale file present is read.
  const titles: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    const m = /^\/locale\/([A-Za-z-]+)\.json$/.exec(path);
    if (!m) continue;
    const meta = metaOf(text);
    if (typeof meta?.title === "string" && meta.title.trim()) titles[m[1]!] = meta.title.trim();
    if (typeof meta?.description === "string" && meta.description.trim()) descriptions[m[1]!] = meta.description.trim();
  }
  for (const locale of [...new Set(["en", o.personLocale])]) {
    const file = `/locale/${locale}.json`;
    const title = titles[locale];
    const description = descriptions[locale];
    if (!title || !description) {
      problems.push({ code: "missing_meta", file });
      continue;
    }
    if (title.length > TITLE_MAX) problems.push({ code: "meta_too_long", file, detail: `meta.title > ${TITLE_MAX}` });
    if (description.length > DESCRIPTION_MAX) problems.push({ code: "meta_too_long", file, detail: `meta.description > ${DESCRIPTION_MAX}` });
  }

  let iconPath = "";
  if (typeof iconSpec === "string") {
    const path = packagePath(iconSpec);
    const type = path ? ICON_TYPES.find((t) => path.toLowerCase().endsWith(t)) : undefined;
    if (!path || !type) problems.push({ code: "icon_bad_type", file: PACKAGE, detail: iconSpec });
    else {
      iconPath = path;
      const content = files[path];
      if (content === undefined) problems.push({ code: "no_icon", file: path });
      else if (sizeOf(content) > ICON_MAX_BYTES) problems.push({ code: "icon_too_big", file: path });
      else if (!isBlobPointer(content)) {
        // A binary is always kept as a pointer, so a PNG/JPEG/WebP that came as text isn't one.
        if (type !== ".svg" || !SVG_ROOT.test(content)) problems.push({ code: "icon_not_an_image", file: path });
        else if (createHash("sha256").update(content).digest("hex") === o.placeholderIconSha)
          problems.push({ code: "icon_is_placeholder", file: path });
      }
    }
  }

  const jobs = readJobs(toolField?.jobs, files, problems);
  const mcp = readMcp(toolField?.mcp, files, problems);

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    manifest: {
      name: typeof pkg.name === "string" ? pkg.name : "",
      version: typeof pkg.version === "string" ? pkg.version : "",
      placement: placement as ToolPlacement,
      titles,
      descriptions,
      iconPath,
      jobs,
      mcp,
    },
  };
}
