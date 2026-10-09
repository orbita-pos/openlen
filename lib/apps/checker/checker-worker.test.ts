// @vitest-environment node
// El hilo del comprobador no crece sin fin (plan 03, tarea 7): el registro de
// documentos de TypeScript guarda cada ruta que ve (medido: ~0,15 MB por app
// distinta, sin techo), y el hilo vive dentro del proceso del servidor. Pasado
// su umbral, contesta y se va; `check-app.ts` lo hace renacer.
import { Worker } from "node:worker_threads";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RUTA = path.join(process.cwd(), "lib", "apps", "checker", "checker-worker.mjs");
const TIPOS = path.join(process.cwd(), "public", "app-vendor", "2026-11", "types.json");

function correr(workerData?: unknown) {
  const w = new Worker(RUTA, workerData === undefined ? {} : { workerData });
  const mensajes: unknown[] = [];
  const salida = new Promise<number>((ok) => w.on("exit", ok));
  w.on("message", (m) => mensajes.push(m));
  w.postMessage({ id: 1, files: { "/src/A.tsx": "export const n: string = 3;" }, typesPackPath: TIPOS });
  return { w, mensajes, salida };
}

describe("el hilo del comprobador (plan 03, tarea 7)", () => {
  it("🔴 pasado su umbral de memoria, CONTESTA y luego se va", async () => {
    const { mensajes, salida } = correr({ maxHeapMb: 1 });
    expect(await salida).toBe(0);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).toMatchObject({ id: 1, ok: true });
  }, 30_000);

  it("por debajo del umbral, sigue vivo", async () => {
    const { w, mensajes } = correr();
    await expect.poll(() => mensajes.length, { timeout: 25_000 }).toBe(1);
    expect(w.threadId).toBeGreaterThan(0);
    let salio = false;
    w.on("exit", () => (salio = true));
    await new Promise((r) => setTimeout(r, 200));
    expect(salio).toBe(false);
    await w.terminate();
  }, 30_000);
});
