// THE FRAME'S LINE FOR A RUNNING JOB (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): OpenLen shows a job the
// tool started — its title, how long it has run, «Detener» — even when the tool shows nothing, and follows it until it
// settles.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

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
const JOB = {
  id: "job-1",
  name: "export-video",
  title: "Exportar el vídeo",
  status: "running" as const,
  progress: "40%",
  detail: null,
  result: null,
  delivered: [],
  startedAt: new Date(START).toISOString(),
  finishedAt: null,
  seconds: 0,
  chargedCentis: 0,
};

function render(status: string[] = ["running"]) {
  const answers = [...status];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/cancel")) return Response.json({ job: { ...JOB, status: "stopping" } });
    return Response.json({ job: { ...JOB, status: answers.length > 1 ? answers.shift() : answers[0] } });
  });
  vi.setSystemTime(START + 84_000);
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  roots.push(root);
  const onSettled = vi.fn();
  act(() =>
    root.render(
      <RunningJobsBar jobs={[JOB]} caller={{ installationId: "i1" }} locale="es" timeZone="UTC" onSettled={onSettled} fetchImpl={fetchImpl as unknown as typeof fetch} />,
    ),
  );
  return { calls, onSettled };
}

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text);

describe("RunningJobsBar", () => {
  it("shows the job's title, how long it has run and its progress", () => {
    render();
    const line = document.querySelector("[data-tool-running-job]")!;
    expect(line.textContent).toContain("Exportar el vídeo");
    expect(line.textContent).toContain("1:24");
    expect(line.textContent).toContain("40%");
  });

  it("«Detener» asks to stop it, with the caller", async () => {
    const r = render();
    await act(async () => button("tools.jobs.running.stop")!.click());
    const cancel = r.calls.find((c) => c.url === "/api/tools/jobs/job-1/cancel")!;
    expect(cancel.init?.method).toBe("POST");
    expect(JSON.parse(String(cancel.init?.body))).toMatchObject({ installationId: "i1" });
    expect(document.body.textContent).toContain("tools.jobs.running.stopping");
  });

  it("follows the job every 2 s and lets it go once it settles", async () => {
    const r = render(["running", "completed"]);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(r.calls[0]!.url).toMatch(/^\/api\/tools\/jobs\/job-1\?/);
    expect(r.calls[0]!.url).toContain("installationId=i1");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(document.querySelector("[data-tool-running-job]")).toBeNull();
    expect(r.onSettled).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1", status: "completed" }));
  });
});
