// WHAT A TASK CAN SAY ABOUT ITS SOURCE (spec local 2026-11-03-len-que-avisa, §7.1, §7.2): the schema of each source's
// parameters (DeepSeek: the provider declares it, and it validates what the model writes) and the `on` parameter of
// `schedule_create` built from them. Pure: the tools and the sources share it, and nothing here reads a base.
import { z } from "zod";

import type { EventSourceKind } from "../store";

export const SOURCE_KINDS: readonly EventSourceKind[] = ["app_rows", "form_submissions", "visitor_chat", "app_users"];

const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "contains", "gt", "lt", "exists"]),
  value: z.union([z.string(), z.number()]).optional(),
});

export const appRowsParamsSchema = z.object({
  table: z.string().min(1),
  created_column: z.string().min(1),
  // «Esperar es una fuente» (spec local 2026-11-04-hazlo, §7.4.3): 30 days at most, past which a card is out of context.
  after_hours: z.number().int().min(1).max(720).optional(),
  conditions: z.array(conditionSchema).optional(),
});
export const formSubmissionsParamsSchema = z.object({ form: z.string().min(1).optional(), conditions: z.array(conditionSchema).optional() });
export const visitorChatParamsSchema = z.object({ watch: z.enum(["messages", "signups"]).optional(), conditions: z.array(conditionSchema).optional() });
export const appUsersParamsSchema = z.object({ conditions: z.array(conditionSchema).optional() });

const PARAMS: Record<EventSourceKind, z.ZodTypeAny> = {
  app_rows: appRowsParamsSchema,
  form_submissions: formSubmissionsParamsSchema,
  visitor_chat: visitorChatParamsSchema,
  app_users: appUsersParamsSchema,
};

/** `schedule_create`'s `on`, Gemini-style like the file's other schemas (no oneOf). Ours. */
export const ON_DECLARATION: Record<string, unknown> = {
  type: "OBJECT",
  description: "Instead of a timing parameter: the source whose changes wake this task. Use it for «tell me when…» requests about what visitors do.",
  properties: {
    source: {
      type: "STRING",
      enum: [...SOURCE_KINDS],
      description:
        "app_rows: new rows of a table of the app's production base. form_submissions: what visitors send through the forms of a published page. visitor_chat: what visitors write to the business in the published page's chat (or, with watch signups, who signs up to it). app_users: new sign-ups to the app (its production users).",
    },
    table: { type: "STRING", description: "app_rows: the table to watch for new rows." },
    created_column: { type: "STRING", description: "app_rows: the table's creation timestamp column, such as created_at." },
    after_hours: {
      type: "NUMBER",
      description: "app_rows: instead of when a row is created, wake N hours after it, if it still matches the conditions then — «a booking still unconfirmed after 24 h». 1 to 720.",
    },
    form: {
      type: "STRING",
      description:
        "form_submissions: the form to watch — its own id (f…) when it has one, else its position: bare on the home page (0, 1…), <page>:<position> on another page. Omit it for every form of the project.",
    },
    watch: { type: "STRING", enum: ["messages", "signups"], description: "visitor_chat: messages (default) or signups." },
    conditions: {
      type: "ARRAY",
      description: "Optional: only changes whose fields match all of these wake the task; they are checked before any model looks.",
      items: {
        type: "OBJECT",
        properties: {
          field: { type: "STRING", description: "A column or form field." },
          op: { type: "STRING", enum: ["eq", "neq", "contains", "gt", "lt", "exists"] },
          value: { type: "STRING", description: "Compared as a number when both sides are numbers, else as text; omit it for exists." },
        },
        required: ["field", "op"],
      },
    },
  },
  required: ["source"],
};

export type ParsedOn = { ok: true; source: EventSourceKind; params: Record<string, unknown> } | { ok: false; message: string };

/** A model's `on`, checked against its source's schema. */
export function parseOn(on: unknown): ParsedOn {
  if (typeof on !== "object" || on === null || Array.isArray(on)) return { ok: false, message: "on must be an object with a source." };
  const { source, ...rest } = on as Record<string, unknown>;
  if (typeof source !== "string" || !(SOURCE_KINDS as readonly string[]).includes(source)) {
    return { ok: false, message: `on.source must be one of ${SOURCE_KINDS.join(", ")}.` };
  }
  const parsed = PARAMS[source as EventSourceKind].safeParse(rest);
  if (!parsed.success) return { ok: false, message: `on for ${source}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "on"} ${i.message}`).join("; ")}.` };
  return { ok: true, source: source as EventSourceKind, params: parsed.data as Record<string, unknown> };
}
