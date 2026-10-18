import { ArtifactError, type Artifact, type ArtifactContext, type ArtifactDependency, type ArtifactSql } from "./types";

export async function requireProjectAccess(sql: ArtifactSql, ctx: Omit<ArtifactContext, "requestId">, permission: "read" | "write" | "data" = "read"): Promise<ArtifactContext["role"]> {
  const [row] = await sql.query(`select p."userId" as "ownerId",m."rol" from "projects" p left join "projectMembers" m on m."projectId"=p."id" and m."userId"=$2 where p."id"=$1`, [ctx.projectId, ctx.actorId]);
  if (!row || (row.ownerId !== ctx.actorId && row.rol !== "editor" && row.rol !== "lector")) throw new ArtifactError("project_not_found");
  if (row.ownerId !== ctx.ownerId) throw new ArtifactError("project_not_found");
  const role = row.ownerId === ctx.actorId ? "dueno" : row.rol as "editor" | "lector";
  if ((permission === "write" && role === "lector") || (permission === "data" && role !== "dueno")) throw new ArtifactError("forbidden");
  return role;
}

export async function requireArtifactAccess(sql: ArtifactSql, ctx: ArtifactContext, id: string, permission: "read" | "write" | "data", seen = new Set<string>(), lock = false): Promise<Artifact> {
  await requireProjectAccess(sql, ctx, "read");
  if (seen.has(id) || seen.size >= 100) throw new ArtifactError("invalid_dependency");
  seen.add(id);
  try {
    const [row] = await sql.query(`select * from "artifacts" where "id"=$1 and "projectId"=$2${lock ? " for update" : ""}`, [id, ctx.projectId]);
    if (!row || (row.visibility === "owner" && ctx.actorId !== ctx.ownerId)) throw new ArtifactError("artifact_not_found");
    if (permission !== "read") await requireProjectAccess(sql, ctx, permission);
    const [revision] = await sql.query(`select "dependencies" from "artifactRevisions" where "artifactId"=$1 and "revision"=$2`, [id, row.currentRevision]);
    for (const dependency of (revision?.dependencies ?? []) as ArtifactDependency[]) await requireArtifactAccess(sql, ctx, dependency.artifactId, "read", seen);
    return row as unknown as Artifact;
  } finally { seen.delete(id); }
}

export async function validateDependencies(sql: ArtifactSql, ctx: ArtifactContext, id: string, dependencies: readonly ArtifactDependency[]): Promise<boolean> {
  if (!Array.isArray(dependencies) || dependencies.length > 50) throw new ArtifactError("invalid_dependency");
  let privateDependency = false;
  const unique = new Set<string>();
  for (const dependency of dependencies) {
    if (!dependency || typeof dependency.artifactId !== "string" || !Number.isSafeInteger(dependency.revision) || dependency.revision < 0 || unique.has(dependency.artifactId)) throw new ArtifactError("invalid_dependency");
    unique.add(dependency.artifactId);
    const artifact = await requireArtifactAccess(sql, ctx, dependency.artifactId, "read", new Set([id]));
    const [revision] = await sql.query(`select "artifactId" from "artifactRevisions" where "artifactId"=$1 and "revision"=$2`, [dependency.artifactId, dependency.revision]);
    if (!revision) throw new ArtifactError("invalid_dependency");
    privateDependency ||= artifact.visibility === "owner";
  }
  return privateDependency;
}
