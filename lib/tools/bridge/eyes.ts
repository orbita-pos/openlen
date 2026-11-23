// LEN'S EYES RUN A TOOL WITH ITS BRIDGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.8; and an agent's
// tool, spec local 2026-11-22-herramienta-dentro-del-agente, §5). The eyes open the tool top-level in Chromium, with no
// workspace around it, so `window.openlen` calls `__openlenBridge`, which Puppeteer exposes and this answers in Node:
// - For a Len-built tool (`draft` / `installed`): reads through the same handlers as the bridge's server; `update` (a
//   production row of another project, which needs the person's press) never — `draft_no_production` in the draft,
//   `eyes_never_write` installed. The tool's OWN backend is its draft in the draft and its production installed, as for
//   the person (Jesús, 04/11: Len may write the installed tool's own data when asked). There is no chat to put text in;
//   the theme is light unless the eyes ask for dark. A job never runs from the eyes (it costs the person, and only their
//   press in OpenLen's confirmation starts one), nor does a file get picked, delivered or a job stopped there; the
//   person's jobs of the tool can still be read (§4.6).
// - For an AGENT's tool (`mode: "lenArtifact"`): answers ONLY `context`, `sendPrompt` (`unavailable`), and `data.*` on an
//   isolated in-memory COPY of its real documents — writes go to the copy, push live updates to the page through
//   `window.__openlenBridgeNotify`, and are thrown away when the visit ends. Real tables are never written.
import "server-only";

import { LEN_ARTIFACT_DATA_MAX_BYTES, LEN_ARTIFACT_DOC_MAX_BYTES, LEN_ARTIFACT_DOCS_MAX } from "@/lib/len-artifacts/limits";
import { runQuery } from "@/lib/len-artifacts/query";
import type { LenArtifactDoc } from "@/lib/len-artifacts/store";
import { isRecord, parseRead, parseWrite, type ReadAction, type WriteAction } from "@/lib/len-artifacts/validate";
import { toBridgeDoc } from "@/lib/len-artifacts/wire";

import {
  BRIDGE_CHANNEL,
  BRIDGE_METHODS,
  METHOD_NOT_FOUND,
  type BridgeError,
  type BridgeRequest,
  type DataChangedParams,
  type ToolContext,
} from "./protocol";
import { handleBridgeCall, SERVER_METHODS, toolProjectOf, type BridgeCaller, type ServerMethod } from "./handlers";
import { WORKSPACE_TOOL_THEME } from "./workspace-theme";

export const EYES_BRIDGE_FUNCTION = "__openlenBridge";

/** An agent's own published tool running in the eyes on an isolated copy of its real documents. */
export interface LenArtifactEyesCaller {
  readonly mode: "lenArtifact";
  readonly toolId: string;
  readonly releaseSha?: string;
  readonly locale?: string;
  readonly theme?: "light" | "dark";
  readonly docs: readonly LenArtifactDoc[];
}

export type EyesCaller = BridgeCaller | LenArtifactEyesCaller;

/** The workspace's colours, light and dark, as the phone gives them (`WORKSPACE_TOOL_THEME`, copied from
 *  app/[locale]/new/tokens.css and pinned by its test): what a tool sees in the eyes, the same tokens as on the web and
 *  the phone. `--font-sans` is the parent's own; the eyes have none, so a system stack. */
const EYES_FONT = "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif";
const LIGHT_TOKENS: Readonly<Record<string, string>> = { ...WORKSPACE_TOOL_THEME.light, "--font-sans": EYES_FONT };
const DARK_TOKENS: Readonly<Record<string, string>> = { ...WORKSPACE_TOOL_THEME.dark, "--font-sans": EYES_FONT };

export interface EyesDeps {
  handle(caller: BridgeCaller, method: ServerMethod, params: unknown): Promise<{ result: unknown } | { error: BridgeError }>;
  /** The person's jobs of the tool, newest first. */
  jobs(caller: BridgeCaller): Promise<unknown[]>;
  job(caller: BridgeCaller, id: string): Promise<unknown | null>;
}

/** JSON-RPC's server-error range: what the eyes never do. */
const EYES_NEVER = -32001;

const realEyesDeps: EyesDeps = {
  handle: (c, m, p) => handleBridgeCall(c, m, p),
  jobs: async (c) => (await import("../jobs/start")).listToolJobs(c.personId, toolProjectOf(c)),
  job: async (c, id) => (await import("../jobs/start")).toolJobView(id, c.personId, toolProjectOf(c)),
};

function contextOf(caller: BridgeCaller): ToolContext {
  return {
    person: { name: "", locale: caller.locale },
    theme: caller.theme === "dark" ? { mode: "dark", tokens: DARK_TOKENS } : { mode: "light", tokens: LIGHT_TOKENS },
    project: null,
    tool: caller.mode === "installed" ? { id: caller.installation.projectId, version: caller.installation.releaseSha } : { id: toolProjectOf(caller), version: "draft" },
    environment: caller.mode,
  };
}

// ---- agent-tool in-memory copy (same caps & validation rules as lib/len-artifacts/store.ts) ---------------------------

const NAME_MAX = 200;
const NOT_A_NAME = /[\u0000-\u001f\u007f/]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const NOT_STORABLE = /(?<!\\)(?:\\\\)*\\u(?:0000|[dD][89a-fA-F][0-9a-fA-F]{2})/;
const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= NAME_MAX && !NOT_A_NAME.test(v);
const keyOf = (collection: string, docId: string) => JSON.stringify([collection, docId]);
const sizeOf = (data: unknown) => Buffer.byteLength(JSON.stringify(data), "utf8");
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function plainObject(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (typeof json !== "string" || NOT_STORABLE.test(json)) return null;
  const parsed: unknown = JSON.parse(json);
  return isRecord(parsed) ? parsed : null;
}

class InMemoryLenArtifactCopy {
  private readonly docs = new Map<string, { doc: LenArtifactDoc; bytes: number }>();
  private totalBytes = 0;

  constructor(initial: readonly LenArtifactDoc[]) {
    for (const d of initial) {
      // What the store gives is one row per key with JSON data; a copy that is handed something else still holds together:
      // a document without data is no document, and a key given twice keeps its last one (its bytes counted once).
      if (d.data === undefined || d.data === null) continue;
      const cloned = JSON.parse(JSON.stringify(d.data)) as unknown;
      const bytes = sizeOf(cloned);
      const key = keyOf(d.collection, d.docId);
      const before = this.docs.get(key);
      if (before) this.totalBytes -= before.bytes;
      this.docs.set(key, {
        doc: { collection: d.collection, docId: d.docId, data: cloned, updatedAt: new Date(d.updatedAt.getTime()), updatedBy: d.updatedBy },
        bytes,
      });
      this.totalBytes += bytes;
    }
  }

  all(collection?: string): LenArtifactDoc[] {
    const out: LenArtifactDoc[] = [];
    for (const { doc } of this.docs.values()) {
      if (collection === undefined || doc.collection === collection) {
        out.push({ ...doc, data: JSON.parse(JSON.stringify(doc.data)) as unknown });
      }
    }
    return out.sort((a, b) => byCodeUnit(a.collection, b.collection) || byCodeUnit(a.docId, b.docId));
  }

  write(
    op: WriteAction,
    collection: string,
    docId: string,
    rawData?: Record<string, unknown>,
  ): { ok: true; changed: boolean; doc: LenArtifactDoc | null } | { ok: false; error: "too_many_docs" | "doc_too_big" | "tool_too_big" | "bad_write" } {
    if (!isName(collection) || !isName(docId)) return { ok: false, error: "bad_write" };
    const key = keyOf(collection, docId);
    const prev = this.docs.get(key);
    if (op === "delete") {
      if (!prev) return { ok: true, changed: false, doc: null };
      this.docs.delete(key);
      this.totalBytes -= prev.bytes;
      return { ok: true, changed: true, doc: null };
    }
    const clean = plainObject(rawData);
    if (!clean) return { ok: false, error: "bad_write" };
    const merged = op === "update" && prev && isRecord(prev.doc.data) ? { ...prev.doc.data, ...clean } : clean;
    const bytes = sizeOf(merged);
    if (bytes > LEN_ARTIFACT_DOC_MAX_BYTES) return { ok: false, error: "doc_too_big" };
    const nextCount = this.docs.size + (prev ? 0 : 1);
    const nextBytes = this.totalBytes + bytes - (prev?.bytes ?? 0);
    if (nextCount > LEN_ARTIFACT_DOCS_MAX) return { ok: false, error: "too_many_docs" };
    if (nextBytes > LEN_ARTIFACT_DATA_MAX_BYTES) return { ok: false, error: "tool_too_big" };

    const doc: LenArtifactDoc = { collection, docId, data: merged, updatedAt: new Date(), updatedBy: "person" };
    this.docs.set(key, { doc, bytes });
    this.totalBytes = nextBytes;
    return { ok: true, changed: true, doc: { ...doc, data: JSON.parse(JSON.stringify(doc.data)) as unknown } };
  }
}

const DATA_READ_METHODS: Readonly<Record<string, ReadAction>> = {
  "data.get": "get",
  "data.list": "list",
  "data.query": "query",
};
const DATA_WRITE_METHODS: Readonly<Record<string, WriteAction>> = {
  "data.set": "set",
  "data.update": "update",
  "data.delete": "delete",
};

function lenArtifactContextOf(caller: LenArtifactEyesCaller): ToolContext {
  return {
    person: { name: "", locale: caller.locale ?? "en" },
    theme: caller.theme === "dark" ? { mode: "dark", tokens: DARK_TOKENS } : { mode: "light", tokens: LIGHT_TOKENS },
    project: null,
    tool: { id: caller.toolId, version: caller.releaseSha ?? "published" },
    environment: "installed",
  };
}

async function answerLenArtifact(
  caller: LenArtifactEyesCaller,
  req: BridgeRequest,
  copy: InMemoryLenArtifactCopy,
  notify: (payload: DataChangedParams) => Promise<void>,
): Promise<{ result: unknown } | { error: BridgeError }> {
  if (req.method === "context") return { result: lenArtifactContextOf(caller) };
  if (req.method === "sendPrompt") return { result: { status: "unavailable" } };
  if (req.method === "data.subscribe") {
    return { result: { kind: "baseline", docs: copy.all().map(toBridgeDoc) } };
  }

  const p = isRecord(req.params) ? req.params : {};
  const input = { collection: p.collection, docId: p.docId, data: p.data, query: p.query };

  const readOp = DATA_READ_METHODS[req.method];
  if (readOp) {
    const parsed = parseRead(readOp, input, "docId");
    if ("problem" in parsed) return { error: { code: 400, message: "bad_request", data: parsed.problem } };
    if (parsed.collection === null) return { error: { code: 400, message: "bad_request", data: "collection is required for list." } };
    const docs = copy.all(parsed.collection);
    if (readOp === "get") {
      const found = docs.find((d) => d.docId === parsed.docId);
      return { result: { doc: found ? toBridgeDoc(found) : null } };
    }
    return { result: { docs: (readOp === "list" ? docs : runQuery(docs, parsed.query)).map(toBridgeDoc) } };
  }

  const writeOp = DATA_WRITE_METHODS[req.method];
  if (writeOp) {
    const parsed = parseWrite(writeOp, input, "docId");
    if ("problem" in parsed) return { error: { code: 400, message: "bad_request", data: parsed.problem } };
    const { op, collection, docId, data } = parsed.write;
    const res = copy.write(op, collection, docId, data);
    if (!res.ok) return { error: { code: 400, message: res.error } };
    if (res.changed) {
      const change: DataChangedParams = res.doc
        ? { kind: "change", by: "person", docs: [toBridgeDoc(res.doc)], deleted: [] }
        : { kind: "change", by: "person", docs: [], deleted: [{ collection, docId }] };
      await notify(change);
    }
    return { result: { ok: true, doc: res.doc ? toBridgeDoc(res.doc) : null } };
  }

  return { error: { code: METHOD_NOT_FOUND, message: "method_not_found" } };
}

async function answer(caller: BridgeCaller, req: BridgeRequest, d: EyesDeps): Promise<{ result: unknown } | { error: BridgeError }> {
  switch (req.method) {
    case "context":
      return { result: contextOf(caller) };
    case "update":
      return { result: { status: "refused", reason: caller.mode === "draft" ? "draft_no_production" : "eyes_never_write" } };
    case "sendPrompt":
      return { result: { status: "unavailable" } };
    case "jobs.run":
      return { result: { status: "refused", reason: "eyes_never_run" } };
    case "jobs.cancel":
    case "files.pick":
    case "files.deliver":
      return { error: { code: EYES_NEVER, message: "eyes_never_run" } };
    case "jobs.list":
      return { result: await d.jobs(caller) };
    case "jobs.get": {
      const id = (req.params as { id?: unknown } | undefined)?.id;
      const job = typeof id === "string" ? await d.job(caller, id) : null;
      return job ? { result: job } : { error: { code: 404, message: "not_found" } };
    }
    default:
      return (SERVER_METHODS as readonly string[]).includes(req.method)
        ? d.handle(caller, req.method as ServerMethod, req.params)
        : { error: { code: METHOD_NOT_FOUND, message: "method_not_found" } };
  }
}

export async function installEyesBridge(
  page: {
    exposeFunction(name: string, fn: (json: string) => Promise<string>): Promise<void>;
    evaluate?(expr: string): Promise<unknown>;
  },
  /** The caller, or a getter read on every call: a tab is bridged once and looks again in dark, or as another person. */
  callerOf: EyesCaller | (() => EyesCaller | undefined),
  deps: EyesDeps = realEyesDeps,
): Promise<void> {
  // Each LenArtifactEyesCaller identity owns its own isolated in-memory copy; when a new visit passes a fresh caller, the
  // old copy is discarded and GC'd.
  const copies = new WeakMap<LenArtifactEyesCaller, InMemoryLenArtifactCopy>();
  const notify = async (payload: DataChangedParams): Promise<void> => {
    if (typeof page.evaluate !== "function") return;
    const serialized = JSON.stringify(payload).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    await page
      .evaluate(`(function(){var fn=window.__openlenBridgeNotify;if(typeof fn==="function")fn(${serialized});})()`)
      .catch(() => undefined);
  };

  await page.exposeFunction(EYES_BRIDGE_FUNCTION, async (json: string) => {
    let req: Partial<BridgeRequest> = {};
    try {
      req = JSON.parse(json) as BridgeRequest;
    } catch {
      /* answered below as not found */
    }
    const id = typeof req.id === "number" ? req.id : 0;
    const known = (BRIDGE_METHODS as readonly unknown[]).includes(req.method);
    const caller = typeof callerOf === "function" ? callerOf() : callerOf;
    let r: { result: unknown } | { error: BridgeError };
    if (!known || !caller) {
      r = { error: { code: METHOD_NOT_FOUND, message: "method_not_found" } };
    } else if (caller.mode === "lenArtifact") {
      let copy = copies.get(caller);
      if (!copy) {
        copy = new InMemoryLenArtifactCopy(caller.docs);
        copies.set(caller, copy);
      }
      r = await answerLenArtifact(caller, req as BridgeRequest, copy, notify);
    } else {
      r = await answer(caller, req as BridgeRequest, deps);
    }
    return JSON.stringify({ jsonrpc: "2.0", id, ...r, channel: BRIDGE_CHANNEL });
  });
}
