import { z } from "zod";
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import { sendAbuseReportEmail } from "@/lib/email";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/report-abuse — the structured side of the abuse channel the AUP
// already publishes (mailto info@jesusbr.com). Public, no auth — reporters
// are visitors. Honeypot + per-IP rate limit; the report itself is the email
// in the operator's inbox (no DB table — deliberately minimal).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;

const BodySchema = z.object({
  siteUrl: z.string().min(4).max(500).transform((v) => v.trim()),
  category: z.enum(["csam", "intimate", "phishing", "copyright", "other"]),
  details: z.string().min(10).max(2000).transform((v) => v.trim()),
  reporterEmail: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim())
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Honeypot — humans never see it; bots fill it.
  website: z.string().max(200).optional(),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_body" }, 400);

  // Honeypot tripped → pretend success, send nothing.
  if (parsed.data.website && parsed.data.website.trim().length > 0) {
    return json({ ok: true }, 200);
  }

  const ip = getClientIp(req);
  const decision = await checkAndConsume(ipLimitKey(ip, "report-abuse"), [
    { windowMs: HOUR, max: 5, label: "hourly" },
  ]);
  if (!decision.ok) return json({ error: "rate_limited" }, 429);

  try {
    await sendAbuseReportEmail({
      siteUrl: parsed.data.siteUrl,
      category: parsed.data.category,
      details: parsed.data.details,
      reporterEmail: parsed.data.reporterEmail ?? null,
      ip,
    });
    // Backup trail in the journal — an abuse report must never vanish into
    // a lost email alone.
    // eslint-disable-next-line no-console
    console.warn(
      `[abuse-report] ${parsed.data.category} — ${parsed.data.siteUrl} (reporter: ${parsed.data.reporterEmail ?? "anon"})`,
    );
    return json({ ok: true }, 200);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[abuse-report] send failed", err);
    return json({ error: "send_failed" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
