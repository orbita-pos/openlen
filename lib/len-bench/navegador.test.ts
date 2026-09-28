// lib/len-bench/navegador.test.ts
import { describe, expect, it } from "vitest";
import type { Page } from "puppeteer";
import { cerrarPestana } from "./navegador";

const nunca = () => new Promise<never>(() => {});

describe("cerrarPestana — no se cuelga, pase lo que pase en la pestaña", () => {
  it("vuelve aunque quitar la intercepción no vuelva nunca (visto el 23/09: tras enviar un formulario publicado)", async () => {
    const hechos: string[] = [];
    const page = {
      setRequestInterception: nunca,
      goto: async () => void hechos.push("about:blank"),
      close: async () => void hechos.push("cerrada"),
    } as unknown as Page;
    const t0 = Date.now();
    await cerrarPestana(page, 100);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(hechos).toEqual(["about:blank", "cerrada"]);
  });
  it("vuelve aunque ningún paso vuelva", async () => {
    const page = { setRequestInterception: nunca, goto: nunca, close: nunca } as unknown as Page;
    const t0 = Date.now();
    await cerrarPestana(page, 100);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});
