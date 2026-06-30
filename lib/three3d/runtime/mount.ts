// lib/three3d/runtime/mount.ts
import {
  Scene, PerspectiveCamera, WebGLRenderer, IcosahedronGeometry,
  MeshStandardMaterial, Mesh, DirectionalLight, AmbientLight, Color,
} from "three";
import type { SceneSpec } from "../scene-spec";
import { buildSceneConfig } from "./interpret";

export interface MountHandle {
  dispose: () => void;
}

export function mount(
  canvas: HTMLCanvasElement,
  spec: SceneSpec,
  opts: { onReady?: () => void } = {},
): MountHandle {
  const cfg = buildSceneConfig(spec);
  const host = canvas.parentElement ?? canvas;
  const width = host.clientWidth || 800;
  const height = host.clientHeight || 600;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 0, cfg.cameraZ);

  scene.add(new AmbientLight(0xffffff, 0.35));
  for (const l of cfg.lights) {
    const dl = new DirectionalLight(new Color(l.color), l.intensity);
    dl.position.set(...l.position);
    scene.add(dl);
  }

  const geometry = new IcosahedronGeometry(cfg.radius, Math.max(1, Math.round(cfg.segments / 24)));
  const material = new MeshStandardMaterial({
    color: new Color(cfg.color),
    emissive: new Color(cfg.emissive),
    roughness: cfg.roughness,
    metalness: cfg.metalness,
    transparent: cfg.opacity < 1,
    opacity: cfg.opacity,
  });
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);

  let raf = 0;
  let visible = true;
  let firstFrame = true;
  const start = performance.now();

  function resize() {
    const w = host.clientWidth || width;
    const h = host.clientHeight || height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame() {
    const t = (performance.now() - start) / 1000;
    mesh.rotation.y = t * cfg.rotationSpeed;
    mesh.rotation.x = Math.sin(t * cfg.rotationSpeed * 0.6) * 0.3;
    mesh.position.y = Math.sin(t * 0.8) * cfg.driftAmplitude;
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      opts.onReady?.();
      window.dispatchEvent(new Event("three-ready"));
    }
    if (visible) raf = requestAnimationFrame(frame);
  }

  // Pause the loop when offscreen or tab hidden (battery/thermal).
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
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
