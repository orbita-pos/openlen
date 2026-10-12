// lib/functions/engines/local-worker.mjs — EL PAQUETE DE UN PROYECTO, CORRIENDO
// (motor `local`, spec local 2026-10-11). Un hilo por destino: importa el
// `index.mjs` del paquete y atiende `{ id, event }` devolviendo sus marcos,
// `{ id, frame }`. Su `process.env` es SÓLO lo que el motor le pasa (la opción
// `env` de Worker): nada del servidor.
//
// NO es un aislamiento para código de terceros: comparte el proceso. Por eso el
// motor local se niega en producción salvo que el dueño de la caja lo pida.

import { parentPort, workerData } from "node:worker_threads";

const mod = await import(workerData.entry);

parentPort.on("message", async ({ id, event }) => {
  let resto = "";
  const sink = {
    write(chunk) {
      resto += chunk;
      let i;
      while ((i = resto.indexOf("\n")) >= 0) {
        const linea = resto.slice(0, i);
        resto = resto.slice(i + 1);
        if (linea) parentPort.postMessage({ id, frame: JSON.parse(linea) });
      }
    },
    end() {},
  };
  try {
    await mod.invoke(event, sink);
  } catch (e) {
    parentPort.postMessage({ id, frame: { t: "error", kind: "uncaught", message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? (e.stack ?? null) : null } });
    parentPort.postMessage({ id, frame: { t: "end", ms: 0 } });
  }
});
