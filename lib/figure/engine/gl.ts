// THE FIGURE'S WEBGL (spec local 2026-11-10-figuras-del-asistente, §5.2): one program, the meshes, and the one
// function that draws a list of pieces. It knows nothing of looks, activities or time — index.ts hands it a frame.
import { FRAGMENT, VERTEX } from "./shaders";
import { ROUND, type Part, type PartMesh, type Vec3 } from "./parts";

export interface Frame {
  /** The whole figure's rotation, column-major 3×3. */
  rotation: Float32Array;
  offset: Vec3;
  /** Which way the fur trails, from how the body just moved. */
  lag: Vec3;
  stretch: Vec3;
  time: number;
  /** Fur layers of the body; shorter fur gets fewer. */
  layers: number;
  density: number;
  eyeOpen: number;
  gaze: readonly [number, number];
}

export interface Renderer {
  /** Draws into the bound framebuffer, `width`×`height` pixels. */
  render(parts: readonly Part[], frame: Frame, width: number, height: number): void;
}

const UNIFORMS = ["uRot", "uPartRot", "uPos", "uScale", "uOffset", "uLag", "uStretch", "uSilA", "uSilB", "uWiden", "uFurLen", "uLayers", "uTime", "uView", "uColor", "uDensity", "uKind", "uRigid", "uTube"] as const;

/** yaw (y), pitch (x), roll (z) → a column-major 3×3. */
export function rotation(yaw: number, pitch: number, roll: number): Float32Array {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
  // R = Ry · Rx · Rz
  const m00 = cy * cz + sy * sx * sz, m01 = -cy * sz + sy * sx * cz, m02 = sy * cx;
  const m10 = cx * sz, m11 = cx * cz, m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz, m21 = sy * sz + cy * sx * cz, m22 = cy * cx;
  return new Float32Array([m00, m10, m20, m01, m11, m21, m02, m12, m22]);
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
}

/** Positions (or, for a ring, its center line) at location 0 and normals at 1. */
function upload(gl: WebGL2RenderingContext, positions: number[], normals: number[], indices: number[]): Mesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  for (const [location, data] of [[0, positions], [1, normals]] as const) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  return { vao, count: indices.length };
}

/** A grid of (rows+1)×(columns+1) vertices, two triangles per cell. */
function grid(rows: number, columns: number, indices: number[], base = 0): void {
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const a = base + y * (columns + 1) + x, b = a + columns + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
}

function sphere(gl: WebGL2RenderingContext): Mesh {
  const SEG = 72, RING = 48;
  const positions: number[] = [], indices: number[] = [];
  for (let y = 0; y <= RING; y++)
    for (let x = 0; x <= SEG; x++) {
      const th = (y / RING) * Math.PI, ph = (x / SEG) * Math.PI * 2;
      positions.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    }
  grid(RING, SEG, indices);
  return upload(gl, positions, positions, indices);
}

/** A ring of radius 1 in the xy plane, swept over `sweep` radians from +x: its center line, and the tube's normals. */
function ring(gl: WebGL2RenderingContext, sweep: number): Mesh {
  const SEG = 48, TUBE = 12;
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let i = 0; i <= SEG; i++)
    for (let j = 0; j <= TUBE; j++) {
      const ph = (i / SEG) * sweep, ps = (j / TUBE) * Math.PI * 2;
      positions.push(Math.cos(ph), Math.sin(ph), 0);
      normals.push(Math.cos(ps) * Math.cos(ph), Math.cos(ps) * Math.sin(ph), Math.sin(ps));
    }
  grid(SEG, TUBE, indices);
  return upload(gl, positions, normals, indices);
}

/** Radius 1 at y = 0 up to `top` (0 for a cone, 1 for a cylinder) at y = 1, closed at both ends. */
function lathe(gl: WebGL2RenderingContext, top: number): Mesh {
  const SEG = 32;
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const slope = 1 - top; // how much the side leans in
  for (const y of [0, 1])
    for (let i = 0; i <= SEG; i++) {
      const ph = (i / SEG) * Math.PI * 2, r = y ? top : 1;
      positions.push(r * Math.cos(ph), y, r * Math.sin(ph));
      const length = Math.hypot(1, slope);
      normals.push(Math.cos(ph) / length, slope / length, Math.sin(ph) / length);
    }
  grid(1, SEG, indices);
  for (const y of [0, 1]) {
    const center = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, y ? 1 : -1, 0);
    for (let i = 0; i <= SEG; i++) {
      const ph = (i / SEG) * Math.PI * 2, r = y ? top : 1;
      positions.push(r * Math.cos(ph), y, r * Math.sin(ph));
      normals.push(0, y ? 1 : -1, 0);
      if (i < SEG) indices.push(center, center + 1 + i, center + 2 + i);
    }
  }
  return upload(gl, positions, normals, indices);
}

const KIND = { fur: 0, solid: 1, gloss: 2 } as const;
/** How far the camera sees from the center, in body units: the figure, its fur, a hat and its shadow fit. */
const REACH = 1.5;

export function createRenderer(gl: WebGL2RenderingContext): Renderer {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "program");
  gl.useProgram(program);
  const u = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  for (const name of UNIFORMS) u[name] = gl.getUniformLocation(program, name);
  const meshes: Record<PartMesh, Mesh> = { sphere: sphere(gl), torus: ring(gl, Math.PI * 2), arc: ring(gl, Math.PI), cone: lathe(gl, 0), cylinder: lathe(gl, 1) };

  gl.enable(gl.DEPTH_TEST);
  gl.cullFace(gl.BACK);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  function draw(part: Part, frame: Frame, layers: number): void {
    const s = part.silhouette ?? ROUND;
    let [px, py, pz] = part.position;
    let [sx, sy, sz] = part.scale;
    const mesh = meshes[part.mesh];
    const rigid = part.mesh !== "sphere";
    if (part.role === "eye" || part.role === "eyeHighlight") {
      px += frame.gaze[0] * 0.05;
      py += frame.gaze[1] * 0.04;
      if (part.role === "eye" && !rigid) sy = Math.max(0.008, sy * frame.eyeOpen);
    }
    gl.uniform3f(u.uPos, px, py, pz);
    gl.uniform3f(u.uScale, sx, sy, sz);
    gl.uniformMatrix3fv(u.uPartRot, false, rotation(part.rotation[0], part.rotation[1], part.rotation[2]));
    gl.uniform3f(u.uColor, part.color[0], part.color[1], part.color[2]);
    gl.uniform4f(u.uSilA, s.power, s.lobes, s.lobeDepth, s.notchTop);
    gl.uniform4f(u.uSilB, s.pointBottom, s.taperBottom, s.taperTop, s.squashBottom);
    gl.uniform1f(u.uWiden, s.widenBottom);
    gl.uniform1f(u.uFurLen, part.furLength);
    gl.uniform1f(u.uLayers, layers);
    gl.uniform1f(u.uKind, KIND[part.kind]);
    gl.uniform1f(u.uRigid, rigid ? 1 : 0);
    gl.uniform1f(u.uTube, part.tube ?? 0);
    // The rigid meshes are closed and opaque: the depth test hides their far side, whatever their winding.
    if (rigid) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(mesh.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0, layers);
  }

  return {
    render(parts, frame, width, height) {
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const side = Math.min(width, height);
      gl.uniform2f(u.uView, side / width / REACH, side / height / REACH);
      gl.uniformMatrix3fv(u.uRot, false, frame.rotation);
      gl.uniform3f(u.uOffset, frame.offset[0], frame.offset[1], frame.offset[2]);
      gl.uniform3f(u.uLag, frame.lag[0], frame.lag[1], frame.lag[2]);
      gl.uniform3f(u.uStretch, frame.stretch[0], frame.stretch[1], frame.stretch[2]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uDensity, frame.density);
      // What is opaque first; the fur is blended over it, from the inside out.
      for (const part of parts) {
        if (part.kind === "fur") continue;
        if (part.role === "eyeHighlight" && frame.eyeOpen < 0.6) continue;
        draw(part, frame, 1);
      }
      for (const part of parts) {
        if (part.kind !== "fur") continue;
        // Short fur (a beret's felt) needs fewer layers than the body's.
        draw(part, frame, Math.max(6, Math.round(frame.layers * Math.min(1, Math.max(0.25, part.furLength / 0.13)))));
      }
    },
  };
}
