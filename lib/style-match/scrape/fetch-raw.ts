import {
  FETCH_TIMEOUT_MS,
  MAX_BODY_BYTES,
  USER_AGENT,
  type ScrapeError,
  type ScrapeResult,
  type ScrapeTarget,
} from "../types";
import { validateUrl } from "./validate-url";

const CHALLENGE_MARKERS = [
  /just a moment\.{3}/i,
  /cf-challenge-platform/i,
  /<title>\s*attention required/i,
  /__cf_chl_/i,
  /challenge-platform\/scripts\/jsd\//i,
  /enable javascript and cookies to continue/i,
];

function detectChallenge(html: string): string | null {
  if (html.length < 2_000) {
    for (const re of CHALLENGE_MARKERS) {
      if (re.test(html)) return re.source;
    }
  } else {
    const head = html.slice(0, 8_000);
    for (const re of CHALLENGE_MARKERS) {
      if (re.test(head)) return re.source;
    }
  }
  return null;
}

export async function fetchRaw(
  target: ScrapeTarget,
): Promise<{ ok: true; value: ScrapeResult } | { ok: false; error: ScrapeError }> {
  const validation = await validateUrl(target.url);
  if (!validation.ok) return validation;

  const { url, hostname } = validation.value;
  const t0 = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as { name?: string }).name === "AbortError") {
      return {
        ok: false,
        error: { kind: "timeout", afterMs: Date.now() - t0 },
      };
    }
    return {
      ok: false,
      error: {
        kind: "network",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 403 || response.status === 503 || response.status === 429) {
    return {
      ok: false,
      error: { kind: "blocked", status: response.status },
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: { kind: "network", message: `HTTP ${response.status} ${response.statusText}` },
    };
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    return {
      ok: false,
      error: { kind: "non-html", contentType },
    };
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      error: { kind: "too-large", sizeBytes: contentLength },
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      ok: false,
      error: { kind: "network", message: "Response has no body" },
    };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return {
          ok: false,
          error: { kind: "too-large", sizeBytes: totalBytes },
        };
      }
      chunks.push(value);
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "network",
        message: `Body read failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const html = new TextDecoder("utf-8", { fatal: false }).decode(merged);

  const challenge = detectChallenge(html);
  if (challenge) {
    return {
      ok: false,
      error: { kind: "challenge", reason: challenge },
    };
  }

  return {
    ok: true,
    value: {
      url: target.url,
      hostname,
      finalUrl: response.url || url.toString(),
      html,
      rendered: false,
      fetchedAt: new Date(),
      tier: 1,
      durationMs: Date.now() - t0,
      sizeBytes: totalBytes,
    },
  };
}
