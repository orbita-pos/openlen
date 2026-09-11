// El fetch del Worker cuando D1 falla. Antes: la excepción subía y Cloudflare
// servía un 1101 opaco (así estuvo status semanas, 2026-09-10). Ahora: un 503
// que dice lo que pasa, y que el home ya sabe degradar (`!res.ok` → sin badge).
import { describe, expect, test, vi } from "vitest";
import worker, { type Env } from "./index";

function envWithBrokenDb(): Env {
  const boom = () => {
    throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.");
  };
  return {
    DB: { prepare: boom, batch: boom } as unknown as D1Database,
    CANARY_HOST: "x",
    ALERT_FROM: "x",
    ALERT_EMAIL: "x",
    RESEND_API_KEY: "x",
  };
}

describe("fetch con D1 caído", () => {
  test("la página responde 503 con texto, no revienta", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await worker.fetch(new Request("https://status.openlen.com/"), envWithBrokenDb());
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toMatch(/no disponible/i);
  });

  test("/api/summary responde 503 JSON con CORS, para que el home degrade", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await worker.fetch(new Request("https://status.openlen.com/api/summary"), envWithBrokenDb());
    expect(res.status).toBe(503);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://openlen.com");
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  test("robots.txt no toca D1 y sigue en 200", async () => {
    const res = await worker.fetch(new Request("https://status.openlen.com/robots.txt"), envWithBrokenDb());
    expect(res.status).toBe(200);
  });
});
