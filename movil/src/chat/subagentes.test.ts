import { describe, expect, it, vi } from "vitest";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { subagentRefsOf, trabajando, type RunDelMovil } from "./subagentes";
import { leerSubagentes, pararSubagente } from "../api/subagentes";

describe("the phone's children", () => {
  it("subagentRefsOf: unique, in order, only the card tools", () => {
    const a = (tool: string, id: string, preset = "Explore") => ({ tool, status: "done" as const, summary: "", subagent: { id, preset } });
    expect(subagentRefsOf([a("subagent", "r1"), a("Read", "x"), a("send_message", "r1"), a("subagent_fork", "r2"), a("skill", "r3"), a("subagent", "bad id")])).toEqual([
      { id: "r1", preset: "Explore" }, { id: "r2", preset: "Explore" }, { id: "r3", preset: "Explore" },
    ]);
  });
  it("trabajando counts the running ones", () => {
    expect(trabajando(["completed", "running", "aborted", "running"].map(status => ({ status } as RunDelMovil)))).toBe(2);
  });
  it("leerSubagentes and pararSubagente call the right URLs", async () => {
    const run = { id: "r1", description: "Find", preset: "Explore", status: "running", toolUses: 3, durationMs: 1000, worktree: { state: "working" } };
    const pedir = vi.fn(async (_ruta: string, _init?: RequestInit) => new Response(JSON.stringify({ runs: [run], stopped: true })));
    const c: ClienteDeOpenLen = { pedir, avisarAlCerrar: () => {} };
    expect(await leerSubagentes(c, { projectId: "p 1", fila: "f1", ids: ["r1", "r2"] })).toEqual([run]);
    expect(pedir.mock.calls[0]?.[0]).toBe("/api/agent/subagents?project=p+1&row=f1&ids=r1%2Cr2");
    expect(await pararSubagente(c, "r1")).toBe(true);
    expect(pedir).toHaveBeenLastCalledWith("/api/agent/subagents/r1/stop", { method: "POST" });
    pedir.mockResolvedValueOnce(new Response(JSON.stringify({ stopped: false })));
    expect(await pararSubagente(c, "r1")).toBe(false);
  });
});
