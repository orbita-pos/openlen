// ─────────────────────────────────────────────────────────────────────────────
// GET /api/len-artifacts?projectId= | ?assistantId= — Len's artifacts (spec local 2026-11-22-artifacts-de-len, §2, §4):
// `projectId` lists the ones LEN made in that project (the lenses of its canvas); `assistantId` the ones that agent made,
// in every project it made them in (the tabs of its place on the web, the buttons of its chat on the phone).
//
// → 200 [{ id, slug, title, releaseSha, updatedAt, frameUrl, frameOrigin }], oldest first so the tabs stay where they were ·
//   400 `bad_request` (neither or both named) · 404 `not_found`.
//
// `frameUrl` is where the WORKSPACE frames the artifact (its private host with the published version in the query) and
// `frameOrigin` the origin of it, so the screen can check what answers the bridge; the phone's own address comes from
// `POST /api/movil/len-artifacts/[id]/open`. One whose frame has no address here (the canvas origin is switched off) is
// left out: there is nothing to frame.
//
// 🔴 The project's OWNER only — or the person whose agent it is — and ONE 404 for everything else: nobody is signed in,
// there is no such project or agent, it is another person's, or it is a project they are only a MEMBER of (Jesús: «Sólo el
// dueño, como Claude Code»). A stranger can't tell either exists. The exception is the switch: with the artifacts OFF the
// answer is an empty list, so the screens simply have no tabs. No plan check, no credits: every plan has them.
// ─────────────────────────────────────────────────────────────────────────────
import { assistantById } from "@/lib/assistants/store";
import { lenArtifactsEnabled } from "@/lib/len-artifacts/enabled";
import { lenArtifactFrameUrl } from "@/lib/len-artifacts/host";
import { lenArtifactsOf, projectOwnerOf, type LenArtifactRow } from "@/lib/len-artifacts/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const notFound = () => json({ error: "not_found" }, 404);

/** The artifacts named, when they are this person's to see; null for the one 404. */
async function artifactsAsked(projectId: string | null, assistantId: string | null, userId: string): Promise<LenArtifactRow[] | null> {
  if (projectId) {
    if ((await projectOwnerOf(projectId)) !== userId) return null;
    return lenArtifactsOf({ projectId, maker: "len" });
  }
  const agent = await assistantById(assistantId!);
  if (!agent || agent.personId !== userId) return null;
  return lenArtifactsOf({ maker: { assistantId: agent.id } });
}

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return notFound();
  if (!lenArtifactsEnabled()) return json([]);
  const params = new URL(req.url).searchParams;
  const projectId = params.get("projectId") || null;
  const assistantId = params.get("assistantId") || null;
  if ((projectId === null) === (assistantId === null)) {
    return json({ error: "bad_request", message: "Name one: projectId (Len's artifacts in that project) or assistantId (that agent's)." }, 400);
  }
  const rows = await artifactsAsked(projectId, assistantId, userId);
  if (!rows) return notFound();

  const requestHost = req.headers.get("host");
  const listed = [];
  for (const row of rows) {
    // The same owner check as the artifact's own routes (data, follow, open, delete): a tab that is listed always opens.
    if (row.personId !== userId) continue;
    const frameUrl = lenArtifactFrameUrl({ hostLabel: row.hostLabel, releaseSha: row.releaseSha, requestHost });
    if (!frameUrl) continue;
    listed.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      releaseSha: row.releaseSha,
      updatedAt: row.updatedAt.toISOString(),
      frameUrl,
      frameOrigin: new URL(frameUrl).origin,
    });
  }
  return json(listed);
});

export const OPTIONS = respuestaPrevia;
