// Cloudflare cache-purge for published landing pages.
//
// When `<sub>.openlen.com` is proxied by Cloudflare (orange cloud), the
// edge caches the rendered HTML up to `s-maxage`. After a publish we
// must purge it so the next visitor sees fresh content instead of the
// previous deploy.
//
// Soft-failing: if CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN are unset
// (local dev, non-CF self-hoster), the call is a no-op + a one-time
// warn. Publish has already succeeded on disk; a stale edge cache will
// flush on its own within the `s-maxage` window.
//
// Token scope required: `Zone:Zone:Read` + `Zone:Cache Purge:Edit`
// restricted to the openlen.com zone.

const PURGE_TIMEOUT_MS = 5000;
let warnedMissingEnv = false;

function baseHost(): string {
  return process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
}

function getEnv(): { zoneId: string; token: string } | null {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!zoneId || !token) {
    if (!warnedMissingEnv) {
      warnedMissingEnv = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[cache-purge] CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN not set — cache purge disabled. Set both to enable.",
      );
    }
    return null;
  }
  return { zoneId, token };
}

/**
 * Purge the Cloudflare cache for a published subdomain.
 *
 * Purges both `https://<sub>.<host>/` and `/index.html` since CF treats
 * them as distinct cache keys.
 */
export async function purgeSubdomain(subdomain: string): Promise<void> {
  const env = getEnv();
  if (!env) return;

  const host = baseHost();
  const urls = [
    `https://${subdomain}.${host}/`,
    `https://${subdomain}.${host}/index.html`,
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PURGE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.zoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.token}`,
        },
        body: JSON.stringify({ files: urls }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.warn(
        `[cache-purge] CF API returned ${res.status} for ${subdomain}: ${body.slice(0, 200)}`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[cache-purge] purge failed for ${subdomain}:`, err);
  } finally {
    clearTimeout(timer);
  }
}
