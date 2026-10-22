/**
 * THE EMAIL DOMAIN'S CARD — `connect_email_domain` (spec local
 * 2026-10-22-email-integration, 6.8).
 *
 * Len asks; the owner answers in a card in the chat: the domain (the project's
 * own proposed), «show as @domain», Connect. The card talks to
 * /api/projects/[id]/email itself; through the turn travels only that it was
 * answered, and Len reads what happened from the email tables. The mechanics are
 * `request_secrets`'s: it waits inside the turn (120 s), and expired it closes
 * the turn with the card. Only the owner connects a domain, as in the tab.
 */
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import {
  ASK_CANCELLED_ERROR,
  CONNECT_EMAIL_DOMAIN,
  EMAIL_DOMAIN_QUESTION_ID,
  QUESTION_DISMISSED,
  questionText,
  type UserQuestion,
} from "@/lib/agent/ask-user-question";
import type { EmailStateForLen } from "@/lib/project-email/state";

export const CONNECT_EMAIL_DOMAIN_DECLARATION: Record<string, unknown> = {
  name: CONNECT_EMAIL_DOMAIN,
  description:
    "Show the project owner a card in the chat to connect their own domain for the project's email, so the app's emails, the sign-in emails and the form replies go from an address on it (noreply@notify.<their domain>) instead of OpenLen's. "
    + "The owner types the domain there; afterwards they add three DNS lines (or approve them in one click if their DNS provider supports it) from the Correos tab of the Database view, and the domain is checked by itself. "
    + "Only the owner can, on a paid plan. Call it when the user wants emails from their domain and PROJECT STATE's `email.status` is `none`. Never ask for the domain or DNS details in chat.",
  parameters: { type: "OBJECT", properties: {} },
};

function emailDomainQuestion(): UserQuestion {
  return { id: EMAIL_DOMAIN_QUESTION_ID, question: "Connect the project's email domain.", intent: { kind: "email-domain" } };
}

function stateResult(s: EmailStateForLen): string {
  if (s.status === "none") return "No domain was connected.";
  if (s.status === "ready") return `The domain ${s.domain} is ready: the project's emails go from ${s.from}.`;
  return `The domain ${s.domain} is ${s.status}: the owner adds its DNS lines from the Correos tab of the Database view (or in one click there, if their DNS provider supports it). It is checked every 15 minutes and on publish; until it is ready, emails go from OpenLen.`;
}

export async function toolConnectEmailDomain(session: AgentSession, deps: AgentDeps): Promise<ToolOutcome> {
  if (session.personId && session.personId !== session.userId) {
    return { response: { ok: false, error: "Only the project's owner connects an email domain: tell the user to ask the owner." } };
  }
  const before = deps.emailState ? await deps.emailState(session.projectId) : null;
  if (!before) return { response: { ok: false, error: "Project email isn't available on this server." } };
  if (before.plan === "free") {
    return { response: { ok: false, error: "Email from the owner's own domain needs a paid plan (Pro or above). Tell the user; until then the emails go from OpenLen." } };
  }
  if (before.status !== "none") return { response: { ok: true, email: before, result: stateResult(before) } };
  const preguntas = [emailDomainQuestion()];
  // Like request_secrets: with nobody to answer inside the turn (voice, Len-Bench), the card closes the turn.
  if (deps.askUser) {
    const answers = await deps.askUser(preguntas);
    if (answers === QUESTION_DISMISSED) return { response: { ok: false, error: ASK_CANCELLED_ERROR }, preguntas, dismissed: true };
    if (answers) {
      const after = (await deps.emailState?.(session.projectId)) ?? before;
      const result = stateResult(after);
      return { response: { ok: true, email: after, result }, preguntas, respuesta: (after.domain ?? result).slice(0, 200) };
    }
  }
  return { response: { ok: true, preguntado: true }, pregunta: questionText(preguntas), preguntas };
}
