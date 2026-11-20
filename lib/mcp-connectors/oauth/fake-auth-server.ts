// A FAKE MCP SERVER WITH ITS OWN AUTHORIZATION SERVER, FOR TESTS ONLY (spec local 2026-11-17-oauth-de-conectores-mcp,
// §5.3, §5.4). Only test files import this module: it listens on 127.0.0.1 (a random port) and nothing in it is checked
// the way a real provider must be. One process plays both parts, as many hosted MCP servers do:
//
// - the MCP server at `/mcp` (the official SDK's McpServer), which asks for a Bearer token: 401 with `resource_metadata`
//   (RFC 9728) when there is none or it expired, and — in its «insufficient_scope» mode — 403 naming the scope it wants;
// - its protected resource metadata at `/.well-known/oauth-protected-resource…`, pointing at the current issuer;
// - the authorization server (RFC 8414 metadata at `/.well-known/oauth-authorization-server<issuer path>`): dynamic
//   registration, `/authorize` that redirects back with `code`, `state` and `iss` (RFC 9207), `/token` with PKCE (S256)
//   and `refresh_token`, and `/revoke`.
//
// Its clock is the test's (`now`), so a token can be made to expire without waiting. A connector's URL must be https
// (config.ts), so the fake can speak for a public `origin` (say `https://mcp.fake.test`): every URL it hands out names
// that origin, and its `fetch` — a plain one, no egress guard — carries requests for it to the loopback socket.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

interface FakeClient {
  readonly clientId: string;
  readonly secret?: string;
  readonly redirectUris: readonly string[];
  readonly anyRedirect?: boolean;
}

interface FakeCode {
  readonly clientId: string;
  readonly challenge: string;
  readonly redirectUri: string;
  readonly scope: string | undefined;
  used: boolean;
}

interface FakeAccess {
  readonly scope: string | undefined;
  readonly expiresAt: number | null;
}

export interface FakeAuthServer {
  /** The origin the fake speaks for (its URLs, issuer and resource). */
  readonly base: string;
  /** A plain fetch that reaches the fake under `base`. */
  readonly fetch: typeof fetch;
  readonly mcpUrl: string;
  /** The issuer the metadata names right now. */
  readonly issuer: string;
  /** Move the authorization server to another path: the metadata and the resource's pointer name the new issuer. */
  setIssuer(path: string): void;
  /** Bodies posted to `/register`. */
  readonly registrations: Record<string, unknown>[];
  /** Every token request's form, in order. */
  readonly tokenRequests: URLSearchParams[];
  /** Tokens posted to `/revoke`. */
  readonly revoked: string[];
  /** Every `/revoke` request's whole form (the client it names and its secret), in order. */
  readonly revokeRequests: URLSearchParams[];
  /** A client known in advance (an entry's `oauth.clientId`). */
  addClient(clientId: string, secret?: string): void;
  /** `expires_in` of the next access tokens (undefined: they never expire). */
  expiresIn: number | undefined;
  /** The scope granted, whatever was asked (undefined: what was asked). */
  grantScope: string | undefined;
  /** The token endpoint refuses refresh tokens with `invalid_grant`. */
  rejectRefresh: boolean;
  /** The MCP server asks for this scope with a 403 `insufficient_scope` when the token lacks it. */
  requiredScope: string | null;
  /** Advertise `client_id_metadata_document_supported`. */
  cimd: boolean;
  /** RFC 9207: send `iss` on the way back and advertise `authorization_response_iss_parameter_supported`. Many
   *  authorization servers do neither. */
  sendIss: boolean;
  /** Serve the authorization server's metadata only at this path (an entry's `oauth.authServerMetadataUrl`), and not at
   *  the well-known paths. */
  metadataAt: string | null;
  /** Answer the metadata request with this instead (given the document the fake would serve): broken or hostile
   *  metadata. */
  serveMetadata: ((standard: Record<string, unknown>) => Response) | null;
  /** The `WWW-Authenticate` of the MCP server's 401 (undefined: `Bearer resource_metadata=…`; null: no header at all, as
   *  a server keyed by `X-API-Key` answers). */
  challenge: string | null | undefined;
  /** Serve the well-known metadata documents (false: every `/.well-known/…` is a 404, as on a server with no OAuth). */
  wellKnown: boolean;
  /** A server keyed by `X-API-Key` (spec local 2026-11-17-oauth-de-conectores-mcp, §5.1): with this value in that header
   *  the MCP server answers without a token; with another, or none, it is a 401 with `challenge`. */
  apiKey: string | null;
  /** The path (and query) of every request the fake received, in order. */
  readonly requests: string[];
  /** Plays the person at `/authorize`: follows the URL by hand and reads the redirect back to OpenLen. */
  authorize(url: string): Promise<{ code: string | null; state: string | null; iss: string | null; error: string | null }>;
  close(): Promise<void>;
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const id = () => randomBytes(12).toString("base64url");

async function toRequest(req: IncomingMessage, base: string): Promise<Request> {
  // Behind `base`: the request arrived on the loopback socket, but it was made for the public origin.
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const method = req.method ?? "GET";
  return new Request(`${base}${req.url ?? "/"}`, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks) });
}

async function send(res: ServerResponse, r: Response): Promise<void> {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const oauthError = (error: string, status = 400) => json({ error, error_description: `fake: ${error}` }, status);

export async function startFakeAuthServer(opts: { now: () => Date; origin?: string }): Promise<FakeAuthServer> {
  const clients = new Map<string, FakeClient>();
  const codes = new Map<string, FakeCode>();
  const access = new Map<string, FakeAccess>();
  const refresh = new Map<string, { clientId: string; scope: string | undefined }>();
  let issuerPath = "/as1";
  let base = "";

  const issuer = () => `${base}${issuerPath}`;
  const resourceMetadataUrl = () => `${base}/.well-known/oauth-protected-resource/mcp`;

  function clientOf(req: Request, form: URLSearchParams): FakeClient | null {
    let clientId = form.get("client_id");
    let secret = form.get("client_secret");
    const basic = req.headers.get("authorization");
    if (basic?.startsWith("Basic ")) {
      const [u, p] = Buffer.from(basic.slice(6), "base64").toString().split(":");
      clientId = decodeURIComponent(u ?? "");
      secret = decodeURIComponent(p ?? "");
    }
    const c = clientId ? clients.get(clientId) : undefined;
    if (!c) return null;
    if (c.secret !== undefined && c.secret !== secret) return null;
    return c;
  }

  function issue(clientId: string, scope: string | undefined) {
    const at = `at_${id()}`;
    const rt = `rt_${id()}`;
    const expiresIn = server.expiresIn;
    access.set(at, { scope, expiresAt: expiresIn === undefined ? null : opts.now().getTime() + expiresIn * 1000 });
    refresh.set(rt, { clientId, scope });
    return json({ access_token: at, token_type: "Bearer", refresh_token: rt, ...(expiresIn !== undefined && { expires_in: expiresIn }), ...(scope && { scope }) });
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    server.requests.push(`${path}${url.search}`);

    if (path.startsWith("/.well-known/") && !server.wellKnown) return new Response("not found", { status: 404 });
    if (path.startsWith("/.well-known/oauth-protected-resource")) {
      return json({ resource: `${base}/mcp`, authorization_servers: [issuer()] });
    }
    if (server.metadataAt === null ? path === `/.well-known/oauth-authorization-server${issuerPath}` : path === server.metadataAt) {
      const i = issuer();
      const standard = {
        issuer: i,
        authorization_endpoint: `${i}/authorize`,
        token_endpoint: `${i}/token`,
        registration_endpoint: `${i}/register`,
        revocation_endpoint: `${i}/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
        ...(server.sendIss && { authorization_response_iss_parameter_supported: true }),
        ...(server.cimd && { client_id_metadata_document_supported: true }),
      };
      return server.serveMetadata ? server.serveMetadata(standard) : json(standard);
    }
    if (path.startsWith("/.well-known/")) return new Response("not found", { status: 404 });

    if (path.endsWith("/register") && req.method === "POST") {
      const body = (await req.json()) as Record<string, unknown>;
      server.registrations.push(body);
      const clientId = `dyn_${id()}`;
      clients.set(clientId, { clientId, redirectUris: (body.redirect_uris as string[]) ?? [] });
      return json({ ...body, client_id: clientId }, 201);
    }

    if (path.endsWith("/authorize")) {
      const p = url.searchParams;
      const cimdClient: FakeClient | undefined = server.cimd && p.get("client_id")?.startsWith("https://") ? { clientId: p.get("client_id")!, redirectUris: [], anyRedirect: true } : undefined;
      const client = clients.get(p.get("client_id") ?? "") ?? cimdClient;
      const redirectUri = p.get("redirect_uri") ?? "";
      if (!client || !(client.anyRedirect || client.redirectUris.includes(redirectUri))) return new Response("bad client or redirect_uri", { status: 400 });
      if (p.get("code_challenge_method") !== "S256" || !p.get("code_challenge")) return new Response("PKCE required", { status: 400 });
      const code = `code_${id()}`;
      codes.set(code, { clientId: client.clientId, challenge: p.get("code_challenge")!, redirectUri, scope: p.get("scope") ?? undefined, used: false });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      if (p.get("state")) back.searchParams.set("state", p.get("state")!);
      if (server.sendIss) back.searchParams.set("iss", issuer());
      return new Response(null, { status: 302, headers: { location: back.toString() } });
    }

    if (path.endsWith("/token") && req.method === "POST") {
      const form = new URLSearchParams(await req.text());
      server.tokenRequests.push(form);
      const client = clientOf(req, form);
      if (!client && !(server.cimd && form.get("client_id")?.startsWith("https://"))) return oauthError("invalid_client", 401);
      const clientId = client?.clientId ?? form.get("client_id")!;
      if (form.get("grant_type") === "authorization_code") {
        const c = codes.get(form.get("code") ?? "");
        if (!c || c.used || c.clientId !== clientId) return oauthError("invalid_grant");
        c.used = true;
        if (s256(form.get("code_verifier") ?? "") !== c.challenge) return oauthError("invalid_grant");
        if (form.get("redirect_uri") !== c.redirectUri) return oauthError("invalid_grant");
        return issue(clientId, server.grantScope ?? c.scope);
      }
      if (form.get("grant_type") === "refresh_token") {
        const r = refresh.get(form.get("refresh_token") ?? "");
        if (server.rejectRefresh || !r || r.clientId !== clientId) return oauthError("invalid_grant");
        return issue(clientId, r.scope);
      }
      return oauthError("unsupported_grant_type");
    }

    if (path.endsWith("/revoke") && req.method === "POST") {
      const form = new URLSearchParams(await req.text());
      server.revoked.push(form.get("token") ?? "");
      server.revokeRequests.push(form);
      access.delete(form.get("token") ?? "");
      refresh.delete(form.get("token") ?? "");
      return new Response(null, { status: 200 });
    }

    if (path === "/mcp") {
      const unauthorized = () => {
        const challenge = server.challenge === undefined ? `Bearer resource_metadata="${resourceMetadataUrl()}"` : server.challenge;
        return new Response("unauthorized", { status: 401, headers: challenge === null ? {} : { "www-authenticate": challenge } });
      };
      const keyed = server.apiKey !== null;
      if (keyed && req.headers.get("x-api-key") !== server.apiKey) return unauthorized();
      const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      const a = keyed ? { scope: undefined, expiresAt: null } : access.get(bearer);
      if (!a || (a.expiresAt !== null && a.expiresAt <= opts.now().getTime())) return unauthorized();
      const required = server.requiredScope;
      if (required && !(a.scope ?? "").split(" ").includes(required)) {
        return new Response("forbidden", {
          status: 403,
          headers: { "www-authenticate": `Bearer error="insufficient_scope", scope="${required}", resource_metadata="${resourceMetadataUrl()}"` },
        });
      }
      const mcp = new McpServer({ name: "fake-oauth", version: "1.0.0" });
      mcp.registerTool("ping", { description: "Ping", inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: "pong" }] }));
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      return transport.handleRequest(req);
    }

    return new Response("not found", { status: 404 });
  }

  const http = createServer((req, res) => {
    toRequest(req, base)
      .then(handle)
      .then((r) => send(res, r))
      .catch((err: unknown) => {
        res.writeHead(500);
        res.end(String(err));
      });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const loopback = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  base = opts.origin ?? loopback;
  const toLoopback = (u: string) => (u.startsWith(base) ? loopback + u.slice(base.length) : u);
  const routed = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (input instanceof Request) return fetch(new Request(toLoopback(input.url), input), init);
    return fetch(toLoopback(String(input)), init);
  }) as typeof fetch;

  const server: FakeAuthServer = {
    base,
    fetch: routed,
    mcpUrl: `${base}/mcp`,
    get issuer() {
      return issuer();
    },
    setIssuer(path: string) {
      issuerPath = path;
    },
    registrations: [],
    tokenRequests: [],
    revoked: [],
    revokeRequests: [],
    addClient(clientId: string, secret?: string) {
      // An entry's client is registered with the provider by hand, return address included: any is accepted.
      clients.set(clientId, { clientId, secret, redirectUris: [], anyRedirect: true });
    },
    expiresIn: 3600,
    grantScope: undefined,
    rejectRefresh: false,
    requiredScope: null,
    cimd: false,
    sendIss: true,
    metadataAt: null,
    serveMetadata: null,
    challenge: undefined,
    wellKnown: true,
    apiKey: null,
    requests: [],
    async authorize(authorizationUrl: string) {
      const r = await routed(authorizationUrl, { redirect: "manual" });
      const location = r.headers.get("location");
      if (!location) return { code: null, state: null, iss: null, error: `no redirect (${r.status})` };
      const p = new URL(location).searchParams;
      return { code: p.get("code"), state: p.get("state"), iss: p.get("iss"), error: p.get("error") };
    },
    async close() {
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
  return server;
}
