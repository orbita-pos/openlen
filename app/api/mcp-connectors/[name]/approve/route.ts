// «CONECTAR» (spec local 2026-11-06-conectores-mcp, §5.3): the person approves one server Len added or changed in their
// ~/.len/mcp.json, exactly as the card showed it, typing the keys it was missing. Only the workspace's browser session:
// the person themself, never Len, never another member.
import { auth } from "@/auth";
import { approveServer } from "@/lib/mcp-connectors/approval";
import { connectorsEnabled } from "@/lib/mcp-connectors/enabled";
import { setCredential } from "@/lib/mcp-connectors/credentials";
import { mountServer } from "@/lib/mcp-connectors/mount";
import { realMountDeps } from "@/lib/mcp-connectors/real";
import { approve, readMcpConfig } from "@/lib/mcp-connectors/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  // Off means off: approving mounts, and mounting connects (the review's kill-switch finding).
  if (!connectorsEnabled()) return json({ error: "off" }, 404);
  const { name } = await params;
  const body = (await req.json().catch(() => null)) as { fingerprint?: unknown; version?: unknown; credentials?: unknown } | null;
  if (typeof body?.fingerprint !== "string" || typeof body.version !== "number") return json({ error: "invalid" }, 400);
  const credentials = body.credentials ?? {};
  if (typeof credentials !== "object" || Array.isArray(credentials) || Object.values(credentials).some((v) => typeof v !== "string")) return json({ error: "invalid" }, 400);
  const r = await approveServer(personId, name, body.fingerprint, body.version, credentials as Record<string, string>, {
    read: readMcpConfig,
    approve,
    setCredential,
    mount: (p, n) => mountServer(p, n, realMountDeps()),
  });
  if (!r.ok) return r.reason === "changed" ? json({ error: "changed" }, 409) : json({ error: "unknown_credential" }, 400);
  return json({ state: r.state ? { status: r.state.status, tools: r.state.tools.length, error: r.state.error } : null });
}
