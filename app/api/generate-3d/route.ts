import { auth } from "@/auth";
import { getUserPlan } from "@/lib/limits";
import { debitCredits, SCENE_3D_CREDIT_COST } from "@/lib/credits";
import { generateSceneSpec, resolveProvider } from "@/lib/three3d/generate-spec";
import type { GenInput } from "@/lib/three3d/gen-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/generate-3d
//
// Body: { describe: string, look?, brandMatch?, behavior?, accent? }
//
// Returns: { spec, provider, rerolls, fallback }
//
// Pro-gate + credit charge apply only when the resolved provider is "gemini"
// (OPENLEN_3D_PROVIDER=gemini). In dev/mock mode the endpoint is free and
// open to any authenticated user — no real AI cost is incurred.
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const describe =
    body &&
    typeof body === "object" &&
    typeof (body as { describe?: unknown }).describe === "string"
      ? (body as { describe: string }).describe.trim()
      : "";
  if (!describe) return json({ error: "describe_required" }, 400);

  const b = body as Record<string, unknown>;
  const input: GenInput = {
    describe,
    look: b.look as GenInput["look"],
    brandMatch: typeof b.brandMatch === "boolean" ? b.brandMatch : undefined,
    behavior: b.behavior as GenInput["behavior"],
    accent: typeof b.accent === "string" ? b.accent : undefined,
    // devSpec intentionally NOT read from request body — dev/test-only seam.
  };

  // Resolve provider once; gate + charge only when it is the live Gemini path.
  const provider = resolveProvider();

  if (provider === "gemini") {
    const plan = await getUserPlan(userId);
    if (plan !== "pro") return json({ error: "pro_required" }, 402);
  }

  let result;
  try {
    result = await generateSceneSpec(input);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[generate-3d] generation failed", err);
    return json({ error: "generation_failed" }, 500);
  }

  // Debit after a confirmed success so a failed call never burns credits.
  if (provider === "gemini") {
    try {
      await debitCredits(userId, SCENE_3D_CREDIT_COST);
    } catch {
      return json({ error: "insufficient_credits" }, 402);
    }
  }

  return json(
    {
      spec: result.spec,
      provider: result.provider,
      rerolls: result.rerolls,
      fallback: result.fallback,
    },
    200,
  );
}
