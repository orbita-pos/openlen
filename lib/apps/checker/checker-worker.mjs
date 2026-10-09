// lib/apps/checker/checker-worker.mjs — EL HILO DEL COMPROBADOR (plan 03).
//
// TypeScript y ESLint son JavaScript puro, pero lentos para el hilo de la app
// (~900 ms en frío): aquí no lo paran, y un chequeo que se cuelga se corta desde
// fuera (`check-app.ts`). Atiende una petición detrás de otra; el registro de
// documentos de `checker-core.mjs` vive mientras viva el hilo, que es lo que
// hace rápidas las siguientes (120–200 ms).
//
// JS plano: lo carga un `Worker` por ruta, como `lib/agent/terminal/trabajador.mjs`.
// Mensajes: `{ id, files, typesPackPaths }` → `{ id, ok, result | error }`.
import { existsSync, readFileSync } from "node:fs";
import { getHeapStatistics } from "node:v8";
import { parentPort, workerData } from "node:worker_threads";
import { checkApp } from "./checker-core.mjs";

// El registro de documentos guarda cada ruta que ve, sin techo (medido el
// 2026-10-08: ~0,15 MB por app distinta), y este hilo vive DENTRO del proceso
// del servidor. Pasado el umbral, contesta y se va: `check-app.ts` lo hace
// renacer limpio. (El tope duro, por si un solo chequeo se dispara, es el
// `resourceLimits` con que se crea.)
const UMBRAL_MB = workerData?.maxHeapMb ?? 512;

// El types.json de cada catálogo (y del kit de pruebas), leído una vez: no cambia nunca.
const paquetes = new Map();
function paqueteDeTipos(ruta) {
  if (!paquetes.has(ruta)) paquetes.set(ruta, existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : {});
  return paquetes.get(ruta);
}

// Los de la petición, fusionados (el del catálogo y el del kit, plan 04): una
// vez por combinación.
const fusionados = new Map();
function paquetesDeTipos(rutas) {
  const clave = rutas.join("\n");
  if (!fusionados.has(clave)) fusionados.set(clave, Object.assign({}, ...rutas.map(paqueteDeTipos)));
  return fusionados.get(clave);
}

parentPort.on("message", (m) => {
  let respuesta;
  try {
    respuesta = { id: m.id, ok: true, result: checkApp({ files: m.files, typesPack: paquetesDeTipos(m.typesPackPaths) }) };
  } catch (e) {
    respuesta = { id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // Se dice EN la respuesta (`recycling`), para que la siguiente petición vaya a
  // un hilo nuevo y no a éste, que se cierra. Cerrar el puerto deja salir el
  // hilo cuando el mensaje ya se fue.
  const seVa = getHeapStatistics().used_heap_size / 1e6 > UMBRAL_MB;
  parentPort.postMessage(seVa ? { ...respuesta, recycling: true } : respuesta);
  if (seVa) parentPort.close();
});
