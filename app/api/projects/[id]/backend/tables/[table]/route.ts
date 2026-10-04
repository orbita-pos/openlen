// Las filas de una tabla, para el editor de tablas del panel del dueño. Van por
// nuestro /rest/v1 como `service_role` (lib/backend/dashboard.ts).
//
//   GET    ?offset=&limit=      → { rows, total }
//   POST   { values }           → { row }
//   PATCH  { key, values }      → { row }
//   DELETE { key }              → { ok: true }
//
// Un error de Postgres vuelve como 400 { error } con su mensaje.

import { deleteRow, insertRow, readRows, updateRow } from "@/lib/backend/dashboard";
import { json, notReady, objectBody, ownedBackend, tableParam } from "@/lib/backend/owner-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; table: string }> };

const answer = (r: object) => ("error" in r ? json(r, 400) : json(r));
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id, table } = await ctx.params;
  const ob = await ownedBackend(id);
  if (ob.kind !== "ready") return notReady(ob);
  const u = new URL(req.url);
  return answer(
    await readRows(ob.project, tableParam(table), {
      offset: Number(u.searchParams.get("offset") ?? 0) || 0,
      limit: Number(u.searchParams.get("limit") ?? 50) || 50,
    }),
  );
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id, table } = await ctx.params;
  const ob = await ownedBackend(id);
  if (ob.kind !== "ready") return notReady(ob);
  const body = await objectBody(req);
  if (!body || !isObject(body.values)) return json({ error: "values must be an object" }, 400);
  return answer(await insertRow(ob.project, tableParam(table), body.values));
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id, table } = await ctx.params;
  const ob = await ownedBackend(id);
  if (ob.kind !== "ready") return notReady(ob);
  const body = await objectBody(req);
  if (!body || !isObject(body.key) || !isObject(body.values)) return json({ error: "key and values must be objects" }, 400);
  return answer(await updateRow(ob.project, tableParam(table), body.key, body.values));
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id, table } = await ctx.params;
  const ob = await ownedBackend(id);
  if (ob.kind !== "ready") return notReady(ob);
  const body = await objectBody(req);
  if (!body || !isObject(body.key)) return json({ error: "key must be an object" }, 400);
  return answer(await deleteRow(ob.project, tableParam(table), body.key));
}
