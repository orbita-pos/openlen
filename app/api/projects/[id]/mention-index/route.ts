// THE «@» INDEX (spec local 2026-10-27-at-mentions, §6.2): everything the chat's
// «@» can point at, from the SOURCE files — the same tree Len sees in his
// terminal (`cargarFicherosDeLaTerminal`), so the person and Len name the same
// things.
//
//   GET → 200 MentionIndexResponse, ETag = the hash of what was read
//         304 with a matching If-None-Match
//
// A page site: each page file tagged with line positions (`etiquetarConPosiciones`);
// the browser parses it with its own parser — the canvas's — so the paths match
// what the canvas gives on a click (`lib/mentions/page-entries.ts`). An app: the
// JSX outline of /src, which needs TypeScript and so is built here.
//
// 401 without a session, 404 if you cannot open the project; members can read
// it like the Code lens (lib/projects/acceso.ts).
import { createHash } from "node:crypto";

import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { realDeps, type AgentSession } from "@/lib/agent/tools";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { esDeLaPlataforma } from "@/lib/agent/ficheros/manual";
import { etiquetarConPosiciones } from "@/lib/agent/ficheros/posiciones";
import { ficherosDelSitio, paginaDeRuta } from "@/lib/agent/ficheros/sitio";
import { outlineApp } from "@/lib/mentions/app-outline";
import type { MentionIndexResponse } from "@/lib/mentions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function isListed(ruta: string): boolean {
  return !esDeLaPlataforma(ruta) && !ruta.startsWith("/.openlen/") && !ruta.startsWith("/tmp/");
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const acceso = await exigirAcceso(id, userId, "ver");
  if (acceso instanceof Response) return acceso;

  const deps = acceso.rol === "dueno" ? realDeps() : { ...realDeps(), resultados: undefined };
  const row = await deps.loadProject(id, acceso.duenoId);
  if (!row) return json({ error: "not_found" }, 404);
  const app = row.data?.app ?? null;
  const session: AgentSession = {
    projectId: id,
    userId: acceso.duenoId,
    ...(userId !== acceso.duenoId ? { personId: userId } : {}),
    ...(app ? { app } : {}),
    page: null,
    ownerEmail: null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
  };
  const all = await cargarFicherosDeLaTerminal(session, deps);
  const listed = Object.keys(all).filter(isListed).sort();

  const hasher = createHash("sha256");
  for (const ruta of listed) hasher.update(`${ruta}\0${all[ruta]}\0`);
  const hash = hasher.digest("hex").slice(0, 32);
  const etag = `"${hash}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });

  let body: MentionIndexResponse;
  if (app) {
    body = { kind: "app", hash, files: listed, entries: await outlineApp(all) };
  } else {
    const pages = ficherosDelSitio(row.data).flatMap((ruta) => {
      const where = paginaDeRuta(ruta);
      if (!where) return [];
      return [{ page: where.page, ruta, tagged: etiquetarConPosiciones(all[ruta] ?? "") }];
    });
    body = { kind: "page", hash, files: listed, pages };
  }
  return json(body, 200, { etag });
}
