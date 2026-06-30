// lib/three3d/runtime/mount.ts
import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh, Color,
  SphereGeometry, TorusGeometry, TorusKnotGeometry, IcosahedronGeometry,
  PlaneGeometry, CapsuleGeometry, BufferGeometry, BufferAttribute, Points,
  MeshStandardMaterial, MeshPhysicalMaterial, PointsMaterial,
  PMREMGenerator, ACESFilmicToneMapping, SRGBColorSpace, DirectionalLight,
  type Material, type Object3D,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { SceneSpec, GeometryKind, MaterialKind } from "../scene-spec";
import { buildSceneConfig, type SceneConfig } from "./interpret";

export interface MountHandle { dispose: () => void }

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

function makeMaterial(kind: MaterialKind, cfg: SceneConfig, faceted = false): Material {
  if (kind === "glass" || kind === "iridescent") return glassMaterial(cfg, faceted);
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
  // matte / gradient / emissive — env-lit standard (interim; tuned in later registers)
  return new MeshStandardMaterial({
    color: new Color(cfg.color),
    emissive: new Color(cfg.emissive), emissiveIntensity: kind === "emissive" ? 1.2 : 0,
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
  const host = canvas.parentElement ?? canvas;
  const width = host.clientWidth || 800;
  const height = host.clientHeight || 600;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = cfg.exposure;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const env = new RoomEnvironment();
  const envRT = pmrem.fromScene(env, 0.04);
  scene.environment = envRT.texture;
  env.dispose();

  const camera = new PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(0, 0, cfg.cameraZ + 2.5);

  const key = new DirectionalLight(0xffffff, 2.0); key.position.set(4, 5, 6); scene.add(key);
  const rim = new DirectionalLight(0xffffff, 1.0); rim.position.set(-5, -2, 3); scene.add(rim);

  const disposables: { dispose: () => void }[] = [];
  const track = <T extends Object3D>(o: T): T => { o.traverse((n: any) => { if (n.geometry) disposables.push(n.geometry); if (n.material) disposables.push(n.material); }); return o; };

  const root = new Group();
  if (cfg.geometryKind === "particles") {
    root.add(track(particleField(cfg)));
  } else if (cfg.cluster) {
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

  let raf = 0, visible = true, firstFrame = true;
  const start = performance.now();

  function resize() {
    const w = host.clientWidth || width, h = host.clientHeight || height;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function frame() {
    const t = (performance.now() - start) / 1000;
    root.children.forEach((c) => { c.rotation.y = t * cfg.rotationSpeed; });
    root.position.y = Math.sin(t * 0.8) * cfg.driftAmplitude;
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
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
      for (const d of disposables) d.dispose();
      envRT.dispose(); pmrem.dispose(); renderer.dispose();
    },
  };
}
