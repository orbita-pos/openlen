// DELIVERING A SCHEDULED TASK (spec local 2026-10-29-tareas-programadas, §7.6–7.7): the email with
// Len's reply, the presented files attached, what waits for the person, saved before it goes; and
// the push to whoever created the task.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));

import type { Tarjetas } from "@/lib/agent/turnos-desde-el-servidor";
import type { RunRow, TaskRow } from "./store";
import { deliverFailure, deliverResult, MAX_ATTACHMENT_BYTES, waitingFrom, type DeliverDeps } from "./deliver";

const task = {
  id: "schedule-1",
  projectId: "p1",
  createdBy: "member",
  locale: "es",
  timeZone: "America/Mexico_City",
  record: { id: "schedule-1", kind: "weekly", title: "PDF de resultados", prompt: "p", scheduledAt: "2026-11-09T15:03:00.000Z", time: "09:03:00.000", timeZone: "America/Mexico_City", weekdays: [1] },
  scheduledAt: new Date("2026-11-09T15:03:00.000Z"),
  status: "active",
  lastRunId: "run-1",
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as TaskRow;
const run = { id: "run-1", taskId: "schedule-1", projectId: "p1", occurrenceAt: new Date("2026-11-02T15:03:00.000Z") } as RunRow;

const delivery = (name: string, size: number) => ({ name, size, url: `/api/projects/p1/deliveries/run-1/0123abcd-${encodeURIComponent(name)}` });

function fakeDeps(over: Partial<DeliverDeps> = {}) {
  const calls: string[] = [];
  const deps: DeliverDeps = {
    markRun: vi.fn(async (_id, patch) => void calls.push(`mark:${Object.keys(patch).sort().join(",")}`)),
    recipientEmail: vi.fn(async () => "member@example.com"),
    projectTitle: vi.fn(async () => "Café Sol"),
    replyAddress: vi.fn(() => "len-p1@reply.openlen.com"),
    readDelivery: vi.fn(async (key: string) => new Uint8Array(key.includes("small") ? 10 : 1)),
    send: vi.fn(async () => void calls.push("send")),
    push: vi.fn(async () => {}),
    siteUrl: "https://openlen.com",
    chatUrl: vi.fn(() => "https://openlen.com/new?project=p1"),
    removeUrl: vi.fn(() => "https://openlen.com/es/scheduled-tasks/remove?task=schedule-1&token=t"),
    ...over,
  };
  return { deps, calls };
}

describe("deliverResult", () => {
  it("saves the reply before the email goes, then marks it done", async () => {
    const { deps, calls } = fakeDeps();
    await deliverResult(run, task, "Listo.", [], deps);
    expect(calls).toEqual(["mark:reply", "send", "mark:emailedAt,finishedAt,outcome"]);
    expect(deps.markRun).toHaveBeenLastCalledWith("run-1", expect.objectContaining({ outcome: "done" }));
  });

  it("if the send throws, the run is not marked emailed", async () => {
    const { deps } = fakeDeps({ send: vi.fn(async () => Promise.reject(new Error("smtp"))) });
    await expect(deliverResult(run, task, "Listo.", [], deps)).rejects.toThrow("smtp");
    expect(deps.markRun).not.toHaveBeenCalledWith("run-1", expect.objectContaining({ emailedAt: expect.anything() }));
  });

  it("attaches what fits and links the rest", async () => {
    const { deps } = fakeDeps();
    const cards = [
      { tool: "present", status: "done", summary: "", delivered: [delivery("small.pdf", 1_000_000), delivery("big.mp4", MAX_ATTACHMENT_BYTES + 5_000_000)] },
    ] as unknown as Tarjetas;
    await deliverResult(run, task, "Listo.", cards, deps);
    expect(deps.readDelivery).toHaveBeenCalledWith("deliveries/p1/run-1/0123abcd-small.pdf");
    const sent = vi.mocked(deps.send).mock.calls[0]![0];
    expect(sent.attachments.map((a) => a.filename)).toEqual(["small.pdf"]);
    expect(sent.texto).toContain("big.mp4: https://openlen.com/api/projects/p1/deliveries/run-1/0123abcd-big.mp4");
  });

  it("replies go to the project's Len address; without it, no reply-to", async () => {
    const a = fakeDeps();
    await deliverResult(run, task, "x", [], a.deps);
    expect(vi.mocked(a.deps.send).mock.calls[0]![0]).toMatchObject({ to: "member@example.com", replyTo: "len-p1@reply.openlen.com", canReply: true });
    const b = fakeDeps({ replyAddress: vi.fn(() => null) });
    await deliverResult(run, task, "x", [], b.deps);
    expect(vi.mocked(b.deps.send).mock.calls[0]![0]).toMatchObject({ replyTo: null, canReply: false });
  });

  it("the push goes to whoever created the task, once per run", async () => {
    const { deps } = fakeDeps();
    await deliverResult(run, task, "Listo, 412 visitas.", [], deps);
    expect(deps.push).toHaveBeenCalledWith(expect.objectContaining({ type: "len_turno", recipientUserId: "member", projectId: "p1" }), "scheduled:run-1");
  });

  it("an unanswered question and a publish card are listed as waiting", async () => {
    const cards = [
      { tool: "ask_user_question", status: "done", summary: "q", preguntas: [{ id: "a", question: "¿Lo publico ya?" }] },
      { tool: "publish", status: "done", summary: "Publicar en cafe.openlen.app" },
      { tool: "Read", status: "done", summary: "/index.html" },
    ] as unknown as Tarjetas;
    expect(waitingFrom(cards)).toEqual(["¿Lo publico ya?", "Publicar en cafe.openlen.app"]);
    const { deps } = fakeDeps();
    await deliverResult(run, task, "Listo.", cards, deps);
    expect(vi.mocked(deps.send).mock.calls[0]![0].waiting).toEqual(["¿Lo publico ya?", "Publicar en cafe.openlen.app"]);
  });
});

describe("deliverFailure", () => {
  it("records the outcome and the reason, emails it, then marks it finished", async () => {
    const { deps, calls } = fakeDeps();
    await deliverFailure(run, task, "no_credits", "Te quedaste sin créditos.", deps);
    expect(calls).toEqual(["mark:outcome,reason", "send", "mark:emailedAt,finishedAt"]);
    expect(vi.mocked(deps.send).mock.calls[0]![0]).toMatchObject({ texto: "Te quedaste sin créditos.", attachments: [] });
    expect(deps.push).not.toHaveBeenCalled();
  });
});
