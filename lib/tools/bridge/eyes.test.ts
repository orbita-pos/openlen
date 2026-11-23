// @vitest-environment node
//
// LEN'S EYES RUN A TOOL WITH ITS BRIDGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.8): without a
// parent, `window.openlen` calls the function Puppeteer exposes. Reads are answered for real; writes never are —
// in draft (the canvas) nor installed; and there is no chat to write in.
import { describe, expect, it, vi } from "vitest";

import type { ToolInstallationRow } from "../store";
import { installEyesBridge } from "./eyes";
import type { BridgeCaller } from "./handlers";
import { TOOL_THEME_TOKENS } from "./protocol";
import { WORKSPACE_TOOL_THEME } from "./workspace-theme";

const base = { personId: "u1", personEmail: "ana@example.com", locale: "es", timeZone: "UTC" };
const draft: BridgeCaller = { ...base, mode: "draft", toolProjectId: "tool" };
const installed: BridgeCaller = { ...base, mode: "installed", installation: { id: "i1", projectId: "tool", releaseSha: "sha1" } as ToolInstallationRow };

async function exposed(caller: BridgeCaller, handle = vi.fn(async () => ({ result: [{ id: "p1" }] }))) {
  let fn: ((json: string) => Promise<string>) | null = null;
  const jobs = vi.fn(async () => [{ id: "job-1" }]);
  const job = vi.fn(async (_c: BridgeCaller, id: string) => (id === "job-1" ? { id } : null));
  await installEyesBridge({ exposeFunction: async (_name, f) => void (fn = f) }, caller, { handle, jobs, job });
  const call = async (method: string, params?: unknown) =>
    JSON.parse(await fn!(JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}), channel: "openlen-tool" }))) as Record<string, unknown>;
  return { call, handle, jobs, job };
}

describe("installEyesBridge", () => {
  it("update is always refused: draft_no_production in draft, eyes_never_write installed", async () => {
    const d = await exposed(draft);
    expect((await d.call("update", { projectId: "p1", table: "t", key: { id: 1 }, set: { a: 1 }, before: { a: 0 } })).result).toEqual({ status: "refused", reason: "draft_no_production" });
    const i = await exposed(installed);
    expect((await i.call("update", {})).result).toEqual({ status: "refused", reason: "eyes_never_write" });
    expect(d.handle).not.toHaveBeenCalled();
  });

  it("reads go to the bridge's handlers, for this caller", async () => {
    const d = await exposed(draft);
    expect((await d.call("projects")).result).toEqual([{ id: "p1" }]);
    expect(d.handle).toHaveBeenCalledWith(draft, "projects", undefined);
  });

  it("context: the person, a light theme, the tool and its mode", async () => {
    const i = await exposed(installed);
    expect((await i.call("context")).result).toMatchObject({ person: { locale: "es" }, theme: { mode: "light" }, tool: { id: "tool", version: "sha1" }, environment: "installed" });
  });

  it("context in dark: the workspace's dark colours, when the eyes ask for dark", async () => {
    const i = await exposed({ ...installed, theme: "dark" });
    const theme = ((await i.call("context")).result as { theme: { mode: string; tokens: Record<string, string> } }).theme;
    expect(theme.mode).toBe("dark");
    expect(theme.tokens["--bg"]).toBe("oklch(11% 0.01 12)");
    expect(theme.tokens["--fg"]).toBe("oklch(96% 0.005 12)");
  });

  it("the eyes give every token the skill names, the same ones the web and the phone give", async () => {
    for (const mode of ["light", "dark"] as const) {
      const i = await exposed({ ...installed, theme: mode });
      const tokens = ((await i.call("context")).result as { theme: { tokens: Record<string, string> } }).theme.tokens;
      expect(Object.keys(tokens).sort()).toEqual([...TOOL_THEME_TOKENS].sort());
      for (const [name, value] of Object.entries(WORKSPACE_TOOL_THEME[mode])) expect(tokens[name]).toBe(value);
      expect(tokens["--font-sans"]).toBeTruthy();
    }
  });

  it("the caller is read on every call, so the same tab can look in light and then in dark", async () => {
    let caller: BridgeCaller = installed;
    let fn: ((json: string) => Promise<string>) | null = null;
    await installEyesBridge({ exposeFunction: async (_name, f) => void (fn = f) }, () => caller, { handle: vi.fn(), jobs: vi.fn(), job: vi.fn() });
    const mode = async () => (JSON.parse(await fn!(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "context", channel: "openlen-tool" }))).result as { theme: { mode: string } }).theme.mode;
    expect(await mode()).toBe("light");
    caller = { ...installed, theme: "dark" };
    expect(await mode()).toBe("dark");
  });

  it("sendPrompt: there is no chat here", async () => {
    expect((await (await exposed(draft)).call("sendPrompt", { text: "hola" })).result).toEqual({ status: "unavailable" });
  });

  it("a job never runs from the eyes, nor a file is picked, delivered or a job stopped: each says why", async () => {
    const d = await exposed(draft);
    expect((await d.call("jobs.run", { name: "export" })).result).toEqual({ status: "refused", reason: "eyes_never_run" });
    for (const method of ["files.pick", "files.deliver", "jobs.cancel"]) expect((await d.call(method, { id: "job-1" })).error).toMatchObject({ message: "eyes_never_run" });
    expect(d.handle).not.toHaveBeenCalled();
  });

  it("jobs.get and jobs.list answer from the draft's jobs, for this caller", async () => {
    const d = await exposed(draft);
    expect((await d.call("jobs.list")).result).toEqual([{ id: "job-1" }]);
    expect(d.jobs).toHaveBeenCalledWith(draft);
    expect((await d.call("jobs.get", { id: "job-1" })).result).toEqual({ id: "job-1" });
    expect((await d.call("jobs.get", { id: "job-x" })).error).toMatchObject({ message: "not_found" });
  });

  it("anything else is JSON-RPC's method not found", async () => {
    expect((await (await exposed(draft)).call("eval")).error).toMatchObject({ code: -32601 });
  });
});

describe("installEyesBridge — agentTool mode", () => {
  const initialDocs = () => [
    {
      collection: "lessons",
      docId: "1",
      data: { title: "Intro", unlocked: true, score: 10 },
      updatedAt: new Date("2026-11-22T10:00:00Z"),
      updatedBy: "agent" as const,
    },
    {
      collection: "lessons",
      docId: "2",
      data: { title: "Verbs", unlocked: false, score: 5 },
      updatedAt: new Date("2026-11-22T10:05:00Z"),
      updatedBy: "agent" as const,
    },
  ];

  async function exposedAgentTool(docs = initialDocs(), extra: { theme?: "light" | "dark"; locale?: string; releaseSha?: string } = {}) {
    let fn: ((json: string) => Promise<string>) | null = null;
    const evals: string[] = [];
    const caller = { mode: "agentTool" as const, toolId: "tool-1", docs, ...extra };
    await installEyesBridge(
      {
        exposeFunction: async (_name, f) => void (fn = f),
        evaluate: async (expr: string) => {
          evals.push(expr);
        },
      },
      caller,
    );
    const call = async (method: string, params?: unknown) =>
      JSON.parse(await fn!(JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}), channel: "openlen-tool" }))) as Record<string, unknown>;
    return { call, evals, docs };
  }

  it("reads initial docs, applies set/update/delete on an isolated copy, pushes __openlenBridgeNotify, and never mutates the caller's docs", async () => {
    const seed = initialDocs();
    const { call, evals } = await exposedAgentTool(seed, { locale: "es", releaseSha: "sha-9" });

    expect((await call("context")).result).toMatchObject({
      person: { locale: "es" },
      theme: { mode: "light" },
      tool: { id: "tool-1", version: "sha-9" },
      environment: "installed",
    });
    expect((await call("sendPrompt", { text: "hola" })).result).toEqual({ status: "unavailable" });

    // data.subscribe returns the baseline directly (client-source.ts delivers it unframed).
    const sub = (await call("data.subscribe")).result as { kind: string; docs: { collection: string; docId: string }[] };
    expect(sub.kind).toBe("baseline");
    expect(sub.docs.map((d) => `${d.collection}/${d.docId}`)).toEqual(["lessons/1", "lessons/2"]);

    // get / list / query read from the copy.
    expect((await call("data.get", { collection: "lessons", docId: "1" })).result).toMatchObject({
      doc: { collection: "lessons", docId: "1", data: { title: "Intro", unlocked: true, score: 10 } },
    });
    const queried = (await call("data.query", {
      collection: "lessons",
      query: { where: [{ field: "unlocked", op: "==", value: true }], orderBy: { field: "score", direction: "desc" } },
    })).result as { docs: { docId: string }[] };
    expect(queried.docs.map((d) => d.docId)).toEqual(["1"]);

    // set writes to the copy and notifies the page through window.__openlenBridgeNotify.
    const setRes = await call("data.set", { collection: "progress", docId: "3", data: { done: true } });
    expect(setRes.result).toMatchObject({ ok: true, doc: { collection: "progress", docId: "3", data: { done: true }, updatedBy: "person" } });
    expect(evals).toHaveLength(1);
    expect(evals[0]).toContain("__openlenBridgeNotify");
    expect(evals[0]).toContain('"kind":"change"');
    expect(evals[0]).toContain('"progress"');

    // A later get sees the write; update merges top-level fields.
    expect((await call("data.get", { collection: "progress", docId: "3" })).result).toMatchObject({ doc: { data: { done: true } } });
    await call("data.update", { collection: "lessons", docId: "2", data: { unlocked: true } });
    expect((await call("data.get", { collection: "lessons", docId: "2" })).result).toMatchObject({
      doc: { data: { title: "Verbs", unlocked: true, score: 5 } },
    });

    // delete removes from copy and notifies with deleted.
    const delRes = await call("data.delete", { collection: "progress", docId: "3" });
    expect(delRes.result).toEqual({ ok: true, doc: null });
    expect((await call("data.get", { collection: "progress", docId: "3" })).result).toEqual({ doc: null });
    expect(evals.at(-1)).toContain('"deleted":[{"collection":"progress","docId":"3"}]');

    // Original seed array (representing real stored docs) was NEVER mutated!
    expect(seed).toHaveLength(2);
    expect(seed[1]!.data).toEqual({ title: "Verbs", unlocked: false, score: 5 });
  });

  it("refuses installed-tool methods (backend, projects, update, jobs.*, files.*) with METHOD_NOT_FOUND", async () => {
    const { call } = await exposedAgentTool();
    for (const m of ["backend", "projects", "forms", "visits", "query", "update", "jobs.run", "jobs.list", "files.pick", "files.deliver"]) {
      expect((await call(m, {})).error).toMatchObject({ code: -32601 });
    }
  });

  it("enforces validation and the 64 KB doc cap on the in-memory copy", async () => {
    const { call } = await exposedAgentTool();
    expect((await call("data.list", {})).error).toMatchObject({ code: 400, message: "bad_request" });
    const huge = { x: "a".repeat(70 * 1024) };
    expect((await call("data.set", { collection: "c", docId: "big", data: huge })).error).toMatchObject({ code: 400, message: "doc_too_big" });
  });
});
