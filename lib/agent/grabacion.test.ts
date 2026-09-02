import { describe, expect, it } from "vitest";
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { runAgentLoop, type AgentStreamEvent } from "./loop";
import {
  creaGrabadora,
  reproducir,
  reproducirCierre,
  directorioDeGrabacion,
  nombreDeFichero,
  FORMATO_GRABACION,
} from "./grabacion";

const done: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
const usage = (o: number): StreamEvent => ({
  type: "usage",
  inputTokens: 100,
  outputTokens: o,
  cachedTokens: 0,
  thinkingTokens: 0,
});

/** Un stream del modelo, como el que envuelve la grabadora. */
function stream(...evs: StreamEvent[]): AsyncIterable<StreamEvent> {
  return (async function* () {
    for (const ev of evs) yield ev;
  })();
}

const AHORA = () => new Date("2026-09-01T12:00:00Z");
const MENSAJES: Message[] = [
  { role: "system", content: "eres el agente" },
  { role: "user", content: "DOCUMENTO ACTUAL…" },
];

describe("la grabadora", () => {
  it("deja pasar los eventos SIN tocarlos — envolver no puede cambiar el turno", async () => {
    const g = creaGrabadora(MENSAJES, AHORA);
    const entrada: StreamEvent[] = [{ type: "text_delta", text: "hola" }, usage(3), done];
    const salida: StreamEvent[] = [];
    for await (const ev of g.envuelve(stream(...entrada))) salida.push(ev);
    expect(salida).toEqual(entrada);
    expect(g.resultado().turnos).toEqual([entrada]);
  });

  it("guarda el ARRANQUE del turno, no su estado final — el bucle muta el array", async () => {
    const mensajes: Message[] = [{ role: "user", content: "hola" }];
    const g = creaGrabadora(mensajes, AHORA);
    // Esto es lo que hace `runAgentLoop`: añadir respuestas de herramientas al
    // mismo array. Sin copia defensiva, la grabación no serviría para volver a
    // empezar el turno, que es su único propósito.
    mensajes.push({ role: "assistant", content: "ya lo hice" });
    expect(g.resultado().messages).toEqual([{ role: "user", content: "hola" }]);
  });

  it("una vuelta por llamada, en orden", async () => {
    const g = creaGrabadora(MENSAJES, AHORA);
    for await (const _ of g.envuelve(stream({ type: "text_delta", text: "a" }))) void _;
    for await (const _ of g.envuelve(stream({ type: "text_delta", text: "b" }, done))) void _;
    expect(g.resultado().turnos).toEqual([
      [{ type: "text_delta", text: "a" }],
      [{ type: "text_delta", text: "b" }, done],
    ]);
  });

  it("sabe si no grabó nada: un turno que revienta antes del primer evento no deja fixture", async () => {
    const g = creaGrabadora(MENSAJES, AHORA);
    expect(g.vacia).toBe(true);
    for await (const _ of g.envuelve(stream(done))) void _;
    expect(g.vacia).toBe(false);
  });
});

describe("ida y vuelta: grabar un turno y volver a correrlo sin modelo", () => {
  it("el replay da el MISMO resultado que el turno grabado", async () => {
    // 1. El turno "real": dos vueltas, una llamada a herramienta en medio.
    const vuelta1: StreamEvent[] = [
      { type: "function_call", name: "editar_pagina", args: { resumen: "titular" } },
      usage(20),
      done,
    ];
    const vuelta2: StreamEvent[] = [{ type: "text_delta", text: "Listo, cambié el titular." }, usage(9), done];

    const g = creaGrabadora(MENSAJES, AHORA);
    let i = 0;
    const eventosEnVivo: AgentStreamEvent[] = [];
    const enVivo = await runAgentLoop({
      messages: [...MENSAJES],
      tools: [],
      openStream: (m) => g.envuelve(i++ === 0 ? stream(...vuelta1) : stream(...vuelta2)),
      runTool: async () => ({ response: { ok: true }, updatedHtml: "<h1>nuevo</h1>", page: null }),
      emit: (e) => eventosEnVivo.push(e),
    });

    // 2. Se serializa y se vuelve a leer, como haría un fichero en disco.
    const grabado = JSON.parse(JSON.stringify(g.resultado({ modelId: "m", requestId: "r1" })));
    expect(grabado.formato).toBe(FORMATO_GRABACION);

    // 3. El replay: el MISMO `runAgentLoop`, sin tocar el modelo.
    const eventosReplay: AgentStreamEvent[] = [];
    const replay = await runAgentLoop({
      messages: grabado.messages,
      tools: [],
      openStream: reproducir(grabado),
      runTool: async () => ({ response: { ok: true }, updatedHtml: "<h1>nuevo</h1>", page: null }),
      emit: (e) => eventosReplay.push(e),
    });

    expect(replay.finalText).toBe(enVivo.finalText);
    expect(replay.toolCalls).toBe(enVivo.toolCalls);
    expect(replay.turns).toBe(enVivo.turns);
    expect(replay.usage).toEqual(enVivo.usage);
    expect(eventosReplay).toEqual(eventosEnVivo);
  });

  it("se QUEJA si el bucle pide más vueltas de las que hay: divergir en silencio es peor", async () => {
    const g = creaGrabadora(MENSAJES, AHORA);
    for await (const _ of g.envuelve(stream({ type: "function_call", name: "x", args: {} }, done))) void _;
    const abrir = reproducir(g.resultado());
    abrir([]); // la única vuelta grabada
    expect(() => abrir([])).toThrow(/divergió de lo grabado/);
  });

  it("rechaza un formato que no entiende en vez de leerlo a medias", () => {
    const g = creaGrabadora(MENSAJES, AHORA);
    const futuro = { ...g.resultado(), formato: FORMATO_GRABACION + 1 };
    expect(() => reproducir(futuro)).toThrow(/formato/);
  });

  it("el cierre va aparte y sólo si lo hubo", async () => {
    const g = creaGrabadora(MENSAJES, AHORA);
    expect(reproducirCierre(g.resultado())).toBeUndefined();
    for await (const _ of g.envuelveCierre(stream({ type: "text_delta", text: "me quedé sin cuerda" }))) void _;
    const abrir = reproducirCierre(g.resultado());
    expect(abrir).toBeDefined();
    const vistos: StreamEvent[] = [];
    for await (const ev of abrir!([])) vistos.push(ev);
    expect(vistos).toEqual([{ type: "text_delta", text: "me quedé sin cuerda" }]);
    // Y NO se cuela como una vuelta más del bucle.
    expect(g.resultado().turnos).toEqual([]);
  });
});

describe("la palanca y el nombre", () => {
  it("sin la variable no graba nada: es opt-in porque escribe el HTML del usuario al disco", () => {
    expect(directorioDeGrabacion({})).toBeNull();
    expect(directorioDeGrabacion({ OPENLEN_AGENT_RECORD_DIR: "  " })).toBeNull();
    expect(directorioDeGrabacion({ OPENLEN_AGENT_RECORD_DIR: "/tmp/t" })).toBe("/tmp/t");
  });

  it("el fichero es ordenable por tiempo y no deja pasar nada raro del requestId", () => {
    const g = creaGrabadora(MENSAJES, AHORA);
    expect(nombreDeFichero(g.resultado({ requestId: "abc-123" }))).toBe(
      "2026-09-01T12-00-00-000Z-abc-123.json",
    );
    expect(nombreDeFichero(g.resultado({ requestId: "../../etc/passwd" }))).toBe(
      "2026-09-01T12-00-00-000Z-etcpasswd.json",
    );
    expect(nombreDeFichero(g.resultado())).toBe("2026-09-01T12-00-00-000Z-turno.json");
  });
});
