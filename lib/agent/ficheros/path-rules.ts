/**
 * JUST-IN-TIME PATH RULES (Plan Ruta 98 %, P2).
 *
 * Pure, deterministic glob-matched rules attached ONCE per turn at the end of a `Read`
 * result when Len touches high-risk paths (migrations, Edge Functions, the app's
 * package.json, motion artifacts). They are the platform's own: the list below.
 *
 * ⚰️ Project rules under `/.len/rules/*.md` were retired (Ruta 98 review, 2026-11-19).
 * They were never reachable: `/.len` is a hidden root of the folder (`folder.ts`,
 * `HIDDEN_ROOTS`), so nothing could write a file there and no store holds one — the
 * loader read a map that never had them. What a project wants Len to follow goes in
 * its `/LEN.md`, which is loaded every conversation.
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
    // The ROOT's manifest, as `folder.ts` treats it: a glob without a slash matches by file name at any depth, so
    // the negation keeps /node_modules/x/package.json and /src/a/package.json out (it needs a folder before the name).
    globs: ["package.json", "!**/*/package.json"],
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

/** Returns newly-matched path rules formatted in `<path-rules>` (mutating `seen` so each rule fires at most once per turn), or null. */
export function collectPathRules(absolutePath: string, seen: Set<string>): string | null {
  const rel = absolutePath.replace(/^\/+/, "");
  if (!rel) return null;
  const matched: PathRule[] = [];
  for (const rule of BUILTIN_PATH_RULES) {
    if (seen.has(rule.id)) continue;
    if (pasaLosGlobs(rel, rule.globs)) {
      seen.add(rule.id);
      matched.push(rule);
    }
  }
  if (matched.length === 0) return null;
  return `<path-rules for="${absolutePath}">\n${matched.map((r) => r.body).join("\n\n")}\n</path-rules>`;
}
