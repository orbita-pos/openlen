import { constants } from "node:fs";
import { mkdir, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, dirname } from "node:path";
import { safeArtifactPath } from "./state";
import { ArtifactError } from "./types";

export interface ArtifactStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
const validateKey = (key: string) => { if (!safeArtifactPath(key)) throw new ArtifactError("invalid_object_key"); };
const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const contained = (root: string, path: string) => { const part = relative(root, path); return part !== "" && !part.startsWith("..") && !isAbsolute(part); };

/**
 * The folder decides who else reads, as a setgid share does: a root this code creates is private (0700), and a root
 * an operator created with group access — on the box, /var/openlen/artifacts, written only by the worker and read by
 * Next and the preview, which run as another user — gets group-readable objects. Writing stays the owner's, and
 * others never get a bit from here.
 */
export function storageModes(rootMode: number): { dir: number; file: number } {
  return (rootMode & 0o050) === 0o050 ? { dir: 0o750, file: 0o640 } : { dir: 0o700, file: 0o600 };
}

export class FilesystemArtifactStorage implements ArtifactStorage {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private async location(key: string, createParent = false): Promise<{ path: string; file: number }> {
    validateKey(key);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const root = await realpath(this.root);
    const modes = storageModes((await stat(root)).mode);
    const path = resolve(root, key);
    if (!contained(root, path)) throw new ArtifactError("invalid_object_key");
    if (createParent) await mkdir(dirname(path), { recursive: true, mode: modes.dir });
    const parent = await realpath(dirname(path));
    if (parent !== root && !contained(root, parent)) throw new ArtifactError("invalid_object_key");
    return { path, file: modes.file };
  }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const { path, file: mode } = await this.location(key, true);
    let file;
    try { file = await open(path, "wx", mode); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (!sameBytes(await this.get(key), bytes)) throw new ArtifactError("object_conflict");
      return;
    }
    try { await file.writeFile(bytes); await file.sync(); }
    catch (error) { await file.close(); await unlink(path).catch(() => undefined); throw error; }
    await file.close();
  }
  async get(key: string): Promise<Uint8Array> {
    const { path } = await this.location(key);
    const real = await realpath(path);
    const root = await realpath(this.root);
    if (!contained(root, real)) throw new ArtifactError("invalid_object_key");
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { return new Uint8Array(await handle.readFile()); } finally { await handle.close(); }
  }
  async delete(key: string): Promise<void> {
    try { await unlink((await this.location(key)).path); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
}

/** Transport must implement immutable/conditional put; no public-URL contract. */
export class R2ArtifactStorage implements ArtifactStorage {
  constructor(private transport: ArtifactStorage) {}
  async put(key: string, bytes: Uint8Array) { validateKey(key); await this.transport.put(key, bytes); }
  async get(key: string) { validateKey(key); return this.transport.get(key); }
  async delete(key: string) { validateKey(key); await this.transport.delete(key); }
}

export async function createR2ArtifactStorage(config: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }): Promise<ArtifactStorage> {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({ region: "auto", endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  const get = async (key: string) => {
    const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    if (!result.Body) throw new ArtifactError("object_not_found");
    return result.Body.transformToByteArray();
  };
  return new R2ArtifactStorage({
    get,
    put: async (key, bytes) => {
      try { await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes, IfNoneMatch: "*", ContentType: "application/octet-stream", CacheControl: "private, no-store" })); }
      catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
        if (!sameBytes(await get(key), bytes)) throw new ArtifactError("object_conflict");
      }
    },
    delete: async (key) => { await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })); },
  });
}

/**
 * The private store, by the environment: the private R2 bucket in production, otherwise a folder that
 * is never under `public` (and none in production without one). Shared by the deliverables and, in
 * development without R2, by what Len delivers with `present` (`lib/agent/skills/deliveries.ts`).
 */
export async function privateStorageFromEnv(env: Readonly<Record<string, string | undefined>>): Promise<ArtifactStorage> {
  if (env.R2_ARTIFACTS_BUCKET && env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY && env.R2_SECRET_KEY) {
    return createR2ArtifactStorage({ accountId: env.R2_ACCOUNT_ID, bucket: env.R2_ARTIFACTS_BUCKET, accessKeyId: env.R2_ACCESS_KEY, secretAccessKey: env.R2_SECRET_KEY });
  }
  if (!env.OPENLEN_ARTIFACTS_DIR && env.NODE_ENV === "production") throw new ArtifactError("private_storage_unavailable");
  const root = resolve(env.OPENLEN_ARTIFACTS_DIR ?? ".artifacts-private");
  if (root.replace(/\\/g, "/").toLowerCase().split("/").includes("public")) throw new ArtifactError("private_storage_unavailable");
  return new FilesystemArtifactStorage(root);
}
