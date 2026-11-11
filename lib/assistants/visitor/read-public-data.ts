// READ_PUBLIC_DATA — WHAT ANY VISITOR OF THE PAGE COULD READ (spec local 2026-11-06-asistente-propio, §4.2; phase 2B).
// «Consultar lo público de la app, como lo vería ese visitante: con la clave pública de la base de producción y su RLS de
// anónimo, nunca con la de servicio y nunca el borrador. Los huecos libres del sábado sí; quién los reservó no.»
//
// The model gives only the PostgREST path (the syntax supabase-js speaks, which it has seen millions of times); the
// server builds the request: GET, the PUBLISHABLE key (role `anon`, so the owner's RLS decides), no Authorization, and
// production's backend — through the backend's own router (`handleBackendRequest`), the same code the page's
// supabase-js reaches. Only the tables published as readable by anon (./public-data.ts), never `rpc/`.
import type { PublicTable } from "@/lib/db/schema";
import type { BackendProject } from "@/lib/backend/router";
import { CLAVE_TOOL_RESULT, fallo } from "@/lib/agent/ficheros/resultado";
import type { ToolOutcome } from "@/lib/agent/tools";

export const READ_PUBLIC_DATA = "read_public_data";
export const PUBLIC_DATA_MAX_ROWS = 50;
export const PUBLIC_DATA_MAX_CHARS = 8_000;

export const READ_PUBLIC_DATA_DECLARATION = {
  name: READ_PUBLIC_DATA,
  description:
    "Reads the business's public data (the tables in <public_data>) exactly as any visitor of the page could: what its access rules show anyone, from the published site. " +
    "Give the PostgREST path after /rest/v1/, as supabase-js would send it, e.g. huecos?select=dia,hora&dia=eq.2026-11-14&libre=is.true&order=hora. " +
    `At most ${PUBLIC_DATA_MAX_ROWS} rows. It only reads.`,
  parameters: {
    type: "OBJECT",
    properties: {
      query: { type: "STRING", description: "The table and its query string: <table>?select=…&<column>=<op>.<value>&order=…&limit=…" },
    },
    required: ["query"],
  },
} as const;

export interface PublicReadDeps {
  /** Production's backend of the project, or null when it was never published. */
  liveProject(projectId: string): Promise<{ project: BackendProject; host: string } | null>;
  serve(req: Request, project: BackendProject): Promise<Response>;
}

const BAD = /[;#\r\n]|\.\./;

export function checkPublicQuery(query: string, tables: readonly PublicTable[]): { ok: true; path: string; search: string } | { ok: false; error: string } {
  const q = query.trim().replace(/^\/+/, "").replace(/^rest\/v1\//, "");
  if (!q) return { ok: false, error: "Give a table and its query, e.g. huecos?select=dia,hora." };
  if (BAD.test(q)) return { ok: false, error: "That query has characters a PostgREST path doesn't use." };
  const cut = q.indexOf("?");
  const path = cut < 0 ? q : q.slice(0, cut);
  if (path === "rpc" || path.startsWith("rpc/")) return { ok: false, error: "Only tables are readable here, not functions." };
  if (!tables.some((t) => t.name === path)) {
    return { ok: false, error: `${path} isn't public. Readable: ${tables.map((t) => t.name).join(", ")}.` };
  }
  const params = new URLSearchParams(cut < 0 ? "" : q.slice(cut + 1));
  params.delete("apikey");
  const asked = Number(params.get("limit"));
  params.set("limit", String(Number.isInteger(asked) && asked > 0 ? Math.min(asked, PUBLIC_DATA_MAX_ROWS) : PUBLIC_DATA_MAX_ROWS));
  return { ok: true, path, search: params.toString() };
}

function toolError(message: string): ToolOutcome {
  const r = fallo(message);
  return { response: { ok: false, error: r.error, [CLAVE_TOOL_RESULT]: r.texto } };
}

export async function readPublicData(projectId: string, query: string, tables: readonly PublicTable[], deps?: PublicReadDeps): Promise<ToolOutcome> {
  const checked = checkPublicQuery(query, tables);
  if (!checked.ok) return toolError(checked.error);
  const d = deps ?? (await realDeps());
  const live = await d.liveProject(projectId);
  if (!live) return toolError("The page's data is not published yet.");
  const req = new Request(`https://${live.host}/rest/v1/${checked.path}?${checked.search}`, {
    method: "GET",
    headers: { apikey: live.project.publishableKey, accept: "application/json" },
  });
  const res = await d.serve(req, live.project);
  const body = await res.text();
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(body) as { message?: unknown };
      if (typeof j.message === "string") message = j.message;
    } catch {
      // not JSON: the status says it
    }
    return toolError(message);
  }
  const out = body.length > PUBLIC_DATA_MAX_CHARS ? `${body.slice(0, PUBLIC_DATA_MAX_CHARS)}\n(truncated)` : body;
  return { response: { ok: true, [CLAVE_TOOL_RESULT]: out } };
}

/** The real parts: production only — never `ensureEnvironmentReady`, which would create it. */
async function realDeps(): Promise<PublicReadDeps> {
  const [{ getBackendByProject, backendProjectFor, projectUrl }, { getEnvironment }, { handleBackendRequest }, { db, schema }, { eq }] = await Promise.all([
    import("@/lib/backend/registry"),
    import("@/lib/backend/environments"),
    import("@/lib/backend/router"),
    import("@/lib/db"),
    import("drizzle-orm"),
  ]);
  return {
    liveProject: async (projectId) => {
      const record = await getBackendByProject(projectId);
      if (!record) return null;
      const env = await getEnvironment(projectId, "live");
      if (!env?.provisionedAt) return null;
      const [p] = await db.select({ subdomain: schema.projects.subdomain }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
      return { project: backendProjectFor({ record, pageSub: p?.subdomain ?? null }, env), host: new URL(projectUrl(record.ref)).host };
    },
    serve: handleBackendRequest,
  };
}
