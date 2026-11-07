// ONE OF THE PERSON'S CONNECTORS (spec local 2026-11-06-conectores-mcp, §5.7): PUT writes it (validated like Len's
// writes, approved because the person wrote it, then mounted); DELETE removes it with its approval and state, keeping
// the keys (they are the person's, listed under «Claves»). Only the workspace's browser session.
import { auth } from "@/auth";
import { connectorsEnabled } from "@/lib/mcp-connectors/enabled";
import { removeEntry, saveEntry } from "@/lib/mcp-connectors/manage";
import { realManageDeps } from "@/lib/mcp-connectors/real";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const strings = (v: unknown): v is Record<string, string> => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");

export async function PUT(req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!connectorsEnabled()) return json({ error: "off" }, 404);
  const { name } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.url !== "string" || typeof b.version !== "number") return json({ error: "invalid" }, 400);
  if ((b.headers !== undefined && !strings(b.headers)) || (b.secretHeaders !== undefined && !strings(b.secretHeaders))) return json({ error: "invalid" }, 400);
  if (b.enabled !== undefined && typeof b.enabled !== "boolean") return json({ error: "invalid" }, 400);
  const r = await saveEntry(
    personId,
    name,
    {
      url: b.url,
      version: b.version,
      ...(b.headers ? { headers: b.headers as Record<string, string> } : {}),
      ...(b.secretHeaders ? { secretHeaders: b.secretHeaders as Record<string, string> } : {}),
      ...(typeof b.enabled === "boolean" ? { enabled: b.enabled } : {}),
      ...(b.mergeHeaders === true ? { mergeHeaders: true } : {}),
    },
    realManageDeps(),
  );
  return r.ok ? json({ server: r.view }) : json({ error: r.error }, r.status);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const personId = (await auth())?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  if (!connectorsEnabled()) return json({ error: "off" }, 404);
  const { name } = await params;
  const version = Number(new URL(req.url).searchParams.get("version"));
  if (!Number.isInteger(version)) return json({ error: "invalid" }, 400);
  const r = await removeEntry(personId, name, version, realManageDeps());
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
}
