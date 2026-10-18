import "server-only";
import { auth } from "@/auth";
import { accesoAlProyecto } from "@/lib/projects/acceso";
import { artifactErrorResponse, handleArtifactApi, type ArtifactApiPath } from "./api";
import { artifactsEnabled, getArtifactRuntime } from "./runtime";
import { ArtifactError } from "./types";

export async function runArtifactRoute(request: Request, params: { id: string; artifactId?: string; jobId?: string; index?: string }, action: ArtifactApiPath["action"]): Promise<Response> {
  if (!artifactsEnabled()) return artifactErrorResponse(new ArtifactError("feature_disabled"));
  try {
    const session = await auth();
    if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
    const access = await accesoAlProyecto(params.id, session.user.id);
    if (!access) throw new ArtifactError("project_not_found");
    return handleArtifactApi(getArtifactRuntime(), { actorId: session.user.id, ownerId: access.duenoId, projectId: params.id, requestId: "", role: access.rol }, request, { action, artifactId: params.artifactId, jobId: params.jobId, index: params.index }, true);
  } catch (error) { return artifactErrorResponse(error); }
}
