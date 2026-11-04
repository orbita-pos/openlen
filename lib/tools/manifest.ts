// A TOOL'S MANIFEST AND DISPLAY RECORD (spec local 2026-11-04-herramientas-hechas-por-len, §4.1). The shape is
// DeepSeek Harness's for a plugin bundle (`host-plugin.md`): `package.json` with a vendor field and `exports`
// for `./locale/*.json` and `./icon`; `meta.title` / `meta.description` in each locale file; an original icon,
// SVG, PNG, JPEG or WebP, at most 256 KiB, inside the package — «never silently accept default artwork».
// Pure: install and Len's `publish` read the project's files through it.
import { createHash } from "node:crypto";

import { isBlobPointer, sizeOf } from "@/lib/files/blob-pointer";

import { TOOL_PLACEMENTS, type ToolPlacement } from "./types";

export const ICON_MAX_BYTES = 262_144;
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 200;
const ICON_TYPES = [".svg", ".png", ".jpg", ".jpeg", ".webp"] as const;

export interface ToolManifest {
  readonly name: string;
  readonly version: string;
  readonly placement: ToolPlacement;
  readonly titles: Record<string, string>;
  readonly descriptions: Record<string, string>;
  readonly iconPath: string;
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
  | "icon_is_placeholder";

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

function metaOf(text: string | undefined): { title?: unknown; description?: unknown } | null {
  return record(record(parse(text))?.meta) as { title?: unknown; description?: unknown } | null;
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

  const placement = record(record(pkg.openlen)?.tool)?.placement;
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
    },
  };
}
