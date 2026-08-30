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
//     …O con los nombres R2_* que este repo ya usa en `lib/storage/`. Ver
//     `configDelAlmacen` abajo: dos juegos de nombres para el mismo bucket
//     costaron que NINGUNA subida de usuario llegara nunca a R2 en producción.
//
// The factory picks the right backend at module load and caches the choice.

import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
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

export interface AssetListItem {
  filename: string;
  contentType: string;
  size: number;
  url: string;
  /** Upload time (ms epoch) — drives newest-first ordering in the panel. */
  uploadedAt: number;
}

export interface AssetStorage {
  put(
    projectId: string,
    contents: Buffer,
    ext: string,
    contentType: string,
  ): Promise<AssetMetadata>;
  get(projectId: string, filename: string): Promise<AssetGetResult | null>;
  /** The project's uploaded IMAGE assets (audio excluded), newest first. */
  list(projectId: string): Promise<AssetListItem[]>;
  /** The project's uploaded AUDIO assets (images excluded), newest first.
   *  Feeds the agent's poner_musica tool — page music may only reference a
   *  track the owner actually uploaded (see isOwnAssetUrl in settings-patch). */
  listAudio(projectId: string): Promise<AssetListItem[]>;
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
  return crypto.createHash("sha256").update(b).digest("hex");
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

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
const AUDIO_EXT = new Set(["mp3", "m4a", "ogg", "wav"]);

function isImageFilename(filename: string): boolean {
  if (!/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes("..")) {
    return false;
  }
  return IMAGE_EXT.has(normalizeExt(filename.split(".").pop() ?? ""));
}

function isAudioFilename(filename: string): boolean {
  if (!/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes("..")) {
    return false;
  }
  return AUDIO_EXT.has(normalizeExt(filename.split(".").pop() ?? ""));
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

  async list(projectId: string): Promise<AssetListItem[]> {
    return this.scan(projectId, isImageFilename);
  }

  async listAudio(projectId: string): Promise<AssetListItem[]> {
    return this.scan(projectId, isAudioFilename);
  }

  private async scan(
    projectId: string,
    matches: (filename: string) => boolean,
  ): Promise<AssetListItem[]> {
    const id = safeProjectId(projectId);
    const projectDir = path.join(this.rootDir, id);
    let names: string[];
    try {
      names = await fs.readdir(projectDir);
    } catch {
      return [];
    }
    const out: AssetListItem[] = [];
    for (const filename of names) {
      if (!matches(filename)) continue;
      try {
        const st = await fs.stat(path.join(projectDir, filename));
        out.push({
          filename,
          contentType: mimeForExt(filename.split(".").pop() ?? ""),
          size: st.size,
          url: `${this.publicBase}/api/projects/${id}/assets/${filename}`,
          uploadedAt: st.mtimeMs,
        });
      } catch {
        /* raced a delete — skip */
      }
    }
    return out.sort((a, b) => b.uploadedAt - a.uploadedAt);
  }
}

// ─── S3 / R2 ────────────────────────────────────────────────────────────────

export class S3AssetStorage implements AssetStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor() {
    // Una sola fuente para los dos juegos de nombres. Antes esto leía `S3_*`
    // por su cuenta, así que aunque el selector dijera «hay nube» el
    // constructor podía no encontrarla — dos lecturas del entorno que podían
    // discrepar.
    const cfg = configDelAlmacen();
    if (!cfg) throw new Error("Almacén en la nube sin configurar (ni S3_* ni R2_*)");
    this.bucket = cfg.bucket;
    this.publicBase = cfg.publicBase.replace(/\/$/, "");
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      // R2/MinIO require path-style addressing; AWS uses virtual-host by
      // default. The presence of a custom endpoint is a reliable signal.
      forcePathStyle: !!cfg.endpoint,
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

  async list(projectId: string): Promise<AssetListItem[]> {
    return this.scan(projectId, isImageFilename);
  }

  async listAudio(projectId: string): Promise<AssetListItem[]> {
    return this.scan(projectId, isAudioFilename);
  }

  private async scan(
    projectId: string,
    matches: (filename: string) => boolean,
  ): Promise<AssetListItem[]> {
    const id = safeProjectId(projectId);
    const prefix = `${id}/`;
    try {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: 500,
        }),
      );
      const out: AssetListItem[] = [];
      for (const obj of res.Contents ?? []) {
        const key = obj.Key ?? "";
        const filename = key.slice(prefix.length);
        if (!filename || !matches(filename)) continue;
        out.push({
          filename,
          contentType: mimeForExt(filename.split(".").pop() ?? ""),
          size: obj.Size ?? 0,
          url: `${this.publicBase}/${key}`,
          uploadedAt: obj.LastModified ? obj.LastModified.getTime() : 0,
        });
      }
      return out.sort((a, b) => b.uploadedAt - a.uploadedAt);
    } catch {
      return [];
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/** LA CONFIGURACIÓN DEL BUCKET, CON LOS DOS NOMBRES QUE ESTE REPO TIENE.
 *
 * 🔴 MEDIDO en producción el 2026-08-30: ninguna subida de usuario había
 * llegado NUNCA a R2. Este módulo leía `S3_*` y el servidor tiene `R2_*` — los
 * mismos que `lib/storage/index.ts` usa desde siempre para elegir R2. Sin una
 * sola `S3_*` puesta, `isS3Configured()` decía «no» y todo caía a disco local;
 * y ahí la URL se resuelve contra `req.url`, que detrás de Caddy es
 * `127.0.0.1:3000`. Resultado: siete páginas publicadas con un
 * `localhost:3000/api/projects/…/assets/…` dentro, o sea la foto del dueño
 * rota para todo el mundo. Nadie lo vio porque falla en silencio: se sube bien,
 * se guarda bien, y sólo no carga.
 *
 * Se leen los dos juegos, `S3_*` primero para no cambiarle nada a quien ya los
 * tuviera puestos. El endpoint de R2 se deriva de la cuenta —es siempre
 * `https://<acct>.r2.cloudflarestorage.com`— así que no hace falta declararlo.
 *
 * Devuelve null cuando no hay nube: entonces manda LocalFs, que es lo correcto
 * en desarrollo. */
function configDelAlmacen(): {
  bucket: string;
  publicBase: string;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
} | null {
  const e = process.env;
  if (e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY && e.S3_PUBLIC_URL_BASE) {
    return {
      bucket: e.S3_BUCKET,
      publicBase: e.S3_PUBLIC_URL_BASE,
      ...(e.S3_ENDPOINT ? { endpoint: e.S3_ENDPOINT } : {}),
      // `||`, no `??`: una variable PUESTA Y VACÍA es lo normal en un fichero
      // de entorno, y con `??` ese "" pasaba como región válida — el SDK muere
      // con «Region is missing» en la primera subida, no al arrancar.
      region: e.S3_REGION || "auto",
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    };
  }
  // Los MISMOS tres que `lib/storage/index.ts` exige para elegir R2, y con sus
  // mismos valores por defecto para bucket y URL pública: un solo bucket de
  // subidas, no dos.
  if (e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY && e.R2_SECRET_KEY) {
    return {
      bucket: e.R2_BUCKET || "openlen-uploads",
      publicBase: e.R2_PUBLIC_URL || "https://uploads.openlen.com",
      endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      region: "auto",
      accessKeyId: e.R2_ACCESS_KEY,
      secretAccessKey: e.R2_SECRET_KEY,
    };
  }
  return null;
}

function isS3Configured(): boolean {
  return configDelAlmacen() !== null;
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
