// Los correos de /auth/v1 de verdad: sus textos (mail-texts.ts, 10 idiomas)
// por el envío de siempre (Resend).
// En desarrollo, sin clave de Resend, el correo se apunta en la consola con su
// enlace (lib/email.ts).
//
// PROJECT EMAIL (spec local 2026-10-22-email-integration, 6.4): with the project's
// domain ready, a paid plan and room in the month, they go out from that domain
// through the sending core, with the project's Supabase template if it has one.
// Otherwise from OpenLen, as before: nobody is ever left without their email.
// Only the hourly cap refuses one, as in Lovable. The draft sends only to the
// project's team, by either road.

import "server-only";

import { sendPageAuthEmail } from "@/lib/email";
import { readAuthTemplates, renderAuthTemplate, templatePath, templateProblem, templateTypeOf } from "@/lib/project-email/auth-templates";
import type { SendInput, SendOutcome } from "@/lib/project-email/send";
import { normalizeAddress } from "@/lib/project-email/types";

import { authEmailContent } from "./mail-texts";
import type { AuthMail } from "./config";

export interface AuthMailDeps {
  readonly emailOn: boolean;
  /** "Brand <noreply@sending host>" when the project's domain is ready; null otherwise. */
  fromOf(projectId: string): Promise<string | null>;
  send(i: SendInput): Promise<SendOutcome>;
  /** OpenLen's own sender, as always. */
  fallback(m: { to: string; subject: string; html: string; text: string }): Promise<void>;
  team(projectId: string): Promise<string[]>;
  supabaseFiles(projectId: string): Promise<Record<string, string>>;
}

async function realAuthMailDeps(): Promise<AuthMailDeps> {
  const [{ emailEnabledIn }, { realSendDeps }, { sendProjectEmail }, { pgEmailStore }, { listProjectFiles }, { db, schema }, { eq }] = await Promise.all([
    import("@/lib/project-email/enabled"),
    import("@/lib/project-email/real"),
    import("@/lib/project-email/send"),
    import("@/lib/project-email/store-pg"),
    import("@/lib/backend/files"),
    import("@/lib/db"),
    import("drizzle-orm"),
  ]);
  const sendDeps = realSendDeps();
  return {
    emailOn: emailEnabledIn(),
    async fromOf(projectId) {
      const domain = await pgEmailStore.getDomain(projectId);
      if (domain?.status !== "ready") return null;
      const [p] = await db.select({ title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
      const name = (p?.title ?? "").replace(/[<>"\r\n]/g, "").trim();
      return name ? `${name} <noreply@${domain.sendingHost}>` : `noreply@${domain.sendingHost}`;
    },
    send: (i) => sendProjectEmail(i, sendDeps),
    fallback: (m) => sendPageAuthEmail(m),
    team: (projectId) => sendDeps.team(projectId),
    supabaseFiles: (projectId) => listProjectFiles(projectId, "/supabase/"),
  };
}

/** The project's Supabase template for this email, filled; null when it has none or it can't be used. */
async function fromTemplate(mail: AuthMail, siteHost: string, files: Readonly<Record<string, string>>): Promise<{ subject: string | null; html: string } | null> {
  const t = readAuthTemplates(files["/supabase/config.toml"] ?? "")[templateTypeOf(mail.kind)];
  const html = t?.contentPath ? files[templatePath(t.contentPath)] : undefined;
  if (!t || html === undefined || templateProblem(templateTypeOf(mail.kind), html)) return null;
  const r = renderAuthTemplate({ subject: t.subject ?? "", html }, { ConfirmationURL: mail.link, Token: mail.otp, SiteURL: `https://${siteHost}`, Email: mail.to, RedirectTo: mail.redirectTo });
  if ("error" in r) return null;
  return { subject: t.subject ? r.subject : null, html: r.html };
}

/** `siteHost`: el host de la página del proyecto, que es lo que reconoce quien
 *  recibe el correo. */
export async function sendAuthEmail(
  mail: AuthMail,
  ctx: { readonly siteHost: string; readonly projectId: string; readonly environment: "draft" | "live" },
  deps?: AuthMailDeps,
): Promise<void> {
  const d = deps ?? (await realAuthMailDeps());
  if (ctx.environment === "draft") {
    const team = new Set((await d.team(ctx.projectId)).map(normalizeAddress));
    if (!team.has(normalizeAddress(mail.to))) {
      console.info("[backend] correo del borrador, no se envía:", mail.kind, mail.to);
      return;
    }
  }
  const kind = mail.kind === "signup" ? "confirm" : mail.kind === "invite" ? "invite" : "recovery";
  const base = authEmailContent({ kind, link: mail.link, host: ctx.siteHost, lang: mail.lang ?? null });
  const tpl = await fromTemplate(mail, ctx.siteHost, await d.supabaseFiles(ctx.projectId).catch(() => ({})));
  const content = { subject: tpl?.subject ?? base.subject, html: tpl?.html ?? base.html, text: base.text };

  if (d.emailOn) {
    const from = await d.fromOf(ctx.projectId);
    if (from) {
      const r = await d.send({ projectId: ctx.projectId, environment: ctx.environment, kind: "auth", email: { from, to: [mail.to], ...content } });
      if (r.kind !== "rejected") return;
      if (r.error.name === "rate_limit_exceeded") {
        console.warn("[email] sign-in email over the hourly cap, not sent:", ctx.projectId, mail.kind);
        return;
      }
    }
  }
  await d.fallback({ to: mail.to, ...content });
}
