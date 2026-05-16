import { z } from "zod";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/reset
//
// Body: { token, password }
// Returns:
//   200 { ok: true } on success — client then calls signIn() with the new password
//   400 { error: "invalid" } on bad/expired/used token
//   400 { error: "<msg>" } on validation failure
//
// Marks the token used and updates the user's passwordHash atomically.
// ─────────────────────────────────────────────────────────────────────────────

const ResetSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = ResetSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const { token, password } = parsed.data;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  try {
    const rows = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.tokenHash, tokenHash),
          gt(schema.passwordResetTokens.expires, new Date()),
          eq(schema.passwordResetTokens.used, false),
        ),
      )
      .limit(1);

    const tokenRow = rows[0];
    if (!tokenRow) {
      return json({ error: "invalid" }, 400);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await db
      .update(schema.users)
      .set({ passwordHash })
      .where(eq(schema.users.id, tokenRow.userId));

    await db
      .update(schema.passwordResetTokens)
      .set({ used: true })
      .where(eq(schema.passwordResetTokens.tokenHash, tokenHash));

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
