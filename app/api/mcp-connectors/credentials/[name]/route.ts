// ONE OF THE PERSON'S KEYS (spec local 2026-11-06-conectores-mcp, §5.2): set or replace its value, or delete it. The
// value is never returned. Setting one mounts, outside the request, every approved server that cites it. Only the
// workspace's browser session.
import { auth } from "@/auth";
import { entryFingerprint, parseMcpConfig } from "@/lib/mcp-connectors/config";
import { deleteCredential, setCredential } from "@/lib/mcp-connectors/credentials";
import { connectorsEnabled } from "@/lib/mcp-connectors/enabled";
import { mountInBackground } from "@/lib/mcp-connectors/real";
import { readMcpConfig } from "@/lib/mcp-connectors/store";
import { CREDENTIAL_NAME, credentialRefsOf } from "@/lib/mcp-connectors/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function PUT(req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  // Off means off: setting a key mounts the servers that cite it, and mounting connects.
  if (!connectorsEnabled()) return json({ error: "off" }, 404);
  const { name } = await params;
  if (!CREDENTIAL_NAME.test(name)) return json({ error: "invalid_name" }, 400);
  const b = (await req.json().catch(() => null)) as { value?: unknown } | null;
  if (typeof b?.value !== "string" || b.value === "") return json({ error: "invalid" }, 400);
  await setCredential(personId, name, b.value);
  const stored = await readMcpConfig(personId);
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  if (parsed.ok) {
    const citing = Object.entries(parsed.config.servers)
      .filter(([n, e]) => e.enabled && stored.approved[n] === entryFingerprint(e) && credentialRefsOf(e).includes(name))
      .map(([n]) => n);
    mountInBackground(personId, citing);
  }
  return json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!connectorsEnabled()) return json({ error: "off" }, 404);
  const { name } = await params;
  await deleteCredential(personId, name);
  return json({ ok: true });
}
