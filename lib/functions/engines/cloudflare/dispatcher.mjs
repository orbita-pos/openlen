// lib/functions/engines/cloudflare/dispatcher.mjs — EL DESPACHADOR (spec local
// 2026-10-12, Parte 3). Un Worker NUESTRO en Cloudflare, el único que puede
// llamar a los scripts de los proyectos (su vínculo `DISPATCHER` al namespace de
// Workers for Platforms). Lo llama SÓLO la puerta de Next, con la clave
// compartida (`DISPATCH_KEY`); pone los límites del plan a cada llamada y
// devuelve los marcos del envoltorio tal cual, según salen. Sus errores también
// van como marcos. JS sin dependencias: lo sube `functions:cloudflare-setup` y
// las pruebas lo importan.

const SCRIPT = /^openlen-[a-z]{20}-(?:draft|live)$/;
const NDJSON = { "content-type": "application/x-ndjson" };

/** Igual, en tiempo constante (la clave). Sin clave configurada, nada vale. */
function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || b.length === 0) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function limitOf(v, porDefecto) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

function frames(...fs) {
  return new Response(fs.map((f) => `${JSON.stringify(f)}\n`).join(""), { headers: NDJSON });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST" || !sameKey(request.headers.get("x-openlen-dispatch-key"), env.DISPATCH_KEY)) {
      return new Response("forbidden", { status: 403 });
    }
    const script = request.headers.get("x-openlen-script") ?? "";
    if (!SCRIPT.test(script)) return new Response("bad script", { status: 400 });
    // Sin un número válido, los de Gratis (lib/functions/limits.ts).
    const limits = {
      cpuMs: limitOf(request.headers.get("x-openlen-cpu-ms"), 50),
      subRequests: limitOf(request.headers.get("x-openlen-subrequests"), 50),
    };
    const event = await request.text();
    try {
      const user = env.DISPATCHER.get(script, {}, { limits });
      return await user.fetch("https://function.internal/", { method: "POST", headers: { "content-type": "application/json" }, body: event });
    } catch (e) {
      const message = String((e && e.message) || e);
      if (message.startsWith("Worker not found")) return frames({ t: "error", kind: "not_found" }, { t: "end", ms: 0 });
      // El mensaje exacto de Cloudflare al pasarse de un límite no está
      // documentado: lo que lo menciona cuenta como límite (546). Se fija en el
      // ensayo real.
      const kind = /exceeded|limit/i.test(message) ? "cpu" : "uncaught";
      return frames({ t: "error", kind, message }, { t: "end", ms: 0 });
    }
  },
};
