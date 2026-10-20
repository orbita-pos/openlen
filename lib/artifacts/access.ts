import { ArtifactError, type Artifact, type ArtifactContext, type ArtifactDependency, type ArtifactSql } from "./types";

export async function requireProjectAccess(sql: ArtifactSql, ctx: Omit<ArtifactContext, "requestId">, permission: "read" | "write" | "data" = "read"): Promise<ArtifactContext["role"]> {
  const [row] = await sql.query(`select p."userId" as "ownerId",m."rol" from "projects" p left join "projectMembers" m on m."projectId"=p."id" and m."userId"=$2 where p."id"=$1`, [ctx.projectId, ctx.actorId]);
  if (!row || (row.ownerId !== ctx.actorId && row.rol !== "editor" && row.rol !== "lector")) throw new ArtifactError("project_not_found");
  if (row.ownerId !== ctx.ownerId) throw new ArtifactError("project_not_found");
  const role = row.ownerId === ctx.actorId ? "dueno" : row.rol as "editor" | "lector";
  if ((permission === "write" && role === "lector") || (permission === "data" && role !== "dueno")) throw new ArtifactError("forbidden");
  return role;
}

/** How deep a dependency chain may go, counting the artifact itself. */
const MAX_DEPENDENCY_DEPTH = 100;

export async function requireArtifactAccess(sql: ArtifactSql, ctx: ArtifactContext, id: string, permission: "read" | "write" | "data", seen = new Set<string>(), lock = false): Promise<Artifact> {
  await requireProjectAccess(sql, ctx, "read");
  if (seen.has(id) || seen.size >= MAX_DEPENDENCY_DEPTH) throw new ArtifactError("invalid_dependency");
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

/**
 * `requireArtifactAccess(…, "read")` for many ids at once, with the same answer
 * for each: the readable ones, in the order given. The bell and the history list
 * up to 200 deliverables every few seconds, and one by one that cost three
 * queries or more per deliverable (602 for one full list). This loads the
 * dependency closure a level at a time instead.
 */
export async function readableArtifacts(sql: ArtifactSql, ctx: ArtifactContext, ids: readonly string[]): Promise<Artifact[]> {
  await requireProjectAccess(sql, ctx, "read");
  const rows = new Map<string, Record<string, unknown>>();
  const dependencies = new Map<string, string[]>();
  const loaded = new Set<string>();
  let level = [...new Set(ids)];
  // Anything further than the depth limit from every id makes none of them
  // readable, so the closure can stop there.
  for (let depth = 0; level.length > 0 && depth <= MAX_DEPENDENCY_DEPTH; depth++) {
    for (const id of level) loaded.add(id);
    for (const row of await sql.query(`select * from "artifacts" where "id"=any($1::text[]) and "projectId"=$2`, [level, ctx.projectId])) rows.set(String(row.id), row);
    const found = level.filter((id) => rows.has(id));
    const revisions = found.length === 0 ? [] : await sql.query(
      `select r."artifactId",r."dependencies" from "artifactRevisions" r join "artifacts" a on a."id"=r."artifactId" and r."revision"=a."currentRevision" where a."id"=any($1::text[]) and a."projectId"=$2`,
      [found, ctx.projectId],
    );
    const next = new Set<string>();
    for (const revision of revisions) {
      const ofRevision = ((revision.dependencies ?? []) as ArtifactDependency[]).map((dependency) => dependency.artifactId);
      dependencies.set(String(revision.artifactId), ofRevision);
      for (const dependency of ofRevision) if (!loaded.has(dependency)) next.add(dependency);
    }
    level = [...next];
  }
  // The longest dependency chain under each artifact, itself included. Missing,
  // owner-only for this actor or part of a cycle: unreadable, as one by one.
  const heights = new Map<string, number>();
  const visiting = new Set<string>();
  const height = (id: string): number => {
    const known = heights.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return Number.POSITIVE_INFINITY;
    const row = rows.get(id);
    let result = Number.POSITIVE_INFINITY;
    if (row && !(row.visibility === "owner" && ctx.actorId !== ctx.ownerId)) {
      visiting.add(id);
      result = 1;
      for (const dependency of dependencies.get(id) ?? []) result = Math.max(result, 1 + height(dependency));
      visiting.delete(id);
    }
    heights.set(id, result);
    return result;
  };
  return ids.filter((id) => height(id) <= MAX_DEPENDENCY_DEPTH).map((id) => rows.get(id) as unknown as Artifact);
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
