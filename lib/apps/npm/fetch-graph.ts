// A package's module graph from esm.sh: the entry (a tiny re-export) and every
// module it reaches by absolute path, each with the sha256 of its text. Bare
// imports left in the code (react, and the app's own esm.sh packages marked
// external) are reported for the caller to resolve.
import { scanModule } from "./module-scan";
import type { FetchLike } from "./registry";
import { sha256Hex } from "./store";

export interface FetchedModule {
  readonly url: string;
  readonly sha: string;
  readonly code: string;
}

export interface ModuleGraph {
  readonly entry: string;
  readonly modules: readonly FetchedModule[];
  readonly bare: readonly string[];
}

export type GraphError = { readonly code: "not-found" | "build-failed" | "unavailable" | "too-large"; readonly message: string };

export interface GraphOptions {
  readonly fetch: FetchLike;
  readonly maxBytes: number;
  /** Epoch ms after which nothing more is fetched. */
  readonly deadline: number;
  readonly concurrency?: number;
}

const REQUEST_TIMEOUT_MS = 30_000;

export async function fetchText(url: string, opts: Pick<GraphOptions, "fetch" | "deadline">): Promise<{ ok: true; text: string } | { ok: false; error: GraphError }> {
  let last: GraphError = { code: "unavailable", message: "esm.sh did not answer" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = opts.deadline - Date.now();
    if (left <= 0) return { ok: false, error: { code: "unavailable", message: "esm.sh took too long" } };
    try {
      const res = await opts.fetch(url, { signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, left)) });
      const text = await res.text();
      if (res.ok) return { ok: true, text };
      const message = text.trim().slice(0, 300) || `esm.sh answered ${res.status}`;
      if (res.status === 404) return { ok: false, error: { code: "not-found", message } };
      if (res.status < 500) return { ok: false, error: { code: "build-failed", message } };
      // A 5xx is esm.sh failing, not the package (measured 2026-10-12: «no
      // space left on device» on every new build): unavailable, like silence.
      last = { code: "unavailable", message: `esm.sh answered ${res.status}${text.trim() ? `: ${text.trim().slice(0, 300)}` : ""}` };
    } catch {
      last = { code: "unavailable", message: "esm.sh did not answer" };
    }
  }
  return { ok: false, error: last };
}

export async function fetchGraph(entry: string, opts: GraphOptions): Promise<{ ok: true; graph: ModuleGraph } | { ok: false; error: GraphError }> {
  // esm.sh writes its modules as "/three@…": they belong to the entry's origin.
  const origin = new URL(entry).origin;
  const modules = new Map<string, FetchedModule>();
  const bare = new Set<string>();
  const queue = [entry];
  const queued = new Set([entry]);
  let bytes = 0;
  let failure: GraphError | null = null;

  const work = async () => {
    while (queue.length > 0 && !failure) {
      const url = queue.shift()!;
      const got = await fetchText(url, opts);
      if (!got.ok) {
        failure ??= got.error;
        return;
      }
      bytes += got.text.length;
      if (bytes > opts.maxBytes) {
        failure ??= { code: "too-large", message: `its modules are over ${Math.round(opts.maxBytes / 1e6)} MB` };
        return;
      }
      modules.set(url, { url, sha: sha256Hex(got.text), code: got.text });
      const scan = await scanModule(got.text);
      for (const s of scan.bare) bare.add(s);
      for (const spec of [...scan.absolute, ...scan.relative]) {
        const next = new URL(spec, url).href;
        if (new URL(next).origin !== origin) {
          failure ??= { code: "build-failed", message: `a module imports from another origin (${next})` };
          return;
        }
        if (!queued.has(next)) {
          queued.add(next);
          queue.push(next);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 8 }, work));
  if (failure) return { ok: false, error: failure };
  return { ok: true, graph: { entry, modules: [...modules.values()], bare: [...bare].sort() } };
}
