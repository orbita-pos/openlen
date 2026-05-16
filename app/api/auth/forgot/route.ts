import { z } from "zod";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import {
  IP_LIMITS,
  checkAndConsume,
  getClientIp,
  ipLimitKey,
} from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/forgot
//
// Body: { email }
// Always returns 200 { ok: true } regardless of whether the email exists —
// prevents user enumeration. The actual email only gets sent if a user
// with that address is in the DB.
// ─────────────────────────────────────────────────────────────────────────────

const ForgotSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
});

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = ForgotSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid email" }, 400);
  }

  const ip = getClientIp(req);
  const decision = await checkAndConsume(
    ipLimitKey(ip, "forgot"),
    IP_LIMITS.forgot,
  );
  if (!decision.ok && decision.blocked) {
    return json(
      {
        error: "rate_limited",
        scope: decision.blocked.label,
        resetAt: decision.resetAt?.toISOString(),
      },
      429,
    );
  }

  const { email } = parsed.data;

  try {
    const users = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (users.length > 0) {
      const user = users[0];
      // Raw token goes in the email. Hash is what we store.
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await db.insert(schema.passwordResetTokens).values({
        tokenHash,
        userId: user.id,
        expires,
        used: false,
      });

      const origin = req.headers.get("origin")
        ?? process.env.NEXTAUTH_URL
        ?? "http://localhost:3000";
      const resetUrl = `${origin}/reset/${rawToken}`;

      await sendPasswordResetEmail({
        to: email,
        name: user.name ?? null,
        resetUrl,
      });
    }

    // Always succeed — don't leak whether the email exists.
    return json({ ok: true }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `Server error: ${message}` }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
