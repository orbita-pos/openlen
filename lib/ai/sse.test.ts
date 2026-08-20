import { describe, expect, it, vi } from "vitest";

import { jsonResponse, sseChannel } from "./sse";

function fakeController() {
  const written: string[] = [];
  let closed = false;
  return {
    written,
    get closed() { return closed; },
    controller: {
      enqueue(bytes: Uint8Array) {
        if (closed) throw new TypeError("controller is closed");
        written.push(new TextDecoder().decode(bytes));
      },
      close() {
        if (closed) throw new TypeError("controller is closed");
        closed = true;
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>,
  };
}

describe("el canal SSE", () => {
  it("escribe el formato de evento que el cliente espera", () => {
    const f = fakeController();
    sseChannel(f.controller).emit("done", { turns: 2 });
    expect(f.written).toEqual([`event: done\ndata: {"turns":2}\n\n`]);
  });

  // La regla que estaba escrita tres veces: escribir en un controlador cerrado
  // lanza, y esa excepción viajaba al catch exterior abortando un turno que ya
  // había terminado bien.
  it("después de cerrar no escribe nada más, y no lanza", () => {
    const f = fakeController();
    const ch = sseChannel(f.controller);
    ch.close();
    expect(() => ch.emit("late", {})).not.toThrow();
    expect(f.written).toEqual([]);
  });

  it("cerrar dos veces es inocuo y la limpieza corre una sola vez", () => {
    const f = fakeController();
    const cleanup = vi.fn();
    const ch = sseChannel(f.controller);
    ch.close(cleanup);
    ch.close(cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(f.closed).toBe(true);
  });

  it("si el cliente se va a mitad del turno, el canal se marca cerrado", () => {
    const f = fakeController();
    const ch = sseChannel(f.controller);
    f.controller.close();
    expect(() => ch.emit("x", {})).not.toThrow();
    expect(ch.isClosed).toBe(true);
  });

  it("la limpieza corre ANTES de cerrar — un temporizador vivo dispararía después", () => {
    const f = fakeController();
    const order: string[] = [];
    sseChannel({
      enqueue() {},
      close() { order.push("close"); },
    } as unknown as ReadableStreamDefaultController<Uint8Array>)
      .close(() => order.push("cleanup"));
    expect(order).toEqual(["cleanup", "close"]);
    expect(f.written).toEqual([]);
  });
});

describe("jsonResponse", () => {
  it("lleva el status y el content-type", async () => {
    const res = jsonResponse({ error: "nope" }, 404);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "nope" });
  });
});
