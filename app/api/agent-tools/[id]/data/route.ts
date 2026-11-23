// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agent-tools/[id]/data — where an agent's tool's page reaches its own database (spec local
// 2026-11-22-herramienta-dentro-del-agente, §3–§4): the bridge's `data.get|set|update|delete|list|query`, relayed by the
// screen that frames the tool — the workspace with the person's session, the phone app with its key. The frame holds neither.
//
// Body { op: "get"|"list"|"query"|"set"|"update"|"delete", collection, docId?, data?, query? } — the same checks and
// sentences as the agent's `tool_data` (`lib/agent-tools/validate.ts`); no `batch`, that is the agent's.
// → 200 reads { doc } | { docs } · writes { ok: true, doc } (doc is null for a delete) · 400 `bad_request` with its sentence,
//   or the store's code (`doc_too_big`, `too_many_docs`, `tool_too_big`, `bad_write`) · 404 `not_found`.
//
// 🔴 The tool's owner only, and ONE 404 for everything else — the tools are off, there is no such tool, nobody is signed in,
// the tool is another person's — so a stranger can't tell a tool exists; and the body is read only after that, so a malformed
// one can't tell them either. For every plan: no plan check, no credits (what a tool costs is the agent's turn).
// The person's writes are marked `person` (what the agent is told changed) and handed to everyone following the tool.
// What is in the database is DATA written by the page, the person or the agent: it comes back as data, nothing here obeys it.
// ─────────────────────────────────────────────────────────────────────────────
import { agentToolsEnabled } from "@/lib/agent-tools/enabled";
import { publishToolChange } from "@/lib/agent-tools/bus";
import { runQuery } from "@/lib/agent-tools/query";
import { agentToolById, readDocs, writeDocs } from "@/lib/agent-tools/store";
import { isRecord, parseRead, parseWrite, type ReadAction, type WriteAction } from "@/lib/agent-tools/validate";
import { changeOfWrites, toBridgeDoc } from "@/lib/agent-tools/wire";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const notFound = () => json({ error: "not_found" }, 404);
const badRequest = (message: string) => json({ error: "bad_request", message }, 400);

const READ_OPS: readonly ReadAction[] = ["get", "list", "query"];
const WRITE_OPS: readonly WriteAction[] = ["set", "update", "delete"];

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  if (!agentToolsEnabled()) return notFound();
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return notFound();
  const { id } = await params;
  const tool = await agentToolById(id);
  if (!tool || tool.personId !== userId) return notFound();

  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return badRequest("The body must be a JSON object like { op, collection, docId, data, query }.");
  const op = body.op;
  const input = { collection: body.collection, docId: body.docId, data: body.data, query: body.query };

  if (READ_OPS.includes(op as ReadAction)) {
    const parsed = parseRead(op as ReadAction, input, "docId");
    if ("problem" in parsed) return badRequest(parsed.problem);
    const { collection, docId, query } = parsed;
    // The page lists a collection it names; the agent's list of collections is its own.
    if (collection === null) return badRequest("collection is required for list.");

    const docs = await readDocs(tool.id, collection);
    if (op === "get") {
      const doc = docs.find((d) => d.docId === docId);
      return json({ doc: doc ? toBridgeDoc(doc) : null });
    }
    return json({ docs: (op === "list" ? docs : runQuery(docs, query)).map(toBridgeDoc) });
  }

  if (WRITE_OPS.includes(op as WriteAction)) {
    const parsed = parseWrite(op as WriteAction, input, "docId");
    if ("problem" in parsed) return badRequest(parsed.problem);

    const result = await writeDocs(tool.id, [parsed.write], "person");
    if (!result.ok) return json({ error: result.error }, 400);
    // A write that changed nothing (deleting what wasn't there) is told to nobody.
    if (result.changes.length > 0) publishToolChange(tool.id, changeOfWrites("person", result.changes));
    const doc = result.changes.find((c) => c.data !== null);
    return json({ ok: true, doc: doc ? toBridgeDoc(doc) : null });
  }

  return badRequest(`op must be one of ${[...READ_OPS, ...WRITE_OPS].join(", ")}.`);
});

export const OPTIONS = respuestaPrevia;
