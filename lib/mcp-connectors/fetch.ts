// THE FETCH OF LEN'S MCP CONNECTORS (spec local 2026-11-06-conectores-mcp, §5.4). A connector's URL comes from a person
// or from Len, so it is untrusted: https only, a redirect is an error (never followed), the host is resolved ONCE and
// only a public IPv4 passes (`decidePublicEgress` — never the allowlist of local origins another part of the process
// may have opened), the connection goes to that IP (no second lookup to rebind), and the answer is read through a byte
// cap. It returns a streaming Response: MCP's Streamable HTTP answers with SSE.
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { decidePublicEgress } from "@/lib/security/egress-proxy";

export type McpEgressCode = "blocked" | "redirect" | "too_large" | "scheme";

export class McpEgressError extends Error {
  constructor(
    readonly code: McpEgressCode,
    message: string,
  ) {
    super(message);
    this.name = "McpEgressError";
  }
}

export interface PinnedRequest {
  readonly url: URL;
  /** The IPv4 the host resolved to: the only place this request may connect. */
  readonly address: string;
  readonly init: RequestInit & { redirect: "manual" };
}

type Lookup = (host: string) => Promise<readonly { address: string; family: number }[]>;

/** The real network: node's https to the pinned address, the host name kept for SNI and Host. */
async function sendPinned(r: PinnedRequest): Promise<Response> {
  const lookup: LookupFunction = (_host, options, callback) => {
    if (options.all) (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: r.address, family: 4 }]);
    else callback(null, r.address, 4);
  };
  const headers = Object.fromEntries(new Headers(r.init.headers).entries());
  const body = r.init.body == null ? undefined : Buffer.from(await new Response(r.init.body).arrayBuffer());
  if (body) headers["content-length"] = String(body.byteLength);
  return new Promise<Response>((resolve, reject) => {
    const req = https.request(
      {
        method: r.init.method ?? "GET",
        hostname: r.url.hostname,
        port: r.url.port ? Number(r.url.port) : 443,
        path: `${r.url.pathname}${r.url.search}`,
        headers,
        lookup,
        servername: r.url.hostname,
        signal: r.init.signal ?? undefined,
      },
      (res: http.IncomingMessage) => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(", ") : v);
        const status = res.statusCode ?? 0;
        const stream = status === 204 || status === 304 ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
        resolve(new Response(stream, { status, statusText: res.statusMessage ?? "", headers: out }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function capped(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let size = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maxBytes) controller.error(new McpEgressError("too_large", `the server's answer is over ${maxBytes} bytes`));
        else controller.enqueue(chunk);
      },
    }),
  );
}

export function createGuardedFetch(opts: { maxBytes: number; lookup?: Lookup; send?: (r: PinnedRequest) => Promise<Response> }): typeof fetch {
  const send = opts.send ?? sendPinned;
  const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : input instanceof URL ? input.href : String(input));
    if (url.protocol !== "https:") throw new McpEgressError("scheme", `only https:// servers are allowed, not ${url.protocol}`);
    const port = url.port ? Number(url.port) : 443;
    const decision = await decidePublicEgress(url.hostname, port, opts.lookup);
    if (!decision.ok) throw new McpEgressError("blocked", `${url.hostname} is a private or internal address`);
    const merged: RequestInit = req
      ? { method: req.method, headers: req.headers, body: req.body ? await req.arrayBuffer() : undefined, signal: req.signal, ...init }
      : { ...init };
    const res = await send({ url, address: decision.address, init: { ...merged, redirect: "manual" } });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      throw new McpEgressError("redirect", `${url.hostname} answered with a redirect (${res.status}); use the address it redirects to`);
    }
    if (!res.body) return res;
    return new Response(capped(res.body, opts.maxBytes), { status: res.status, statusText: res.statusText, headers: res.headers });
  };
  return guarded as typeof fetch;
}
