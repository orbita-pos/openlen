import { createHash } from "node:crypto";
import { insertReport } from "@/lib/community/store";
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import { REPORT_LIMITS } from "@/lib/community/limits";

export const runtime = "nodejs";

const REASONS = new Set(["spam", "adult", "phishing", "other"]);

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    { projectId?: string; reason?: string; note?: string } | null;
  if (!body || typeof body.projectId !== "string" || !REASONS.has(body.reason ?? "")) {
    return json({ error: "invalid_body" }, 400);
  }
  const decision = await checkAndConsume(ipLimitKey(getClientIp(req), "explore-report"), REPORT_LIMITS);
  if (!decision.ok) return json({ error: "rate_limited" }, 429);
  const ua = req.headers.get("user-agent") ?? "";
  const uaHash = createHash("sha256").update(`ol-report:${ua}`).digest("hex").slice(0, 12);
  await insertReport({
    projectId: body.projectId,
    reason: body.reason as string,
    note: typeof body.note === "string" ? body.note.slice(0, 500) : undefined,
    uaHash,
  });
  return json({ ok: true }, 200);
}

function json(b: unknown, s: number) {
  return new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
}
