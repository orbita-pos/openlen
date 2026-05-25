import type { StorageAdapter, UploadArgs, UploadResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// R2Storage — Cloudflare R2 adapter using the AWS S3 SDK (R2 is S3-compatible).
//
// Heavy: @aws-sdk/client-s3 is ~3MB compressed. To keep the default bundle lean
// for the filesystem path, the SDK is loaded lazily via dynamic `import()`.
// The factory in `./index.ts` only instantiates this class when R2_* env vars
// are set, so the SDK is never resolved for local dev or self-hosted Hetzner
// installs that ride on the filesystem adapter.
//
// To enable: `npm install @aws-sdk/client-s3` and set R2_ACCOUNT_ID,
// R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL.
// ─────────────────────────────────────────────────────────────────────────────

export interface R2StorageOptions {
  accountId: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  publicUrlBase: string;
}

interface S3LikeClient {
  send(cmd: unknown): Promise<unknown>;
}

interface AwsSdkModule {
  S3Client: new (config: unknown) => S3LikeClient;
  PutObjectCommand: new (params: unknown) => unknown;
  DeleteObjectCommand: new (params: unknown) => unknown;
}

export class R2Storage implements StorageAdapter {
  private clientPromise: Promise<{ client: S3LikeClient; sdk: AwsSdkModule }> | null = null;

  constructor(private opts: R2StorageOptions) {}

  private getClient(): Promise<{ client: S3LikeClient; sdk: AwsSdkModule }> {
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = (async () => {
      let sdk: AwsSdkModule;
      try {
        // Variable-form specifier prevents bundlers from trying to resolve
        // the module at build time. Only the first call pays the import cost.
        const specifier = "@aws-sdk/client-s3";
        sdk = (await import(/* @vite-ignore */ specifier)) as AwsSdkModule;
      } catch {
        throw new Error(
          "R2Storage requires @aws-sdk/client-s3. Run `npm install @aws-sdk/client-s3`, or unset R2_* env vars to fall back to filesystem.",
        );
      }
      const client = new sdk.S3Client({
        region: "auto",
        endpoint: `https://${this.opts.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.opts.accessKey,
          secretAccessKey: this.opts.secretKey,
        },
      });
      return { client, sdk };
    })();
    return this.clientPromise;
  }

  async upload({ key, contentType, body }: UploadArgs): Promise<UploadResult> {
    const { client, sdk } = await this.getClient();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        ContentType: contentType,
        Body: body,
        // Both buckets we use (templates + uploads) store content-addressed
        // files — the filename includes a sha256 prefix, so the bytes at
        // any given URL never change. 1 year + immutable lets the CDN edge
        // cache aggressively and lets the browser skip revalidation
        // entirely. Re-uploads create a new URL via a new hash, no purge
        // needed.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    const publicBase = this.opts.publicUrlBase.replace(/\/+$/, "");
    return {
      url: `${publicBase}/${key}`,
      size: body.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    const { client, sdk } = await this.getClient();
    await client.send(
      new sdk.DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }),
    );
  }
}
