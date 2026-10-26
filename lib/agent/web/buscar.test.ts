// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/style-match/scrape/fetch-raw", () => ({ fetchRaw: vi.fn() }));

import { buscarEnExa, ErrorDeLaWeb, fuentesDeExa, visitRealSite, webDelServidor } from "./buscar";
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
    // The fixed web of a case has no browser: a visit to another site says so.
    expect(await web.visit("p1", "https://museo.example/", [{ screenshot: "screen" }], "desktop")).toEqual({
      ok: false,
      error: "opening other sites in a browser is not available here; read the page with web_fetch",
    });
    await web.cobrar("u1", 3);
    expect(debit).not.toHaveBeenCalled();
    expect(red).not.toHaveBeenCalled();
    red.mockRestore();
  });

  it("fuera de Len-Bench, lo buscado se cobra: 1,5 créditos por consulta", async () => {
    delete process.env.OPENLEN_WEB_DE_PRUEBA_DIR;
    const debit = vi.fn(async () => undefined);
    await webDelServidor(debit).cobrar("u1", 3);
    // Con su uso, para el libro de gasto: Exa, tres consultas.
    expect(debit).toHaveBeenCalledWith("u1", 450, { provider: "exa", model: "search", queries: 3 });
  });
});

// ANOTHER SITE, USED (26/10): `use_page` and `view_page` with `url`. The visit
// runs in the eyes' browser (lib/agent/usar-pagina.ts, `visitAnotherSite`);
// this is the door in front of it: the address is checked before anything
// opens, and what can't be opened is said without detail.
describe("visitRealSite — the door to another site", () => {
  const PASOS = [{ click: "Pricing" }, { screenshot: "screen" }] as const;
  const visitor = (r: { informe: string; images?: { mimeType: string; dataBase64: string }[] } | Error) =>
    vi.fn(async () => {
      if (r instanceof Error) throw r;
      return r;
    });

  it("a public address opens with its steps and its size, and the visit's report comes back", async () => {
    const v = visitor({ informe: "Visit to https://linear.app/ …", images: [{ mimeType: "image/jpeg", dataBase64: "JPEG" }] });
    const ok = async () => ({ ok: true as const, value: { url: new URL("https://linear.app/"), hostname: "linear.app" } });
    expect(await visitRealSite("https://linear.app", [...PASOS], "mobile", { validate: ok as never, visit: v })).toEqual({
      ok: true,
      report: "Visit to https://linear.app/ …",
      images: [{ mimeType: "image/jpeg", dataBase64: "JPEG" }],
    });
    expect(v).toHaveBeenCalledWith({ url: "https://linear.app/", pasos: [...PASOS], viewport: "mobile" });
  });

  it("🔴 an address that is not a public website is refused before any browser opens, without saying what is behind it", async () => {
    const v = visitor({ informe: "no" });
    const blocked = async () => ({ ok: false as const, error: { kind: "ssrf-blocked" as const, reason: "resolves to 10.0.0.5" } });
    const r = await visitRealSite("http://intranet.local", [...PASOS], "desktop", { validate: blocked as never, visit: v });
    expect(r).toEqual({ ok: false, error: "that address is not a public website and cannot be read" });
    expect(JSON.stringify(r)).not.toContain("10.0.0.5");
    expect(v).not.toHaveBeenCalled();
  });

  it("a browser that can't open the site says so, and doesn't pass it off as working or not", async () => {
    const ok = async () => ({ ok: true as const, value: { url: new URL("https://x.example/"), hostname: "x.example" } });
    expect(await visitRealSite("https://x.example", [...PASOS], "desktop", { validate: ok as never, visit: visitor(new Error("net::ERR_NAME_NOT_RESOLVED")) })).toEqual({
      ok: false,
      error: "the site couldn't be opened in the browser this time (net::ERR_NAME_NOT_RESOLVED).",
    });
  });
});
