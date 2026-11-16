// lib/len-bench/sesion.test.ts
// @vitest-environment node
//
// Sin `fetch` simulado: eso sólo comprobaría que el simulacro contesta lo que
// se le dijo. La ida y vuelta al servidor la prueba el humo de Len-Bench. Aquí
// se prueba lo que NO necesita servidor: que la cookie la abre el `decode`
// real de Auth.js, y que el nombre y el secreto salen como los saca Auth.js.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { decode } from "next-auth/jwt";
import { afterEach, describe, expect, it } from "vitest";
import { BenchClockError, acunarCookie, enviarTurno, herramientasDeLen, nombreDeCookie, secretoDeAuth, tarjetaDePublicar, textoDeLen, tocarPublicar } from "./sesion";

const SECRETO = "secreto-de-prueba-de-treinta-y-dos-bytes";

function partir(cookie: string): { nombre: string; token: string } {
  const i = cookie.indexOf("=");
  return { nombre: cookie.slice(0, i), token: cookie.slice(i + 1) };
}

describe("nombreDeCookie", () => {
  it("sin AUTH_URL ni NEXTAUTH_URL, en http, va sin prefijo: Next pone x-forwarded-proto=http", () => {
    expect(nombreDeCookie({})).toBe("authjs.session-token");
    expect(nombreDeCookie({ NEXTAUTH_URL: "http://127.0.0.1:3007" })).toBe("authjs.session-token");
  });
  it("con AUTH_URL o NEXTAUTH_URL en https, Auth.js reescribe la petición a https y espera la __Secure-", () => {
    expect(nombreDeCookie({ NEXTAUTH_URL: "https://openlen.com" })).toBe("__Secure-authjs.session-token");
    expect(nombreDeCookie({ AUTH_URL: "https://openlen.com", NEXTAUTH_URL: "http://127.0.0.1:3007" })).toBe(
      "__Secure-authjs.session-token",
    );
  });
});

describe("secretoDeAuth", () => {
  it("AUTH_SECRET antes que NEXTAUTH_SECRET, como `setEnvDefaults` de next-auth", () => {
    expect(secretoDeAuth({ AUTH_SECRET: "a", NEXTAUTH_SECRET: "b" })).toBe("a");
    expect(secretoDeAuth({ NEXTAUTH_SECRET: "b" })).toBe("b");
  });
  it("sin ninguno lo dice, en vez de firmar con nada", () => {
    expect(() => secretoDeAuth({})).toThrow(/NEXTAUTH_SECRET/);
  });
});

describe("acunarCookie", () => {
  it("el decode de Auth.js la abre con el mismo secreto y la sal = el nombre de la cookie, y lleva el id", async () => {
    const { nombre, token } = partir(
      await acunarCookie({ userId: "u-1", email: "eval@x.test", entorno: { NEXTAUTH_SECRET: SECRETO } }),
    );
    expect(nombre).toBe("authjs.session-token");
    const t = await decode({ token, secret: SECRETO, salt: nombre });
    expect(t?.sub).toBe("u-1");
  });
  it("con otro secreto NO se abre: la prueba de arriba no pasa por casualidad", async () => {
    const { nombre, token } = partir(
      await acunarCookie({ userId: "u-1", email: "eval@x.test", entorno: { NEXTAUTH_SECRET: SECRETO } }),
    );
    await expect(decode({ token, secret: "otro-secreto-de-treinta-y-dos-bytes!!", salt: nombre })).rejects.toThrow();
  });
});

describe("textoDeLen", () => {
  it("suma los eventos `text` en orden e ignora los demás", () => {
    expect(
      textoDeLen([
        { nombre: "text", datos: { type: "text", text: "Ho" } },
        { nombre: "action", datos: { type: "action", tool: "editar_texto" } },
        { nombre: "text", datos: { type: "text", text: "la" } },
      ]),
    ).toBe("Hola");
  });

  it("un `retry` retira lo que el intento fallido llegó a escribir (no se puntúa lo descartado)", () => {
    expect(
      textoDeLen([
        { nombre: "text", datos: { type: "text", text: "Miro. " } },
        { nombre: "text", datos: { type: "text", text: "Ya v" } },
        { nombre: "retry", datos: { type: "retry", attempt: 1, maxAttempts: 5, delayMs: 500, discardChars: 4 } },
        { nombre: "text", datos: { type: "text", text: "Ya está." } },
      ]),
    ).toBe("Miro. Ya está.");
  });

  it("una `compaction` con descarte también retira lo del intento (desborde a media vuelta)", () => {
    expect(
      textoDeLen([
        { nombre: "text", datos: { type: "text", text: "Miro. " } },
        { nombre: "text", datos: { type: "text", text: "Ya v" } },
        { nombre: "compaction", datos: { type: "compaction", pruned: 0, summarized: true, discardChars: 4 } },
        { nombre: "text", datos: { type: "text", text: "Ya está." } },
      ]),
    ).toBe("Miro. Ya está.");
  });
});

describe("herramientasDeLen", () => {
  it("el `tool` de los eventos `action`, una vez cada una y en el orden en que empezó", () => {
    expect(
      herramientasDeLen([
        { nombre: "action", datos: { type: "action", tool: "list_messages", status: "running" } },
        { nombre: "text", datos: { type: "text", text: "Juan te escribió" } },
        { nombre: "action", datos: { type: "action", tool: "list_messages", status: "done" } },
        { nombre: "action", datos: { type: "action", tool: "draft_reply", status: "running" } },
        { nombre: "confirm", datos: { type: "confirm", action: "responder", tool: "no-es-una-accion" } },
      ]),
    ).toEqual(["list_messages", "draft_reply"]);
  });
  it("una grabación de antes del 2026-10-06 sale con los nombres de hoy, y puntúa igual", () => {
    expect(
      herramientasDeLen([
        { nombre: "action", datos: { type: "action", tool: "ver_mensajes", status: "running" } },
        { nombre: "action", datos: { type: "action", tool: "list_messages", status: "done" } },
        { nombre: "action", datos: { type: "action", tool: "preparar_respuesta", status: "running" } },
      ]),
    ).toEqual(["list_messages", "draft_reply"]);
  });
});

describe("tarjetaDePublicar", () => {
  it("lee la tarjeta de publicar que Len dejó en el turno (la última)", () => {
    expect(
      tarjetaDePublicar([
        { nombre: "text", datos: { type: "text", text: "toca Publicar" } },
        { nombre: "confirm", datos: { type: "confirm", action: "publish", subdominio: "robleyluz", idiomas: [], republicar: false } },
      ]),
    ).toEqual({ subdominio: "robleyluz", idiomas: [], republicar: false });
  });
  it("y la de una grabación de antes, con «publicar», también", () => {
    expect(
      tarjetaDePublicar([
        { nombre: "confirm", datos: { type: "confirm", action: "publicar", subdominio: "robleyluz", idiomas: [], republicar: false } },
      ]),
    ).toEqual({ subdominio: "robleyluz", idiomas: [], republicar: false });
  });
  it("sin tarjeta de publicar, nada que tocar", () => {
    expect(tarjetaDePublicar([{ nombre: "text", datos: { type: "text", text: "ya quedó publicada" } }])).toBeNull();
  });
});

describe("tocarPublicar — lo mismo que hace agent-confirm-card.tsx al tocarla", () => {
  function red(respuestas: Record<string, { status: number; json: unknown }>) {
    const llamadas: { url: string; body: unknown }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      llamadas.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
      const r = respuestas[new URL(url).pathname];
      return new Response(JSON.stringify(r.json), { status: r.status });
    }) as typeof fetch;
    return { f, llamadas };
  }
  const base = "http://localhost:3007";

  it("un subdominio nuevo: primero mira si está libre, luego publica (sin `languages` si no hay idiomas)", async () => {
    const { f, llamadas } = red({
      "/api/subdomains/check": { status: 200, json: { available: true } },
      "/api/projects/p1/publish": { status: 200, json: { url: "https://robleyluz.openlen.app" } },
    });
    const r = await tocarPublicar({ base, cookie: "c", projectId: "p1", tarjeta: { subdominio: "robleyluz", idiomas: [], republicar: false }, fetch: f });
    expect(r).toEqual({ ok: true });
    expect(llamadas).toEqual([
      { url: `${base}/api/subdomains/check`, body: { subdomain: "robleyluz" } },
      { url: `${base}/api/projects/p1/publish`, body: { subdomain: "robleyluz" } },
    ]);
  });
  it("re-publicar el suyo se salta la comprobación y manda los idiomas si los hay", async () => {
    const { f, llamadas } = red({ "/api/projects/p1/publish": { status: 200, json: {} } });
    await tocarPublicar({ base, cookie: "c", projectId: "p1", tarjeta: { subdominio: "robleyluz", idiomas: ["en"], republicar: true }, fetch: f });
    expect(llamadas).toEqual([{ url: `${base}/api/projects/p1/publish`, body: { subdomain: "robleyluz", languages: ["en"] } }]);
  });
  it("si el nombre está ocupado no publica, y dice por qué", async () => {
    const { f, llamadas } = red({ "/api/subdomains/check": { status: 200, json: { available: false, reason: "taken" } } });
    const r = await tocarPublicar({ base, cookie: "c", projectId: "p1", tarjeta: { subdominio: "x", idiomas: [], republicar: false }, fetch: f });
    expect(r).toEqual({ ok: false, motivo: "subdominio no disponible: taken" });
    expect(llamadas).toHaveLength(1);
  });
});

// 🔴 La pregunta DENTRO del turno, como el panel (Len 2.5, pieza 3): la ruta sólo
// espera si el cuerpo lleva `answersQuestions: true`, emite `question` y la
// respuesta entra por `POST /api/agent/responder` mientras el turno sigue abierto.
// Un servidor HTTP de verdad en 127.0.0.1 que se comporta así: el SSE no se
// cierra hasta que llega la respuesta.
describe("enviarTurno — contesta la pregunta mientras el turno espera", () => {
  let servidor: http.Server | null = null;
  afterEach(async () => {
    await new Promise<void>((r) => (servidor ? servidor.close(() => r()) : r()));
    servidor = null;
  });

  async function rutaQuePregunta(o: { responderStatus: number }) {
    const recibido: { turno?: Record<string, unknown>; respuesta?: unknown; descartes: unknown[] } = { descartes: [] };
    let alResponder: (() => void) | null = null;
    servidor = http.createServer((req, res) => {
      let cuerpo = "";
      req.on("data", (c) => (cuerpo += c));
      req.on("end", () => {
        if (req.url === "/api/agent/responder") {
          const b = JSON.parse(cuerpo) as { dismiss?: unknown };
          // Un descarte suelta la espera, como `dismissQuestion` en la ruta.
          if (b.dismiss === true) {
            recibido.descartes.push(b);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            alResponder?.();
            return;
          }
          recibido.respuesta = b;
          res.writeHead(o.responderStatus, { "content-type": "application/json" });
          res.end(JSON.stringify(o.responderStatus === 200 ? { ok: true } : { error: o.responderStatus === 409 ? "sin_pregunta" : "respuesta_invalida" }));
          // Con 200 la herramienta sigue; con 409 ya nadie esperaba; con 400 la ruta SIGUE esperando.
          if (o.responderStatus !== 400) alResponder?.();
          return;
        }
        recibido.turno = JSON.parse(cuerpo);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: turno\ndata: ${JSON.stringify({ type: "turno", turnoId: "t1" })}\n\n`);
        res.write(`event: question\ndata: ${JSON.stringify({ type: "question", questions: [{ id: "q1", question: "¿Qué dirección?" }] })}\n\n`);
        // La herramienta espera: el SSE sigue abierto hasta que llega la respuesta.
        alResponder = () => {
          res.write(`event: text\ndata: ${JSON.stringify({ type: "text", text: "Publico en esa." })}\n\n`);
          res.end();
        };
      });
    });
    await new Promise<void>((r) => servidor!.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(servidor!.address() as AddressInfo).port}`;
    return { base, recibido };
  }

  const cuerpo = { projectId: "p1", prompt: "publícala", turnId: "00000000-0000-4000-8000-000000000001", history: [], esfuerzo: "auto" };

  it("manda answersQuestions, contesta por /api/agent/responder y sigue leyendo el turno", async () => {
    const { base, recibido } = await rutaQuePregunta({ responderStatus: 200 });
    const eventos = await enviarTurno({
      base,
      cookie: "c",
      cuerpo,
      timeoutMs: 5_000,
      onQuestion: (q) => q.questions.map((p) => ({ id: p.id, selected: [], custom: "FICHA" })),
    });
    expect(recibido.turno?.answersQuestions).toBe(true);
    expect(recibido.respuesta).toEqual({ turnoId: "t1", answers: [{ id: "q1", selected: [], custom: "FICHA" }] });
    expect(textoDeLen(eventos)).toBe("Publico en esa.");
    expect(eventos.find((e) => e.nombre === "bench_answer")?.datos).toEqual({ ok: true, status: 200 });
  });

  it("si nadie espera ya (409), lo anota y el turno no se corta", async () => {
    const { base } = await rutaQuePregunta({ responderStatus: 409 });
    const eventos = await enviarTurno({
      base,
      cookie: "c",
      cuerpo,
      timeoutMs: 5_000,
      onQuestion: (q) => q.questions.map((p) => ({ id: p.id, selected: [], custom: "FICHA" })),
    });
    expect(eventos.find((e) => e.nombre === "bench_answer")?.datos).toEqual({ ok: false, status: 409 });
    expect(textoDeLen(eventos)).toBe("Publico en esa.");
  });

  it("si la ruta rechaza la respuesta (400), descarta la pregunta para que el turno no espere 120 s (revisión I5)", async () => {
    const { base, recibido } = await rutaQuePregunta({ responderStatus: 400 });
    const eventos = await enviarTurno({
      base,
      cookie: "c",
      cuerpo,
      timeoutMs: 5_000,
      onQuestion: (q) => q.questions.map((p) => ({ id: p.id, selected: [], custom: "FICHA" })),
    });
    expect(recibido.descartes).toEqual([{ turnoId: "t1", dismiss: true }]);
    expect(eventos.find((e) => e.nombre === "bench_answer")?.datos).toEqual({ ok: false, status: 400, dismissed: true });
  });

  it("sin manejador de preguntas, el cuerpo va como antes (sin answersQuestions)", async () => {
    servidor = http.createServer((req, res) => {
      let c = "";
      req.on("data", (x) => (c += x));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`event: text\ndata: ${JSON.stringify({ type: "text", text: JSON.stringify(JSON.parse(c).answersQuestions ?? null) })}\n\n`);
      });
    });
    await new Promise<void>((r) => servidor!.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(servidor!.address() as AddressInfo).port}`;
    expect(textoDeLen(await enviarTurno({ base, cookie: "c", cuerpo, timeoutMs: 5_000 }))).toBe("null");
  });
});

// 16/11 (battery 1 of Len 3.1): the bench's own turn clock cut 13 runs at 20 min and they were counted as Len's
// errors — «This operation was aborted» fell in the conductor's catch-all. In production nothing cuts a turn that
// is working (only a 180 s silence watchdog), so a cut by this clock is the bench's, said with its own error.
describe("enviarTurno — the bench's clock", () => {
  let servidor: http.Server | null = null;
  afterEach(async () => {
    servidor?.closeAllConnections();
    await new Promise<void>((r) => (servidor ? servidor.close(() => r()) : r()));
    servidor = null;
  });

  it("🔴 a turn still working when the clock runs out: asks the route to stop and throws BenchClockError", async () => {
    const cancelled: unknown[] = [];
    servidor = http.createServer((req, res) => {
      let c = "";
      req.on("data", (x) => (c += x));
      req.on("end", () => {
        if (req.url === "/api/agent/cancelar") {
          cancelled.push(JSON.parse(c));
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: turno\ndata: ${JSON.stringify({ type: "turno", turnoId: "t1" })}\n\n`);
        // Len keeps working: the stream never ends on its own.
      });
    });
    await new Promise<void>((r) => servidor!.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(servidor!.address() as AddressInfo).port}`;
    const cuerpo = { projectId: "p1", prompt: "hazla", turnId: "00000000-0000-4000-8000-000000000002", history: [], esfuerzo: "auto" };
    const sent = enviarTurno({ base, cookie: "c", cuerpo, timeoutMs: 300 });
    await expect(sent).rejects.toBeInstanceOf(BenchClockError);
    expect(cancelled).toEqual([{ turnoId: "t1" }]);
  });
});
