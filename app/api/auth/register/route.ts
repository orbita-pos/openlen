import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  IP_LIMITS,
  checkAndConsume,
  getClientIp,
  ipLimitKey,
} from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
//
// Body: { email, password, name? }
// Returns: 200 { ok: true } on success — client then calls signIn() to log in.
//          409 { error: "exists" } if email already registered.
//          400 { error: "<zod message>" } on validation failure.
//
// Note: we do NOT auto-sign-in the user here. Auth.js's signIn() needs to
// run from a browser session with CSRF tokens — easier to call from the
// client immediately after register succeeds.
// ─────────────────────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: z.string().max(120).optional(),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const ip = getClientIp(req);
  const decision = await checkAndConsume(
    ipLimitKey(ip, "register"),
    IP_LIMITS.register,
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

  const { email, password, name } = parsed.data;

  try {
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return json({ error: "exists" }, 409);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(schema.users).values({
      email,
      passwordHash,
      name: name ?? null,
    });

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
