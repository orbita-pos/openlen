// THE CONFIRMATION OPENLEN DRAWS BEFORE A TOOL'S JOB RUNS (spec local 2026-11-04-herramientas-hechas-por-len, §4.4,
// §4.6): outside the frame, with the job's title, the most minutes and credits it can take — from the version's
// declaration — and the files it gets; nothing runs until the person presses «Ejecutar».
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

import { JobConfirmDialog } from "./job-confirm-dialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const JOB = { name: "export-video", title: "Exportar el vídeo", maxMinutes: 10, mostCentis: 332, files: [{ id: "up-1", name: "boda.mp4" }] };

function render(job = JOB, onRun = vi.fn(), onCancel = vi.fn()) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  roots.push(root);
  act(() => root.render(<JobConfirmDialog open toolTitle="Vídeos" job={job} locale="en" onRun={onRun} onCancel={onCancel} />));
  return { onRun, onCancel };
}

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

describe("JobConfirmDialog", () => {
  it("names the tool and the job, and the most it can take: minutes and credits", () => {
    render();
    const text = document.body.textContent ?? "";
    expect(text).toContain('tools.jobs.confirm.title {"tool":"Vídeos","job":"Exportar el vídeo"}');
    expect(text).toContain('tools.jobs.confirm.minutes {"minutes":10}');
    expect(text).toContain('tools.jobs.confirm.credits {"credits":"3.32"}');
  });

  it("lists the files the job gets, and says nothing about files when there are none", () => {
    render();
    expect([...document.querySelectorAll("[data-tool-job-file]")].map((li) => li.textContent)).toEqual(["boda.mp4"]);
    for (const r of roots.splice(0)) act(() => r.unmount());
    document.body.innerHTML = "";
    render({ ...JOB, files: [] });
    expect(document.querySelector("[data-tool-job-file]")).toBeNull();
    expect(document.body.textContent).not.toContain("tools.jobs.confirm.files");
  });

  it("«Ejecutar» runs; «Cancelar» doesn't", () => {
    const r = render();
    act(() => button("tools.jobs.confirm.run").click());
    expect(r.onRun).toHaveBeenCalledTimes(1);
    act(() => button("tools.jobs.confirm.cancel").click());
    expect(r.onCancel).toHaveBeenCalledTimes(1);
  });
});
