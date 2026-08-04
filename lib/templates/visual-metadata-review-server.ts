import { Buffer } from "node:buffer";
import { randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ReviewCommand } from "./visual-metadata-review-session";
import type { VisualMetadataReviewWorkspace } from "./visual-metadata-review-session-store";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_JSON_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 20_000;
const COOKIE_NAME = "openlen_review_session";
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

export interface ReviewClientAssets {
  javascript: string;
  css: string;
}

export interface RunningReviewServer {
  bootstrapUrl: string;
  origin: string;
  close(): Promise<void>;
}

export interface VisualMetadataReviewServerOptions {
  workspace?: VisualMetadataReviewWorkspace;
  workspaceFactory?: (reviewer: { name: string; email: string }) => Promise<VisualMetadataReviewWorkspace>;
  assets: ReviewClientAssets;
  fetchImpl?: typeof fetch;
  randomBytes?: (size: number) => Buffer;
}

class SafeHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "SafeHttpError";
    this.stack = `${this.name}: ${code}`;
  }
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("Content-Security-Policy", CSP);
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
}

function send(response: ServerResponse, status: number, body: string, contentType: string): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function sendError(response: ServerResponse, error: SafeHttpError): void {
  sendJson(response, error.status, { error: error.code });
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const mediaType = request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") throw new SafeHttpError(415, "json_required");
  const declared = request.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_JSON_BYTES)) {
    throw new SafeHttpError(413, "body_too_large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_JSON_BYTES) throw new SafeHttpError(413, "body_too_large");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SafeHttpError(400, "invalid_json");
  }
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function sessionCookie(request: IncomingMessage): string | undefined {
  const values = request.headers.cookie?.split(";").map((part) => part.trim()) ?? [];
  const matches = values.filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return undefined;
  return matches[0].slice(COOKIE_NAME.length + 1);
}

function exactHostHeader(request: IncomingMessage, authority: string): boolean {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === "host") values.push(request.rawHeaders[index + 1]);
  }
  return values.length === 1 && values[0] === authority;
}

function trustedRequestUrl(target: string, origin: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(target, origin);
  } catch {
    throw new SafeHttpError(400, "request_target_rejected");
  }
  if ((!target.startsWith("/") && !/^https?:\/\//i.test(target))
    || parsed.origin !== origin || parsed.username !== "" || parsed.password !== "") {
    throw new SafeHttpError(400, "request_target_rejected");
  }
  return parsed;
}

function decodeItemId(encoded: string): string {
  try {
    let decoded: string;
    if (encoded.startsWith("~")) {
      const payload = encoded.slice(1);
      if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("invalid");
      decoded = Buffer.from(payload, "base64url").toString("utf8");
      if (encodeItemId(decoded) !== encoded) throw new Error("invalid");
    } else {
      decoded = decodeURIComponent(encoded);
    }
    if (!decoded || decoded.includes("\0")) throw new Error("invalid");
    return decoded;
  } catch {
    throw new SafeHttpError(400, "invalid_item_id");
  }
}

function encodeItemId(id: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(id)) return id;
  return `~${Buffer.from(id, "utf8").toString("base64url")}`;
}

function validScreenshotSource(value: string | null): value is string {
  if (value === null) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "templates.openlen.com"
      && url.port === ""
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}

async function readImage(response: Response): Promise<Buffer> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!response.ok || !contentType?.startsWith("image/")) throw new SafeHttpError(502, "screenshot_unavailable");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_IMAGE_BYTES)) {
    throw new SafeHttpError(502, "screenshot_unavailable");
  }
  if (!response.body) throw new SafeHttpError(502, "screenshot_unavailable");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new SafeHttpError(502, "screenshot_unavailable");
    }
    chunks.push(Buffer.from(part.value));
  }
  if (size === 0) throw new SafeHttpError(502, "screenshot_unavailable");
  return Buffer.concat(chunks);
}

function safeWorkspace(workspace: VisualMetadataReviewWorkspace | undefined): VisualMetadataReviewWorkspace {
  if (!workspace) throw new SafeHttpError(409, "identity_required");
  return workspace;
}

function safeDto(workspace: VisualMetadataReviewWorkspace) {
  const dto = workspace.getSafeReviewDto();
  for (const item of dto.items) {
    if (item.screenshotEndpoint !== null) {
      const encodedId = encodeItemId(item.id);
      item.screenshotEndpoint = `/api/items/${encodedId}/screenshot`;
    }
  }
  return dto;
}

export async function startVisualMetadataReviewServer(
  options: VisualMetadataReviewServerOptions,
): Promise<RunningReviewServer> {
  if ((options.workspace === undefined) === (options.workspaceFactory === undefined)
    || !options.assets || typeof options.assets.javascript !== "string" || typeof options.assets.css !== "string") {
    throw new SafeHttpError(500, "server_configuration_invalid");
  }
  const makeRandomBytes = options.randomBytes ?? cryptoRandomBytes;
  const bootstrapBytes = makeRandomBytes(32);
  const sessionBytes = makeRandomBytes(32);
  if (!Buffer.isBuffer(bootstrapBytes) || bootstrapBytes.byteLength !== 32
    || !Buffer.isBuffer(sessionBytes) || sessionBytes.byteLength !== 32) {
    throw new SafeHttpError(500, "server_configuration_invalid");
  }
  let bootstrapToken: string | null = bootstrapBytes.toString("hex");
  const browserSessionToken = sessionBytes.toString("hex");
  let workspace = options.workspace;
  let workspaceOpening: {
    reviewer: { name: string; email: string };
    promise: Promise<VisualMetadataReviewWorkspace>;
  } | null = null;
  let origin = "";
  let authority = "";
  let closing = false;
  const servedScreenshots = new Set<string>();
  const fetchImpl = options.fetchImpl ?? fetch;
  const closedWorkspaces = new WeakSet<VisualMetadataReviewWorkspace>();
  const closeWorkspaceOnce = async (candidate: VisualMetadataReviewWorkspace): Promise<void> => {
    if (closedWorkspaces.has(candidate)) return;
    closedWorkspaces.add(candidate);
    try {
      await candidate.close();
    } finally {
      if (workspace === candidate) workspace = undefined;
    }
  };

  const listener = createServer(async (request, response) => {
    const requestSocket = request.socket;
    securityHeaders(response);
    try {
      if (!exactHostHeader(request, authority)) throw new SafeHttpError(400, "host_rejected");
      const requestUrl = trustedRequestUrl(request.url ?? "/", origin);
      if (closing) throw new SafeHttpError(503, "server_closing");
      const method = request.method ?? "GET";

      if (method === "GET" && requestUrl.pathname === "/" && requestUrl.searchParams.has("bootstrap")) {
        const supplied = requestUrl.searchParams.get("bootstrap") ?? undefined;
        if (bootstrapToken === null || requestUrl.searchParams.size !== 1 || !tokenMatches(supplied, bootstrapToken)) {
          throw new SafeHttpError(401, "unauthorized");
        }
        bootstrapToken = null;
        response.statusCode = 303;
        response.setHeader("Location", "/");
        response.setHeader("Set-Cookie", `${COOKIE_NAME}=${browserSessionToken}; Path=/; HttpOnly; SameSite=Strict`);
        response.end();
        return;
      }

      if (!tokenMatches(sessionCookie(request), browserSessionToken)) throw new SafeHttpError(401, "unauthorized");
      if (["POST", "PATCH", "PUT", "DELETE"].includes(method) && request.headers.origin !== origin) {
        throw new SafeHttpError(403, "origin_rejected");
      }

      if (method === "GET" && requestUrl.pathname === "/") {
        send(response, 200,
          '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/app.css"></head><body><main id="app"></main><script src="/assets/app.js" defer></script></body></html>',
          "text/html; charset=utf-8");
        return;
      }
      if (method === "GET" && requestUrl.pathname === "/assets/app.js") {
        send(response, 200, options.assets.javascript, "text/javascript; charset=utf-8");
        return;
      }
      if (method === "GET" && requestUrl.pathname === "/assets/app.css") {
        send(response, 200, options.assets.css, "text/css; charset=utf-8");
        return;
      }
      if (method === "GET" && requestUrl.pathname === "/api/session") {
        sendJson(response, 200, workspace ? safeDto(workspace).session : { phase: "identity_required" });
        return;
      }
      if (method === "POST" && requestUrl.pathname === "/api/identity") {
        if (!options.workspaceFactory || workspace) throw new SafeHttpError(409, "identity_already_set");
        const body = await readJson(request);
        if (!record(body) || !exactKeys(body, ["name", "email"])
          || typeof body.name !== "string" || typeof body.email !== "string") {
          throw new SafeHttpError(400, "identity_invalid");
        }
        const reviewer = { name: body.name.trim(), email: body.email.trim() };
        if (!reviewer.name || reviewer.name.length > 200
          || reviewer.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reviewer.email)) {
          throw new SafeHttpError(400, "identity_invalid");
        }
        if (closing) throw new SafeHttpError(503, "server_closing");
        if (workspace) throw new SafeHttpError(409, "identity_already_set");
        if (workspaceOpening
          && (workspaceOpening.reviewer.name !== reviewer.name || workspaceOpening.reviewer.email !== reviewer.email)) {
          throw new SafeHttpError(409, "identity_open_in_progress");
        }
        if (!workspaceOpening) {
          const pending = {
            reviewer,
            promise: Promise.resolve().then(() => options.workspaceFactory!(reviewer)),
          };
          workspaceOpening = pending;
          pending.promise.catch(() => {
            if (workspaceOpening === pending) workspaceOpening = null;
          });
        }
        const pending = workspaceOpening;
        try {
          const opened = await pending.promise;
          if (closing) throw new SafeHttpError(503, "server_closing");
          workspace = opened;
          if (workspaceOpening === pending) workspaceOpening = null;
          servedScreenshots.clear();
        } catch (error) {
          if (error instanceof SafeHttpError) throw error;
          if (workspaceOpening === pending) workspaceOpening = null;
          throw new SafeHttpError(500, "workspace_open_failed");
        }
        sendJson(response, 200, safeDto(workspace).session);
        return;
      }
      if (method === "GET" && requestUrl.pathname === "/api/items") {
        const dto = safeDto(safeWorkspace(workspace));
        const status = requestUrl.searchParams.get("status")?.trim() ?? "";
        const query = requestUrl.searchParams.get("q")?.trim().toLocaleLowerCase() ?? "";
        const allowed = new Set(["", "pending", "approved", "rejected", "failed"]);
        if (!allowed.has(status)) throw new SafeHttpError(400, "filter_invalid");
        const items = dto.items.filter((item) => (!status || item.state === status)
          && (!query || item.id.toLocaleLowerCase().includes(query) || item.name.toLocaleLowerCase().includes(query)));
        sendJson(response, 200, { items });
        return;
      }

      const screenshotMatch = /^\/api\/items\/([^/]+)\/screenshot$/.exec(requestUrl.pathname);
      if (method === "GET" && screenshotMatch) {
        const id = decodeItemId(screenshotMatch[1]);
        const current = safeWorkspace(workspace);
        const source = current.getScreenshotSourceUrl(id);
        if (!validScreenshotSource(source)) throw new SafeHttpError(404, "screenshot_not_found");
        const controller = new AbortController();
        const abortForDisconnect = () => {
          if (!response.writableFinished) controller.abort();
        };
        response.once("close", abortForDisconnect);
        request.once("aborted", abortForDisconnect);
        if (response.destroyed || request.aborted) controller.abort();
        const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
        let upstream: Response;
        let image: Buffer;
        try {
          upstream = await fetchImpl(source, { redirect: "error", signal: controller.signal });
          image = await readImage(upstream);
        } catch (error) {
          if (controller.signal.aborted) throw new SafeHttpError(504, "screenshot_timeout");
          if (error instanceof SafeHttpError) throw error;
          throw new SafeHttpError(502, "screenshot_unavailable");
        } finally {
          clearTimeout(timeout);
          response.off("close", abortForDisconnect);
          request.off("aborted", abortForDisconnect);
        }
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", upstream.headers.get("content-type")!.split(";", 1)[0]);
        response.setHeader("Content-Length", image.byteLength);
        response.once("finish", () => servedScreenshots.add(id));
        response.end(image);
        return;
      }

      const metadataMatch = /^\/api\/items\/([^/]+)\/metadata$/.exec(requestUrl.pathname);
      if (method === "PATCH" && metadataMatch) {
        const body = await readJson(request);
        if (!record(body) || !exactKeys(body, ["field", "value"]) || typeof body.field !== "string") {
          throw new SafeHttpError(400, "command_invalid");
        }
        await safeWorkspace(workspace).dispatch({
          action: "metadata_updated",
          templateId: decodeItemId(metadataMatch[1]),
          field: body.field as ReviewCommand & never,
          value: body.value,
        } as ReviewCommand);
        sendJson(response, 200, safeDto(safeWorkspace(workspace)));
        return;
      }

      const decisionMatch = /^\/api\/items\/([^/]+)\/decision$/.exec(requestUrl.pathname);
      if (method === "POST" && decisionMatch) {
        const id = decodeItemId(decisionMatch[1]);
        const body = await readJson(request);
        if (!record(body) || typeof body.decision !== "string") throw new SafeHttpError(400, "command_invalid");
        let command: ReviewCommand;
        if (body.decision === "approve" && exactKeys(body, ["decision"])) {
          if (!servedScreenshots.has(id)) throw new SafeHttpError(409, "screenshot_required");
          command = { action: "approved", templateId: id };
        } else if (body.decision === "reject" && exactKeys(body, ["decision", "reason"]) && typeof body.reason === "string") {
          command = { action: "rejected", templateId: id, reason: body.reason };
        } else {
          throw new SafeHttpError(400, "command_invalid");
        }
        await safeWorkspace(workspace).dispatch(command);
        sendJson(response, 200, safeDto(safeWorkspace(workspace)));
        return;
      }

      const reopenMatch = /^\/api\/items\/([^/]+)\/reopen$/.exec(requestUrl.pathname);
      if (method === "POST" && reopenMatch) {
        const body = await readJson(request);
        if (!record(body) || !exactKeys(body, [])) throw new SafeHttpError(400, "command_invalid");
        await safeWorkspace(workspace).dispatch({ action: "reopened", templateId: decodeItemId(reopenMatch[1]) });
        sendJson(response, 200, safeDto(safeWorkspace(workspace)));
        return;
      }
      if (method === "POST" && requestUrl.pathname === "/api/navigation") {
        const body = await readJson(request);
        if (!record(body) || !exactKeys(body, ["templateId"]) || typeof body.templateId !== "string") {
          throw new SafeHttpError(400, "command_invalid");
        }
        await safeWorkspace(workspace).setCurrentTemplate(body.templateId);
        sendJson(response, 200, safeDto(safeWorkspace(workspace)).session);
        return;
      }
      if (method === "POST" && requestUrl.pathname === "/api/export") {
        const body = await readJson(request);
        if (!record(body) || !exactKeys(body, [])) throw new SafeHttpError(400, "command_invalid");
        const current = safeWorkspace(workspace);
        if (!current.snapshot().state.progress.finalExportEnabled) {
          throw new SafeHttpError(409, "export_gate_closed");
        }
        try {
          await current.exportFinal();
        } catch {
          throw new SafeHttpError(500, "export_failed");
        }
        sendJson(response, 200, { exported: true });
        return;
      }
      if (method === "POST" && requestUrl.pathname === "/api/export/audit") {
        const body = await readJson(request);
        if (!record(body) || !exactKeys(body, [])) throw new SafeHttpError(400, "command_invalid");
        await safeWorkspace(workspace).exportAuditBackup();
        sendJson(response, 200, { exported: true });
        return;
      }
      throw new SafeHttpError(404, "not_found");
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      const safeError = error instanceof SafeHttpError ? error : new SafeHttpError(409, "request_rejected");
      if (safeError.code === "server_closing") response.setHeader("Connection", "close");
      if (!request.complete && (safeError.code === "json_required" || safeError.code === "body_too_large")) {
        request.resume();
        response.setHeader("Connection", "close");
        response.once("finish", () => requestSocket.end());
      }
      sendError(response, safeError);
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, LOOPBACK_HOST, () => {
        listener.off("error", reject);
        resolve();
      });
    });
  } catch {
    throw new SafeHttpError(500, "server_start_failed");
  }
  const address = listener.address() as AddressInfo | null;
  if (!address || address.address !== LOOPBACK_HOST || address.port < 1) {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    throw new SafeHttpError(500, "server_start_failed");
  }
  origin = `http://${LOOPBACK_HOST}:${address.port}`;
  authority = `${LOOPBACK_HOST}:${address.port}`;
  const encodedBootstrap = encodeURIComponent(bootstrapToken!);
  let closePromise: Promise<void> | null = null;
  return {
    origin,
    bootstrapUrl: `${origin}/?bootstrap=${encodedBootstrap}`,
    close() {
      if (!closePromise) {
        closing = true;
        const listenerClosed = new Promise<void>((resolve, reject) => {
          listener.close((error) => error ? reject(new SafeHttpError(500, "server_close_failed")) : resolve());
        });
        const openingAtClose = workspaceOpening;
        const opened = openingAtClose
          ? openingAtClose.promise.catch(() => undefined)
          : Promise.resolve(undefined);
        closePromise = Promise.all([listenerClosed, opened]).then(async ([, openedWorkspace]) => {
          if (openedWorkspace) await closeWorkspaceOnce(openedWorkspace);
          if (workspace) await closeWorkspaceOnce(workspace);
          workspaceOpening = null;
          workspace = undefined;
        });
      }
      return closePromise;
    },
  };
}
