// lib/project-email/auth-templates.ts — THE SIGN-IN EMAILS' TEMPLATES, AS SUPABASE'S
// (spec local 2026-10-22-email-integration, 5 and 6.4): `[auth.email.template.<type>]`
// in supabase/config.toml with `subject` and `content_path`, and the HTML with
// Supabase's variables. Only `{{ .Name }}` of the five a page's sign-in has; any
// other Go template action is refused with the reason, never half-rendered.
// Pure.

import type { Diagnostico } from "@/lib/agent/diagnosticos";
import type { AuthMail } from "@/lib/backend/auth/config";

export type SupabaseTemplateType = "confirmation" | "recovery" | "invite" | "magic_link";

export function templateTypeOf(kind: AuthMail["kind"]): SupabaseTemplateType {
  return kind === "signup" ? "confirmation" : kind === "magiclink" ? "magic_link" : kind;
}

const SECTION = /^\[\s*auth\.email\.template\.([a-z_]+)\s*\]\s*(?:#.*)?$/;
const ANY_SECTION = /^\[[^\]]*\]/;
const KEY = /^(subject|content_path)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/;
const TYPES = new Set<string>(["confirmation", "recovery", "invite", "magic_link"]);

export function readAuthTemplates(configToml: string): Partial<Record<SupabaseTemplateType, { subject?: string; contentPath?: string }>> {
  const out: Partial<Record<SupabaseTemplateType, { subject?: string; contentPath?: string }>> = {};
  let current: SupabaseTemplateType | null = null;
  for (const raw of configToml.split(/\r?\n/)) {
    const line = raw.trim();
    const s = SECTION.exec(line);
    if (s) {
      current = TYPES.has(s[1]!) ? (s[1] as SupabaseTemplateType) : null;
      if (current) out[current] ??= {};
      continue;
    }
    if (ANY_SECTION.test(line)) {
      current = null;
      continue;
    }
    const k = current ? KEY.exec(line) : null;
    if (!k || !current) continue;
    const value = k[2] !== undefined ? k[2].replace(/\\(["\\])/g, "$1") : k[3]!;
    out[current]![k[1] === "subject" ? "subject" : "contentPath"] = value;
  }
  return out;
}

export interface AuthTemplateVars {
  readonly ConfirmationURL: string;
  readonly Token: string;
  readonly SiteURL: string;
  readonly Email: string;
  readonly RedirectTo: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ACTION = /\{\{[\s\S]*?\}\}/g;
const VARIABLE = /^\{\{\s*\.([A-Za-z]+)\s*\}\}$/;

function fill(text: string, vars: AuthTemplateVars, escape: boolean): string | { error: string } {
  // `{{ .Data.name }}` has a dot inside: VARIABLE doesn't match it, so it is refused as an action.
  const problems: string[] = [];
  const out = text.replace(ACTION, (action) => {
    const m = VARIABLE.exec(action);
    if (!m) {
      problems.push(`Only {{ .Name }} variables are supported here, not ${action.slice(0, 40)}.`);
      return action;
    }
    const name = m[1] as keyof AuthTemplateVars;
    if (!Object.hasOwn(vars, name)) {
      problems.push(`{{ .${name} }} isn't one of the variables: ConfirmationURL, Token, SiteURL, Email, RedirectTo.`);
      return action;
    }
    return escape ? escapeHtml(vars[name]) : vars[name];
  });
  return problems.length > 0 ? { error: problems[0]! } : out;
}

export function renderAuthTemplate(tpl: { subject: string; html: string }, vars: AuthTemplateVars): { subject: string; html: string } | { error: string } {
  const subject = fill(tpl.subject, vars, false);
  if (typeof subject !== "string") return subject;
  const html = fill(tpl.html, vars, true);
  if (typeof html !== "string") return html;
  return { subject, html };
}

/** Without the link nor the code, whoever gets it can't sign in: that's what would leave people out. */
export function templateProblem(type: SupabaseTemplateType, html: string): string | null {
  if (/\{\{\s*\.ConfirmationURL\s*\}\}/.test(html) || /\{\{\s*\.Token\s*\}\}/.test(html)) return null;
  return `The ${type} email template has neither {{ .ConfirmationURL }} nor {{ .Token }}: whoever gets it couldn't sign in.`;
}

/** `./supabase/templates/x.html` (relative to the project, as the Supabase CLI) → `/supabase/templates/x.html`. */
export function templatePath(contentPath: string): string {
  return `/${contentPath.replace(/^\.\//, "").replace(/^\/+/, "")}`;
}

const AUTH_PATH = /^\/supabase\/(config\.toml|templates\/)/;

/** After Len wrote config.toml or a template: what would break a sign-in email, as diagnostics. */
export function authTemplateDiagnostics(written: readonly string[], files: Readonly<Record<string, string>>): Diagnostico[] {
  if (!written.some((p) => AUTH_PATH.test(p))) return [];
  const toml = files["/supabase/config.toml"];
  if (!toml) return [];
  const out: Diagnostico[] = [];
  const at = (ruta: string, mensaje: string): Diagnostico => ({ ruta, linea: 1, columna: 1, gravedad: "Error", mensaje, codigo: "auth-email-template", fuente: "supabase" });
  for (const [type, t] of Object.entries(readAuthTemplates(toml)) as [SupabaseTemplateType, { subject?: string; contentPath?: string }][]) {
    if (!t.contentPath) continue;
    const path = templatePath(t.contentPath);
    const html = files[path];
    if (html === undefined) {
      out.push(at("/supabase/config.toml", `[auth.email.template.${type}] content_path ${t.contentPath} doesn't exist.`));
      continue;
    }
    const problem = templateProblem(type, html);
    const rendered = renderAuthTemplate({ subject: t.subject ?? "", html }, { ConfirmationURL: "x", Token: "x", SiteURL: "x", Email: "x", RedirectTo: "x" });
    const why = problem ?? ("error" in rendered ? rendered.error : null);
    if (why) out.push(at(path, why));
  }
  return out;
}
