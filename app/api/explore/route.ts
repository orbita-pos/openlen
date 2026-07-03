import { listExplore } from "@/lib/community/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sort = url.searchParams.get("sort") === "remixed" ? "remixed" : "recent";
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const data = await listExplore({ sort, cursor });
  return new Response(JSON.stringify(data), {
    status: 200, headers: { "content-type": "application/json" },
  });
}
