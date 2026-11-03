// THE `form_submissions` SOURCE (spec local 2026-11-03-len-que-avisa, §7.2): what visitors send through the forms
// of a published page, read from OpenLen's own base (`formSubmissions`). One form (`formKeyOf`) or all of the
// project's; after a cursor kept as Postgres wrote it (text), so no microsecond is lost on the way. The email the
// owner already gets for each submission (`notifyOwner`) is another feature and stays as it is.
import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { db, schema } from "@/lib/db";

import { formSubmissionsParamsSchema } from "./declarations";
import type { EventSource, SourceChange } from "./types";

export interface FormSubmissionsParams {
  readonly form?: string;
  readonly conditions?: readonly { readonly field: string; readonly op: "eq" | "neq" | "contains" | "gt" | "lt" | "exists"; readonly value?: string | number }[];
}

export interface FormSubmissionsState {
  readonly cursor: { readonly at: string; readonly id: string };
}

const PAGE = 200;
const BEFORE = 20;
const f = schema.formSubmissions;
const atText = sql<string>`${f.createdAt}::text`;

const paramsSchema = formSubmissionsParamsSchema as unknown as z.ZodType<FormSubmissionsParams>;

const ofForm = (projectId: string, form: string | undefined) => (form ? and(eq(f.projectId, projectId), eq(f.formId, form)) : eq(f.projectId, projectId));

function summaryOf(data: Record<string, string>): string {
  return Object.entries(data)
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

export const formSubmissionsSource: EventSource<FormSubmissionsParams, FormSubmissionsState> = {
  kind: "form_submissions",
  paramsSchema,

  async validate(projectId, params) {
    const [last] = await db.select({ at: atText, id: f.id }).from(f).where(ofForm(projectId, params.form)).orderBy(desc(f.createdAt), desc(f.id)).limit(1);
    return { ok: true, initialState: { cursor: last ? { at: last.at, id: last.id } : { at: "-infinity", id: "" } } };
  },

  async observe(projectId, params, state) {
    const at = state.cursor.at;
    const rows = await db
      .select({ id: f.id, data: f.data, formId: f.formId, at: atText })
      .from(f)
      .where(and(ofForm(projectId, params.form), sql`(${f.createdAt} > ${at}::timestamp OR (${f.createdAt} = ${at}::timestamp AND ${f.id} > ${state.cursor.id}))`))
      .orderBy(asc(f.createdAt), asc(f.id))
      .limit(PAGE);
    if (rows.length === 0) return { state, changes: [] };
    const changes: SourceChange[] = rows.map((r) => ({ subject: r.formId ?? "form", summary: summaryOf(r.data), detail: r.data, link: r.id, at: r.at }));
    const last = rows.at(-1)!;
    return { state: { cursor: { at: last.at, id: last.id } }, changes };
  },

  async read(projectId, params, { keys }) {
    const items = keys.length === 0 ? [] : await db.select({ id: f.id, data: f.data }).from(f).where(and(eq(f.projectId, projectId), inArray(f.id, [...keys])));
    const previous = await db.select({ id: f.id, data: f.data }).from(f).where(ofForm(projectId, params.form)).orderBy(desc(f.createdAt)).limit(BEFORE);
    return { items, previous };
  },
};
