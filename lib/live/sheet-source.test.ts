// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// validateUrl hace una resolución DNS real — mockeado para que estos tests
// nunca toquen la red, ni siquiera DNS. El guardia SSRF real (dns.lookup +
// rangos privados) ya tiene su propia cobertura en validate-url.ts; aquí solo
// probamos que fetchSheet LO LLAMA y respeta su veredicto (defensa en
// profundidad), no que el guardia en sí funcione.
const { validateUrlMock } = vi.hoisted(() => ({
  validateUrlMock: vi.fn(),
}));
vi.mock("@/lib/style-match/scrape/validate-url", () => ({
  validateUrl: validateUrlMock,
}));

import { fetchSheet, resolveSheetCsvUrl } from "./sheet-source";

function okValidation(raw: string) {
  return {
    ok: true as const,
    value: { url: new URL(raw), hostname: new URL(raw).hostname, resolvedIp: "142.250.0.1" },
  };
}

function fakeResponse(text: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => text } as unknown as Response;
}

beforeEach(() => {
  validateUrlMock.mockReset();
  validateUrlMock.mockImplementation(async (raw: string) => okValidation(raw));
});

describe("resolveSheetCsvUrl", () => {
  it("URL de edición → export CSV con el gid del hash", () => {
    expect(resolveSheetCsvUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=42")).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=42",
    );
  });

  it("host ajeno → null", () => {
    expect(resolveSheetCsvUrl("https://evil.com/x")).toBeNull();
  });

  it("IP directa (metadata/loopback) → null, ni siquiera es docs.google.com", () => {
    expect(resolveSheetCsvUrl("http://169.254.169.254/")).toBeNull();
  });

  it("subdominio disfrazado (docs.google.com.evil.com) → null, comparación exacta de host", () => {
    expect(
      resolveSheetCsvUrl("https://docs.google.com.evil.com/spreadsheets/d/ABC123/edit"),
    ).toBeNull();
  });

  it("sin gid en el hash ni en la query → default gid=0", () => {
    expect(resolveSheetCsvUrl("https://docs.google.com/spreadsheets/d/XYZ789/edit")).toBe(
      "https://docs.google.com/spreadsheets/d/XYZ789/export?format=csv&gid=0",
    );
  });

  it("gid vía query (?gid=7) en vez de hash", () => {
    expect(resolveSheetCsvUrl("https://docs.google.com/spreadsheets/d/QQQ/edit?gid=7")).toBe(
      "https://docs.google.com/spreadsheets/d/QQQ/export?format=csv&gid=7",
    );
  });

  it("URL de docs.google.com que no es un Sheet (es un Doc) → null", () => {
    expect(resolveSheetCsvUrl("https://docs.google.com/document/d/ABC123/edit")).toBeNull();
  });

  it("URL que no parsea → null", () => {
    expect(resolveSheetCsvUrl("no-es-una-url")).toBeNull();
  });
});

describe("fetchSheet — SSRF", () => {
  it("host ajeno: resolveSheetCsvUrl rechaza antes de tocar fetch o validateUrl", async () => {
    const fetchSpy = vi.fn();
    await expect(fetchSheet("https://evil.com/x", 5000, fetchSpy)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(validateUrlMock).not.toHaveBeenCalled();
  });

  it("defensa en profundidad: validateUrl rechaza la URL ya resuelta → lanza, fetch nunca se llama", async () => {
    validateUrlMock.mockResolvedValueOnce({
      ok: false,
      error: { kind: "ssrf-blocked", reason: "resuelve a IP privada" },
    });
    const fetchSpy = vi.fn();
    await expect(
      fetchSheet("https://docs.google.com/spreadsheets/d/ABC123/edit", 5000, fetchSpy),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchSheet — parse (fetch inyectado, cero red real)", () => {
  const SHEET_URL = "https://docs.google.com/spreadsheets/d/ABC123/edit";

  it("CSV de 2 columnas (clave|valor) → values Map poblado, rows también", async () => {
    const csv = "key,value\nprecio-taco,$45\nstock-playeras,12\n";
    const fetchSpy = vi.fn().mockResolvedValue(fakeResponse(csv));
    const data = await fetchSheet(SHEET_URL, 5000, fetchSpy);

    expect(data.values.get("precio-taco")).toBe("$45");
    expect(data.values.get("stock-playeras")).toBe("12");
    expect(data.rows).toEqual([
      { key: "precio-taco", value: "$45" },
      { key: "stock-playeras", value: "12" },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=0",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("CSV de 3 columnas → rows poblado por encabezado, values vacío (no es clave|valor)", async () => {
    const csv = "name,price,photo\nTacos pastor,45,https://x/img.jpg\n";
    const fetchSpy = vi.fn().mockResolvedValue(fakeResponse(csv));
    const data = await fetchSheet(SHEET_URL, 5000, fetchSpy);

    expect(data.rows).toEqual([{ name: "Tacos pastor", price: "45", photo: "https://x/img.jpg" }]);
    expect(data.values.size).toBe(0);
  });

  it("campo con comillas: coma dentro del campo + comilla escapada", async () => {
    const csv = 'name,note\n"Tacos, al pastor","dijo ""hola"""\n';
    const fetchSpy = vi.fn().mockResolvedValue(fakeResponse(csv));
    const data = await fetchSheet(SHEET_URL, 5000, fetchSpy);

    expect(data.rows).toEqual([{ name: "Tacos, al pastor", note: 'dijo "hola"' }]);
  });

  it("CSV vacío → values y rows vacíos, no lanza", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeResponse(""));
    const data = await fetchSheet(SHEET_URL, 5000, fetchSpy);

    expect(data.values.size).toBe(0);
    expect(data.rows).toEqual([]);
  });

  it("respuesta HTTP no-ok (404) → lanza", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeResponse("", false, 404));
    await expect(fetchSheet(SHEET_URL, 5000, fetchSpy)).rejects.toThrow();
  });

  it("fetch inyectado rechaza (red caída) → lanza, no revienta sin capturar", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(fetchSheet(SHEET_URL, 5000, fetchSpy)).rejects.toThrow();
  });
});
