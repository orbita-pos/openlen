// THE FRAME'S LINE FOR A JOB (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): OpenLen shows every job of the
// tool that is running — the ones this frame started, and the ones already running when it opened — with its title,
// how long it has run and «Detener», even when the tool shows nothing; and when one settles, how it ended and the
// files it left, until the person closes the line.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

import type { ToolJobView } from "@/lib/tools/jobs/types";

import { RunningJobsBar } from "./running-jobs-bar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const START = Date.parse("2026-11-05T10:00:00Z");
const JOB: ToolJobView = {
  id: "job-1",
  name: "export-video",
  title: "Exportar el vídeo",
  status: "running",
  progress: "40%",
  detail: null,
  result: null,
  delivered: [],
  startedAt: new Date(START).toISOString(),
  finishedAt: null,
  seconds: 0,
  chargedCentis: 0,
};

function render(o: { answers?: Array<Partial<ToolJobView>>; listed?: Array<Partial<ToolJobView>>; started?: ToolJobView[] } = {}) {
  const answers = [...(o.answers ?? [{}])];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/cancel")) return Response.json({ job: { ...JOB, status: "stopping" } });
    if (url.startsWith("/api/tools/jobs?")) return Response.json({ jobs: (o.listed ?? []).map((j) => ({ ...JOB, ...j })) });
    const next = answers.length > 1 ? answers.shift()! : answers[0]!;
    return Response.json({ job: { ...JOB, ...next } });
  });
  vi.setSystemTime(START + 84_000);
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  roots.push(root);
  const onDismiss = vi.fn();
  act(() =>
    root.render(
      <RunningJobsBar
        jobs={o.started ?? [JOB]}
        caller={{ installationId: "i1" }}
        locale="es"
        timeZone="UTC"
        onDismiss={onDismiss}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    ),
  );
  return { calls, onDismiss };
}

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const line = () => document.querySelector("[data-tool-running-job]");

describe("RunningJobsBar", () => {
  it("shows the job's title, how long it has run and its progress", () => {
    render();
    expect(line()!.textContent).toContain("Exportar el vídeo");
    expect(line()!.textContent).toContain("1:24");
    expect(line()!.textContent).toContain("40%");
  });

  it("«Detener» asks to stop it, with the caller", async () => {
    const r = render();
    await act(async () => button("tools.jobs.running.stop")!.click());
    const cancel = r.calls.find((c) => c.url === "/api/tools/jobs/job-1/cancel")!;
    expect(cancel.init?.method).toBe("POST");
    expect(JSON.parse(String(cancel.init?.body))).toMatchObject({ installationId: "i1" });
    expect(document.body.textContent).toContain("tools.jobs.running.stopping");
  });

  it("🔴 follows it every 2 s; once settled it says how it ended and links what it left, until closed (I2)", async () => {
    const delivered = [{ name: "boda.mp4", url: "/api/projects/tool-1/deliveries/job-1/abcd-boda.mp4", size: 9 }];
    const r = render({ answers: [{}, { status: "completed", delivered }] });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(r.calls.find((c) => c.url.startsWith("/api/tools/jobs/job-1?"))!.url).toContain("installationId=i1");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(line()!.textContent).toContain("tools.jobs.running.completed");
    const link = line()!.querySelector<HTMLAnchorElement>("a[data-tool-job-file]")!;
    expect(link.textContent).toBe("boda.mp4");
    expect(link.getAttribute("href")).toBe(delivered[0]!.url);
    expect(button("tools.jobs.running.stop")).toBeUndefined();
    await act(async () => button("tools.jobs.running.dismiss")!.click());
    expect(r.onDismiss).toHaveBeenCalledWith("job-1");
  });

  it("a failed job says why", async () => {
    render({ answers: [{ status: "failed", detail: "exit 1: boom" }] });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(line()!.textContent).toContain("tools.jobs.running.failed");
    expect(line()!.textContent).toContain("exit 1: boom");
  });

  it("🔴 a job already running when the frame opens shows up too, with «Detener» (I8)", async () => {
    const r = render({ started: [], listed: [{ id: "job-9", title: "Hacer el PDF", status: "running" }, { id: "job-old", status: "completed" }] });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(r.calls[0]!.url).toMatch(/^\/api\/tools\/jobs\?.*installationId=i1/);
    const lines = [...document.querySelectorAll("[data-tool-running-job]")].map((l) => l.textContent);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Hacer el PDF");
    expect(button("tools.jobs.running.stop")).toBeDefined();
  });
});
