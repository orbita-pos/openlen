import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGeneration, type GenerationState } from "./use-generation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 🔴 EL DEFECTO QUE ESTE ARCHIVO CIERRA (hallazgo 10, mitad cliente).
//
// El bucle de lectura salía por `done` y no exigía haber visto un evento
// terminal. Una 200 que se cierra limpiamente sin `project_saved` ni `error`
// —un proceso que muere, un proxy que corta, una excepción del servidor
// después de abrir el stream— dejaba el estado en `generating` PARA SIEMPRE:
// el watchdog ya está apagado a esas alturas, así que no queda nada que saque
// al usuario de ahí. Spinner eterno; sólo se sale recargando.

let ultimo: GenerationState = { kind: "idle" };
let generar: ((brief: string) => Promise<void>) | null = null;

function Sonda() {
  const { state, generate } = useGeneration();
  ultimo = state;
  generar = generate;
  return null;
}

function sse(...eventos: string[]): Response {
  const cuerpo = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const e of eventos) controller.enqueue(enc.encode(e));
      controller.close();
    },
  });
  return new Response(cuerpo, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function montarYGenerar(respuesta: Response): Promise<void> {
  vi.stubGlobal("fetch", vi.fn(async () => respuesta));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(Sonda));
  });
  await act(async () => {
    await generar!("una landing para una cafetería de barrio");
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  ultimo = { kind: "idle" };
  generar = null;
  vi.unstubAllGlobals();
});

describe("useGeneration — EOF sin evento terminal", () => {
  it("un stream que se cierra sin terminar NO deja el spinner girando", async () => {
    await montarYGenerar(
      sse(
        'event: progress\ndata: {"chars":0}\n\n',
        'event: html_chunk\ndata: {"text":"<!doctype html><html>"}\n\n',
      ),
    );

    expect(ultimo.kind).toBe("error");
    expect(ultimo.kind === "error" && ultimo.message).toMatch(/se cerró antes de terminar/);
  });

  it("ni siquiera cuando el servidor no manda absolutamente nada", async () => {
    await montarYGenerar(sse());

    expect(ultimo.kind).toBe("error");
  });

  // CONTROL: sin esto, «siempre error al cerrar» pasaría las dos de arriba y
  // rompería todas las generaciones buenas.
  it("un turno que SÍ termina bien queda en done, no en error", async () => {
    await montarYGenerar(
      sse(
        'event: html_chunk\ndata: {"text":"<!doctype html>"}\n\n',
        'event: project_saved\ndata: {"projectId":"p1","title":"Café Luna"}\n\n',
      ),
    );

    expect(ultimo).toEqual({ kind: "done", projectId: "p1", title: "Café Luna" });
  });

  it("y un error del servidor sigue siendo ESE error, no el genérico de cierre", async () => {
    await montarYGenerar(
      sse('event: error\ndata: {"message":"El modelo tuvo un problema"}\n\n'),
    );

    expect(ultimo).toEqual({ kind: "error", message: "El modelo tuvo un problema" });
  });
});
