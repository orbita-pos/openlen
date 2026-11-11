// «QUIERO UN ASISTENTE» (spec local 2026-11-06-asistente-propio, §4.4): Len's `create_assistant` offers the owner the
// creator's card. It creates nothing: the owner names it and picks its look on the card (the creator, like Muse), and
// the card's button does the creating (`POST /api/assistants`). If the project already has one, Len hears which. If the
// owner already has one elsewhere (phase 4, step 2), Len hears its name and asks «¿la uso también aquí o creas otro?»;
// the card offers both.
//
// Len may suggest her figure (spec local 2026-11-10-figuras-del-asistente, §5.6): parts of the catalog and a color.
// The creator opens with it; the owner changes anything there, and Len never changes it afterwards.
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { checkLook, type FigureCategory, type FigureLook } from "@/lib/figure/look";
import { curatedLook } from "@/lib/figure/random";

import { assistantsEnabled } from "./enabled";
import type { AssistantRow } from "./store";
import { summaryWithLook } from "./suggested-look";

export { suggestedLookOf } from "./suggested-look";

const PARTS: readonly FigureCategory[] = ["shape", "eyes", "eyewear", "accessory"];

/** WHAT LEN MAY NAME, KEPT HERE ON PURPOSE. Not `offered()`: Len's tool declarations are a cached prefix of every turn
 *  of every person, and a list read from the live catalog would move that prefix each time a shape or a hat is added.
 *  The catalog can grow without Len knowing; teaching him a new entry is adding it here, once, knowingly. An id the
 *  catalog later retires still draws (lib/figure/look.ts), and one it no longer knows is dropped when he names it. */
export const SUGGESTABLE: Readonly<Record<FigureCategory, readonly string[]>> = Object.freeze({
  shape: Object.freeze(["drop", "round", "capsule", "cube", "ears", "heart", "flower", "triangle"]),
  eyes: Object.freeze(["oval", "round", "dot", "smile", "sleepy"]),
  eyewear: Object.freeze(["none", "round", "shades"]),
  accessory: Object.freeze(["none", "beret", "beanie", "bow", "crown", "hat", "headphones"]),
});
const part = (category: FigureCategory, description: string) => ({ type: "STRING", enum: [...SUGGESTABLE[category]], description });

export const CREATE_ASSISTANT = "create_assistant";

export const CREATE_ASSISTANT_DECLARATION = {
  name: CREATE_ASSISTANT,
  description:
    "Shows the owner the card to create their own assistant: a chat assistant of theirs, with the name and the look they pick, that knows their business and talks with them about it — not you. " +
    "Call it when the owner asks for an assistant, a chatbot or an AI of their own. It creates nothing: the owner names it and picks its look on the card. " +
    "If this project already has one, you get which, and say so. " +
    "You may suggest its figure — any of shape, eyes, eyewear, accessory and color — when something fits the business; the card opens with it and the owner changes whatever they like.",
  parameters: {
    type: "OBJECT",
    properties: {
      shape: part("shape", "Optional. The figure's body."),
      eyes: part("eyes", "Optional."),
      eyewear: part("eyewear", "Optional."),
      accessory: part("accessory", "Optional. What it wears on its head."),
      color: { type: "STRING", description: "Optional. The figure's color as #RRGGBB. Left out, it takes the page's accent." },
    },
  },
} as const;

export interface CreateAssistantDeps {
  assistantOfProject(projectId: string): Promise<Pick<AssistantRow, "name" | "slug"> | null>;
  /** The person's own, newest first. */
  assistantsOf(personId: string): Promise<Pick<AssistantRow, "name" | "slug">[]>;
  /** The accent of the project's page (#rrggbb), when it has one. */
  accentOf(projectId: string): Promise<string | null>;
  /** What the unsaid parts are drawn from (tests fix it). */
  seed?: () => number;
}

async function storeDeps(): Promise<CreateAssistantDeps> {
  const store = await import("./store");
  return {
    assistantOfProject: store.assistantOfProject,
    assistantsOf: store.assistantsOf,
    accentOf: async (projectId) => {
      const [{ pageHtmlOf }, { detectSiteAccent }] = await Promise.all([import("./projects"), import("@/lib/publish/site-accent")]);
      return detectSiteAccent((await pageHtmlOf(projectId)) ?? "");
    },
  };
}

/** The look the creator opens with: one that goes well together, with each part Len named that the catalog has, in
 *  his color or else the page's accent. A part it does not have is left out, never an error. */
async function suggestedLook(args: Record<string, unknown>, projectId: string, d: CreateAssistantDeps): Promise<FigureLook> {
  let look = curatedLook(d.seed ? d.seed() : Math.floor(Math.random() * 0xffffffff));
  const take = (patch: Record<string, unknown>) => {
    const next = checkLook({ ...look, ...patch });
    if (next.ok) look = next.value;
  };
  for (const category of PARTS) if (typeof args[category] === "string") take({ [category]: args[category] });
  // His color when it is one; otherwise the page's accent; otherwise the look's own.
  if (typeof args.color === "string" && checkLook({ ...look, color: args.color }).ok) take({ color: args.color });
  else take({ color: await d.accentOf(projectId).catch(() => null) });
  return look;
}

export async function runCreateAssistant(session: AgentSession, args: Record<string, unknown> = {}, deps?: CreateAssistantDeps): Promise<ToolOutcome> {
  if (session.assistant) return { response: { ok: false, error: "not_available", message: "Only Len offers a new assistant." } };
  if (!assistantsEnabled()) return { response: { ok: false, error: "assistants_off", message: "Assistants are turned off right now." } };
  const d = deps ?? (await storeDeps());
  const existing = await d.assistantOfProject(session.projectId);
  if (existing) {
    return { response: { ok: false, error: "project_has_assistant", assistant: { name: existing.name, slug: existing.slug }, message: `This project already has its assistant, ${existing.name}.` } };
  }
  // The session's user is the project's owner (a member never gets this tool): their own assistants, elsewhere.
  const theirs = (await d.assistantsOf(session.userId)).map((a) => ({ name: a.name, slug: a.slug }));
  const tool_result = theirs.length
    ? `The owner already has ${theirs.map((a) => a.name).join(", ")}. Ask them whether to use ${theirs.length > 1 ? "one of them" : theirs[0]!.name} here too or create another: the card under your answer offers both.`
    : "The owner now sees the card to create their assistant: they pick its name and its look there.";
  return {
    response: { ok: true, card: "assistant_create", ...(theirs.length ? { existing: theirs } : {}), tool_result },
    action: { tool: CREATE_ASSISTANT, ok: true, summary: summaryWithLook(await suggestedLook(args, session.projectId, d)) },
  };
}
