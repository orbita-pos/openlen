// Asset storage abstraction — used by the upload feature in the Replace
// modal. Two backends:
//
//   LocalFsAssetStorage (default)
//     Writes to OPENLEN_UPLOAD_DIR (defaults to ./uploads/<projectId>/).
//     Served back via GET /api/projects/[id]/assets/[filename]. URLs are
//     absolute when OPENLEN_APP_BASE_URL is set (so they work from the
//     published subdomain), otherwise relative (fine for in-iframe editing).
//
//   S3AssetStorage (cloud — R2, AWS S3, MinIO, anything S3-compatible)
//     Enabled when ALL of these env vars are present:
//       S3_BUCKET                    — bucket name
//       S3_ACCESS_KEY_ID             — credential
//       S3_SECRET_ACCESS_KEY         — credential
//       S3_PUBLIC_URL_BASE           — base URL clients hit to read objects
//     Optional:
//       S3_REGION                    — defaults to "auto" (R2 convention)
//       S3_ENDPOINT                  — custom endpoint (R2: https://<acct>.r2.cloudflarestorage.com)
//
// The factory picks the right backend at module load and caches the choice.

import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface AssetMetadata {
  filename: string;
  contentType: string;
  size: number;
  /** URL the client should use to reference the asset. May be relative
   *  (LocalFs without OPENLEN_APP_BASE_URL) or absolute (everywhere else). */
  url: string;
}

export interface AssetGetResult {
  contents: Buffer;
  contentType: string;
}

export interface AssetStorage {
  put(
    projectId: string,
    contents: Buffer,
    ext: string,
    contentType: string,
  ): Promise<AssetMetadata>;
  get(projectId: string, filename: string): Promise<AssetGetResult | null>;
}

const VALID_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "mp3",
  "m4a",
  "ogg",
  "wav",
]);

function hashContents(b: Buffer): string {
  return crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);
}

function normalizeExt(ext: string): string {
  return ext.replace(/^\./, "").toLowerCase().slice(0, 5);
}

function safeFilename(hash: string, ext: string): string {
  const clean = normalizeExt(ext);
  if (!VALID_EXT.has(clean)) {
    throw new Error(
      `Unsupported extension "${ext}" — allowed: png/jpg/jpeg/webp/gif/svg/mp3/m4a/ogg/wav`,
    );
  }
  return `${hash}.${clean}`;
}

function safeProjectId(id: string): string {
  // UUID-ish or project-slug — alphanumerics + - and _ only. Anything else
  // would be a path-traversal risk on the LocalFs backend.
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid projectId");
  return id;
}

function mimeForExt(ext: string): string {
  switch (normalizeExt(ext)) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

// ─── LocalFs ────────────────────────────────────────────────────────────────

export class LocalFsAssetStorage implements AssetStorage {
  private readonly rootDir: string;
  private readonly publicBase: string;

  constructor() {
    this.rootDir =
      process.env.OPENLEN_UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
    this.publicBase = (process.env.OPENLEN_APP_BASE_URL ?? "").replace(
      /\/$/,
      "",
    );
  }

  async put(
    projectId: string,
    contents: Buffer,
    ext: string,
    contentType: string,
  ): Promise<AssetMetadata> {
    const id = safeProjectId(projectId);
    const hash = hashContents(contents);
    const filename = safeFilename(hash, ext);
    const projectDir = path.join(this.rootDir, id);
    await fs.mkdir(projectDir, { recursive: true });
    const filePath = path.join(projectDir, filename);
    if (!existsSync(filePath)) {
      await fs.writeFile(filePath, contents);
    }
    return {
      filename,
      contentType,
      size: contents.length,
      url: `${this.publicBase}/api/projects/${id}/assets/${filename}`,
    };
  }

  async get(
    projectId: string,
    filename: string,
  ): Promise<AssetGetResult | null> {
    const id = safeProjectId(projectId);
    if (!/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes("..")) {
      return null;
    }
    const filePath = path.join(this.rootDir, id, filename);
    try {
      const contents = await fs.readFile(filePath);
      const ext = filename.split(".").pop() ?? "";
      return { contents, contentType: mimeForExt(ext) };
    } catch {
      return null;
    }
  }
}

// ─── S3 / R2 ────────────────────────────────────────────────────────────────

export class S3AssetStorage implements AssetStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor() {
    const bucket = process.env.S3_BUCKET;
    const publicBase = process.env.S3_PUBLIC_URL_BASE;
    if (!bucket) throw new Error("S3_BUCKET not set");
    if (!publicBase) throw new Error("S3_PUBLIC_URL_BASE not set");
    this.bucket = bucket;
    this.publicBase = publicBase.replace(/\/$/, "");
    const endpoint = process.env.S3_ENDPOINT;
    this.client = new S3Client({
      region: process.env.S3_REGION ?? "auto",
      ...(endpoint ? { endpoint } : {}),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
      // R2/MinIO require path-style addressing; AWS uses virtual-host by
      // default. The presence of a custom endpoint is a reliable signal.
      forcePathStyle: !!endpoint,
    });
  }

  async put(
    projectId: string,
    contents: Buffer,
    ext: string,
    contentType: string,
  ): Promise<AssetMetadata> {
    const id = safeProjectId(projectId);
    const hash = hashContents(contents);
    const filename = safeFilename(hash, ext);
    const key = `${id}/${filename}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: contents,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return {
      filename,
      contentType,
      size: contents.length,
      url: `${this.publicBase}/${key}`,
    };
  }

  async get(
    projectId: string,
    filename: string,
  ): Promise<AssetGetResult | null> {
    const id = safeProjectId(projectId);
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
    const key = `${id}/${filename}`;
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) return null;
      const chunks: Buffer[] = [];
      // The SDK's Body type is loose — in Node it's an AsyncIterable of
      // byte chunks.
      for await (const chunk of res.Body as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const contents = Buffer.concat(chunks);
      const ext = filename.split(".").pop() ?? "";
      return {
        contents,
        contentType: res.ContentType ?? mimeForExt(ext),
      };
    } catch {
      return null;
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

function isS3Configured(): boolean {
  return !!(
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY &&
    process.env.S3_PUBLIC_URL_BASE
  );
}

let cachedStorage: AssetStorage | null = null;

export function getAssetStorage(): AssetStorage {
  if (cachedStorage) return cachedStorage;
  cachedStorage = isS3Configured()
    ? new S3AssetStorage()
    : new LocalFsAssetStorage();
  return cachedStorage;
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_AUDIO_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB
export const ACCEPTED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;
// Page-music uploads (the floating player). Audio skips the image pipeline:
// stored as-is, hash-named, served with the mime mapped above.
export const ACCEPTED_AUDIO_MIMES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/wav",
] as const;

export function extForMime(mime: string): string | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
      return "wav";
    default:
      return null;
  }
}
