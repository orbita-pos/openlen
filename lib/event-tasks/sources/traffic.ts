// THE `traffic` SOURCE (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.4): the published page's visits,
// what the beacon writes in `pageEvents`. Once a local day ends in the task's zone, it is compared with the same weekday a
// week before; a change past the task's threshold is one change. Days are cut as the Results view cuts them
// (lib/resultados/visitas.ts), so «yesterday» is the owner's yesterday. Days missed while the server was down are not
// made up: only the latest complete day is compared, as the scheduler runs a missed recurring task once. Nobody to
// answer: a card about traffic is work in the project.
import "server-only";

import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import { db, schema } from "@/lib/db";
import { fechaLocal, fechaValida, restarDias, ZONA_SIN_DATO, zonaValida } from "@/lib/resultados/zona";

import { trafficParamsSchema } from "./declarations";
import { SourceError, type EventSource, type SourceChange } from "./types";

export interface TrafficParams {
  readonly metric?: "views" | "visitors";
  /** A page's slug, "/" for the home page; absent, the whole site. */
  readonly page?: string;
  readonly change_percent?: number;
  readonly direction?: "up" | "down" | "either";
  readonly min_views?: number;
  readonly conditions?: readonly { readonly field: string; readonly op: "eq" | "neq" | "contains" | "gt" | "lt" | "exists"; readonly value?: string | number }[];
}

export interface TrafficState {
  /** The last local day compared, YYYY-MM-DD. */
  readonly lastDay: string;
}

const DEFAULT_PERCENT = 30;
const DEFAULT_FLOOR = 20;
const FORTNIGHT = 14;
const TOP = 5;

const e = schema.pageEvents;
const paramsSchema = trafficParamsSchema as unknown as z.ZodType<TrafficParams>;

const zoneOf = (timeZone: string) => zonaValida(timeZone) ?? ZONA_SIN_DATO;
const localDay = (zone: string): SQL => sql`((${e.ts} AT TIME ZONE 'UTC') AT TIME ZONE ${zone})::date`;
/** The latest complete local day. */
const yesterday = (now: Date, zone: string) => restarDias(fechaLocal(now, zone), 1);

/** One project's views over local days [from, to]; the prefilter on `ts` uses the index (no zone is past ±14 h). */
function views(projectId: string, zone: string, from: string, to: string, page: string | undefined): SQL {
  const before = new Date(`${from}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  const after = new Date(`${to}T00:00:00Z`);
  after.setUTCDate(after.getUTCDate() + 2);
  const onPage = page === undefined ? undefined : page === "/" ? isNull(e.page) : eq(e.page, page.replace(/^\/+/, ""));
  return and(eq(e.projectId, projectId), eq(e.type, "view"), gte(e.ts, before), lt(e.ts, after), sql`${localDay(zone)} BETWEEN ${from}::date AND ${to}::date`, onPage) as SQL;
}

async function count(projectId: string, zone: string, day: string, page: string | undefined): Promise<{ views: number; visitors: number }> {
  const [r] = await db
    .select({ views: sql<number>`COUNT(*)::int`, visitors: sql<number>`COUNT(DISTINCT ${e.uaHash})::int` })
    .from(e)
    .where(views(projectId, zone, day, day, page));
  return { views: Number(r?.views ?? 0), visitors: Number(r?.visitors ?? 0) };
}

/** The day's views by a key, most first. Grouped by POSITION: a key carrying the zone as a parameter is $1 in the SELECT
 *  and another $n in the GROUP BY, which Postgres doesn't see as the same (lib/resultados/visitas.ts, measured). */
async function top(projectId: string, zone: string, day: string, page: string | undefined, key: SQL): Promise<{ key: string; views: number }[]> {
  const rows = await db
    .select({ key: sql<string>`${key}`, views: sql<number>`COUNT(*)::int` })
    .from(e)
    .where(views(projectId, zone, day, day, page))
    .groupBy(sql`1`)
    .orderBy(desc(sql`COUNT(*)`), asc(sql`1`))
    .limit(TOP);
  return rows.map((r) => ({ key: String(r.key), views: Number(r.views) }));
}

async function perDay(projectId: string, zone: string, from: string, to: string, page: string | undefined): Promise<{ day: string; views: number; visitors: number }[]> {
  const rows = await db
    .select({ day: sql<string>`${localDay(zone)}::text`, views: sql<number>`COUNT(*)::int`, visitors: sql<number>`COUNT(DISTINCT ${e.uaHash})::int` })
    .from(e)
    .where(views(projectId, zone, from, to, page))
    .groupBy(sql`1`)
    .orderBy(asc(sql`1`));
  return rows.map((r) => ({ day: String(r.day), views: Number(r.views), visitors: Number(r.visitors) }));
}

export const trafficSource: EventSource<TrafficParams, TrafficState> = {
  kind: "traffic",
  paramsSchema,
  offers: { dataChange: false, replies: [] },
  // The answer changes once a day: a look every quarter of an hour is soon enough after midnight.
  checkEveryMs: 15 * 60_000,

  async validate(_projectId, _params, ctx) {
    // The first comparison is of today, once it ends.
    return { ok: true, initialState: { lastDay: yesterday(ctx.now, zoneOf(ctx.timeZone)) } };
  },

  async observe(projectId, params, state, ctx) {
    const zone = zoneOf(ctx.timeZone);
    const day = yesterday(ctx.now, zone);
    if (day <= state.lastDay) return { state, changes: [] };
    const next = { lastDay: day };
    const before = restarDias(day, 7);
    const [now, then] = await Promise.all([count(projectId, zone, day, params.page), count(projectId, zone, before, params.page)]);
    const metric = params.metric ?? "views";
    const current = now[metric];
    const previous = then[metric];
    if (current === previous || Math.max(current, previous) < (params.min_views ?? DEFAULT_FLOOR)) return { state: next, changes: [] };
    const pct = previous === 0 ? 100 : Math.round(((current - previous) / previous) * 100);
    const direction = current > previous ? "up" : "down";
    const wanted = params.direction ?? "either";
    if (Math.abs(pct) < (params.change_percent ?? DEFAULT_PERCENT) || (wanted !== "either" && wanted !== direction)) return { state: next, changes: [] };
    const change: SourceChange = {
      subject: "traffic",
      summary: `${metric} ${day}: ${current} (${pct > 0 ? "+" : ""}${pct}% vs ${before}: ${previous})`,
      detail: { day, compared_to: before, metric, page: params.page ?? "all", current, previous, change_percent: pct, direction },
      link: day,
      at: ctx.now.toISOString(),
    };
    return { state: next, changes: [change] };
  },

  async read(projectId, params, { keys, match, ctx }) {
    if (match?.length) throw new SourceError("column_missing", "traffic has nothing to match: read days by key.");
    const zone = zoneOf(ctx.timeZone);
    const days = [...new Set(keys.map(fechaValida).filter((d): d is string => d !== null))].sort();
    const page = (p: string) => (p === "" ? "/" : `/${p}`);
    const items = await Promise.all(
      days.map(async (day) => {
        const [c, pages, from] = await Promise.all([
          count(projectId, zone, day, params.page),
          top(projectId, zone, day, params.page, sql`COALESCE(${e.page}, '')`),
          top(projectId, zone, day, params.page, sql`COALESCE(NULLIF(split_part(split_part(${e.referrer}, '://', 2), '/', 1), ''), 'direct')`),
        ]);
        return { day, ...c, pages: pages.map((x) => ({ page: page(x.key), views: x.views })), from: from.map((x) => ({ from: x.key, views: x.views })) };
      }),
    );
    const last = days[0] ? restarDias(days[0], 1) : yesterday(ctx.now, zone);
    const previous = await perDay(projectId, zone, restarDias(last, FORTNIGHT - 1), last, params.page);
    return { items, previous };
  },
};
