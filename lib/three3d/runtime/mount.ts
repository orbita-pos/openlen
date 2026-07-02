// lib/three3d/runtime/mount.ts
import {
  Scene, PerspectiveCamera, Camera, WebGLRenderer, Group, Mesh, Color,
  SphereGeometry, TorusGeometry, TorusKnotGeometry, IcosahedronGeometry,
  PlaneGeometry, CapsuleGeometry, BufferGeometry, BufferAttribute, Points,
  MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, PointsMaterial,
  ShaderMaterial,
  PMREMGenerator, ACESFilmicToneMapping, NoToneMapping, SRGBColorSpace, DirectionalLight,
  CanvasTexture, EquirectangularReflectionMapping,
  Vector2, Vector3, Box3, MathUtils, type Material, type Object3D,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { SceneSpec, GeometryKind, MaterialKind, Look } from "../scene-spec";
import { buildSceneConfig, type SceneConfig } from "./interpret";
import { SHADER_VERT, shaderFragment } from "./shaders";

export interface MountHandle { dispose: () => void }

// WebGL context can be lost (GPU reset, tab background eviction, driver crash) and later
// restored by the browser. Pause the RAF loop while lost (rendering into a dead context
// throws/no-ops) and resume it on restore; the published bootstrap re-shows the poster
// in between.
function attachContextGuards(canvas: HTMLCanvasElement, h: { pause(): void; resume(): void }): () => void {
  const onLost = (e: Event) => { e.preventDefault(); h.pause(); window.dispatchEvent(new Event("three-context-lost")); };
  const onRestored = () => { h.resume(); window.dispatchEvent(new Event("three-context-restored")); };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  return () => { canvas.removeEventListener("webglcontextlost", onLost); canvas.removeEventListener("webglcontextrestored", onRestored); };
}

function mountShader(canvas: HTMLCanvasElement, cfg: SceneConfig, opts: { onReady?: () => void }): MountHandle {
  const host = canvas.parentElement ?? canvas;
  const width = host.clientWidth || 800;
  const height = host.clientHeight || 600;

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  const detachContextGuards = attachContextGuards(canvas, {
    pause: () => { cancelAnimationFrame(raf); raf = 0; },
    resume: () => { if (visible && !raf) raf = requestAnimationFrame(frame); },
  });

  const scene = new Scene();
  const camera = new Camera();

  const pr = renderer.getPixelRatio();
  const mat = new ShaderMaterial({
    vertexShader: SHADER_VERT,
    fragmentShader: shaderFragment(cfg.shader!),
    uniforms: {
      iTime: { value: 6.0 },
      iResolution: { value: new Vector2(width * pr, height * pr) },
    },
  });
  const geo = new PlaneGeometry(2, 2);
  scene.add(new Mesh(geo, mat));

  let raf = 0, visible = true, firstFrame = true;
  const start = performance.now();

  function resize() {
    const w = host.clientWidth || width, h = host.clientHeight || height;
    renderer.setSize(w, h, false);
    const p = renderer.getPixelRatio();
    mat.uniforms.iResolution.value.set(w * p, h * p);
  }
  function frame() {
    mat.uniforms.iTime.value = 6.0 + (performance.now() - start) / 1000;
    renderer.render(scene, camera);
    if (firstFrame) { firstFrame = false; opts.onReady?.(); window.dispatchEvent(new Event("three-ready")); }
    if (visible) { raf = requestAnimationFrame(frame); } else { raf = 0; }
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible && !raf) raf = requestAnimationFrame(frame);
  });
  io.observe(host);
  const onVis = () => {
    if (document.visibilityState === "hidden") { cancelAnimationFrame(raf); raf = 0; }
    else if (visible && !raf) { raf = requestAnimationFrame(frame); }
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("resize", resize);
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      detachContextGuards();
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
    },
  };
}

// Model-path look mapping — distinct from interpret.ts's EXPOSURE/ENV_INTENSITY
// tables, which are tuned for the abstract geometry/shader path, not GLB PBR materials.
const MODEL_LOOK: Record<Look, { exposure: number; key: number }> = {
  studio: { exposure: 1.15, key: 1.9 },
  soft: { exposure: 1.05, key: 1.6 },
  dramatic: { exposure: 1.0, key: 2.2 },
  neutral: { exposure: 0.95, key: 1.2 },
};

function mountModel(canvas: HTMLCanvasElement, cfg: SceneConfig, opts: { onReady?: () => void }): MountHandle {
  const host = canvas.parentElement ?? canvas;
  const width = host.clientWidth || 800;
  const height = host.clientHeight || 600;
  const modelLook = MODEL_LOOK[cfg.look];

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = modelLook.exposure;
  renderer.outputColorSpace = SRGBColorSpace;
  const detachContextGuards = attachContextGuards(canvas, {
    pause: () => { cancelAnimationFrame(raf); raf = 0; },
    resume: () => { if (visible && !raf) raf = requestAnimationFrame(frame); },
  });

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  roomEnv.dispose();
  scene.environment = envRT.texture;

  const camera = new PerspectiveCamera(40, width / height, 0.01, 1000);
  const key = new DirectionalLight(0xffffff, modelLook.key); key.position.set(4, 6, 5); scene.add(key);
  if (cfg.accentLinked) {
    // Brand accent as light, never as material tint — safe on any texture set.
    // Two opposed back rims wrap a visible halo even on glossy/env-lit models.
    const rim = new DirectionalLight(new Color(cfg.accentColor), 3.4);
    rim.position.set(-5, 3, -6); scene.add(rim);
    const rim2 = new DirectionalLight(new Color(cfg.accentColor), 1.6);
    rim2.position.set(5, -1, -5); scene.add(rim2);
    const fill = new DirectionalLight(new Color(cfg.accentColor), 0.7);
    fill.position.set(3, -2, 4); scene.add(fill);
  }
  const group = new Group(); scene.add(group);

  let raf = 0, visible = true, firstFrame = true, modelLoaded = false;
  let disposed = false;

  // cfg.rotationSpeed is exactly 0 when motion.kind === "still" (see buildSceneConfig);
  // cfg.motionSpeed is the raw 0..1 speed, since rotationSpeed is scaled for the geometry path.
  const rotStep = cfg.rotationSpeed === 0 ? 0 : 0.002 + cfg.motionSpeed * 0.018;

  function resize() {
    const w = host.clientWidth || width, h = host.clientHeight || height;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function frame() {
    group.rotation.y += rotStep;
    renderer.render(scene, camera);
    if (firstFrame && modelLoaded) {
      firstFrame = false;
      opts.onReady?.();
      window.dispatchEvent(new Event("three-ready"));
    }
    if (visible) { raf = requestAnimationFrame(frame); } else { raf = 0; }
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    cfg.modelUrl!,
    (gltf) => {
      if (disposed) { gltf.scene.traverse((node: any) => { if (node.geometry) node.geometry.dispose(); if (node.material) { const TEX_SLOTS = ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','clearcoatMap','clearcoatNormalMap','clearcoatRoughnessMap','iridescenceMap','iridescenceThicknessMap','sheenColorMap','sheenRoughnessMap','specularMap','specularIntensityMap','specularColorMap','transmissionMap','thicknessMap','envMap','lightMap','bumpMap','displacementMap','alphaMap']; const mats = Array.isArray(node.material) ? node.material : [node.material]; for (const mat of mats) { for (const k of TEX_SLOTS) { const t = (mat as any)[k]; if (t && typeof t.dispose === 'function') t.dispose(); } mat.dispose(); } } }); return; }
      const model = gltf.scene;
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      model.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dist = (maxDim / 2) / Math.tan(MathUtils.degToRad(40 / 2));
      camera.position.set(0, maxDim * 0.05, dist * (cfg.framing === "wide" ? 2.4 : 1.9));
      camera.lookAt(0, 0, 0);
      if (cfg.framing === "offset") {
        camera.position.x += maxDim * 0.35;
        camera.lookAt(maxDim * 0.12, 0, 0);
      }
      group.add(model);
      resize();
      modelLoaded = true;
      // Start loop if not already running (IO may have already started it pre-load).
      if (!raf) raf = requestAnimationFrame(frame);
    },
    undefined,
    (_err) => {
      if (disposed) return;
      // Fire ready on error so the headless poster never hangs.
      opts.onReady?.();
      window.dispatchEvent(new Event("three-ready"));
    },
  );

  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible && !raf) raf = requestAnimationFrame(frame);
  });
  io.observe(host);
  const onVis = () => {
    if (document.visibilityState === "hidden") { cancelAnimationFrame(raf); raf = 0; }
    else if (visible && !raf) { raf = requestAnimationFrame(frame); }
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("resize", resize);
  // Start render loop immediately so the env backdrop is visible even before load.
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      disposed = true;
      detachContextGuards();
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
      group.traverse((node: any) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          const TEX_SLOTS = ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','clearcoatMap','clearcoatNormalMap','clearcoatRoughnessMap','iridescenceMap','iridescenceThicknessMap','sheenColorMap','sheenRoughnessMap','specularMap','specularIntensityMap','specularColorMap','transmissionMap','thicknessMap','envMap','lightMap','bumpMap','displacementMap','alphaMap'];
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const mat of mats) { for (const k of TEX_SLOTS) { const t = (mat as any)[k]; if (t && typeof t.dispose === 'function') t.dispose(); } mat.dispose(); }
        }
      });
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}

function makeGeometry(kind: GeometryKind, radius: number, segments: number): BufferGeometry {
  switch (kind) {
    case "torus": return new TorusGeometry(radius, radius * 0.4, 48, 128);
    case "torusKnot": return new TorusKnotGeometry(radius * 0.7, radius * 0.26, 220, 32);
    case "icosa": return new IcosahedronGeometry(radius, 0);
    case "plane": return new PlaneGeometry(radius * 2.4, radius * 1.5, 64, 64);
    case "blob": return new IcosahedronGeometry(radius, 8);
    case "sphere":
    default: return new SphereGeometry(radius, 96, 96);
  }
}

function glassMaterial(cfg: SceneConfig, faceted: boolean): MeshPhysicalMaterial {
  if (faceted) {
    // Faceted gem recipe: high IOR + dispersion + flat shading reads each face as a prismatic facet.
    return new MeshPhysicalMaterial({
      transmission: 1, thickness: 1.2, roughness: 0.04, ior: 1.9, dispersion: 0.95,
      iridescence: 1, iridescenceIOR: 1.4, iridescenceThicknessRange: [120, 700],
      clearcoat: 0.5, clearcoatRoughness: 0.08, metalness: 0, transparent: true,
      color: new Color(0xffffff),
      attenuationColor: new Color(cfg.accentColor), attenuationDistance: 9.0,
      flatShading: true,
      envMapIntensity: cfg.envIntensity,
    });
  }
  // Smooth glass recipe (unchanged).
  return new MeshPhysicalMaterial({
    transmission: 1, thickness: 1.0, roughness: 0.13, ior: 1.5, dispersion: 0.5,
    iridescence: 1, iridescenceIOR: 1.4, iridescenceThicknessRange: [130, 740],
    clearcoat: 0.6, clearcoatRoughness: 0.12, metalness: 0, transparent: true,
    color: new Color(0xffffff),
    attenuationColor: new Color(cfg.accentColor), attenuationDistance: 4.5,
    envMapIntensity: cfg.envIntensity,
  });
}

function rainbowEnvTexture(): CanvasTexture {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 1024, 0);
  g.addColorStop(0.0, "#3a1c71"); g.addColorStop(0.22, "#d76d77"); g.addColorStop(0.45, "#ffaf7b");
  g.addColorStop(0.68, "#2bd2ff"); g.addColorStop(0.85, "#7c5cff"); g.addColorStop(1.0, "#ff3cc8");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
  const tex = new CanvasTexture(c);
  tex.mapping = EquirectangularReflectionMapping; tex.colorSpace = SRGBColorSpace;
  return tex;
}

function iridescentMaterial(cfg: SceneConfig): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    metalness: 0.6, roughness: 0.12,
    iridescence: 1.0, iridescenceIOR: 1.6, iridescenceThicknessRange: [100, 900],
    clearcoat: 1.0, clearcoatRoughness: 0.08,
    color: new Color(0x111118), envMapIntensity: cfg.envIntensity,
  });
}

function makeMaterial(kind: MaterialKind, cfg: SceneConfig, faceted = false): Material {
  if (kind === "iridescent") return iridescentMaterial(cfg);
  if (kind === "glass") return glassMaterial(cfg, faceted);
  if (kind === "chrome") {
    return new MeshPhysicalMaterial({
      metalness: 1.0, roughness: 0.03,
      iridescence: 1.0, iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 520],
      clearcoat: 1.0, clearcoatRoughness: 0.04,
      color: new Color(0xfafafa), envMapIntensity: cfg.envIntensity,
    });
  }
  if (kind === "metal") {
    return new MeshStandardMaterial({ color: new Color(cfg.accentColor), metalness: 1, roughness: 0.25, envMapIntensity: cfg.envIntensity });
  }
  if (kind === "emissive") {
    return new MeshBasicMaterial({ color: new Color(cfg.accentColor), wireframe: true });
  }
  // matte / gradient — env-lit standard
  return new MeshStandardMaterial({
    color: new Color(cfg.color),
    emissive: new Color(cfg.emissive), emissiveIntensity: 0,
    roughness: cfg.roughness, metalness: cfg.metalness, envMapIntensity: cfg.envIntensity,
    transparent: cfg.opacity < 1, opacity: cfg.opacity,
  });
}

function particleField(cfg: SceneConfig): Points {
  const N = 700;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = cfg.radius * (0.4 + Math.cbrt((i + 1) / N) * 1.3);
    const th = i * 2.399963; const ph = Math.acos(1 - 2 * ((i + 0.5) / N));
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const g = new BufferGeometry(); g.setAttribute("position", new BufferAttribute(pos, 3));
  return new Points(g, new PointsMaterial({ color: new Color(cfg.accentColor), size: 0.045, transparent: true, opacity: 0.9, depthWrite: false }));
}

export function mount(canvas: HTMLCanvasElement, spec: SceneSpec, opts: { onReady?: () => void } = {}): MountHandle {
  const cfg = buildSceneConfig(spec);
  if (cfg.shader) return mountShader(canvas, cfg, opts);
  if (cfg.modelUrl) return mountModel(canvas, cfg, opts);
  const useBloom = cfg.materialKind === "emissive";
  const host = canvas.parentElement ?? canvas;
  const width = host.clientWidth || 800;
  const height = host.clientHeight || 600;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.toneMapping = useBloom ? NoToneMapping : ACESFilmicToneMapping;
  renderer.toneMappingExposure = cfg.exposure;
  renderer.outputColorSpace = SRGBColorSpace;
  const detachContextGuards = attachContextGuards(canvas, {
    pause: () => { cancelAnimationFrame(raf); raf = 0; },
    resume: () => { if (visible && !raf) raf = requestAnimationFrame(frame); },
  });

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  let envRT;
  if (cfg.materialKind === "iridescent") {
    const tex = rainbowEnvTexture();
    envRT = pmrem.fromEquirectangular(tex);
    tex.dispose();
  } else {
    const env = new RoomEnvironment();
    envRT = pmrem.fromScene(env, 0.04);
    env.dispose();
  }
  scene.environment = envRT.texture;

  const camera = new PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(0, 0, cfg.cameraZ + 2.5);

  const key = new DirectionalLight(0xffffff, 2.0); key.position.set(4, 5, 6); scene.add(key);
  const rim = new DirectionalLight(0xffffff, 1.0); rim.position.set(-5, -2, 3); scene.add(rim);

  const disposables: { dispose: () => void }[] = [];
  const track = <T extends Object3D>(o: T): T => { o.traverse((n: any) => { if (n.geometry) disposables.push(n.geometry); if (n.material) disposables.push(n.material); }); return o; };

  const root = new Group();
  if (cfg.geometryKind === "particles") {
    root.add(track(particleField(cfg)));
  } else if (cfg.cluster && cfg.materialKind !== "emissive" && cfg.materialKind !== "iridescent") {
    const leadFaceted = cfg.geometryKind === "icosa";
    const lead = new Mesh(makeGeometry(cfg.geometryKind, cfg.radius * 0.75, cfg.segments), makeMaterial(cfg.materialKind, cfg, leadFaceted));
    lead.position.set(0.1, 0.55, 0);
    // Companions (RoundedBox, Capsule) are smooth — never faceted.
    const box = new Mesh(new RoundedBoxGeometry(cfg.radius * 1.05, cfg.radius * 1.05, cfg.radius * 1.05, 8, cfg.radius * 0.26), makeMaterial(cfg.materialKind, cfg, false));
    box.position.set(-0.15, -0.55, 0.25); box.rotation.set(0.2, 0.5, 0.05);
    const cap = new Mesh(new CapsuleGeometry(cfg.radius * 0.4, cfg.radius * 0.9, 24, 48), makeMaterial(cfg.materialKind, cfg, false));
    cap.position.set(1.1, -0.05, -0.15); cap.rotation.z = 0.95;
    root.add(track(lead), track(box), track(cap));
    root.position.set(1.2, 0, 0); root.rotation.y = -0.15;
  } else {
    const faceted = cfg.geometryKind === "icosa";
    root.add(track(new Mesh(makeGeometry(cfg.geometryKind, cfg.radius, cfg.segments), makeMaterial(cfg.materialKind, cfg, faceted))));
  }
  scene.add(root);

  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let outputPass: OutputPass | null = null;
  if (useBloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new Vector2(width, height), 0.95, 0.55, 0.0);
    composer.addPass(bloomPass);
    outputPass = new OutputPass();
    composer.addPass(outputPass);
  }

  let raf = 0, visible = true, firstFrame = true;
  const start = performance.now();

  function resize() {
    const w = host.clientWidth || width, h = host.clientHeight || height;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    composer?.setSize(w, h);
  }
  function frame() {
    const t = (performance.now() - start) / 1000;
    root.children.forEach((c) => { c.rotation.y = t * cfg.rotationSpeed; });
    root.position.y = Math.sin(t * 0.8) * cfg.driftAmplitude;
    if (composer) composer.render(); else renderer.render(scene, camera);
    if (firstFrame) { firstFrame = false; opts.onReady?.(); window.dispatchEvent(new Event("three-ready")); }
    if (visible) { raf = requestAnimationFrame(frame); } else { raf = 0; }
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible && !raf) raf = requestAnimationFrame(frame);
  });
  io.observe(host);
  const onVis = () => {
    if (document.visibilityState === "hidden") { cancelAnimationFrame(raf); raf = 0; }
    else if (visible && !raf) { raf = requestAnimationFrame(frame); }
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("resize", resize);
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      detachContextGuards();
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
      for (const d of disposables) d.dispose();
      composer?.dispose();
      bloomPass?.dispose();
      outputPass?.dispose();
      envRT.dispose(); pmrem.dispose(); renderer.dispose();
    },
  };
}
