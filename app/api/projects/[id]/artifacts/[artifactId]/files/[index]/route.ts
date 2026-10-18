import { runArtifactRoute } from "@/lib/artifacts/routes";
export const runtime = "nodejs";
export async function GET(request: Request, ctx: { params: Promise<{ id: string; artifactId: string; index: string }> }) { return runArtifactRoute(request, await ctx.params, "download"); }
