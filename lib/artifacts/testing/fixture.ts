import { PGlite } from "@electric-sql/pglite";
import { ARTIFACT_MIGRATION_SQL } from "../migration";
import { createArtifactStore } from "../store";
import type { ArtifactContext, ArtifactDatabase, ArtifactKind, ArtifactVisibility } from "../types";

export async function artifactFixture() {
  const pg = new PGlite();
  const database: ArtifactDatabase = {
    query: async (text, values = []) => (await pg.query(text, [...values])).rows as Record<string, unknown>[],
    transaction: (fn) => pg.transaction(async (tx) => fn({ query: async (text, values = []) => (await tx.query(text, [...values])).rows as Record<string, unknown>[] })),
  };
  await pg.exec(`create table "users" ("id" text primary key); create table "projects" ("id" text primary key,"userId" text not null references "users"("id")); create table "projectMembers" ("projectId" text,"userId" text,"rol" text); insert into "users" values ('owner'),('editor'),('reader'),('stranger'); insert into "projects" values ('project','owner'),('other','owner'); insert into "projectMembers" values ('project','editor','editor'),('project','reader','lector');`);
  await pg.exec(ARTIFACT_MIGRATION_SQL);
  const store = createArtifactStore(database);
  const owner: ArtifactContext = { actorId: "owner", ownerId: "owner", projectId: "project", requestId: "", role: "dueno" };
  async function create(visibility: ArtifactVisibility = "project", kind: ArtifactKind = "slides") {
    const request = await store.ensureArtifactRequest(owner, crypto.randomUUID());
    const ctx = { ...owner, requestId: request.id };
    return { ctx, artifact: await store.createArtifact(ctx, { kind, visibility, title: "Demo", brief: "My app" }) };
  }
  return { pg, database, store, owner, create };
}
