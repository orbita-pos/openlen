/**
 * THE FORM'S AUTOMATIC REPLY, WRITTEN BY LEN — `set_form_auto_reply` (spec local
 * 2026-10-22-email-integration, 6.5 and 6.8). The same setting the inspector
 * writes (`autoReply` in the form's config), through the same settings-patch,
 * with the form found by the same keys: its own id, else page + index. Before
 * saving, the template is rendered as it would go out: a link to a site that
 * isn't the project's is refused here, where Len can fix it.
 */
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { renderReply } from "@/lib/project-email/form-reply";
import { publishedHost } from "@/lib/publish/base-host";
import { applySettingsPatch, validateSettingsPatch, type SettingsPatchBody } from "@/lib/projects/settings-patch";

export const SET_FORM_AUTO_REPLY = "set_form_auto_reply";

export const SET_FORM_AUTO_REPLY_DECLARATION: Record<string, unknown> = {
  name: SET_FORM_AUTO_REPLY,
  description:
    "Set (or turn off) the automatic email reply a page's form sends to whoever fills it, from the project's email domain: the same setting as the form's «Automatic reply» in the inspector. "
    + "`{{field}}` in the subject or text puts in what they wrote in that field (by its name attribute). One reply per address a day; links only to the project's own sites. "
    + "It goes out only with the project's email domain ready on a paid plan (PROJECT STATE's `email`); saved before that, it waits for it.",
  parameters: {
    type: "OBJECT",
    properties: {
      form_id: { type: "STRING", description: "The form's data-ol-form-id, when it has one. It wins over form_index." },
      page: { type: "STRING", description: "The site page's slug the form is on (e.g. menu); omit it for the home page." },
      form_index: { type: "INTEGER", description: "Which <form> of that page, counting from 0 in document order." },
      subject: { type: "STRING", description: "The email's subject, in the visitor's language." },
      body: { type: "STRING", description: "The email's text: plain text, a blank line between paragraphs." },
      on: { type: "BOOLEAN", description: "false turns the reply off. Defaults to true." },
    },
  },
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The settings patch for these arguments, or what's wrong with them (said to the model). */
export function formAutoReplyPatch(args: Record<string, unknown>): { ok: true; body: SettingsPatchBody; on: boolean } | { ok: false; error: string } {
  const formId = text(args.form_id);
  const page = text(args.page);
  const index = typeof args.form_index === "number" && Number.isInteger(args.form_index) ? args.form_index : null;
  if (!formId && index === null) return { ok: false, error: "Say which form: form_id (its data-ol-form-id) or form_index (0 is the page's first <form>), plus page for a site page." };
  const on = args.on !== false;
  const subject = text(args.subject);
  const body = text(args.body);
  if (on && (!subject || !body)) return { ok: false, error: "The reply needs both a subject and a body (or on: false to turn it off)." };
  return {
    ok: true,
    on,
    body: {
      formIndex: index ?? 0,
      ...(formId ? { formId } : {}),
      ...(page ? { page } : {}),
      patch: { autoReply: on ? { subject, body } : null },
    },
  };
}

export async function toolSetFormAutoReply(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const p = formAutoReplyPatch(args);
  if (!p.ok) return { response: { ok: false, error: p.error } };
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "project not found" } };
  const email = deps.emailState ? await deps.emailState(session.projectId).catch(() => null) : null;
  const reply = p.body.patch?.autoReply;
  if (reply?.subject && reply.body) {
    const hosts = [...(row.subdomain ? [publishedHost(row.subdomain)] : []), ...(email?.domain ? [email.domain] : [])];
    const rendered = renderReply({ subject: reply.subject, body: reply.body }, {}, hosts);
    if ("error" in rendered) return { response: { ok: false, error: rendered.error } };
  }
  const v = validateSettingsPatch(p.body, session.projectId);
  if (!v.ok) return { response: { ok: false, error: v.message ?? "invalid patch" } };
  const outcome = applySettingsPatch(row.data, v.body);
  if ("error" in outcome) return { response: { ok: false, error: outcome.error } };
  await deps.saveProjectData(session.projectId, session.userId, (actual) => {
    const fresh = applySettingsPatch(actual, v.body);
    return "error" in fresh ? actual : fresh.nextData;
  });
  const waits = p.on && email?.status !== "ready";
  return {
    response: {
      ok: true,
      form: outcome.formKey,
      auto_reply: p.on ? "on" : "off",
      ...(waits ? { note: "Saved, but it goes out only once the project's email domain is ready on a paid plan: tell the user (connect_email_domain shows them the card)." } : {}),
    },
    action: { tool: SET_FORM_AUTO_REPLY, ok: true, summary: p.on ? "on" : "off" },
  };
}
