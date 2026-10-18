import { constants } from "node:fs";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
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

export class FilesystemArtifactStorage implements ArtifactStorage {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private async location(key: string, createParent = false): Promise<string> {
    validateKey(key);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const root = await realpath(this.root);
    const path = resolve(root, key);
    if (!contained(root, path)) throw new ArtifactError("invalid_object_key");
    if (createParent) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const parent = await realpath(dirname(path));
    if (parent !== root && !contained(root, parent)) throw new ArtifactError("invalid_object_key");
    return path;
  }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = await this.location(key, true);
    let file;
    try { file = await open(path, "wx", 0o600); }
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
    const path = await this.location(key);
    const real = await realpath(path);
    const root = await realpath(this.root);
    if (!contained(root, real)) throw new ArtifactError("invalid_object_key");
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { return new Uint8Array(await handle.readFile()); } finally { await handle.close(); }
  }
  async delete(key: string): Promise<void> {
    try { await unlink(await this.location(key)); }
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
