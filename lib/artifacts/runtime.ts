import "server-only";
import { resolve } from "node:path";
import { createArtifactDatabase } from "./database";
import { createArtifactEvents } from "./events";
import { createArtifactJobs } from "./jobs";
import { createArtifactStore } from "./store";
import { createR2ArtifactStorage, FilesystemArtifactStorage, type ArtifactStorage } from "./private-storage";
import { ArtifactError } from "./types";

export const artifactsEnabled = (env: Readonly<Record<string, string | undefined>> = process.env) => env.OPENLEN_ARTIFACTS === "1";
export function createArtifactRuntime(env: Readonly<Record<string, string | undefined>>) {
  if (!env.DATABASE_URL) throw new ArtifactError("database_unavailable");
  const database = createArtifactDatabase(env.DATABASE_URL);
  const store = createArtifactStore(database);
  let storage: Promise<ArtifactStorage> | null = null;
  const loadStorage = async (): Promise<ArtifactStorage> => {
    if (env.R2_ARTIFACTS_BUCKET && env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY && env.R2_SECRET_KEY) return createR2ArtifactStorage({ accountId: env.R2_ACCOUNT_ID, bucket: env.R2_ARTIFACTS_BUCKET, accessKeyId: env.R2_ACCESS_KEY, secretAccessKey: env.R2_SECRET_KEY });
    if (!env.OPENLEN_ARTIFACTS_DIR && env.NODE_ENV === "production") throw new ArtifactError("private_storage_unavailable");
    const root = resolve(env.OPENLEN_ARTIFACTS_DIR ?? ".artifacts-private");
    if (root.replace(/\\/g, "/").toLowerCase().split("/").includes("public")) throw new ArtifactError("private_storage_unavailable");
    return new FilesystemArtifactStorage(root);
  };
  return { database, store, jobs: createArtifactJobs(database, store), events: createArtifactEvents(database), storage: () => storage ??= loadStorage().catch((error) => { storage = null; throw error; }), close: () => database.close() };
}
type Runtime = ReturnType<typeof createArtifactRuntime>;
const KEY = Symbol.for("openlen.artifacts.runtime");
type WithRuntime = typeof globalThis & { [KEY]?: Runtime };
export function getArtifactRuntime(): Runtime {
  if (!artifactsEnabled()) throw new ArtifactError("feature_disabled");
  const global = globalThis as WithRuntime;
  return global[KEY] ??= createArtifactRuntime(process.env);
}
