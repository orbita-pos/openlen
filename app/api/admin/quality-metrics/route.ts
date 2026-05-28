import { requireAdmin } from "@/lib/auth/admin-only";
import { getQualityMetrics } from "@/lib/ai/quality-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/quality-metrics — in-memory vision-critic (Quality S3)
// counters for this process: { totalGens, regensTriggered, regensSucceeded,
// criticFallbacks, regenRate }. Once ~100 gens accumulate, regenRate tells us
// whether the critic's regen threshold is calibrated. Process-local + reset on
// restart — a calibration signal, not durable analytics.
export async function GET(): Promise<Response> {
  const guard = await requireAdmin();
  if (guard instanceof Response) return guard;

  return new Response(JSON.stringify(getQualityMetrics()), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
