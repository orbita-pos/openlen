// Gate SSRF de datos vivos (spec §8): confirma end-to-end que applyLiveData
// NUNCA alcanza un host que no sea Google Sheets — ni loopback, ni metadata,
// ni el canario local. La defensa primaria es resolveSheetCsvUrl (allowlist
// de docs.google.com) + validateUrl (defensa en profundidad); esto lo prueba
// con un servidor canario REAL, no con un fetch mockeado. Corre:
//   npm run live:ssrf
import { createServer } from "node:http";
import { applyLiveData } from "@/lib/live";

// Servidor canario: cuenta cualquier conexión. Si applyLiveData lo alcanza
// con alguna de las URLs hostiles de abajo, hay egreso indebido.
let hits = 0;
const server = createServer((req, res) => {
  hits++;
  console.log("  ⚠ CANARIO ALCANZADO:", req.method, req.url);
  res.end("leaked");
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
console.log(`canario en 127.0.0.1:${port}`);

// Vectores hostiles que un dueño malicioso podría pegar como "URL de Sheet".
// TODOS deben ser rechazados por resolveSheetCsvUrl (host != docs.google.com)
// ANTES de cualquier fetch → cero egreso, y applyLiveData cae a fallback.
const HTML = `<span data-ol-live="x">fallback</span>`;
const HOSTILE = [
  `http://127.0.0.1:${port}/exfil`,
  `http://169.254.169.254/latest/meta-data/`,
  `http://localhost:${port}/`,
  `http://docs.google.com.evil.com/spreadsheets/d/ABC/edit`,
  `http://evil.com/spreadsheets/d/ABC/export?format=csv`,
];

let failed = false;
for (const url of HOSTILE) {
  const out = await applyLiveData(HTML, url);
  // La página SIEMPRE queda intacta (fallback), nunca a medio hornear.
  if (!out.html.includes("fallback")) {
    console.error(`  ✗ ${url} → la página no conservó el fallback`);
    failed = true;
  }
}

// Control positivo: el canario SÍ es alcanzable desde Node — si esto no sube
// el contador, el "cero egreso" de arriba no probaría nada (servidor muerto).
await fetch(`http://127.0.0.1:${port}/control`).catch(() => {});
await new Promise((r) => setTimeout(r, 300));
server.close();

const egress = hits - 1; // el control positivo suma 1
if (hits === 0) {
  console.error("GATE INVÁLIDO — ni el control positivo alcanzó el canario; no probaría nada");
  process.exit(1);
}
if (egress > 0) {
  console.error(`SECURITY FAIL — ${egress} conexión(es) desde applyLiveData: HAY EGRESO A UN HOST NO-GOOGLE`);
  process.exit(1);
}
if (failed) {
  console.error("GATE FAIL — alguna URL hostil no cayó a fallback");
  process.exit(1);
}
console.log("LIVE-DATA SSRF GATE PASS — cero egreso a hosts no-Google (5 vectores), con control positivo del canario");
process.exit(0);
