import { z } from "zod";

const GEOMETRY_KINDS = ["sphere", "torus", "torusKnot", "icosa", "blob", "particles", "plane"] as const;
const MATERIAL_KINDS = ["matte", "metal", "glass", "iridescent", "gradient", "chrome", "emissive"] as const;
const MOTION_KINDS = ["still", "drift", "rotate", "pulse", "parallax"] as const;
const LOOKS = ["studio", "soft", "dramatic", "neutral"] as const;
const FRAMINGS = ["centered", "offset", "wide"] as const;
const PRESETS = ["background", "accent", "divider"] as const;
const BACKGROUNDS = ["transparent", "color", "gradient"] as const;

export type GeometryKind = (typeof GEOMETRY_KINDS)[number];
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export type MotionKind = (typeof MOTION_KINDS)[number];
export type Look = (typeof LOOKS)[number];

const unit = (def: number) => z.number().catch(def).transform((n) => Math.min(1, Math.max(0, n)));
const enumWithDefault = <T extends readonly [string, ...string[]]>(vals: T, def: T[number]) =>
  z.enum(vals).catch(def);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const SceneSpecSchema = z.object({
  version: z.literal(1).catch(1),
  preset: enumWithDefault(PRESETS, "background"),
  geometry: z.object({
    kind: enumWithDefault(GEOMETRY_KINDS, "sphere"),
    params: z.object({
      scale: unit(0.6),
      detail: unit(0.5),
      distort: unit(0.3),
      density: unit(0.5),
    }).catch({ scale: 0.6, detail: 0.5, distort: 0.3, density: 0.5 }),
  }).catch({ kind: "sphere", params: { scale: 0.6, detail: 0.5, distort: 0.3, density: 0.5 } }),
  material: z.object({
    kind: enumWithDefault(MATERIAL_KINDS, "matte"),
    roughness: unit(0.4),
    metalness: unit(0.6),
    opacity: unit(1),
    accentLinked: z.boolean().catch(true),
    colors: z.array(hexColor).catch([]),
  }).catch({ kind: "matte", roughness: 0.4, metalness: 0.6, opacity: 1, accentLinked: true, colors: [] }),
  motion: z.object({
    kind: enumWithDefault(MOTION_KINDS, "drift"),
    speed: unit(0.4),
    amplitude: unit(0.4),
  }).catch({ kind: "drift", speed: 0.4, amplitude: 0.4 }),
  look: enumWithDefault(LOOKS, "soft"),
  camera: z.object({ framing: enumWithDefault(FRAMINGS, "centered") }).catch({ framing: "centered" }),
  background: enumWithDefault(BACKGROUNDS, "transparent"),
});

export type SceneSpec = z.infer<typeof SceneSpecSchema>;

export function coerceSceneSpec(input: unknown): SceneSpec {
  const obj = typeof input === "object" && input !== null && !Array.isArray(input) ? input : {};
  return SceneSpecSchema.parse(obj);
}

export const SAMPLE_SPEC: SceneSpec = {
  version: 1,
  preset: "background",
  geometry: { kind: "sphere", params: { scale: 0.7, detail: 0.7, distort: 0.45, density: 0.5 } },
  material: { kind: "iridescent", roughness: 0.25, metalness: 0.8, opacity: 1, accentLinked: false, colors: ["#7C5CFF", "#FF5A36"] },
  motion: { kind: "drift", speed: 0.35, amplitude: 0.5 },
  look: "dramatic",
  camera: { framing: "centered" },
  background: "transparent",
};
