// lib/three3d/runtime/lite.ts
// Shader-only mount on raw WebGL1 — no three.js. Ships ~10KB instead of the
// ~155KB-gz full runtime for pages whose only 3D is a fullscreen shader
// backdrop. Behavior contract mirrors mount.ts's mountShader EXACTLY (iTime
// starts 6.0, DPR capped at 2, IntersectionObserver + visibilitychange raf
// gating, first-frame onReady + 'three-ready', context-loss guards firing the
// same window events, dispose releasing all GL + listeners).
import type { SceneSpec } from "../scene-spec";
import { shaderFragment } from "./shaders";

// Own tiny vert — raw WebGL has no three built-ins (uv/position). Maps the
// clip-space quad [-1,1] to vUv [0,1] so the ported fragments read identically.
const VERT =
  "attribute vec2 position; varying vec2 vUv; void main(){ vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }";
// Fullscreen quad: 2 triangles, single vec2 position attribute.
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

export function mountLite(
  canvas: HTMLCanvasElement,
  spec: SceneSpec,
  opts: { onReady?: () => void } = {},
): { dispose: () => void } {
  const host = canvas.parentElement ?? canvas;
  let width = host.clientWidth || 800;
  let height = host.clientHeight || 600;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let raf = 0;
  let visible = true;
  let firstFrame = true;
  const start = performance.now();
  const fireReady = () => {
    if (!firstFrame) return;
    firstFrame = false;
    opts.onReady?.();
    window.dispatchEvent(new Event("three-ready"));
  };

  const gl = (canvas.getContext("webgl", { antialias: true }) ||
    canvas.getContext("experimental-webgl", { antialias: true })) as WebGLRenderingContext | null;
  if (!gl) {
    // No WebGL — the poster must never hang (mirrors mountModel's error path).
    fireReady();
    return { dispose() {} };
  }

  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let uTime: WebGLUniformLocation | null = null;
  let uRes: WebGLUniformLocation | null = null;
  let rendering = false;

  function applySize() {
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    gl!.viewport(0, 0, canvas.width, canvas.height);
    if (uRes) gl!.uniform2f(uRes, width * dpr, height * dpr);
  }

  // Compiles the program + quad. Re-runnable so a restored context rebuilds all
  // GL objects (raw WebGL invalidates every resource on context loss).
  function build(): boolean {
    program = null;
    buffer = null;
    uTime = null;
    uRes = null;
    const vs = gl!.createShader(gl!.VERTEX_SHADER);
    const fs = gl!.createShader(gl!.FRAGMENT_SHADER);
    if (!vs || !fs) return false;
    gl!.shaderSource(vs, VERT);
    gl!.compileShader(vs);
    gl!.shaderSource(fs, shaderFragment(spec.shader ?? "gradient"));
    gl!.compileShader(fs);
    const prog = gl!.createProgram();
    if (!prog) return false;
    gl!.attachShader(prog, vs);
    gl!.attachShader(prog, fs);
    gl!.linkProgram(prog);
    gl!.deleteShader(vs);
    gl!.deleteShader(fs);
    if (!gl!.getProgramParameter(prog, gl!.LINK_STATUS)) {
      gl!.deleteProgram(prog);
      return false;
    }
    program = prog;
    buffer = gl!.createBuffer();
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    gl!.bufferData(gl!.ARRAY_BUFFER, QUAD, gl!.STATIC_DRAW);
    gl!.useProgram(program);
    const loc = gl!.getAttribLocation(program, "position");
    gl!.enableVertexAttribArray(loc);
    gl!.vertexAttribPointer(loc, 2, gl!.FLOAT, false, 0, 0);
    uTime = gl!.getUniformLocation(program, "iTime");
    uRes = gl!.getUniformLocation(program, "iResolution");
    applySize();
    return true;
  }

  function frame() {
    if (rendering && !gl!.isContextLost()) {
      gl!.uniform1f(uTime, 6.0 + (performance.now() - start) / 1000);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    }
    fireReady();
    if (visible) raf = requestAnimationFrame(frame);
    else raf = 0;
  }

  function resize() {
    width = host.clientWidth || width;
    height = host.clientHeight || height;
    applySize();
  }

  rendering = build();
  if (!rendering) {
    // Compile/link failed — release and fire ready so the poster never hangs.
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    fireReady();
    return { dispose() {} };
  }

  const onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    raf = 0;
    window.dispatchEvent(new Event("three-context-lost"));
  };
  const onRestored = () => {
    rendering = build();
    if (visible && !raf) raf = requestAnimationFrame(frame);
    window.dispatchEvent(new Event("three-context-restored"));
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible && !raf) raf = requestAnimationFrame(frame);
  });
  io.observe(host);
  const onVis = () => {
    if (document.visibilityState === "hidden") {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (visible && !raf) {
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("resize", resize);
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    },
  };
}
