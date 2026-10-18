import { runArtifactRoute } from "@/lib/artifacts/routes";
export const runtime = "nodejs";
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) { return runArtifactRoute(request, await ctx.params, "events"); }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) { return runArtifactRoute(request, await ctx.params, "ack"); }
