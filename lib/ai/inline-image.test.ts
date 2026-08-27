import { afterEach, describe, expect, it, vi } from "vitest";

import { esGritoDeLaPagina, fetchImageAsInlineData } from "./inline-image";

// 🔴 EL DEFECTO QUE ESTE ARCHIVO CIERRA (hallazgo 12).
//
// El tope de 4 MB se aplicaba DESPUÉS de `await res.arrayBuffer()`: una URL
// pública que sirviera 2 GB reservaba 2 GB de memoria y sólo entonces se
// descubría que sobraba. Y no había plazo: `fetch` no trae timeout, así que un
// servidor que acepta la conexión y no manda nunca el cuerpo dejaba la petición
// colgada — y el Agente hace esto ANTES de abrir el SSE, o sea que el usuario
// se queda mirando la nada. La firma aceptaba un `signal` que ningún llamador
// pasaba.

const PNG = new Uint8Array([137, 80, 78, 71]);

function cabeceras(pares: Record<string, string | null>): Headers {
  return {
    get: (k: string) => pares[k.toLowerCase()] ?? null,
  } as unknown as Headers;
}

/** Respuesta falsa que SÓLO se puede leer por stream: `arrayBuffer` lanza, así
 *  que si alguien vuelve al camino de materializar entero, se entera. */
function respuesta(opts: {
  chunks: Uint8Array[];
  contentLength?: string;
  contentType?: string;
  onCancel?: () => void;
  onRead?: (i: number) => void;
}): Response {
  let i = 0;
  let cancelado = false;
  return {
    ok: true,
    status: 200,
    headers: cabeceras({
      "content-type": opts.contentType ?? "image/png",
      "content-length": opts.contentLength ?? null,
    }),
    body: {
      getReader: () => ({
        read: async () => {
          if (cancelado || i >= opts.chunks.length) {
            return { done: true, value: undefined };
          }
          opts.onRead?.(i);
          return { done: false, value: opts.chunks[i++]! };
        },
        cancel: async () => {
          cancelado = true;
          opts.onCancel?.();
        },
      }),
    },
    arrayBuffer: async () => {
      throw new Error("arrayBuffer() no debe usarse: el cuerpo se lee por trozos");
    },
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchImageAsInlineData — el tope se aplica ANTES de gastar memoria", () => {
  it("un Content-Length que ya se pasa se rechaza sin descargar un byte", async () => {
    let leidos = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuesta({
          chunks: [new Uint8Array(1024)],
          contentLength: String(9 * 1024 * 1024),
          onRead: () => { leidos += 1; },
        }),
      ),
    );

    await expect(fetchImageAsInlineData("https://x.test/a.png")).resolves.toBeNull();
    expect(leidos).toBe(0);
  });

  it("sin Content-Length, corta el stream en cuanto se pasa y cancela el resto", async () => {
    let cancelado = false;
    let leidos = 0;
    // Cuatro trozos de 2 MB: con el tope en 4 MB, el tercero ya sobra. El
    // cuarto no se lee nunca — eso es lo que separa cortar de medir al final.
    const chunks = [0, 1, 2, 3].map(() => new Uint8Array(2 * 1024 * 1024));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuesta({
          chunks,
          onCancel: () => { cancelado = true; },
          onRead: () => { leidos += 1; },
        }),
      ),
    );

    await expect(fetchImageAsInlineData("https://x.test/a.png")).resolves.toBeNull();
    expect(cancelado).toBe(true);
    expect(leidos).toBe(3);
  });

  it("una imagen normal sigue llegando entera", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta({ chunks: [PNG] })));

    await expect(fetchImageAsInlineData("https://x.test/a.png")).resolves.toEqual({
      mimeType: "image/png",
      dataBase64: Buffer.from(PNG).toString("base64"),
    });
  });

  it("un cuerpo vacío no se manda al modelo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta({ chunks: [] })));

    await expect(fetchImageAsInlineData("https://x.test/a.png")).resolves.toBeNull();
  });
});

describe("fetchImageAsInlineData — hay un plazo", () => {
  it("un servidor que nunca contesta no cuelga la petición", async () => {
    let abortada = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              abortada = true;
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );

    const empezo = Date.now();
    await expect(
      fetchImageAsInlineData("https://x.test/lento.png", { timeoutMs: 80 }),
    ).resolves.toBeNull();
    expect(abortada).toBe(true);
    expect(Date.now() - empezo).toBeLessThan(3_000);
  });

  it("la señal de quien llama también aborta — antes era un parámetro muerto", async () => {
    let abortada = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              abortada = true;
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );

    const propia = new AbortController();
    const p = fetchImageAsInlineData("https://x.test/lento.png", {
      signal: propia.signal,
      timeoutMs: 60_000,
    });
    propia.abort();

    await expect(p).resolves.toBeNull();
    expect(abortada).toBe(true);
  });
});

// ─── Un recurso que no carga no es «el JavaScript falla» ─────────────────────
//
// Lo que sale de aquí se le entrega al modelo bajo esa frase LITERAL, y encima
// forzando broken=true sin consultar a nadie (`conHechos`, lib/agent/verify.ts).
//
// MEDIDO el 2026-08-27: Jesús adjuntó una foto suya, en dev su URL es localhost
// (no hay R2), el guardia SSRF la cortó —correctamente— y Chromium gritó
// `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT`. Eso llegó al Agente
// como «El JavaScript de la página falla», fue a buscar culpable, encontró el
// <img> y BORRÓ la foto del dueño. Ni era JavaScript, ni estaba rota.

describe("qué error de consola cuenta como un grito de la página", () => {
  it("el recurso que el guardia SSRF cortó, NO", () => {
    expect(
      esGritoDeLaPagina("Failed to load resource: net::ERR_BLOCKED_BY_CLIENT"),
      "el bloqueo de nuestro propio guardia vuelve a contarse como JavaScript roto",
    ).toBe(false);
  });

  it("ni un 404 ni un fallo de red — son hechos distintos que hoy no medimos", () => {
    expect(esGritoDeLaPagina("Failed to load resource: the server responded with a status of 404")).toBe(false);
    expect(esGritoDeLaPagina("Failed to load resource: net::ERR_NAME_NOT_RESOLVED")).toBe(false);
  });

  /**
   * Y LO QUE SÍ ES DE LA PÁGINA SIGUE PASANDO. Sin esto el filtro sería un
   * silenciador: los ojos volverían a aprobar páginas cuyo JavaScript murió al
   * cargar, que es el defecto que este canal existe para cazar.
   */
  it("pero una excepción del código del modelo SÍ", () => {
    expect(esGritoDeLaPagina("Uncaught TypeError: Cannot read properties of null")).toBe(true);
    expect(esGritoDeLaPagina("Uncaught ReferenceError: cart is not defined")).toBe(true);
    expect(esGritoDeLaPagina("Assignment to constant variable.")).toBe(true);
  });

  it("y un mensaje que sólo MENCIONA la frase, también — el corte es al principio", () => {
    // Un script que hace console.error("... failed to load resource ...") está
    // hablando, no fallando la red. El anclaje evita callarlo.
    expect(esGritoDeLaPagina("mi script dice: failed to load resource")).toBe(true);
  });
});
