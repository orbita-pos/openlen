import { describe, expect, test } from "vitest";
import { pickLang, renderHtml, summaryJson, type PageData } from "./page";

const NOW = 1_800_000_000_000;

function fakeData(overrides?: Partial<PageData>): PageData {
  const days = [{ day: "2027-01-15", state: "ok" as const }];
  return {
    generatedAt: NOW,
    targets: [
      { target: "app", status: "up", since: NOW - 3_600_000, lastLatencyMs: 120, uptime: { d1: 100, d7: 99.95, d90: null }, days },
      { target: "pages", status: "up", since: NOW - 3_600_000, lastLatencyMs: 80, uptime: { d1: 100, d7: 100, d90: 100 }, days },
      { target: "api", status: "down", since: NOW - 600_000, lastLatencyMs: null, uptime: { d1: 97.92, d7: 99.7, d90: 99.9 }, days },
    ],
    incidents: [{ target: "api", start: NOW - 600_000, end: NOW, durationMin: 10 }],
    ...overrides,
  };
}

describe("pickLang", () => {
  test("es por default; en solo si Accept-Language no trae español", () => {
    expect(pickLang(null)).toBe("es");
    expect(pickLang("es-MX,es;q=0.9")).toBe("es");
    expect(pickLang("en-US,en;q=0.9")).toBe("en");
  });
});

describe("renderHtml", () => {
  test("pinta 3 componentes, estado global degradado y uptime", () => {
    const html = renderHtml(fakeData(), "es");
    expect(html).toContain("Aplicación");
    expect(html).toContain("Páginas publicadas");
    expect(html).toContain("API y datos");
    expect((html.match(/class="status-dot/g) ?? []).length).toBe(3);
    expect(html).toContain("Interrupción parcial"); // un target down
    expect(html).toContain("99.95%");
    expect(html).toContain("—"); // uptime d90 null de app → sin dato
  });

  test("todo up → encabezado verde; en inglés", () => {
    const data = fakeData();
    data.targets = data.targets.map((t) => ({ ...t, status: "up" as const }));
    data.incidents = [];
    const html = renderHtml(data, "en");
    expect(html).toContain("All systems operational");
    expect(html).toContain("No incidents in the last 90 days");
  });
});

describe("summaryJson", () => {
  test("shape estable para la futura página de confianza", () => {
    const parsed = JSON.parse(summaryJson(fakeData()));
    expect(parsed.overall).toBe("degraded");
    expect(parsed.targets.app.uptime.d7).toBe(99.95);
    expect(parsed.targets.api.status).toBe("down");
  });
});
