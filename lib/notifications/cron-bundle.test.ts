// LOS BUNDLES DEL CRON SE PUEDEN CARGAR FUERA DE NEXT.
//
// Visto en el ensayo de caja (08/10): el aviso de una mención del chat importa
// `lib/projects/chat-equipo` → `hilos.ts` → `import "server-only"`, que fuera de
// Next lanza. scripts/build-cron.mjs sólo le ponía el módulo vacío al servidor
// de Realtime, así que el bundle de `notifications-drain` llevaba el `throw`: el
// primer aviso de mención tumbaba el drenaje entero, y con él todos los avisos.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = resolve(__dirname, "../..");
const LANZA = "cannot be imported from a Client Component";

describe("los bundles del cron", () => {
  it("🔴 ninguno lleva el `throw` de server-only (el drenaje de avisos cargaba hilos.ts)", () => {
    execFileSync(process.execPath, ["scripts/build-cron.mjs"], { cwd: raiz, stdio: "pipe" });
    for (const f of ["notifications-drain.mjs", "renewal-reminders.mjs", "analytics-rollup.mjs"]) {
      const bundle = readFileSync(resolve(raiz, ".next/standalone/cron", f), "utf8");
      expect(bundle.includes(LANZA), f).toBe(false);
    }
  }, 120_000);
});
