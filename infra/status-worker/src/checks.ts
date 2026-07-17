import type { CheckResult, Target } from "./logic";

const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 5_000;

interface CheckDef {
  target: Target;
  url: (canaryHost: string) => string;
  validate?: (body: string) => boolean;
}

const DEFS: CheckDef[] = [
  { target: "app", url: () => "https://openlen.com/en" },
  // El ?sc= cambia la cache key del CDN: sin él, Cloudflare serviría copia
  // cacheada (s-maxage 3600 + SWR 86400) y el check mentiría con el box muerto.
  { target: "pages", url: (host) => `https://${host}/?sc=${Date.now()}` },
  {
    target: "api",
    url: () => "https://openlen.com/api/templates",
    validate: (body) => {
      try {
        JSON.parse(body);
        return true;
      } catch {
        return false;
      }
    },
  },
];

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attempt(def: CheckDef, canaryHost: string, fetcher: typeof fetch): Promise<CheckResult> {
  const started = Date.now();
  try {
    const res = await fetcher(def.url(canaryHost), {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "openlen-status/1" },
    });
    const latencyMs = Date.now() - started;
    let ok = res.status === 200;
    if (ok && def.validate) ok = def.validate(await res.text());
    return { target: def.target, ok, status: res.status, latencyMs };
  } catch {
    return { target: def.target, ok: false, status: null, latencyMs: Date.now() - started };
  }
}

async function runCheck(def: CheckDef, canaryHost: string, fetcher: typeof fetch, sleep: Sleep): Promise<CheckResult> {
  const first = await attempt(def, canaryHost, fetcher);
  if (first.ok) return first;
  await sleep(RETRY_DELAY_MS);
  return attempt(def, canaryHost, fetcher);
}

export async function runAllChecks(
  canaryHost: string,
  fetcher: typeof fetch = fetch,
  sleep: Sleep = realSleep,
): Promise<CheckResult[]> {
  return Promise.all(DEFS.map((d) => runCheck(d, canaryHost, fetcher, sleep)));
}
