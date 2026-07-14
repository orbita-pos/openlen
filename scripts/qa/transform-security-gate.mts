// transform-security-gate — el candado de red del transform (hallazgo
// publish-safety, 2026-07-14). Corre: npm run transform:security
//
// Mide lo ÚNICO que importa: EGRESO REAL. Un servidor canario local cuenta
// conexiones; la página del "desconocido" (from-html) intenta alcanzarlo por
// 8 vías. Con el candado, cero.
//
// DOS CONTROLES, sin los cuales este gate sería un verde falso:
//   (A) el canario SÍ es alcanzable desde Node → si el guardia se quitara,
//       este gate se pondría rojo de verdad (no es un servidor muerto).
//   (B) el script de la página SÍ se ejecutó → si no corriera, tampoco habría
//       intentos de red y "cero conexiones" no probaría NADA. (Es el patrón
//       efecto-no-causa que ya se coló cinco veces en este repo.)
//
// La primera versión de este smoke afirmaba "window.open devolvió un objeto ⇒
// fuga" — falso: devolver una Window no prueba que la red se alcanzara. Lo que
// prueba una fuga es que algo LLEGUE al otro lado.
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

const vectors = (u: string) => `
  const U = ${JSON.stringify(u)};
  document.getElementById("out").textContent = "SCRIPT-CORRIO";
  try { fetch(U + "?v=fetch"); } catch(e) {}
  try { const i = new Image(); i.src = U + "?v=img"; } catch(e) {}
  try { window.open(U + "?v=open"); } catch(e) {}
  try { const f = document.createElement("iframe"); f.src = U + "?v=iframe"; document.body.appendChild(f); } catch(e) {}
  try { navigator.sendBeacon && navigator.sendBeacon(U + "?v=beacon", "x"); } catch(e) {}
  try { new WebSocket(U.replace("http://", "ws://") + "?v=ws"); } catch(e) {}
  try { const x = new XMLHttpRequest(); x.open("GET", U + "?v=xhr", true); x.send(); } catch(e) {}
`;

// Página 1 — los 7 vectores que NO destruyen el documento, así la captura
// puede probar el CONTROL (B): el script corrió de verdad.
const EVIL = `<!doctype html><html><head></head><body>
<div id="out" data-ol-bake-c="0"></div>
<script>${vectors(CANARY)}</script>
</body></html>`;
const cap = await runPageNoNetwork(EVIL, 6000);
const captured = cap.containers["0"] ?? "";
console.log("captura:", JSON.stringify(captured));

// Página 2 — navegación top-level aparte: destruye el documento (Chrome no
// puede cargar nada con el proxy muerto), así que su captura no sirve de
// control; lo único que se le pide es no alcanzar el canario.
const NAV = `<!doctype html><html><head></head><body><div id="out" data-ol-bake-c="0"></div>
<script>location.href = ${JSON.stringify(CANARY)} + "?v=nav";</script>
</body></html>`;
await runPageNoNetwork(NAV, 6000).catch(() => {});

await new Promise((r) => setTimeout(r, 800));

// CONTROL (A): el canario ES alcanzable — si esto no sube el contador, el
// "cero conexiones" de arriba no significaba nada.
await fetch(`${CANARY}?v=control`).catch(() => {});
await new Promise((r) => setTimeout(r, 200));
server.close();

const leaksFromBrowser = hits - 1; // el control positivo suma 1
let failed = false;

if (hits === 0) {
  console.error("GATE INVÁLIDO — ni siquiera el control positivo alcanzó el canario; este gate no probaría nada");
  failed = true;
}
if (!captured.includes("SCRIPT-CORRIO")) {
  console.error("GATE INVÁLIDO — el script de la página hostil NO se ejecutó; 'cero egreso' sería un verde falso");
  failed = true;
}
if (leaksFromBrowser > 0) {
  console.error(`SECURITY FAIL — ${leaksFromBrowser} conexión(es) desde el navegador: HAY EGRESO DE RED`);
  failed = true;
}

if (failed) process.exit(1);
console.log(
  "SECURITY GATE PASS — cero egreso desde el navegador (fetch · Image · window.open · iframe · sendBeacon · WebSocket · XHR · navegación), con control positivo del canario y prueba de que el script corrió",
);
process.exit(0);
