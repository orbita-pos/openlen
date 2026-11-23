// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/len-artifacts/[id] — the project's owner removes one of its artifacts (spec local 2026-11-22-artifacts-de-len, §4),
// from the menu of its lens or tab on the web or from the phone, after confirming. As in Claude's artifacts, deleting is the
// person's: the artifact and its data are deleted for good (the data hangs from its row, so it goes with it), its version too
// unless something else still points at it (§6), and every screen following it is told `gone`. The folder's files stay in
// the project — they are the project's — and its maker has no tool that does this.
//
// → 200 { ok: true } · 404 `not_found`.
//
// 🔴 The project's owner only (Jesús: «Sólo el dueño»), and ONE 404 for everything else — the artifacts are off, nobody is
// signed in, there is no such artifact, it is another person's or a project they are only a member of, it was deleted a
// moment ago — so a stranger can't tell one exists. No plan check, no credits.
// ─────────────────────────────────────────────────────────────────────────────
import { publishArtifactGone } from "@/lib/len-artifacts/bus";
import { lenArtifactsEnabled } from "@/lib/len-artifacts/enabled";
import { lenArtifactById, deleteLenArtifact } from "@/lib/len-artifacts/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { deleteReleaseIfUnused } from "@/lib/tools/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const notFound = () => json({ error: "not_found" }, 404);

export const DELETE = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  if (!lenArtifactsEnabled()) return notFound();
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return notFound();
  const { id } = await params;
  const tool = await lenArtifactById(id);
  if (!tool || tool.personId !== userId) return notFound();

  // Two deletes at once: only the one that removed the row tells the screens, and the other finds nothing, as a later one would.
  if (!(await deleteLenArtifact(tool.id))) return notFound();
  publishArtifactGone(tool.id);
  // Its version goes too, unless another artifact or an installed tool still points at it (spec local
  // 2026-11-22-artifacts-de-len, §6). Never what fails the delete: an old version only takes room.
  await deleteReleaseIfUnused(tool.releaseSha).catch((error) => console.warn("[len-artifacts] a deleted artifact's version couldn't be deleted", error));
  return json({ ok: true });
});

export const OPTIONS = respuestaPrevia;
