import { auth } from "@/auth";
import {
  createProfile,
  listProfiles,
} from "@/lib/business-profiles/store";
import { normalizeProfileData } from "@/lib/business-profiles/normalize";

// GET  /api/profiles      — list the signed-in user's saved business profiles
// POST /api/profiles      — create one { name, data, isDefault? }

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return json(401, { error: "unauthenticated" });
  const profiles = await listProfiles(session.user.id);
  return json(200, { profiles });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return json(401, { error: "unauthenticated" });

  let body: { name?: unknown; data?: unknown; isDefault?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return json(400, { error: "name is required" });
  if (name.length > 80) return json(400, { error: "name too long (max 80)" });

  const data = normalizeProfileData(body.data);
  const profile = await createProfile(session.user.id, {
    name,
    data,
    isDefault: body.isDefault === true,
  });
  return json(201, { profile });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
