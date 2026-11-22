// THE AGENT'S NOTE TO ITS PERSON (spec local 2026-11-21-len-y-el-agente-conversan, decision 12 — Jesús, 21/11: «Sí, por
// correo»). A turn Len's message woke runs with nobody watching; when it ends with something for the person, besides the
// push (`len_turno`, sent by the route) the person gets an email FROM THE AGENT, as its scheduled tasks' email comes
// (lib/scheduled-tasks/deliver.ts): in its name, with no Reply-To — replying would start a Len turn, not the agent's —
// its text and a link to its place. With nothing to say, nothing goes: the turn that only answered Len leaves its final
// text empty.
import { idiomaDelCorreo, type DatosDeLaNotaDelAgente, type IdiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";

export interface AgentNoteEmail extends DatosDeLaNotaDelAgente {
  readonly to: string;
  readonly idioma: IdiomaDelCorreo;
}

/** What sending needs: the scheduled tasks' own lookups (`defaultDeliverDeps`) and the email itself. */
export interface AgentNoteDeps {
  recipientEmail(userId: string): Promise<string | null>;
  /** The agent's place, where the email sends the person to answer it. */
  agentUrl(locale: string, slug: string): string;
  send(email: AgentNoteEmail): Promise<void>;
}

export interface AgentNote {
  /** Whom the agent works for: the email goes to them. */
  readonly personId: string;
  readonly agent: { readonly name: string; readonly slug: string };
  /** The project Len wrote about. */
  readonly projectTitle: string;
  /** What the agent said last in the turn. */
  readonly text: string;
  /** The turn's language (the agent's own, as the waking turn carries it). */
  readonly locale: string;
}

async function liveDeps(): Promise<AgentNoteDeps> {
  const [{ defaultDeliverDeps }, { sendAgentNoteEmail }] = await Promise.all([import("@/lib/scheduled-tasks/deliver"), import("@/lib/email")]);
  const d = await defaultDeliverDeps();
  return { recipientEmail: d.recipientEmail, agentUrl: d.agentUrl, send: sendAgentNoteEmail };
}

/** Emails the agent's person what it said, when it said something and they have an address. Whether it went. */
export async function emailAgentNote(note: AgentNote, deps?: AgentNoteDeps): Promise<boolean> {
  const texto = note.text.trim();
  if (!texto) return false;
  const d = deps ?? (await liveDeps());
  const to = await d.recipientEmail(note.personId);
  if (!to) {
    console.warn(`[agent-messages] no email for ${note.personId}: the agent's note stays in its chat`);
    return false;
  }
  const idioma = idiomaDelCorreo(note.locale);
  await d.send({ to, idioma, agentName: note.agent.name, projectTitle: note.projectTitle, texto, url: d.agentUrl(idioma, note.agent.slug) });
  return true;
}
