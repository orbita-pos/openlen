import { timingSafeEqual } from "node:crypto";
import { seedExplore } from "@/lib/community/seed";
import { SEED_ENTRIES } from "@/lib/community/explore-seed.config";

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
  const provided = Buffer.from(req.headers.get("x-seed-token") ?? "");
  const expected = Buffer.from(token);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return new Response("forbidden", { status: 403 });
  }
  // ?only=<templateId,...> — subset para pilotos (p.ej. re-seed de UN demo
  // para medir costo/fidelidad antes de correr los 24). Sin el param: todos.
  const onlyParam = new URL(req.url).searchParams.get("only");
  const only = onlyParam
    ? new Set(
        onlyParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
  const entries = only ? SEED_ENTRIES.filter((e) => only.has(e.templateId)) : SEED_ENTRIES;
  if (entries.length === 0) return new Response(JSON.stringify({ error: "no_matching_entries" }), { status: 400 });

  const result = await seedExplore(entries);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
