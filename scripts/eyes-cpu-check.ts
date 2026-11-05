// scripts/eyes-cpu-check.ts
// What the new eyes cost the machine they run on (spec local 2026-11-05-ojos-que-ven-el-movimiento, §7,
// §8.5, §10): use_page on a WebGL scene that never stops drawing, with Len's own launcher (WebGL by
// software, nice 10 on Linux), measuring
//   (a) ms per `key` step with and without the canvas measure (internals.canvasDiff);
//   (b) the machine's busy cores during a visit of 8 × `wait: 10`, against the same time idle;
//   (c) with --probe-url <url>, that URL's latency every 500 ms during the waits, against idle.
// Criteria: (a) ≤ 250 ms more per step — measured 05/11: three captures of ~45 ms each, whatever their
// size (the compositor's readback), so the plan's first 50 ms couldn't be met by a smaller scale; a step
// already takes 2–3.5 s; (c) p95 during the visit ≤ 2 × idle — if not, a cap on the
// total wait of a visit. Run it locally first; on the production box only in the box rehearsal, with
// Jesús's OK.
//
// Run: npm run eyes:cpu-check [-- --probe-url https://…]

import { cpus } from "node:os";

import { usarPagina } from "../lib/agent/usar-pagina";
import type { PasoDeUso } from "../lib/agent/pasos-de-uso";

// A WebGL scene that redraws every frame, as a 3D game does (no CDN: raw WebGL).
const SCENE = `<!doctype html><html><head><meta charset="utf-8"><title>Scene</title>
<style>html,body{margin:0;height:100%;background:#111}canvas{display:block;width:100vw;height:100vh}</style></head>
<body><canvas id="c"></canvas><script>
var c = document.getElementById("c"); c.width = innerWidth; c.height = innerHeight;
var gl = c.getContext("webgl");
var vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, "attribute vec2 p; uniform float t; void main(){ float s=sin(t), k=cos(t); gl_Position=vec4(p.x*k-p.y*s, p.x*s+p.y*k, 0.0, 1.0); }"); gl.compileShader(vs);
var fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, "precision highp float; uniform float t; void main(){ gl_FragColor=vec4(0.5+0.5*sin(t), 0.3, 0.6, 1.0); }"); gl.compileShader(fs);
var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr); gl.useProgram(pr);
var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.6,-0.5, 0.6,-0.5, 0,0.7]), gl.STATIC_DRAW);
var loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
var tl = gl.getUniformLocation(pr, "t"), x = 0;
addEventListener("keydown", function () { x += 0.5; });
(function f(ms) { gl.uniform1f(tl, ms / 1000 + x); gl.clearColor(0.07, 0.07, 0.07, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3); requestAnimationFrame(f); })(0);
</script></body></html>`;

const KEYS: PasoDeUso[] = Array.from({ length: 6 }, () => ({ key: "ArrowRight" }));
const WAITS: PasoDeUso[] = Array.from({ length: 8 }, () => ({ wait: 10 }));

/** Busy cores of the whole machine between two readings of os.cpus(). */
function busyCores(a: ReturnType<typeof cpus>, b: ReturnType<typeof cpus>): number {
  let busy = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const ta = a[i]!.times;
    const tb = b[i]!.times;
    const idle = tb.idle - ta.idle;
    const all = tb.user - ta.user + (tb.nice - ta.nice) + (tb.sys - ta.sys) + (tb.irq - ta.irq) + idle;
    busy += all - idle;
    total += all;
  }
  return total > 0 ? (busy / total) * a.length : 0;
}

async function sample<T>(during: Promise<T>, probeUrl: string | undefined): Promise<{ result: T; cores: number[]; latencies: number[] }> {
  const cores: number[] = [];
  const latencies: number[] = [];
  let done = false;
  const sampler = (async () => {
    let prev = cpus();
    while (!done) {
      await new Promise((r) => setTimeout(r, 500));
      const now = cpus();
      cores.push(busyCores(prev, now));
      prev = now;
      if (probeUrl) {
        const t0 = performance.now();
        await fetch(probeUrl, { cache: "no-store" }).then((r) => r.arrayBuffer()).catch(() => undefined);
        latencies.push(performance.now() - t0);
      }
    }
  })();
  const result = await during;
  done = true;
  await sampler;
  return { result, cores, latencies };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]! : 0);
const f1 = (x: number) => x.toFixed(1);

async function main() {
  const at = process.argv.indexOf("--probe-url");
  const probeUrl = at >= 0 ? process.argv[at + 1] : undefined;
  const visit = (pasos: PasoDeUso[], canvasDiff: boolean) =>
    usarPagina({ html: SCENE, pasos, ruta: "/index.html" }, { canvasDiff, plazoMs: 120_000 });

  // (a) the canvas measure, per step.
  await visit([{ key: "a" }], false); // warm-up: the first Chromium start is slower
  const t0 = performance.now();
  await visit(KEYS, false);
  const off = performance.now() - t0;
  const t1 = performance.now();
  const on = await visit(KEYS, true);
  const onMs = performance.now() - t1;
  const perStep = (onMs - off) / KEYS.length;
  console.log(`(a) 6 key steps: ${f1(off)} ms without the canvas measure, ${f1(onMs)} ms with → ${f1(perStep)} ms more per step`);
  console.log(`    the report says: ${on.informe.split("\n").find((l) => l.includes("the canvas")) ?? "(no canvas line)"}`);

  // (b) + (c): idle, then a visit full of waits.
  const idle = await sample(new Promise((r) => setTimeout(r, 6_000)), probeUrl);
  const busy = await sample(visit(WAITS, true), probeUrl);
  console.log(`(b) busy cores of ${cpus().length}: idle avg ${f1(avg(idle.cores))}, during 8 × wait:10 avg ${f1(avg(busy.cores))} max ${f1(Math.max(...busy.cores))}`);
  if (probeUrl) {
    console.log(`(c) ${probeUrl}: p95 idle ${f1(p95(idle.latencies))} ms, during the visit ${f1(p95(busy.latencies))} ms`);
  }

  const verdicts = [`canvas measure ${perStep <= 250 ? "OK" : "OVER"} (${f1(perStep)} ms/step, limit 250)`];
  if (probeUrl) {
    const ratio = p95(busy.latencies) / Math.max(1, p95(idle.latencies));
    verdicts.push(`latency ${ratio <= 2 ? "OK" : "OVER"} (p95 × ${f1(ratio)}, limit 2)`);
  }
  console.log(`\n${verdicts.join("; ")}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  },
);
