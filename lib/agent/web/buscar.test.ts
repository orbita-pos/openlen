// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/style-match/scrape/fetch-raw", () => ({ fetchRaw: vi.fn() }));

import { buscarEnExa, ErrorDeLaWeb, fuentesDeExa, webDelServidor } from "./buscar";
import { webASerializable } from "@/lib/len-bench/web-sustituta";

const senal = () => new AbortController().signal;

describe("Exa — lo que se le manda y cómo se lee lo que devuelve", () => {
  it("una fuente necesita un fragmento de verdad; la fecha, como AAAA-MM-DD", () => {
    expect(
      fuentesDeExa({
        results: [
          { url: "https://a.example", title: "A", highlights: ["  Abre de 10   a 18. "], publishedDate: "2026-09-30T10:00:00.000Z" },
          { url: "https://b.example", title: "B", highlights: ["", " "] },
          { url: "https://c.example", highlights: ["sin título"] },
          { title: "sin url", highlights: ["x"] },
        ],
      }),
    ).toEqual([
      { titulo: "A", url: "https://a.example", fragmento: "Abre de 10 a 18.", fecha: "2026-09-30" },
      { titulo: "https://c.example", url: "https://c.example", fragmento: "sin título" },
    ]);
  });

  it("POST /search con su clave, sin seguir redirecciones, con un resaltado por fuente", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [] })));
    await buscarEnExa("clave", "museo del mar horario", 8, senal(), fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.exa.ai/search");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer clave");
    expect(JSON.parse(String(init.body))).toEqual({
      query: "museo del mar horario",
      type: "auto",
      numResults: 8,
      contents: { highlights: { highlightsPerUrl: 1 } },
    });
  });

  it("un fallo del servicio es un ErrorDeLaWeb con su motivo", async () => {
    const http = vi.fn(async () => new Response("no", { status: 429 }));
    await expect(buscarEnExa("k", "q", 8, senal(), http as unknown as typeof fetch)).rejects.toThrow(new ErrorDeLaWeb("the search service answered HTTP 429"));
    const roto = vi.fn(async () => new Response("<html>"));
    await expect(buscarEnExa("k", "q", 8, senal(), roto as unknown as typeof fetch)).rejects.toThrow(/unreadable answer/);
  });
});

describe("webDelServidor — de dónde sale la web", () => {
  const antes = { ...process.env };
  afterEach(() => {
    process.env = { ...antes };
  });

  it("sin clave de Exa, buscar falla con un error que el modelo puede leer", async () => {
    delete process.env.OPENLEN_WEB_DE_PRUEBA_DIR;
    delete process.env.EXA_API_KEY;
    await expect(webDelServidor(async () => undefined).buscar("p", "q", 8, senal())).rejects.toThrow(/not available on this server/);
  });

  it("🔴 en Len-Bench, la web fija del caso: ni una petición a la red, y no se cobra", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-de-prueba-"));
    fs.writeFileSync(
      path.join(dir, "p1.json"),
      JSON.stringify(
        webASerializable({
          busquedas: [{ si: /museo/i, resultados: [{ titulo: "Museo del Mar", url: "https://museo.example/", fragmento: "Horario de verano" }] }],
          paginas: { "https://museo.example/": "<h1>Horario</h1>" },
        }),
      ),
    );
    process.env.OPENLEN_WEB_DE_PRUEBA_DIR = dir;
    process.env.EXA_API_KEY = "no-se-usa";
    const red = vi.spyOn(globalThis, "fetch");
    const debit = vi.fn(async () => undefined);
    const web = webDelServidor(debit);
    expect(await web.buscar("p1", "horario del MUSEO", 8, senal())).toEqual([
      { titulo: "Museo del Mar", url: "https://museo.example/", fragmento: "Horario de verano" },
    ]);
    expect(await web.buscar("p1", "otra cosa", 8, senal())).toEqual([]);
    expect(await web.leer("p1", "https://www.museo.example")).toEqual({ ok: true, url: "https://www.museo.example", html: "<h1>Horario</h1>" });
    expect(await web.leer("p1", "https://museo.example/no")).toEqual({ ok: false, error: "the page does not exist (HTTP 404)" });
    // Otro proyecto, sin fichero: una web vacía.
    expect(await web.buscar("p2", "museo", 8, senal())).toEqual([]);
    await web.cobrar("u1", 3);
    expect(debit).not.toHaveBeenCalled();
    expect(red).not.toHaveBeenCalled();
    red.mockRestore();
  });

  it("fuera de Len-Bench, lo buscado se cobra: 1,5 créditos por consulta", async () => {
    delete process.env.OPENLEN_WEB_DE_PRUEBA_DIR;
    const debit = vi.fn(async () => undefined);
    await webDelServidor(debit).cobrar("u1", 3);
    expect(debit).toHaveBeenCalledWith("u1", 450);
  });
});
