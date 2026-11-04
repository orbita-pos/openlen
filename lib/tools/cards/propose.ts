// LEN'S `propose_action` (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek Harness's card tool
// (packages/experimental/action-cards/src/index.ts, `propose`, at fcc0ad4621, MIT): its name, description, fields,
// checks in their order, its refusals word for word, and the kind's invitation
// (creation-recommendations/src/index.ts), for one action: `create_tool`.
import "server-only";

import { z } from "zod";

import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { TOOL_SUGGESTIONS } from "@/lib/agent/skills/tool";

import type { ToolPlacement } from "../types";
import { PROPOSE_ACTION, type ToolCardView } from "./types";

export { PROPOSE_ACTION };
export const CREATE_TOOL = "create_tool";

export const DECLARACION_PROPOSE_ACTION = {
  name: PROPOSE_ACTION,
  description: "Show the user one optional action card under this answer. Call only as the skill that names the action instructs.",
  parameters: {
    type: "OBJECT",
    properties: {
      action: { type: "STRING", description: "Action name from the skill." },
      title: { type: "STRING", description: "Card title." },
      brief: { type: "STRING", description: "What the action does, in the user's language." },
      details: { type: "OBJECT", description: "Fields the skill lists for this action." },
    },
    required: ["action", "title", "brief", "details"],
  },
} as const;

/** DeepSeek's invitation for a page card, for an OpenLen tool. */
export const INVITATION =
  "End with at most one short invitation in the user's language, in the first person: after they press Crear below, " +
  "you will build it in the background as a tool that stays in their OpenLen, without blocking the chat; " +
  "the build takes minutes and uses their credits.";

/** DeepSeek's `queuedMessageLimit` default. */
const QUEUED_MESSAGE_LIMIT = 2;

const detailsSchema = z.object({ placement: z.enum(["rail", "project"]), initialContent: z.string().optional() });

export interface ProposeDeps {
  insertCard(input: {
    projectId: string;
    chatRowId: string;
    personId: string;
    title: string;
    brief: string;
    initialContent: string | null;
    placement: ToolPlacement;
  }): Promise<ToolCardView>;
  /** Messages the person sent while this turn runs, not yet read (the steering queue). */
  queued(turnId: string): number;
}

const refuse = (error: string): ToolOutcome => ({ response: { ok: false, error } });

export async function proposeToolCard(session: AgentSession, args: Record<string, unknown>, deps: ProposeDeps): Promise<ToolOutcome> {
  if (session.isSubagent) return refuse("Cards are offered in the main conversation only.");
  if (deps.queued(session.turnId ?? "") >= QUEUED_MESSAGE_LIMIT) return refuse("The user has queued more messages; show no card and answer briefly.");
  const action = String(args.action ?? "");
  if (action !== CREATE_TOOL) return refuse(`Unknown action "${action}". Registered actions: ${CREATE_TOOL}.`);
  if (!session.turnSkillLoads?.has(TOOL_SUGGESTIONS)) return refuse(`Load skill ${TOOL_SUGGESTIONS} first, then call ${PROPOSE_ACTION}.`);
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const brief = typeof args.brief === "string" ? args.brief.trim() : "";
  if (!title || !brief) return refuse("Write a title and a brief.");
  const details = detailsSchema.safeParse(args.details);
  if (!details.success) {
    return refuse("Invalid details: " + details.error.issues.map((i) => `${["details", ...i.path.map(String)].join(".")}: ${i.message}`).join("; "));
  }
  if (session.cardProposedThisTurn) return refuse("One card per turn; the earlier card stands.");
  const card = await deps.insertCard({
    projectId: session.projectId,
    chatRowId: session.chatRowId ?? session.turnId ?? "",
    personId: session.personId ?? session.userId,
    title,
    brief,
    initialContent: details.data.initialContent?.trim() ? details.data.initialContent : null,
    placement: details.data.placement,
  });
  session.cardProposedThisTurn = true;
  return { response: { ok: true, tool_result: `Card shown below your answer. Do not restate it. ${INVITATION}` }, toolCard: card };
}
