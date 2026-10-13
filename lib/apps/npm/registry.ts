// The npm registry's full package document (it carries `time`, which the
// abbreviated one doesn't), with an ETag cache. Some are huge (@types/node
// measured 11.2 MB on 2026-10-13): over 20 MB is refused.
import { npmRegistry } from "./paths";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface PackumentVersion {
  readonly version: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

export interface Packument {
  readonly name: string;
  readonly "dist-tags": Readonly<Record<string, string>>;
  readonly versions: Readonly<Record<string, PackumentVersion>>;
  readonly time: Readonly<Record<string, string>>;
}

export class RegistryUnavailableError extends Error {}

const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const cache = new Map<string, { etag: string | null; doc: Packument }>();

export function clearPackumentCache(): void {
  cache.clear();
}

/** The package document, or null if npm doesn't know the package. */
export async function getPackument(name: string, fetchImpl: FetchLike = fetch): Promise<Packument | null> {
  const cached = cache.get(name);
  let res: Response;
  try {
    res = await fetchImpl(`${npmRegistry()}/${name.replace("/", "%2f")}`, {
      headers: { accept: "application/json", ...(cached?.etag ? { "if-none-match": cached.etag } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new RegistryUnavailableError(e instanceof Error ? e.message : String(e));
  }
  if (res.status === 304 && cached) return cached.doc;
  if (res.status === 404) return null;
  if (!res.ok) throw new RegistryUnavailableError(`the registry answered ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new RegistryUnavailableError(`${name}: the registry document is over 20 MB`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new RegistryUnavailableError(`${name}: the registry document is over 20 MB`);
  const doc = JSON.parse(text) as Packument;
  cache.set(name, { etag: res.headers.get("etag"), doc });
  return doc;
}
