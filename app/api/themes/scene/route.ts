// THE SCENE OF A THEME (spec local 2026-11-27-temas-del-workspace, §5.2): the workspace paints it in an <img> behind the
// glass. `lib/themes/serve.ts` decides who sees what and how the image is made harmless; this only reads the query.
// Web session only, like the rest of the theme routes: the phone has no theme layer yet.
import { realSceneServeDeps, serveThemeScene } from "@/lib/themes/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  return serveThemeScene(
    { ref: params.get("ref"), still: params.get("still") === "1", v: params.get("v") },
    realSceneServeDeps(),
  );
}
