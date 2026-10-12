// LA SUITE OFICIAL DE CONFORMIDAD contra un servidor MCP de OpenLen YA EN
// MARCHA (local o producción). La suite no sabe mandar cabeceras, así que va
// por un proxy local que añade `Authorization: Bearer <token>`. Sólo los
// escenarios que aplican a un servidor real: los demás piden las herramientas
// de prueba del servidor de ejemplo del SDK, y `dns-rebinding-protection` no
// tiene sentido a través de un proxy que reescribe el Host. Versión FIJADA
// (0.1.16 = spec 2025-11-25; los de 2026-07-28 sólo están en alfas).
//   npm run mcp:conformance -- --url http://localhost:3007/api/mcp --token olp_…
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SUITE = "@modelcontextprotocol/conformance@0.1.16";
const SCENARIOS = ["server-initialize", "ping", "tools-list", "json-schema-2020-12"];
const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const target = arg("url");
const token = arg("token") ?? process.env.OPENLEN_MCP_TOKEN;
if (!target || !token) {
  console.error("Uso: npm run mcp:conformance -- --url <url del MCP> --token <olp_…>");
  process.exit(2);
}
const baseline = fileURLToPath(new URL("./mcp-conformance-baseline.yml", import.meta.url));
const DROP_REQ = new Set(["host", "content-length", "accept-encoding", "authorization", "connection"]);
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

const proxy = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !DROP_REQ.has(k)));
  headers.authorization = `Bearer ${token}`;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks);
  const r = await fetch(target, { method: req.method, headers, body }).catch((e) => e);
  if (r instanceof Error) {
    res.writeHead(502).end(String(r));
    return;
  }
  res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => !DROP_RES.has(k))));
  if (r.body) for await (const c of r.body) res.write(c);
  res.end();
});
await new Promise((ok) => proxy.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${proxy.address().port}/mcp`;
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conformance-"));
let unexpected = 0;
// Manda el veredicto de la suite, no sólo su código de salida: en Windows su
// proceso puede caer AL CERRARSE (libuv, «Assertion failed … src\win\async.c»)
// después de haber escrito «Baseline check passed» (medido el 11/10/2026).
for (const scenario of SCENARIOS) {
  const { code, out } = await new Promise((done) => {
    const child = spawn(`npx -y ${SUITE} server --url ${url} --scenario ${scenario} --expected-failures "${baseline}"`, { cwd, shell: true });
    let out = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (d) => {
        out += d;
        process.stdout.write(d);
      });
    }
    child.on("close", (code) => done({ code, out }));
  });
  const passed = code === 0 || (out.includes("Baseline check passed") && !out.includes("Unexpected"));
  if (!passed) unexpected++;
}
proxy.close();
console.log(`\nResultados en ${cwd}`);
console.log(unexpected === 0 ? "CONFORMIDAD: todo como se espera" : `CONFORMIDAD: ${unexpected} escenario(s) fuera de lo esperado`);
process.exit(unexpected === 0 ? 0 : 1);
