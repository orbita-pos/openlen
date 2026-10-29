// How OpenLen's server talks HTTP to a git remote (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8). The
// address is the person's, so the request goes through the same guard as the server's Chromium (`decideEgress`): no
// private, loopback or internal address, and the connection is pinned to the IP the guard resolved — no second DNS
// answer to poison. No redirects are followed, the answer has a size cap, and every request a deadline.
import "server-only";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

import { MAX_PROJECT_BYTES } from "@/lib/files/limits";
import { decideEgress } from "@/lib/security/egress-proxy";

export type RemoteErrorKind = "blocked" | "auth" | "not-found" | "http" | "network" | "protocol" | "too-large";

/** Why talking to a remote failed; the git commands turn it into git's own message. */
export class RemoteError extends Error {
  constructor(
    readonly kind: RemoteErrorKind,
    readonly url: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** A remote's URL with any credentials taken out: what is shown, stored and logged. */
export function publicUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return raw;
  }
}

const TIMEOUT_MS = 120_000;

export interface HttpAnswer {
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
}

/** One request to the remote. `auth` is "user:password" for Basic (a GitHub App token: "x-access-token:<token>"). */
export async function remoteRequest(url: string, o: { readonly method: "GET" | "POST"; readonly auth: string | null; readonly headers?: Readonly<Record<string, string>>; readonly body?: Uint8Array }): Promise<HttpAnswer> {
  const shown = publicUrl(url);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new RemoteError("blocked", shown, `'${shown}' is not a URL`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new RemoteError("blocked", shown, `the ${u.protocol} protocol isn't allowed for a remote`);
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  const decision = await decideEgress(u.hostname, port);
  if (!decision.ok) throw new RemoteError("blocked", shown, `${u.hostname} is a private or internal address`);
  const lookup: LookupFunction = (_host, options, callback) => {
    if (options.all) (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: decision.address, family: 4 }]);
    else callback(null, decision.address, 4);
  };
  const headers: Record<string, string> = { "User-Agent": "git/2.45.2 (OpenLen)", ...o.headers };
  if (o.auth) headers.Authorization = `Basic ${Buffer.from(o.auth, "utf8").toString("base64")}`;
  if (o.body) headers["Content-Length"] = String(o.body.byteLength);
  const lib = u.protocol === "https:" ? https : http;
  return new Promise<HttpAnswer>((resolve, reject) => {
    const req = lib.request(
      { method: o.method, hostname: u.hostname, port, path: `${u.pathname}${u.search}`, headers, lookup, servername: u.hostname, timeout: TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.byteLength;
          if (size > MAX_PROJECT_BYTES) {
            req.destroy(new RemoteError("too-large", shown, "the remote's answer is larger than a project can be"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, contentType: String(res.headers["content-type"] ?? ""), body: new Uint8Array(Buffer.concat(chunks)) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new RemoteError("network", shown, "the remote took too long to answer")));
    req.on("error", (e) => reject(e instanceof RemoteError ? e : new RemoteError("network", shown, e.message)));
    req.end(o.body ? Buffer.from(o.body) : undefined);
  });
}

/** A non-200 answer as a RemoteError, the way git words it. */
export function failedAnswer(url: string, a: HttpAnswer): RemoteError {
  const shown = publicUrl(url);
  if (a.status === 401 || a.status === 403) return new RemoteError("auth", shown, `Authentication failed for '${shown}'`, a.status);
  if (a.status === 404) return new RemoteError("not-found", shown, `repository '${shown}' not found`, a.status);
  if (a.status >= 300 && a.status < 400) return new RemoteError("http", shown, `the remote at '${shown}' redirects; use the address it redirects to`, a.status);
  return new RemoteError("http", shown, `unable to access '${shown}': The requested URL returned error: ${a.status}`, a.status);
}
