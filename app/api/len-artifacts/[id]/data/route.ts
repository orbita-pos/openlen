// ─────────────────────────────────────────────────────────────────────────────
// POST /api/len-artifacts/[id]/data — where an agent's tool's page reaches its own database (spec local
// 2026-11-22-herramienta-dentro-del-agente, §3–§4): the bridge's `data.get|set|update|delete|list|query`, relayed by the
// screen that frames the tool — the workspace with the person's session, the phone app with its key. The frame holds neither.
//
// Body { op: "get"|"list"|"query"|"set"|"update"|"delete", collection, docId?, data?, query? } — the same checks and
// sentences as the agent's `artifact_data` (`lib/len-artifacts/validate.ts`); no `batch`, that is the agent's.
// → 200 reads { doc } | { docs } · writes { ok: true, doc } (doc is null for a delete) · 400 `bad_request` with its sentence,
//   or the store's code (`doc_too_big`, `too_many_docs`, `tool_too_big`, `bad_write`) · 404 `not_found` · 413
//   `payload_too_large` for a body past 256 KB (read no further than that).
//
// 🔴 The tool's owner only, and ONE 404 for everything else — the tools are off, there is no such tool, nobody is signed in,
// the tool is another person's — so a stranger can't tell a tool exists; and the body is read only after that, so a malformed
// one can't tell them either. For every plan: no plan check, no credits (what a tool costs is the agent's turn).
// The person's writes are marked `person` (what the agent is told changed) and handed to everyone following the tool.
// What is in the database is DATA written by the page, the person or the agent: it comes back as data, nothing here obeys it.
// ─────────────────────────────────────────────────────────────────────────────
import { lenArtifactsEnabled } from "@/lib/len-artifacts/enabled";
import { publishArtifactChange } from "@/lib/len-artifacts/bus";
import { runQuery } from "@/lib/len-artifacts/query";
import { lenArtifactById, readDoc, readDocs, writeDocs } from "@/lib/len-artifacts/store";
import { isRecord, parseRead, parseWrite, READ_ACTIONS, WRITE_ACTIONS, type ReadAction, type WriteAction } from "@/lib/len-artifacts/validate";
import { changeOfWrites, toBridgeDoc } from "@/lib/len-artifacts/wire";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const notFound = () => json({ error: "not_found" }, 404);
const badRequest = (message: string) => json({ error: "bad_request", message }, 400);

const READ_OPS: readonly ReadAction[] = READ_ACTIONS;
const WRITE_OPS: readonly WriteAction[] = WRITE_ACTIONS;

/** The most a call's body may weigh: one document is at most 64 KB, so four times that leaves room for its JSON's escapes
 *  and a query — and a page can't make the server parse megabytes before the store's own check refuses them. */
export const DATA_BODY_MAX_BYTES = 256 * 1024;
const tooLarge = () => json({ error: "payload_too_large" }, 413);

/** The body as text, or null once it is past `max` bytes — whatever its `content-length` says, read no further than that. */
async function boundedText(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  if (!lenArtifactsEnabled()) return notFound();
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return notFound();
  const { id } = await params;
  const tool = await lenArtifactById(id);
  if (!tool || tool.personId !== userId) return notFound();

  const text = await boundedText(req, DATA_BODY_MAX_BYTES).catch(() => "");
  if (text === null) return tooLarge();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!isRecord(body)) return badRequest("The body must be a JSON object like { op, collection, docId, data, query }.");
  const op = body.op;
  const input = { collection: body.collection, docId: body.docId, data: body.data, query: body.query };

  if (READ_OPS.includes(op as ReadAction)) {
    const parsed = parseRead(op as ReadAction, input, "docId");
    if ("problem" in parsed) return badRequest(parsed.problem);
    const { collection, docId, query } = parsed;
    // The page lists a collection it names; the agent's list of collections is its own.
    if (collection === null) return badRequest("collection is required for list.");

    if (op === "get") {
      const doc = await readDoc(tool.id, collection, docId!);
      return json({ doc: doc ? toBridgeDoc(doc) : null });
    }
    const docs = await readDocs(tool.id, collection);
    return json({ docs: (op === "list" ? docs : runQuery(docs, query)).map(toBridgeDoc) });
  }

  if (WRITE_OPS.includes(op as WriteAction)) {
    const parsed = parseWrite(op as WriteAction, input, "docId");
    if ("problem" in parsed) return badRequest(parsed.problem);

    const result = await writeDocs(tool.id, [parsed.write], "person");
    if (!result.ok) return json({ error: result.error }, 400);
    // A write that changed nothing (deleting what wasn't there) is told to nobody.
    if (result.changes.length > 0) publishArtifactChange(tool.id, changeOfWrites("person", result.changes));
    const doc = result.changes.find((c) => c.data !== null);
    return json({ ok: true, doc: doc ? toBridgeDoc(doc) : null });
  }

  return badRequest(`op must be one of ${[...READ_OPS, ...WRITE_OPS].join(", ")}.`);
});

export const OPTIONS = respuestaPrevia;
