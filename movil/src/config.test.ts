import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("el paquete de producción apunta a OpenLen sin depender de la PC", async () => {
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_OPENLEN_BASE", undefined);
  expect((await import("./config")).BASE).toBe("https://openlen.com");
});

it("desarrollo conserva el servidor local", async () => {
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_OPENLEN_BASE", undefined);
  expect((await import("./config")).BASE).toBe("http://localhost:3007");
});

it("permite configurar otro servidor", async () => {
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_OPENLEN_BASE", "https://pruebas.example.com");
  expect((await import("./config")).BASE).toBe("https://pruebas.example.com");
});
