/**
 * JUST-IN-TIME PATH RULES (Plan Ruta 98 %, P2).
 *
 * Pure, deterministic glob-matched rules attached ONCE per turn at the end of a `Read`
 * result when Len touches high-risk paths (migrations, Edge Functions, package.json,
 * motion artifacts) or user-defined project rules under `/.len/rules/*.md`.
 *
 * Cache effect: zero on the cached prefix — rules ride inside the tool result that
 * triggered them and never mutate message 0 or the tool catalog.
 */
import { pasaLosGlobs } from "./patron-glob";

export interface PathRule {
  readonly id: string;
  readonly globs: readonly string[];
  readonly body: string;
}

export const PROJECT_RULES_DIR = "/.len/rules/";
const MAX_CUSTOM_RULE_FILES = 10;
const MAX_CUSTOM_RULE_CHARS = 2_000;

export const BUILTIN_PATH_RULES: readonly PathRule[] = [
  {
    id: "builtin:supabase-migrations",
    globs: ["supabase/migrations/**"],
    body:
      "Supabase migrations rules:\n" +
      "- Enable RLS (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) on every public table; the browser ships the publishable key.\n" +
      "- Never write `FOR UPDATE/DELETE TO authenticated USING (true)` on user-owned rows: scope policies to `auth.uid()` or an explicit role check.\n" +
      "- Keep DDL idempotent (`IF NOT EXISTS`) and never rely on client-side checks for authorization.",
  },
  {
    id: "builtin:supabase-functions",
    globs: ["supabase/functions/**", "supabase/config.toml"],
    body:
      "Edge Functions rules:\n" +
      "- Edge Functions run on Deno. If `verify_jwt = false`, the endpoint is public: verify provider webhook signatures (Stripe, Mercado Pago) or explicitly authorize the caller before using the service_role/secret key.\n" +
      "- Never send email via `RESEND_API_KEY` to an arbitrary request-supplied recipient without caller authorization (open relay).\n" +
      "- Keep secrets strictly inside Edge Functions — never expose them to `/src` or HTML.",
  },
  {
    id: "builtin:app-package-json",
    globs: ["package.json"],
    body:
      "App package.json rule:\n" +
      "- Use verified packages compatible with OpenLen's app catalog; avoid inventing unverified versions or native Node binaries that cannot run in the browser bundle.",
  },
  {
    id: "builtin:motion-artifact",
    globs: [".len/artifacts/**/motion.json", ".len/artifacts/**/main.{ts,tsx,js,jsx}"],
    body:
      "Motion artifact (GSAP) rules:\n" +
      "- Build one `gsap.timeline({ paused: true })` with explicit `fromTo` endpoints and `immediateRender: false`; `seek(t)` must be purely deterministic.\n" +
      "- Avoid CSS `transition`/`@keyframes` on `transform` for GSAP-animated elements, and never call `getBoundingClientRect()` inside `onUpdate`.",
  },
];

/** Parses a `/.len/rules/<name>.md` file with simple YAML frontmatter (`paths:` list or comma-separated globs). */
export function parseCustomRuleFile(filePath: string, raw: string): PathRule | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw.trimStart());
  if (!m) return null;
  const front = m[1]!;
  const body = m[2]!.trim().slice(0, MAX_CUSTOM_RULE_CHARS);
  if (!body) return null;

  const globs: string[] = [];
  const lines = front.split(/\r?\n/);
  let inPathsList = false;
  for (const line of lines) {
    const inline = /^paths\s*:\s*(.+)$/.exec(line.trim());
    if (inline) {
      inPathsList = false;
      const val = inline[1]!.trim();
      if (val.startsWith("[") && val.endsWith("]")) {
        for (const item of val.slice(1, -1).split(",")) {
          const clean = item.trim().replace(/^['"]|['"]$/g, "").replace(/^\/+/, "");
          if (clean) globs.push(clean);
        }
      } else {
        for (const item of val.split(",")) {
          const clean = item.trim().replace(/^['"]|['"]$/g, "").replace(/^\/+/, "");
          if (clean) globs.push(clean);
        }
      }
      continue;
    }
    if (/^paths\s*:\s*$/.test(line.trim())) {
      inPathsList = true;
      continue;
    }
    if (inPathsList) {
      const bullet = /^\s*-\s+(.+)$/.exec(line);
      if (bullet) {
        const clean = bullet[1]!.trim().replace(/^['"]|['"]$/g, "").replace(/^\/+/, "");
        if (clean) globs.push(clean);
      } else if (line.trim() !== "") {
        inPathsList = false;
      }
    }
  }
  if (globs.length === 0) return null;
  return { id: `project:${filePath}`, globs, body };
}

export type ProjectFilesMap = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

/** Loads any valid project rules from `/.len/rules/*.md`. */
export function customPathRulesFrom(files: ProjectFilesMap | undefined): PathRule[] {
  if (!files) return [];
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  const out: PathRule[] = [];
  for (const [path, content] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!path.startsWith(PROJECT_RULES_DIR) || !path.endsWith(".md")) continue;
    if (out.length >= MAX_CUSTOM_RULE_FILES) break;
    const rule = parseCustomRuleFile(path, content);
    if (rule) out.push(rule);
  }
  return out;
}

/** Returns newly-matched path rules formatted in `<path-rules>` (mutating `seen` so each rule fires at most once per turn), or null. */
export function collectPathRules(
  absolutePath: string,
  seen: Set<string>,
  projectFiles?: ProjectFilesMap,
): string | null {
  const rel = absolutePath.replace(/^\/+/, "");
  if (!rel || rel.startsWith(".len/rules/")) return null;
  const all = [...BUILTIN_PATH_RULES, ...customPathRulesFrom(projectFiles)];
  const matched: PathRule[] = [];
  for (const rule of all) {
    if (seen.has(rule.id)) continue;
    if (pasaLosGlobs(rel, rule.globs)) {
      seen.add(rule.id);
      matched.push(rule);
    }
  }
  if (matched.length === 0) return null;
  return `<path-rules for="${absolutePath}">\n${matched.map((r) => r.body).join("\n\n")}\n</path-rules>`;
}
