# three.js here

Written from three.js's own sources (MIT): its guide for language models (threejs.org/docs/llms.txt), its official `three/addons/` pipeline, and production WebGL2 patterns for three r186–r187 (installing gives you the newest version published more than 7 days ago). three changes its API often: the types and the lint that check the files you change catch what no longer exists.

## 1. Imports, Renderer, Color Spaces & Software-WebGL Adaptation

- `import * as THREE from "three"`: importing it installs it.
- Addons come from `three/addons/…`:
  - `import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"`
  - `import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"`
  - `import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"`
  - `import { RenderPass } from "three/addons/postprocessing/RenderPass.js"`
  - `import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"`
  - `import { OutputPass } from "three/addons/postprocessing/OutputPass.js"`
  - `import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"`
- Never use the old global `<script src="…/three.min.js">`.
- **Renderer defaults:** use `new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" })`. Never `WebGPURenderer` (Len's headless eyes can't capture WebGPU).
- **Color management:** `renderer.outputColorSpace = THREE.SRGBColorSpace` (default in r186+; `outputEncoding` is gone). Set `texture.colorSpace = THREE.SRGBColorSpace` **only** on color/albedo/emissive maps — leave `normalMap`, `roughnessMap`, `metalnessMap` and `aoMap` in linear `THREE.NoColorSpace`.
- **Subtle PBR environment reflections:** generate a low-intensity PMREM environment with `RoomEnvironment` (`scene.environmentIntensity = 0.18` to `0.35`) so dark wood, glass, brass and wet floors catch realistic specular highlights instead of rendering dead black in shadow.
- **Software-WebGL scaling for headless checks:** Len's `view_page` / `use_page` runs on headless Chromium with software WebGL (SwiftShader / llvmpipe). Detect it once so headless captures render fast without lowering quality on real GPUs:

```ts
export function isSoftwareWebGL(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
  return /SwiftShader|llvmpipe|Software/i.test(name);
}
```

When `isSoftwareWebGL(renderer)` is `true`, cap `pixelRatio` to `1`, skip MSAA samples on post-processing render targets, and use `1024` shadow maps instead of `2048`.

## 2. Mounting inside React (`/src/game/Game.tsx`) & Complete Cleanup

Keep per-frame values in plain variables or engine objects, never React `useState`. Dispose geometries, materials, texture maps, PMREM, composer and renderer on unmount — skipping cleanup leaks WebGL contexts across edits:

```tsx
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export default function Game() {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = mount.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const software = /SwiftShader|llvmpipe|Software/i.test(
      (() => {
        const gl = renderer.getContext();
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
      })(),
    );
    renderer.setPixelRatio(software ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.22;

    const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 120);
    camera.position.set(0, 1.68, 4);

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let last = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
      last = now;
      // update simulation(dt) ...
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      const disposedTex = new Set<THREE.Texture>();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          for (const mat of [obj.material].flat()) {
            for (const val of Object.values(mat)) {
              if (val instanceof THREE.Texture && !disposedTex.has(val)) {
                disposedTex.add(val);
                val.dispose();
              }
            }
            mat.dispose();
          }
        }
      });
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mount} className="h-full w-full" style={{ touchAction: "none" }} />;
}
```

## 3. Spatial Architecture & Anti-Artifact Geometry Rules (`1 unit = 1.00 m`)

When building 3D rooms, buildings or levels in code, architectural precision is what separates an immersive world from floating boxes:

- **Real human proportions (`1 unit = 1.00 m`):**
  - Standing eye height: `1.68 m` (`1.05 m` crouched); player collision cylinder radius: `0.30 m`.
  - Corridors: `1.60–1.90 m` wide; ceiling heights: `2.85–3.20 m`; structural slab between floors: `0.25–0.30 m`.
  - Interior doorways: `1.05 m × 2.25 m` clear opening (`>= 0.40 m` wider than the player diameter so movement never snags).
- **Segmented walls with real thickness (`0.18–0.24 m`):**
  - Never punch openings by overlapping coplanar boxes. Split any wall with doors or windows into non-overlapping **left jamb**, **right jamb**, **lintel** (above opening) and **sill** (below window). Real thickness blocks light bleed and casts clean doorway shadows.
  - Add architectural millwork in local wall coordinates `(alongWall, verticalY, wallNormalOffset)`: door jamb liners, casings, plinth blocks, baseboards (`0.12–0.16 m` tall, `0.018 m` proud of the wall), crown moldings, ceiling beams, and recessed window frames with mullions and sills.
- **Zero Z-fighting:**
  - Never place rugs, paintings, mirrors, wallpaper tears, floor stains or trim at the exact plane of a wall or floor.
  - Offset flat decals/overlays by **`>= 0.008 m` (`8 mm`)** along the surface normal **plus** `polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2`, and moldings/frames by **`>= 0.018 m`**.
- **Metric world-space UVs:**
  - Scale UV repeats on every box face from its real dimensions in meters (`uSpan / tileMeters`, `vSpan / tileMeters`) with `RepeatWrapping`, or clone texture repeats per surface class, so narrow jambs and 6-meter walls show the same plank/wallpaper scale without stretching.

## 4. Procedural PBR Materials (`< 200 ms`, Zero External Files)

Flat `MeshStandardMaterial({ color })` looks like untextured plastic under spotlights. When external CC0 textures aren't loaded, synthesize seamless `map` + `normalMap` + `roughnessMap` canvases once at startup using a deterministic PRNG, periodic wrapped value noise (100 % tileable), and a **3×3 Sobel height-to-normal filter**:

```ts
import * as THREE from "three";

export function mulberry32(seed = 1928): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 100% seamless periodic 2D value-noise octave on a power-of-two grid. */
export function periodicOctave(size: number, period: number, rng: () => number): Float32Array {
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  const out = new Float32Array(size * size);
  const scale = period / size;
  for (let y = 0; y < size; y++) {
    const gy = y * scale, iy = Math.floor(gy), fy = gy - iy, uy = fy * fy * (3 - 2 * fy);
    const y0 = ((iy % period) + period) % period, y1 = (y0 + 1) % period;
    for (let x = 0; x < size; x++) {
      const gx = x * scale, ix = Math.floor(gx), fx = gx - ix, ux = fx * fx * (3 - 2 * fx);
      const x0 = ((ix % period) + period) % period, x1 = (x0 + 1) % period;
      const nx0 = lat[y0 * period + x0] + (lat[y0 * period + x1] - lat[y0 * period + x0]) * ux;
      const nx1 = lat[y1 * period + x0] + (lat[y1 * period + x1] - lat[y1 * period + x0]) * ux;
      out[y * size + x] = nx0 + (nx1 - nx0) * uy;
    }
  }
  return out;
}

/** 3x3 Sobel heightmap -> tangent-space normal map (OpenGL +Y, seamless wrap). */
export function heightToNormalTexture(height: Float32Array, size = 512, strength = 2.5): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1) & mask, yp = (y + 1) & mask;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1) & mask, xp = (x + 1) & mask;
      const tl = height[ym * size + xm], t = height[ym * size + x], tr = height[ym * size + xp];
      const l = height[y * size + xm], r = height[y * size + xp];
      const bl = height[yp * size + xm], b = height[yp * size + x], br = height[yp * size + xp];
      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const inv = 1 / Math.hypot(-dx, -dy, 1);
      const o = (y * size + x) * 4;
      d[o] = ((-dx * inv * 0.5 + 0.5) * 255) | 0;
      d[o + 1] = ((-dy * inv * 0.5 + 0.5) * 255) | 0;
      d[o + 2] = ((inv * 0.5 + 0.5) * 255) | 0;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
```

Combine 3–5 octaves once into shared coarse/medium/fine buffers so generating 15–30 distinct materials (aged oak planks with groove lines, peeling damask wallpaper with damp patches, cracked checkerboard tile, dusty fabric sheets, tarnished brass, rough plaster) finishes in ~150 ms.

## 5. Atmospheric Lighting & WebGL Shadow Budget

- **Respect `MAX_TEXTURE_IMAGE_UNITS = 16`:** Every `MeshStandardMaterial` with PBR maps consumes texture units, and every active `castShadow = true` light consumes shadow sampler units. Enabling `castShadow = true` on 8–12 `PointLight`s at once causes WebGL shader compilation to fail (`FRAGMENT shader texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS`).
- **Dynamic shadow budget:** Keep `castShadow = true` permanently only on key directional/spot lights (e.g. player flashlight + primary moonlight/sunlight) plus **at most 3 practical lights at a time**, dynamically enabling `castShadow` each frame on the highest-priority lights closest to the player and setting `castShadow = false` on distant ones.
- **Stop light bleed through walls:** Give every indoor `PointLight` / `SpotLight` physical quadratic falloff (`decay: 2`) and a `distance` bounded to its room (`4.5–7.5 m`), plus `shadow.bias = -0.0005` and `shadow.normalBias = 0.02`.
- **Visual composition & contrast:** Pair deep cold ambient/moonlight (`#6e92c8` / `#162030` + `THREE.FogExp2`) with focused warm or eerie practicals (`#ffb469` tungsten lamp, `#ff4d12` fireplace embers, `#8be4ff` open fridge or faulty fluorescent tube) and subtle organic flicker so every doorway frames a readable silhouette and focal point without crushing dark rooms to unreadable pure black.

## 6. Post-Processing Pipeline (`EffectComposer`)

In modern Three.js (`r174+`), keep rendering linear through HDR bloom, convert once with `OutputPass`, and run subtle grading/vignette/grain last in sRGB:

1. `RenderPass(scene, camera)`
2. `UnrealBloomPass(resolution, 0.24, 0.42, 0.84)` — **high threshold (`0.80–0.88`) and low strength (`0.18–0.28`)** so only bare bulbs, embers, specular glints and bright windows glow, never the whole scene.
3. `OutputPass()` — applies `renderer.toneMapping` (`ACESFilmicToneMapping`) and linear-to-sRGB conversion.
4. Optional `ShaderPass` for subtle outer-edge chromatic aberration (`~0.0012`), cold-shadow / warm-midtone split-toning, soft vignette, and **sin-less film grain** (never use `fract(sin(dot(...)) * 43758.5453)` for grain — `sin()` precision bands visibly on Windows ANGLE / D3D11 GPUs; use Dave Hoskins's sin-less hash instead):

```glsl
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
```

When `!isSoftwareWebGL(renderer)` and `renderer.capabilities.isWebGL2`, set `composer.renderTarget1.samples = composer.renderTarget2.samples = Math.min(4, renderer.capabilities.maxSamples)` so thin geometry (stair balusters, crib bars, doorframes) stays anti-aliased through `EffectComposer`. Update both `renderer` and `composer.setSize(w, h)` inside `ResizeObserver`.

## 7. GLB Models, Collisions, Physics & `window.__GAME_DEBUG__` Inspection

### A model (GLB, compressed with meshopt)

```ts
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync("/models/ship.glb");
scene.add(gltf.scene);
```

Not Draco or KTX2: their decoders are fetched by URL, which has no path here.

### Collisions and physics

- **First-person / character room collisions:** test a horizontal player circle (`radius = 0.30 m`) against room/prop AABBs separately on `X` and then on `Z` so the player slides smoothly along walls and doorframes instead of sticking on corners; resolve `Y` against floor slabs and stair ramps; disable or rotate a door's AABB when the player opens it.
- **Simple overlaps & ground checks:** `new THREE.Box3().setFromObject(a).intersectsBox(…)` and `THREE.Raycaster`.
- **Full rigid-body physics:** use `@dimforge/rapier3d-compat` (the build with its `.wasm` embedded inside), and call `await RAPIER.init()` before creating the world.

### Camera presets & debug hook for verification (`window.__GAME_DEBUG__`)

Headless browsers cannot grant pointer lock without a real user gesture. In any 3D first-person or multi-room scene, attach a lightweight inspection helper on `window` so `use_page` (`eval` + `screenshot`) can jump straight to each room's doorway or focal point, dismiss any start overlay for inspection, and verify real movement and visual polish across every space:

```ts
declare global {
  interface Window {
    __GAME_DEBUG__?: {
      views: Record<string, { pos: [number, number, number]; lookAt: [number, number, number] }>;
      lookFrom: (viewId: string) => boolean;
      teleport: (x: number, y: number, z: number, yawRad?: number, pitchRad?: number) => void;
      state: () => { pos: [number, number, number]; fps: number; room?: string };
    };
  }
}
```
