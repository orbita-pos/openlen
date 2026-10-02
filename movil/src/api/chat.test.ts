// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { EventoSse } from "@/lib/len-bench/sse";
import { SinRed } from "./proyectos";
import { dirigirA, mandarALen, subirFoto, transcribir } from "./chat";

function cliente(responder: (ruta: string, init?: RequestInit) => Promise<Response>) {
  const pedir = vi.fn(responder);
  const c: ClienteDeOpenLen = { pedir, avisarAlCerrar: () => {} };
  return { c, pedir };
}
const trozos = (...ts: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(ctl) {
        for (const t of ts) ctl.enqueue(new TextEncoder().encode(t));
        ctl.close();
      },
    }),
  );
const sinRed = async (): Promise<Response> => {
  throw new TypeError("Failed to fetch");
};

describe("mandarALen", () => {
  it("manda el pedido con la zona horaria y entrega los eventos aunque vengan partidos", async () => {
    const { c, pedir } = cliente(async () => trozos('event: turno\ndata: {"turnoId":"x1"}\n\nevent: te', 'xt\ndata: {"text":"Hola"}\n\n', "event: done\ndata: {}\n\n"));
    const eventos: EventoSse[] = [];
    const fin = await mandarALen(c, { projectId: "p1", prompt: "Pon azul" }, (e) => eventos.push(e));
    expect(fin).toBe("terminado");
    expect(eventos.map((e) => e.nombre)).toEqual(["turno", "text", "done"]);
    const [ruta, init] = pedir.mock.calls[0]!;
    expect(ruta).toBe("/api/agent");
    const cuerpo = JSON.parse(String(init!.body));
    expect(cuerpo).toMatchObject({ projectId: "p1", prompt: "Pon azul" });
    expect(typeof cuerpo.zonaHoraria).toBe("string");
    expect(cuerpo.attachedImage).toBeUndefined();
  });

  it("el turno lleva el id de su fila: el servidor guarda la conversación con él", async () => {
    const { c, pedir } = cliente(async () => trozos(""));
    await mandarALen(c, { projectId: "p1", prompt: "x", turnId: "f1" }, () => {});
    expect(JSON.parse(String(pedir.mock.calls[0]![1]!.body)).turnId).toBe("f1");
  });

  it("con foto, va como attachedImage", async () => {
    const { c, pedir } = cliente(async () => trozos(""));
    await mandarALen(c, { projectId: "p1", prompt: "x", foto: "https://x/f.jpg" }, () => {});
    expect(JSON.parse(String(pedir.mock.calls[0]![1]!.body)).attachedImage).toEqual({ url: "https://x/f.jpg" });
  });

  it("sin red: «sinRed»; un rechazo: su status", async () => {
    expect(await mandarALen(cliente(sinRed).c, { projectId: "p", prompt: "x" }, () => {})).toBe("sinRed");
    expect(await mandarALen(cliente(async () => new Response(null, { status: 503 })).c, { projectId: "p", prompt: "x" }, () => {})).toEqual({ status: 503 });
  });

  it("si la conexión se corta a media respuesta: «cortado» (el turno sigue en el servidor)", async () => {
    // Un trozo por lectura y el corte en la segunda: `error()` tira lo que siga
    // en cola sin leer, así que darlo en el mismo `start` perdería el primero.
    let lecturas = 0;
    const roto = new Response(
      new ReadableStream<Uint8Array>({
        pull(ctl) {
          if (lecturas++ === 0) ctl.enqueue(new TextEncoder().encode('event: turno\ndata: {"turnoId":"x"}\n\n'));
          else ctl.error(new Error("red"));
        },
      }),
    );
    const eventos: EventoSse[] = [];
    expect(await mandarALen(cliente(async () => roto).c, { projectId: "p", prompt: "x" }, (e) => eventos.push(e))).toBe("cortado");
    expect(eventos.map((e) => e.nombre)).toEqual(["turno"]);
  });
});

describe("dirigirA", () => {
  it("manda la corrección al turno y dice si llegó", async () => {
    const { c, pedir } = cliente(async () => Response.json({ ok: true }));
    expect(await dirigirA(c, "x1", "mejor verde")).toBe(true);
    expect(pedir.mock.calls[0]![0]).toBe("/api/agent/dirigir");
    expect(JSON.parse(String(pedir.mock.calls[0]![1]!.body))).toEqual({ turnoId: "x1", texto: "mejor verde" });
    expect(await dirigirA(cliente(async () => new Response(null, { status: 404 })).c, "x", "y")).toBe(false);
    expect(await dirigirA(cliente(sinRed).c, "x", "y")).toBe(false);
  });
});

describe("subirFoto", () => {
  it("sube el fichero y devuelve la dirección completa aunque la ruta conteste con una relativa", async () => {
    const { c, pedir } = cliente(async () => Response.json({ url: "/uploads/abc.jpg" }));
    expect(await subirFoto(c, "http://localhost:3007", new Blob(["x"], { type: "image/jpeg" }))).toBe("http://localhost:3007/uploads/abc.jpg");
    const form = pedir.mock.calls[0]![1]!.body as FormData;
    expect((form.get("file") as File).name).toBe("foto.jpg");
  });
  it("sin red lanza SinRed; un rechazo, un error", async () => {
    await expect(subirFoto(cliente(sinRed).c, "http://b", new Blob(["x"]))).rejects.toBeInstanceOf(SinRed);
    await expect(subirFoto(cliente(async () => new Response(null, { status: 413 })).c, "http://b", new Blob(["x"]))).rejects.toThrow("413");
  });
});

describe("transcribir", () => {
  const nota = { audio: new Blob(["x"], { type: "audio/webm" }), projectId: "p1", idioma: "es", segundos: 4.4 };
  it("manda el audio con su página, idioma y segundos, y devuelve el texto", async () => {
    const { c, pedir } = cliente(async () => Response.json({ texto: " Hola " }));
    expect(await transcribir(c, nota)).toEqual({ texto: "Hola" });
    const form = pedir.mock.calls[0]![1]!.body as FormData;
    expect(pedir.mock.calls[0]![0]).toBe("/api/voz/nota");
    expect(form.get("projectId")).toBe("p1");
    expect(form.get("idioma")).toBe("es");
    expect(form.get("segundos")).toBe("4");
  });
  it("tope del día, sin red, fallo o texto vacío", async () => {
    expect(await transcribir(cliente(async () => new Response(null, { status: 429 })).c, nota)).toEqual({ error: "tope" });
    expect(await transcribir(cliente(sinRed).c, nota)).toEqual({ error: "sinRed" });
    expect(await transcribir(cliente(async () => new Response(null, { status: 502 })).c, nota)).toEqual({ error: "fallo" });
    expect(await transcribir(cliente(async () => Response.json({ texto: "  " })).c, nota)).toEqual({ error: "fallo" });
  });
});
