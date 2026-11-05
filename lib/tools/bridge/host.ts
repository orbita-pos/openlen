// THE PARENT'S SIDE OF A TOOL'S BRIDGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.14). The tool runs
// in a frame on its own `.app` host with no credentials; it asks its parent — the workspace, or since phase 5 the phone
// app — and this answers. Only its own frame from its own origin; what needs the server is relayed with the person's
// session or key (`fetchImpl`); never writes production until the person accepts OpenLen's dialog (option B); puts text
// in Len's composer and never sends it; gives the tool the parent's colours, light or dark. Phase 3 (§4.6): a job runs
// only after OpenLen's confirmation, with the numbers of the version's declaration; a file reaches a job only through
// OpenLen's own picker — the frame never names a file of the disk. No React and no DOM beyond `window`'s origin: the
// workspace's hook and the phone app both build on it.
import {
  BRIDGE_CHANNEL,
  isBridgeRequest,
  type BridgeError,
  type BridgeRequest,
  type DataChange,
  type ToolContext,
  type ToolJobAsk,
} from "./protocol";
import { JOB_REFUSALS, UPLOADS_PER_PICK, type ToolJobView } from "../jobs/types";

export type BridgeHostCaller = { readonly installationId: string } | { readonly draftProjectId: string };
/** What OpenLen's dialog shows: the change, and the project's title when the bridge has seen it. */
export type ToolChange = DataChange & { readonly projectId: string; readonly projectTitle?: string };

export interface BridgeHostOptions {
  frame(): Window | null;
  frameOrigin: string | null;
  caller: BridgeHostCaller;
  context(): Omit<ToolContext, "theme">;
  theme(): ToolContext["theme"];
  /** Null where there is no chat to write in (a rail tool): `sendPrompt` answers `unavailable`. */
  onPrompt: ((text: string) => void) | null;
  /** OpenLen's dialog: true only when the person pressed «Aplicar». */
  onConfirmChange(change: ToolChange): Promise<boolean>;
  /** OpenLen's confirmation before a job runs: true only when the person pressed «Ejecutar». */
  onConfirmJob(job: ToolJobAsk): Promise<boolean>;
  /** OpenLen's own file picker, in the workspace: the files the person chose, or null when they closed it. */
  onPickFiles(o: { accept?: string; multiple: boolean }): Promise<File[] | null>;
  /** A job this frame started: the frame's bar shows it with «Detener». */
  onJobStarted?(job: ToolJobView): void;
  fetchImpl?: typeof fetch;
  /** The origin a link the frame gets must name — where the person's session or key opens it. The workspace's own by
   *  default; the phone app gives openlen.com's (phase 5, §4.14). */
  linkOrigin?: string;
  timeZone?: string;
  locale?: string;
}

const PROMPT_MAX = 2000;
const INTERNAL_ERROR = -32603;

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function createToolBridgeHost(o: BridgeHostOptions): { onMessage(e: MessageEvent): Promise<void>; notifyContext(): void } {
  // Titles of the projects the tool has seen (its `projects()`), so the dialog names a project, not an id.
  const titles = new Map<string, string>();
  const doFetch = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const post = (message: unknown) => {
    const frame = o.frame();
    if (frame && o.frameOrigin) frame.postMessage(message, o.frameOrigin);
  };
  const answer = (id: number, r: { result: unknown } | { error: BridgeError }) => post({ jsonrpc: "2.0", id, ...r, channel: BRIDGE_CHANNEL });
  const relay = async (url: string, body: Record<string, unknown>): Promise<{ result: unknown } | { error: BridgeError }> => {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...o.caller, timeZone: o.timeZone, locale: o.locale, ...body }),
      });
      const data = record(await res.json().catch(() => ({})));
      if (!res.ok) return { error: { code: res.status, message: typeof data.error === "string" ? data.error : "bridge_failed" } };
      return { result: data };
    } catch {
      return { error: { code: INTERNAL_ERROR, message: "bridge_failed" } };
    }
  };

  // The person's picks in this frame, so the job's confirmation names the files, not their ids.
  const picked = new Map<string, string>();
  const callerFields = (): Record<string, string> => {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...o.caller, timeZone: o.timeZone, locale: o.locale })) if (typeof v === "string" && v) fields[k] = v;
    return fields;
  };
  const answerOf = async (res: Response): Promise<{ result: Record<string, unknown> } | { error: BridgeError }> => {
    const data = record(await res.json().catch(() => ({})));
    if (!res.ok) return { error: { code: res.status, message: typeof data.error === "string" ? data.error : "bridge_failed" } };
    return { result: data };
  };
  const get = async (path: string, extra: Record<string, string> = {}) => {
    try {
      return await answerOf(await doFetch(`${path}?${new URLSearchParams({ ...callerFields(), ...extra })}`));
    } catch {
      return { error: { code: INTERNAL_ERROR, message: "bridge_failed" } };
    }
  };
  const postFiles = async (path: string, files: readonly File[]) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(callerFields())) form.set(k, v);
    for (const file of files) form.append("file", file);
    try {
      return await answerOf(await doFetch(path, { method: "POST", body: form }));
    } catch {
      return { error: { code: INTERNAL_ERROR, message: "bridge_failed" } };
    }
  };
  const field = (r: { result: unknown } | { error: BridgeError }, key: string): { result: unknown } | { error: BridgeError } =>
    "error" in r ? r : { result: record(r.result)[key] ?? null };
  // The frame lives on the tool's own .app host: a link it gets must name OpenLen's origin, where the person's session
  // opens the file — a relative one would resolve on the tool's host, without it.
  const absolute = (url: unknown) => (typeof url === "string" && url.startsWith("/") ? new URL(url, o.linkOrigin ?? window.location.origin).href : url);
  const withLinks = (job: unknown): unknown => {
    const j = record(job);
    return Array.isArray(j.delivered) ? { ...j, delivered: j.delivered.map((f) => ({ ...record(f), url: absolute(record(f).url) })) } : job;
  };
  const jobsWithLinks = (r: { result: unknown } | { error: BridgeError }) =>
    "error" in r ? r : { result: Array.isArray(r.result) ? r.result.map(withLinks) : withLinks(r.result) };
  const isRefusal = (message: string) => (JOB_REFUSALS as readonly string[]).includes(message);

  async function runJob(p: Record<string, unknown>): Promise<{ result: unknown } | { error: BridgeError }> {
    const name = String(p.name ?? "");
    const ids = Array.isArray(p.files) ? p.files.filter((id): id is string => typeof id === "string") : [];
    const declared = await get("/api/tools/jobs/declared", { name });
    if ("error" in declared) return isRefusal(declared.error.message) ? { result: { status: "refused", reason: declared.error.message } } : declared;
    const job = record(declared.result.job);
    const ask: ToolJobAsk = {
      name,
      title: typeof job.title === "string" ? job.title : name,
      maxMinutes: Number(job.maxMinutes) || 0,
      mostCentis: Number(job.mostCentis) || 0,
      files: ids.map((id) => ({ id, name: picked.get(id) ?? id })),
    };
    if (!(await o.onConfirmJob(ask))) return { result: { status: "declined" } };
    const started = await relay("/api/tools/jobs", { name, input: p.input, uploads: ids });
    if ("error" in started) return isRefusal(started.error.message) ? { result: { status: "refused", reason: started.error.message } } : started;
    const view = record(started.result).job as ToolJobView;
    o.onJobStarted?.(view);
    return { result: { status: "started", job: withLinks(view) } };
  }

  async function pickFiles(p: Record<string, unknown>): Promise<{ result: unknown } | { error: BridgeError }> {
    const files = await o.onPickFiles({ accept: typeof p.accept === "string" ? p.accept : undefined, multiple: p.multiple === true });
    if (!files || files.length === 0) return { result: null };
    const saved = field(await postFiles("/api/tools/uploads", files.slice(0, UPLOADS_PER_PICK)), "uploads");
    if ("result" in saved && Array.isArray(saved.result)) {
      for (const up of saved.result) {
        const u = record(up);
        if (typeof u.id === "string" && typeof u.name === "string") picked.set(u.id, u.name);
      }
    }
    return saved;
  }

  async function deliverFile(p: Record<string, unknown>): Promise<{ result: unknown } | { error: BridgeError }> {
    const bytes = p.bytes;
    if (!(bytes instanceof Blob || bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes))) return { error: { code: -32602, message: "invalid_params" } };
    const name = typeof p.name === "string" && p.name ? p.name : "file";
    const file = new File([bytes as BlobPart], name, { type: typeof p.contentType === "string" ? p.contentType : "" });
    const delivered = await postFiles("/api/tools/deliver", [file]);
    return "error" in delivered ? delivered : { result: { ...delivered.result, url: absolute(delivered.result.url) } };
  }

  async function handle(req: BridgeRequest): Promise<{ result: unknown } | { error: BridgeError }> {
    const p = record(req.params);
    switch (req.method) {
      case "context":
        return { result: { ...o.context(), theme: o.theme() } };
      case "sendPrompt": {
        if (!o.onPrompt) return { result: { status: "unavailable" } };
        const text = String(p.text ?? "").trim().slice(0, PROMPT_MAX);
        if (!text) return { result: { status: "unavailable" } };
        o.onPrompt(text);
        return { result: { status: "placed" } };
      }
      case "update": {
        // The draft never writes production: refused here, before OpenLen's dialog (the server refuses it too).
        if ("draftProjectId" in o.caller) return { result: { status: "refused", reason: "draft_no_production" } };
        const change = { projectId: String(p.projectId ?? ""), table: String(p.table ?? ""), key: record(p.key), set: record(p.set), before: record(p.before) };
        const here = o.context().project;
        const projectTitle = titles.get(change.projectId) ?? (here?.id === change.projectId ? here.title : undefined);
        if (!(await o.onConfirmChange(projectTitle ? { ...change, projectTitle } : change))) return { result: { status: "declined" } };
        return relay("/api/tools/data-change", { change });
      }
      case "jobs.run":
        return runJob(p);
      case "jobs.get":
        return jobsWithLinks(field(await get(`/api/tools/jobs/${encodeURIComponent(String(p.id ?? ""))}`), "job"));
      case "jobs.cancel":
        return jobsWithLinks(field(await relay(`/api/tools/jobs/${encodeURIComponent(String(p.id ?? ""))}/cancel`, {}), "job"));
      case "jobs.list":
        return jobsWithLinks(field(await get("/api/tools/jobs"), "jobs"));
      case "files.pick":
        return pickFiles(p);
      case "files.deliver":
        return deliverFile(p);
      default: {
        const r = await relay("/api/tools/bridge", { request: req });
        if ("error" in r) return r;
        const rpc = record(r.result);
        if (req.method === "projects" && Array.isArray(rpc.result)) {
          for (const item of rpc.result) {
            const it = record(item);
            if (typeof it.id === "string" && typeof it.title === "string") titles.set(it.id, it.title);
          }
        }
        return rpc.error ? { error: rpc.error as BridgeError } : { result: rpc.result };
      }
    }
  }

  return {
    async onMessage(e: MessageEvent) {
      const frame = o.frame();
      if (!frame || e.source !== frame || !o.frameOrigin || e.origin !== o.frameOrigin) return;
      if (!isBridgeRequest(e.data)) return;
      answer(e.data.id, await handle(e.data));
    },
    notifyContext() {
      post({ jsonrpc: "2.0", method: "context", params: { ...o.context(), theme: o.theme() }, channel: BRIDGE_CHANNEL });
    },
  };
}
