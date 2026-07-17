import { describe, expect, test, vi } from "vitest";
import { runAllChecks } from "./checks";

const okResponse = (body = "ok") => new Response(body, { status: 200 });
const noSleep = () => Promise.resolve();

describe("runAllChecks", () => {
  test("los 3 targets con 200 (api con JSON) → todos ok, sin retry", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("/api/templates") ? okResponse("[]") : okResponse(),
    );
    const results = await runAllChecks("canario.openlen.com", fetcher as typeof fetch, noSleep);
    expect(results.map((r) => [r.target, r.ok])).toEqual([
      ["app", true],
      ["pages", true],
      ["api", true],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const urls = fetcher.mock.calls.map((c) => String(c[0]));
    expect(urls[1]).toMatch(/^https:\/\/canario\.openlen\.com\/\?sc=\d+$/);
  });

  test("fallo + retry exitoso → ok (el retry cuenta)", async () => {
    let apiCalls = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/templates")) {
        apiCalls++;
        return apiCalls === 1 ? new Response("boom", { status: 500 }) : okResponse("[]");
      }
      return okResponse();
    });
    const results = await runAllChecks("c.openlen.com", fetcher as typeof fetch, noSleep);
    expect(results.find((r) => r.target === "api")?.ok).toBe(true);
    expect(apiCalls).toBe(2);
  });

  test("api con 200 pero body no-JSON → falla; excepción de red → status null", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/templates")) return okResponse("<html>no soy json</html>");
      if (u.includes("openlen.com/en")) throw new Error("network");
      return okResponse();
    });
    const results = await runAllChecks("c.openlen.com", fetcher as typeof fetch, noSleep);
    const api = results.find((r) => r.target === "api")!;
    const app = results.find((r) => r.target === "app")!;
    expect(api.ok).toBe(false);
    expect(api.status).toBe(200);
    expect(app.ok).toBe(false);
    expect(app.status).toBeNull();
  });
});
