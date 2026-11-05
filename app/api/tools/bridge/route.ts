// THE BRIDGE'S SERVER (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): the workspace relays a tool's
// JSON-RPC request here with the person's session and answers the frame with what comes back. Only what needs
// the server: the tool's backend, the person's projects, and the owner's form submissions, visits and read-only
// SQL. `update` goes through OpenLen's dialog and /api/tools/data-change; `context` and `sendPrompt` never leave
// the workspace.
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { resolveBridgeCaller } from "@/lib/tools/bridge/caller";
import { handleBridgeCall, SERVER_METHODS, type ServerMethod } from "@/lib/tools/bridge/handlers";
import { BRIDGE_CHANNEL, isBridgeRequest, METHOD_NOT_FOUND } from "@/lib/tools/bridge/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// The workspace's session or the phone app's key (phase 5, spec §4.14): the phone draws OpenLen's confirmations itself.
export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isBridgeRequest(body.request)) return json({ error: "invalid" }, 400);
  const request = body.request;
  if (!(SERVER_METHODS as readonly string[]).includes(request.method)) {
    return json({ jsonrpc: "2.0", id: request.id, error: { code: METHOD_NOT_FOUND, message: "method_not_found" }, channel: BRIDGE_CHANNEL });
  }
  const who = await resolveBridgeCaller(userId, body);
  if (!("caller" in who)) return json(who.body, who.status);
  const answer = await handleBridgeCall(who.caller, request.method as ServerMethod, request.params);
  return json({ jsonrpc: "2.0", id: request.id, ...answer, channel: BRIDGE_CHANNEL });
});

export const OPTIONS = respuestaPrevia;
