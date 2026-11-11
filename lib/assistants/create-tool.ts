// «QUIERO UN ASISTENTE» (spec local 2026-11-06-asistente-propio, §4.4): Len's `create_assistant` offers the owner the
// creator's card. It creates nothing: the owner names it and picks its look on the card (the creator, like Muse), and
// the card's button does the creating (`POST /api/assistants`). If the project already has one, Len hears which. If the
// owner already has one elsewhere (phase 4, step 2), Len hears its name and asks «¿la uso también aquí o creas otro?»;
// the card offers both.
//
// Len may suggest her figure (spec local 2026-11-10-figuras-del-asistente, §5.6): parts of the catalog and a color.
// The creator opens with it; the owner changes anything there, and Len never changes it afterwards.
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { DEFAULT_LOOK, checkLook, type FigureCategory, type FigureLook } from "@/lib/figure/look";

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

/** WHAT EACH CHOICE LOOKS LIKE, in words, for Len — in his declaration and in his result (11/11, real turns: he called the
 *  «hat» a «gorro de panadero»; an enum value with no words is whatever the model imagines). As OpenAI's function-calling
 *  guide and Claude Code's own tool descriptions do, each choice says what it is. Kept with SUGGESTABLE, for the same
 *  reason: the cached prefix of his tools moves only when someone teaches him on purpose. */
const WORDS: Readonly<Record<FigureCategory, Readonly<Record<string, string>>>> = {
  shape: { drop: "a drop", round: "a ball", capsule: "a capsule", cube: "a soft cube", ears: "a ball with two round ears", heart: "a heart", flower: "a flower", triangle: "a soft triangle" },
  eyes: { oval: "oval eyes", round: "round eyes", dot: "two small dot eyes", smile: "smiling eyes", sleepy: "sleepy, half-closed eyes" },
  eyewear: { none: "no glasses", round: "round glasses", shades: "dark sunglasses" },
  accessory: { none: "nothing on its head", beret: "a beret", beanie: "a knit beanie with a pompom", bow: "a bow", crown: "a gold crown", hat: "a short top hat with a brim", headphones: "headphones" },
};
/** In his declaration, only the choices whose id doesn't say what they look like. */
const HINTS: Readonly<Partial<Record<FigureCategory, Readonly<Record<string, string>>>>> = {
  shape: { round: "a ball", ears: "a ball with two round ears" },
  eyes: { dot: "two small dots", smile: "closed, smiling arcs", sleepy: "half-closed" },
  eyewear: { round: "round glasses", shades: "dark sunglasses" },
  accessory: { beanie: "a knit cap with a pompom", hat: "a short top hat with a brim" },
};
const listed = (category: FigureCategory) => SUGGESTABLE[category].map((id) => (HINTS[category]?.[id] ? `${id} (${HINTS[category]![id]})` : id)).join(", ");

export const CREATE_ASSISTANT = "create_assistant";

export const CREATE_ASSISTANT_DECLARATION = {
  name: CREATE_ASSISTANT,
  description:
    "Shows the owner the card to create their own assistant: a chat assistant of theirs, with the name and the look they pick, that knows their business and talks with them about it — not you. " +
    "Call it when the owner asks for an assistant, a chatbot or an AI of their own. It creates nothing: the owner names it and picks its look on the card. " +
    "If this project already has one, you get which, and say so. " +
    "You may suggest its figure — any of shape, eyes, eyewear, accessory and color — when something fits the business; the card opens with it and the owner changes whatever they like. " +
    "Name only the parts you mean: what you leave out stays plain. The result says exactly what the card opens with.",
  parameters: {
    type: "OBJECT",
    properties: {
      shape: part("shape", `Optional. The figure's body: ${listed("shape")}.`),
      eyes: part("eyes", `Optional. ${listed("eyes")}.`),
      eyewear: part("eyewear", `Optional. ${listed("eyewear")}. Left out, it wears none.`),
      accessory: part("accessory", `Optional. What it wears on its head: ${listed("accessory")}. There is no chef's hat. Left out, it wears none.`),
      color: { type: "STRING", description: "Optional. The figure's color as #RRGGBB. Left out, it takes the page's accent." },
    },
  },
} as const;

/** The card's figure in words, for Len to describe it as it is. */
function lookInWords(look: FigureLook): string {
  const say = (category: FigureCategory, id: string) => WORDS[category][id] ?? id;
  return `${say("shape", look.shape)}, ${say("eyes", look.eyes)}, ${say("eyewear", look.eyewear)}, ${say("accessory", look.accessory)}, in ${look.color}`;
}

export interface CreateAssistantDeps {
  assistantOfProject(projectId: string): Promise<Pick<AssistantRow, "name" | "slug"> | null>;
  /** The person's own, newest first. */
  assistantsOf(personId: string): Promise<Pick<AssistantRow, "name" | "slug">[]>;
  /** The accent of the project's page (#rrggbb), when it has one. */
  accentOf(projectId: string): Promise<string | null>;
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

/** The look the creator opens with: each part Len named that the catalog has, in his color or else the page's accent.
 *  A part it does not have is left out, never an error. What he leaves out is the plain default — no glasses, nothing
 *  on its head — never a draw (11/11, real turns: four calls of four left eyewear out, and a random draw put glasses on
 *  her that he never heard of). An optional parameter left out is its default, as in a JSON schema. */
async function suggestedLook(args: Record<string, unknown>, projectId: string, d: CreateAssistantDeps): Promise<FigureLook> {
  let look: FigureLook = DEFAULT_LOOK;
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
  const look = await suggestedLook(args, session.projectId, d);
  // What the card shows, said back as it is — like Claude Code's Edit answering with what the file now says — so what he
  // tells the owner is what they see (11/11: he described a «gorro de panadero» over a top hat, and glasses he never chose).
  const opens = `If a new one is created, the card opens with its figure as ${lookInWords(look)}. If you mention the figure, say exactly that; the owner can change any part on the card.`;
  const tool_result = theirs.length
    ? `The owner already has ${theirs.map((a) => a.name).join(", ")}. Ask them whether to use ${theirs.length > 1 ? "one of them" : theirs[0]!.name} here too or create another: the card under your answer offers both. ${opens}`
    : `The owner now sees the card to create their assistant: they pick its name and its look there. ${opens}`;
  return {
    response: { ok: true, card: "assistant_create", ...(theirs.length ? { existing: theirs } : {}), tool_result },
    action: { tool: CREATE_ASSISTANT, ok: true, summary: summaryWithLook(look) },
  };
}
