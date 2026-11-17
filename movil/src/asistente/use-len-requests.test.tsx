import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LenRequestView } from "@/lib/assistants/len-requests";

import type { ElementoDelHilo } from "../chat/hilo";
import { useLenRequests } from "./use-len-requests";

const m = vi.hoisted(() => ({ read: vi.fn(), pause: vi.fn() }));
vi.mock("../api/asistente", () => ({ readLenRequests: m.read }));
vi.mock("../gestion/api", () => ({ pausarEncargo: m.pause }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cliente = { pedir: vi.fn(), avisarAlCerrar: vi.fn() };
const REF = { filaId: "f1", projectId: "p1" };
const ELEMENTOS: ElementoDelHilo[] = [{ clave: "t1:lenPedidos", t: 1, tipo: "lenPedidos", refs: [REF] }];
const view = (status: LenRequestView["status"]): LenRequestView => ({ filaId: "f1", status });

let root: Root;
let host: HTMLDivElement;
let result: ReturnType<typeof useLenRequests>;
const onSettled = vi.fn();
function Probe({ assistantId }: { assistantId: string | null }) {
  result = useLenRequests({ cliente, assistantId, elementos: ELEMENTOS, onSettled });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  m.read.mockReset();
  onSettled.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("her Len cards follow his turns (spec local 2026-11-16-movil-es-tu-asistente, §5.4)", () => {
  it("asks every 4 s while Len works and stops when he's done, telling once", async () => {
    m.read.mockResolvedValueOnce([view("running")]).mockResolvedValueOnce([view("running")]).mockResolvedValueOnce([view("done")]);
    await act(async () => root.render(<Probe assistantId="a1" />));
    expect(m.read).toHaveBeenCalledWith(cliente, "a1", ["f1"]);
    expect(result.byFila.get("f1")?.status).toBe("running");
    await act(async () => vi.advanceTimersByTime(4000));
    await act(async () => vi.advanceTimersByTime(4000));
    expect(m.read).toHaveBeenCalledTimes(3);
    expect(result.byFila.get("f1")?.status).toBe("done");
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(REF);
    await act(async () => vi.advanceTimersByTime(12000));
    expect(m.read).toHaveBeenCalledTimes(3);
  });

  it("a request already over when the chat opens is not told again", async () => {
    m.read.mockResolvedValueOnce([view("done")]);
    await act(async () => root.render(<Probe assistantId="a1" />));
    expect(result.byFila.get("f1")?.status).toBe("done");
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("🔴 an answer that arrives after switching assistant paints nothing and reloads nothing", async () => {
    let answer!: (v: LenRequestView[]) => void;
    m.read.mockImplementationOnce(() => new Promise((r) => { answer = r; })).mockResolvedValue([]);
    await act(async () => root.render(<Probe assistantId="a1" />));
    await act(async () => root.render(<Probe assistantId="a2" />));
    await act(async () => answer([view("done")]));
    expect(result.byFila.get("f1")).toBeUndefined();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("🔴 more than 20 requests in her thread: the newest 20 are asked for (final review, C1)", async () => {
    m.read.mockResolvedValue([]);
    const many: ElementoDelHilo[] = [{ clave: "t:lenPedidos", t: 1, tipo: "lenPedidos", refs: Array.from({ length: 25 }, (_, i) => ({ filaId: `f${i + 1}`, projectId: "p1" })) }];
    function Many() {
      result = useLenRequests({ cliente, assistantId: "a1", elementos: many, onSettled });
      return null;
    }
    await act(async () => root.render(<Many />));
    expect(m.read.mock.calls[0]![2]).toEqual(Array.from({ length: 20 }, (_, i) => `f${i + 6}`));
  });

  // Deferred minor of the final review: every poll asked again for cards already over, and got their whole turns back.
  it("🔴 once a card is over it is not asked for again: the next looks ask only for the ones still moving", async () => {
    const two: ElementoDelHilo[] = [{ clave: "t:lenPedidos", t: 1, tipo: "lenPedidos", refs: [REF, { filaId: "f2", projectId: "p1" }] }];
    function Two() {
      result = useLenRequests({ cliente, assistantId: "a1", elementos: two, onSettled });
      return null;
    }
    m.read
      .mockResolvedValueOnce([view("done"), { filaId: "f2", status: "running" }])
      .mockResolvedValueOnce([{ filaId: "f2", status: "done" }]);
    await act(async () => root.render(<Two />));
    expect(m.read.mock.calls[0]![2]).toEqual(["f1", "f2"]);
    await act(async () => vi.advanceTimersByTime(4000));
    expect(m.read.mock.calls[1]![2]).toEqual(["f2"]);
    // What was already known stays on its card.
    expect(result.byFila.get("f1")?.status).toBe("done");
    expect(result.byFila.get("f2")?.status).toBe("done");
    await act(async () => vi.advanceTimersByTime(12000));
    expect(m.read).toHaveBeenCalledTimes(2);
  });

  it("«Parar» pauses Len's live turn and reads again", async () => {
    m.read.mockResolvedValue([{ ...view("running"), turnoId: "t1" }]);
    m.pause.mockResolvedValue({ ok: true });
    await act(async () => root.render(<Probe assistantId="a1" />));
    await act(async () => result.stop("t1"));
    expect(m.pause).toHaveBeenCalledWith(cliente, "t1");
    expect(m.read).toHaveBeenCalledTimes(2);
  });
});
