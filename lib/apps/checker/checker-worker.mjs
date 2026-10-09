// lib/apps/checker/checker-worker.mjs — EL HILO DEL COMPROBADOR (plan 03).
//
// TypeScript y ESLint son JavaScript puro, pero lentos para el hilo de la app
// (~900 ms en frío): aquí no lo paran, y un chequeo que se cuelga se corta desde
// fuera (`check-app.ts`). Atiende una petición detrás de otra; el registro de
// documentos de `checker-core.mjs` vive mientras viva el hilo, que es lo que
// hace rápidas las siguientes (120–200 ms).
//
// JS plano: lo carga un `Worker` por ruta, como `lib/agent/terminal/trabajador.mjs`.
// Mensajes: `{ id, files, typesPackPath }` → `{ id, ok, result | error }`.
import { existsSync, readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { checkApp } from "./checker-core.mjs";

// El types.json de cada catálogo, leído una vez: no cambia nunca.
const paquetes = new Map();
function paqueteDeTipos(ruta) {
  if (!paquetes.has(ruta)) paquetes.set(ruta, existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : {});
  return paquetes.get(ruta);
}

parentPort.on("message", (m) => {
  try {
    parentPort.postMessage({ id: m.id, ok: true, result: checkApp({ files: m.files, typesPack: paqueteDeTipos(m.typesPackPath) }) });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
