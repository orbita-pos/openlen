// A LOCAL PAGE TO LOOK AT HER PUBLISHED BUBBLE (spec local 2026-11-10-figuras-del-asistente, §7: «lo que no prueba
// una máquina»): a page baked exactly as publishing bakes it, with the status and the answers stubbed. Nothing of it
// is published, and it talks to no model.
//
//   npx tsx --require ./scripts/test-node-server-only-shim.cjs scripts/figure-bubble-demo.ts   → http://127.0.0.1:4878
//   ?shape=heart&color=19c3b1&eyes=round&eyewear=shades&accessory=crown   any look of the catalog
import { createServer } from "node:http";

import { FIGURE_ENGINE } from "@/lib/figure/engine/published";
import { DEFAULT_LOOK, lookOrDefault } from "@/lib/figure/look";
import { FIGURE_ENGINE_PATH, bakeAssistantPersona } from "@/lib/publish/assistant-widget";

const PORT = 4878;
const PAGE =
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pastelería Canela</title></head>' +
  '<body style="margin:0;font-family:system-ui;background:#faf6f1;color:#2b1d14"><main style="max-width:720px;margin:0 auto;padding:64px 24px">' +
  "<h1>Pastelería Canela</h1><p>Pan de masa madre, pasteles por encargo y café. Abre la burbuja de abajo a la derecha.</p></main></body></html>";

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname.startsWith("/api/assistant/")) {
    res.setHeader("content-type", "application/json");
    if (req.method !== "POST") return void res.end(JSON.stringify({ asistente: true, chat: false, traspaso: false, figuras: true }));
    // Slow enough to see her think.
    return void setTimeout(() => res.end(JSON.stringify({ respuesta: "¡Claro! Horneamos todos los días a las 7. ¿Te aparto algo?", intent: "answer" })), 1800);
  }
  if (url.pathname === `/${FIGURE_ENGINE_PATH}`) {
    res.setHeader("content-type", "text/javascript; charset=utf-8");
    return void res.end(FIGURE_ENGINE.code);
  }
  const q = url.searchParams;
  const look = lookOrDefault({
    ...DEFAULT_LOOK,
    ...Object.fromEntries(["shape", "eyes", "eyewear", "accessory"].flatMap((k) => (q.get(k) ? [[k, q.get(k)]] : []))),
    ...(q.get("color") ? { color: `#${q.get("color")}` } : {}),
  });
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(bakeAssistantPersona(PAGE, { sub: "canela", apiBase: "", businessName: "Pastelería Canela", persona: { name: "Lucía", look } }));
}).listen(PORT, "127.0.0.1", () => console.log(`bubble demo: http://127.0.0.1:${PORT}`));
