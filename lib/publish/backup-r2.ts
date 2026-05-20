// Per-publish backup of release HTML to Cloudflare R2.
//
// Soft-failing: if R2_ACCOUNT_ID / R2_ACCESS_KEY / R2_SECRET_KEY /
// R2_PUBLISHED_BUCKET are not all set, the call is a no-op (one-time warn).
// Publish has already succeeded on disk; the nightly rclone sync
// (infra/scripts/backup-published-to-r2.sh) is the durability backstop —
// the per-publish path is a fresher copy for low-RPO restore.
//
// Object key: `<sub>/releases/<sha>/index.html`. Bucket separate from the
// uploads bucket (R2_BUCKET) so lifecycle/retention policies can differ.

interface S3LikeClient {
  send(cmd: unknown): Promise<unknown>;
}

interface AwsSdkModule {
  S3Client: new (config: unknown) => S3LikeClient;
  PutObjectCommand: new (params: unknown) => unknown;
}

let clientPromise: Promise<{
  client: S3LikeClient;
  sdk: AwsSdkModule;
  bucket: string;
} | null> | null = null;
let warnedMissing = false;

function loadClient(): Promise<{
  client: S3LikeClient;
  sdk: AwsSdkModule;
  bucket: string;
} | null> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const accessKey = process.env.R2_ACCESS_KEY?.trim();
    const secretKey = process.env.R2_SECRET_KEY?.trim();
    const bucket = process.env.R2_PUBLISHED_BUCKET?.trim();
    if (!accountId || !accessKey || !secretKey || !bucket) {
      if (!warnedMissing) {
        warnedMissing = true;
        // eslint-disable-next-line no-console
        console.warn(
          "[backup-r2] R2_ACCOUNT_ID / R2_ACCESS_KEY / R2_SECRET_KEY / R2_PUBLISHED_BUCKET not all set — per-publish backup disabled.",
        );
      }
      return null;
    }
    let sdk: AwsSdkModule;
    try {
      const specifier = "@aws-sdk/client-s3";
      sdk = (await import(/* @vite-ignore */ specifier)) as AwsSdkModule;
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        "[backup-r2] @aws-sdk/client-s3 not installed — per-publish backup disabled.",
      );
      return null;
    }
    const client = new sdk.S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    });
    return { client, sdk, bucket };
  })();
  return clientPromise;
}

/**
 * Upload a release's HTML to R2. Soft-fails on any error — the on-disk
 * write has already succeeded, this is just a redundancy layer.
 */
export async function backupReleaseToR2(
  subdomain: string,
  sha: string,
  html: string,
): Promise<void> {
  const ctx = await loadClient().catch(() => null);
  if (!ctx) return;

  const key = `${subdomain}/releases/${sha}/index.html`;
  try {
    await ctx.client.send(
      new ctx.sdk.PutObjectCommand({
        Bucket: ctx.bucket,
        Key: key,
        ContentType: "text/html; charset=utf-8",
        Body: html,
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[backup-r2] failed to upload ${key}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
