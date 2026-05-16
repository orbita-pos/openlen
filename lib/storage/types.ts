// ─────────────────────────────────────────────────────────────────────────────
// Storage adapter contract.
//
// The /api/upload endpoint writes through this interface. Filesystem is the
// default for local dev; R2 (Cloudflare) is the production target. Adding a
// new adapter (S3, B2, GCS) means implementing this interface plus one entry
// in the factory in `index.ts`.
//
// Why not the Next.js built-in: `next/server` has no first-class file primitive.
// Vercel Blob is a SaaS lock-in. Direct filesystem is fine for self-hosted
// (Hetzner / Docker volume) but breaks on serverless. The abstraction keeps
// both story lines open.
// ─────────────────────────────────────────────────────────────────────────────

export interface UploadArgs {
  /** Path-like key under which to store the file (e.g. "uploads/abc/img.jpg").
   *  Adapters MAY rewrite this (e.g. to insert a CDN prefix) but the caller
   *  treats the returned URL as authoritative. */
  key: string;
  contentType: string;
  body: Buffer;
}

export interface UploadResult {
  /** Public URL the browser can fetch. Filesystem returns a relative
   *  `/uploads/...` path that Next.js serves statically; R2 returns an
   *  absolute https://… on the configured public origin. */
  url: string;
  size: number;
}

export interface StorageAdapter {
  upload(args: UploadArgs): Promise<UploadResult>;
  delete(key: string): Promise<void>;
}
