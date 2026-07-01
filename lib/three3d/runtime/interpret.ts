import type { SceneSpec, Look, ShaderVariant } from "../scene-spec";

export interface LightSpec {
  color: string;
  intensity: number;
  position: [number, number, number];
}

export interface SceneConfig {
  segments: number;
  radius: number;
  distort: number;
  color: string;
  emissive: string;
  roughness: number;
  metalness: number;
  opacity: number;
  rotationSpeed: number; // radians/sec
  driftAmplitude: number; // world units
  lights: LightSpec[];
  cameraZ: number;
  geometryKind: import("../scene-spec").GeometryKind;
  materialKind: import("../scene-spec").MaterialKind;
  cluster: boolean;
  exposure: number;
  envIntensity: number;
  accentColor: string;
  shader?: ShaderVariant;
}

const DEFAULT_COLOR = "#7C5CFF";

const EXPOSURE: Record<Look, number> = { studio: 1.0, soft: 1.05, dramatic: 1.15, neutral: 1.0 };
const ENV_INTENSITY: Record<Look, number> = { studio: 1.5, soft: 1.4, dramatic: 1.3, neutral: 1.35 };

const LIGHT_RIGS: Record<Look, LightSpec[]> = {
  studio: [
    { color: "#ffffff", intensity: 1.1, position: [4, 5, 6] },
    { color: "#ffffff", intensity: 0.5, position: [-5, -2, 3] },
    { color: "#ffffff", intensity: 0.3, position: [0, 6, -4] },
  ],
  soft: [
    { color: "#fff4e6", intensity: 0.8, position: [3, 4, 5] },
    { color: "#e6f0ff", intensity: 0.6, position: [-4, 1, 4] },
  ],
  dramatic: [
    { color: "#ffffff", intensity: 1.6, position: [6, 3, 4] },
    { color: "#3a2bff", intensity: 0.5, position: [-6, -3, 2] },
  ],
  neutral: [
    { color: "#ffffff", intensity: 0.9, position: [3, 3, 5] },
    { color: "#ffffff", intensity: 0.4, position: [-3, 2, 3] },
  ],
};

export function buildSceneConfig(spec: SceneSpec): SceneConfig {
  const moving = spec.motion.kind !== "still";
  return {
    segments: Math.round(24 + spec.geometry.params.detail * 96), // 24..120
    radius: 0.6 + spec.geometry.params.scale * 1.4, // 0.6..2.0
    distort: spec.geometry.params.distort,
    color: spec.material.colors[0] ?? DEFAULT_COLOR,
    emissive: spec.material.kind === "emissive" ? (spec.material.colors[0] ?? DEFAULT_COLOR) : "#000000",
    roughness: spec.material.roughness,
    metalness: spec.material.metalness,
    opacity: spec.material.opacity,
    rotationSpeed: moving ? 0.05 + spec.motion.speed * 0.45 : 0, // rad/s
    driftAmplitude: moving && spec.motion.kind !== "rotate" ? spec.motion.amplitude * 0.4 : 0,
    lights: LIGHT_RIGS[spec.look],
    cameraZ: spec.camera.framing === "wide" ? 6 : spec.camera.framing === "offset" ? 4.5 : 4,
    geometryKind: spec.geometry.kind,
    materialKind: spec.material.kind,
    cluster: spec.preset === "background",
    exposure: EXPOSURE[spec.look],
    envIntensity: ENV_INTENSITY[spec.look],
    accentColor: spec.material.colors[0] ?? DEFAULT_COLOR,
    shader: spec.shader,
  };
}
