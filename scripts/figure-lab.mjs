// THE FIGURES' LAB (spec local 2026-11-10-figuras-del-asistente, §7): a local page to LOOK at the live figure —
// every shape, every activity, the small sizes, the frames per second. It is how the look gets judged; no machine
// can say "it looks clean". Never deployed, never imported by the app.
//
//   npm run figure:lab            → http://127.0.0.1:4877
//   npm run figure:lab -- --host  → also reachable from a phone on the same network
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const lab = path.join(root, "lib/figure/lab");
const host = process.argv.includes("--host") ? "0.0.0.0" : "127.0.0.1";
const port = 4877;

/** Rebuilt on every request: edit a shader, reload the page. */
async function bundle() {
  const result = await build({ entryPoints: [path.join(lab, "main.ts")], bundle: true, format: "iife", target: "es2020", sourcemap: "inline", write: false });
  return result.outputFiles[0].text;
}

createServer(async (request, response) => {
  try {
    if (request.url === "/main.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      response.end(await bundle());
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(readFileSync(path.join(lab, "lab.html")));
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(String(error?.message ?? error));
  }
}).listen(port, host, () => {
  console.log(`figure lab: http://127.0.0.1:${port}`);
  if (host === "0.0.0.0")
    for (const list of Object.values(networkInterfaces()))
      for (const address of list ?? []) if (address.family === "IPv4" && !address.internal) console.log(`  on your network: http://${address.address}:${port}`);
});
