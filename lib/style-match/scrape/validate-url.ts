import dns from "node:dns/promises";
import type { ScrapeError } from "../types";

const PRIVATE_IPV4_RANGES: Array<[number, number, number, number, number]> = [
  [10, 0, 0, 0, 8],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 168, 0, 0, 16],
  [0, 0, 0, 0, 8],
];

function ipv4ToInt(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function ipInPrivateRange(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const ipInt = ipv4ToInt(parts);
  for (const [a, b, c, d, prefix] of PRIVATE_IPV4_RANGES) {
    const baseInt = ipv4ToInt([a, b, c, d]);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    if ((ipInt & mask) === (baseInt & mask)) return true;
  }
  return false;
}

export interface ValidatedUrl {
  url: URL;
  hostname: string;
  resolvedIp: string;
}

export async function validateUrl(
  raw: string,
): Promise<{ ok: true; value: ValidatedUrl } | { ok: false; error: ScrapeError }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: { kind: "invalid-url", reason: "Not a valid URL" } };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: { kind: "invalid-url", reason: `Protocol ${parsed.protocol} not allowed` },
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".")
  ) {
    return {
      ok: false,
      error: { kind: "ssrf-blocked", reason: `Hostname '${hostname}' is not allowed` },
    };
  }

  let resolved: { address: string; family: number };
  try {
    resolved = await dns.lookup(hostname, { family: 4 });
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "network",
        message: `DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  if (ipInPrivateRange(resolved.address)) {
    return {
      ok: false,
      error: {
        kind: "ssrf-blocked",
        reason: `Hostname resolves to private IP ${resolved.address}`,
      },
    };
  }

  return {
    ok: true,
    value: { url: parsed, hostname, resolvedIp: resolved.address },
  };
}
