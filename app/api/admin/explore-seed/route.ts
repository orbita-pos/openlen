import { seedExplore } from "@/lib/community/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-time first-party seed of /explore. Inert unless EXPLORE_SEED_TOKEN is set
// in the environment (404), so it presents no surface in normal operation.
// Triggered once on the box after the gallery is approved:
//   ssh openlen "curl -s -X POST http://127.0.0.1:3000/api/admin/explore-seed \
//     -H 'x-seed-token: $EXPLORE_SEED_TOKEN'"
export async function POST(req: Request): Promise<Response> {
  const token = process.env.EXPLORE_SEED_TOKEN?.trim();
  if (!token) return new Response("not found", { status: 404 });
  if (req.headers.get("x-seed-token") !== token) {
    return new Response("forbidden", { status: 403 });
  }
  const result = await seedExplore();
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
