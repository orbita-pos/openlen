// THE `form_submissions` SOURCE (spec local 2026-11-03-len-que-avisa, §7.2): what visitors send through the forms
// of a published page, read from OpenLen's own base (`formSubmissions`). One form (`formKeyOf`) or all of the
// project's; after a cursor kept as Postgres wrote it (text), so no microsecond is lost on the way. The email the
// owner already gets for each submission (`notifyOwner`) is another feature and stays as it is.
import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { db, schema } from "@/lib/db";
import { readFormIds } from "@/lib/publish/form-identity";

import { formSubmissionsParamsSchema } from "./declarations";
import { MATCHING_MAX, type EventSource, type SourceChange } from "./types";

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

/** The keys of the site's forms, as `formKeyOf` names their submissions: a form's own id, else its position —
 *  bare on the home page, `<page>:<position>` on another page. */
export function siteFormKeys(data: { readonly html?: string; readonly pages?: Record<string, { readonly html?: string } | undefined> } | null | undefined): string[] {
  const keys: string[] = [];
  const add = (html: string | undefined, page: string | null) =>
    readFormIds(html ?? "").forEach((id, i) => keys.push(id || (page ? `${page}:${i}` : String(i))));
  add(data?.html, null);
  for (const [slug, page] of Object.entries(data?.pages ?? {})) add(page?.html, slug);
  return keys;
}

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
  // What a visitor sent is never changed; its sender can be answered.
  offers: { dataChange: false, replyByEmail: true },

  async validate(projectId, params) {
    // A form the site has, or one whose submissions already came: a typo would watch nothing and say nothing
    // (final review I12).
    if (params.form) {
      const [project] = await db.select({ data: schema.projects.data }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
      const keys = siteFormKeys(project?.data as Parameters<typeof siteFormKeys>[0]);
      if (!keys.includes(params.form)) {
        const [seen] = await db.select({ id: f.id }).from(f).where(ofForm(projectId, params.form)).limit(1);
        if (!seen) {
          return {
            ok: false,
            reason: `There is no form "${params.form}" on this site. Its forms: ${keys.length ? keys.join(", ") : "none"}. A form with its own id is named by it; one without, by its position — bare on the home page (0, 1…), "<page>:<position>" on another page.`,
          };
        }
      }
    }
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

  async read(projectId, params, { keys, match }) {
    const items = keys.length === 0 ? [] : await db.select({ id: f.id, data: f.data }).from(f).where(and(eq(f.projectId, projectId), inArray(f.id, [...keys])));
    const previous = await db.select({ id: f.id, data: f.data }).from(f).where(ofForm(projectId, params.form)).orderBy(desc(f.createdAt)).limit(BEFORE);
    if (!match?.length) return { items, previous };
    // A field of what the visitor sent, as text: a form's values are strings.
    const fields = match.map((m) => sql`${f.data}->>${m.field} = ${m.value}`);
    const matching = await db
      .select({ id: f.id, data: f.data })
      .from(f)
      .where(and(ofForm(projectId, params.form), ...fields))
      .orderBy(desc(f.createdAt))
      .limit(MATCHING_MAX);
    return { items, previous, matching };
  },
};
