// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/style-match/scrape/fetch-raw", () => ({ fetchRaw: vi.fn() }));
vi.mock("@/lib/style-match/scrape/fetch-puppeteer", () => ({ fetchPuppeteer: vi.fn() }));

import { buscarEnExa, screenshotRealSite, ErrorDeLaWeb, fuentesDeExa, webDelServidor } from "./buscar";
import type { fetchPuppeteer } from "@/lib/style-match/scrape/fetch-puppeteer";
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
    // The fixed web of a case has no browser: a screenshot of another site says so.
    expect(await web.screenshot("p1", "https://museo.example/", "desktop")).toEqual({
      ok: false,
      error: "screenshots of other sites are not available here; read the page with web_fetch",
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

// ANOTHER SITE, SEEN (26/10): `view_page` with `url`. The browser is the one the
// "make one like this" chip used (`fetchPuppeteer`: the address checked on every
// redirect, its traffic through the filtering proxy, no server secrets in its
// environment); this only turns its answer into what Len reads.
describe("screenshotRealSite — a screenshot of another site", () => {
  const fetcher = (r: Awaited<ReturnType<typeof fetchPuppeteer>>) => vi.fn(async () => r) as unknown as typeof fetchPuppeteer & ReturnType<typeof vi.fn>;
  const rendered = (finalUrl: string, screenshot?: Buffer) =>
    ({ ok: true, value: { url: finalUrl, finalUrl, screenshot } }) as unknown as Awaited<ReturnType<typeof fetchPuppeteer>>;

  it("comes back as a JPEG image, at the size asked for: 1440×900 on a desktop, 390×844 on a phone", async () => {
    const f = fetcher(rendered("https://linear.app/", Buffer.from("jpeg-bytes")));
    expect(await screenshotRealSite("https://linear.app", "desktop", f)).toEqual({
      ok: true,
      url: "https://linear.app/",
      image: { mimeType: "image/jpeg", dataBase64: Buffer.from("jpeg-bytes").toString("base64") },
    });
    await screenshotRealSite("https://linear.app", "mobile", f);
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      { url: "https://linear.app", viewport: { width: 1440, height: 900 } },
      { url: "https://linear.app", viewport: { width: 390, height: 844 } },
    ]);
  });

  it("🔴 an address that is not a public website is refused without saying what is behind it", async () => {
    const f = fetcher({ ok: false, error: { kind: "ssrf-blocked", reason: "resolves to 10.0.0.5" } });
    const r = await screenshotRealSite("http://intranet.local", "desktop", f);
    expect(r).toEqual({ ok: false, error: "that address is not a public website and cannot be read" });
    expect(JSON.stringify(r)).not.toContain("10.0.0.5");
  });

  it("a site that refuses, a render with no picture and a browser that throws each say so", async () => {
    expect(await screenshotRealSite("https://x.example", "desktop", fetcher({ ok: false, error: { kind: "blocked", status: 403 } }))).toEqual({
      ok: false,
      error: "the site refused the request (HTTP 403) — do not retry; ask the user to paste the text",
    });
    expect(await screenshotRealSite("https://x.example", "desktop", fetcher(rendered("https://x.example/")))).toEqual({
      ok: false,
      error: "the page opened but no screenshot came out",
    });
    const roto = vi.fn(async () => {
      throw new Error("Chrome not found");
    }) as unknown as typeof fetchPuppeteer;
    expect(await screenshotRealSite("https://x.example", "desktop", roto)).toEqual({ ok: false, error: "Chrome not found" });
  });
});
