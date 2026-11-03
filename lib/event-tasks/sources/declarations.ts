// WHAT A TASK CAN SAY ABOUT ITS SOURCE (spec local 2026-11-03-len-que-avisa, §7.1, §7.2): the schema of each source's
// parameters (DeepSeek: the provider declares it, and it validates what the model writes) and the `on` parameter of
// `schedule_create` built from them. Pure: the tools and the sources share it, and nothing here reads a base.
import { z } from "zod";

import type { EventSourceKind } from "../store";

export const SOURCE_KINDS: readonly EventSourceKind[] = ["app_rows", "form_submissions"];

const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "contains", "gt", "lt", "exists"]),
  value: z.union([z.string(), z.number()]).optional(),
});

export const appRowsParamsSchema = z.object({ table: z.string().min(1), created_column: z.string().min(1), conditions: z.array(conditionSchema).optional() });
export const formSubmissionsParamsSchema = z.object({ form: z.string().min(1).optional(), conditions: z.array(conditionSchema).optional() });

const PARAMS: Record<EventSourceKind, z.ZodTypeAny> = { app_rows: appRowsParamsSchema, form_submissions: formSubmissionsParamsSchema };

/** `schedule_create`'s `on`, Gemini-style like the file's other schemas (no oneOf). Ours. */
export const ON_DECLARATION: Record<string, unknown> = {
  type: "OBJECT",
  description: "Instead of a timing parameter: the source whose changes wake this task. Use it for «tell me when…» requests about what visitors do.",
  properties: {
    source: { type: "STRING", enum: [...SOURCE_KINDS], description: "app_rows: new rows of a table of the app's production base. form_submissions: what visitors send through the forms of a published page." },
    table: { type: "STRING", description: "app_rows: the table to watch for new rows." },
    created_column: { type: "STRING", description: "app_rows: the table's creation timestamp column, such as created_at." },
    form: { type: "STRING", description: "form_submissions: the form to watch, its own id (f…) or <page>:<index>; omit it for every form of the project." },
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
