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

// UN TURNO MUDO ES UN TURNO MUERTO, Y EL MURO NO ES NUESTRO.
//
// 🔴 EL CASO, medido en producción el 2026-09-15. Un turno del Agente se quedó
// dentro de una medición que no volvía. El stream siguió abierto y sin mandar
// un solo byte, y a los 90 SEGUNDOS EXACTOS Caddy cortó la respuesta a medias:
//
//   18:08:10  última señal del turno
//   18:09:40  aborting with incomplete response · read tcp 127.0.0.1:3000: i/o timeout
//
// El navegador del usuario llama a eso «network error». No hubo ningún error de
// red: hubo silencio, y `read_timeout 90s` en el transporte de Caddy hacia Next
// (infra/caddy/Caddyfile).
//
// Crear ya latía por esto mismo desde antes (`keepalive` en
// app/api/generate/route.ts, cada 5 s). El Agente no. Vive aquí y no en la ruta
// por la misma razón que el resto de este fichero: estaba escrito tres veces y
// la que se olvidó fue la que costó el turno.
describe("el latido del canal", () => {
  it("🔴 un turno que no dice nada late igualmente", () => {
    vi.useFakeTimers();
    try {
      const f = fakeController();
      sseChannel(f.controller, { latidoMs: 15_000 });
      vi.advanceTimersByTime(45_000);
      // Tres latidos en 45 s: el muro del proxy son 90 s, así que hay que
      // fallar seis veces seguidas antes de que corte.
      expect(f.written).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("el latido es un COMENTARIO: ningún cliente lo ve como evento", () => {
    vi.useFakeTimers();
    try {
      const f = fakeController();
      sseChannel(f.controller, { latidoMs: 15_000 });
      vi.advanceTimersByTime(15_000);
      // Sin línea `data:`. El lector del taller (chat-panel.tsx) parte por
      // `\n\n`, junta las líneas `data:` y hace `if (!dataStr) continue` — así
      // que esto no puede inventarle un evento ni romperle el JSON.
      expect(f.written).toEqual([": latido\n\n"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un evento DE VERDAD reinicia el reloj — el latido no compite con el trabajo", () => {
    // El vigía de silencio de Claude Code: se reinicia con cada
    // señal de avance en vez de disparar a ciegas. Un turno que habla no
    // necesita que le añadamos bytes.
    vi.useFakeTimers();
    try {
      const f = fakeController();
      const ch = sseChannel(f.controller, { latidoMs: 15_000 });
      vi.advanceTimersByTime(10_000);
      ch.emit("tool", { nombre: "editar_pagina" });
      vi.advanceTimersByTime(10_000);
      expect(f.written).toEqual([`event: tool\ndata: {"nombre":"editar_pagina"}\n\n`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cerrar apaga el latido — si no, el temporizador sobrevive al turno", () => {
    vi.useFakeTimers();
    try {
      const f = fakeController();
      const ch = sseChannel(f.controller, { latidoMs: 15_000 });
      ch.close();
      vi.advanceTimersByTime(60_000);
      expect(f.written).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("CONTRA-PRUEBA: sin `latidoMs` el canal sale byte a byte como siempre", () => {
    vi.useFakeTimers();
    try {
      const f = fakeController();
      sseChannel(f.controller);
      vi.advanceTimersByTime(120_000);
      expect(f.written).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
