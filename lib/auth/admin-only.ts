import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// requireAdmin() — gate for the /api/admin/* endpoints.
//
// Returns { userId } if the caller has a session AND users.role = 'admin'.
// Otherwise returns a Response (401 anon, 403 logged-in-non-admin) that the
// caller should return directly:
//
//   const guard = await requireAdmin();
//   if (guard instanceof Response) return guard;
//   // guard.userId is the admin user id from here on
//
// Why this pattern: the type narrowing keeps the happy path linear and the
// short-circuit obvious. Throwing would force a try/catch in every handler.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminGuardSuccess {
  userId: string;
}

export async function requireAdmin(): Promise<AdminGuardSuccess | Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const rows = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);

  const role = rows[0]?.role;
  if (role !== "admin") {
    return new Response(
      JSON.stringify({ error: "forbidden", reason: "admin role required" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return { userId: session.user.id };
}
