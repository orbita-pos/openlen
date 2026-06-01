// Auth.js v5 mounts both GET and POST under this catch-all route.
// `handlers` is an object { GET, POST } created in /auth.ts.
import { type NextRequest } from "next/server";
import { handlers } from "@/auth";
import {
  IP_LIMITS,
  checkAndConsume,
  getClientIp,
  ipLimitKey,
} from "@/lib/limits";

// Node runtime — the login rate-limiter loads the native @openlen/rate-limit
// binding, which the Edge runtime can't host. (Auth.js's DB-session adapter
// needs Node anyway.)
export const runtime = "nodejs";

export const GET = handlers.GET;

// Brute-force / credential-stuffing guard. Credentials sign-in POSTs to
// /api/auth/callback/credentials, which had NO throttling even though register
// / forgot / reset all do. Gate it per IP before Auth.js touches the DB or
// bcrypt. We read only headers + the URL here — never the body — so the request
// still streams intact into the Auth.js handler.
export async function POST(req: NextRequest): Promise<Response> {
  if (new URL(req.url).pathname.endsWith("/callback/credentials")) {
    const ip = getClientIp(req);
    const gate = await checkAndConsume(ipLimitKey(ip, "login"), IP_LIMITS.login);
    if (!gate.ok) {
      return new Response(
        JSON.stringify({
          error: "rate_limited",
          resetAt: gate.resetAt?.toISOString(),
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    }
  }
  return handlers.POST(req);
}
