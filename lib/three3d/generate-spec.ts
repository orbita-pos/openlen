import type { SceneSpec } from "./scene-spec";
import { coerceSceneSpec } from "./scene-spec";
import { GOLDEN } from "./golden-specs";
import type { GenInput, GenResult, Provider } from "./gen-types";

export function resolveProvider(opts?: { provider?: Provider }): Provider {
  if (opts?.provider) return opts.provider;
  return process.env.OPENLEN_3D_PROVIDER === "gemini" ? "gemini" : "mock";
}

function nearestGolden(describe: string): SceneSpec {
  const words = new Set(describe.toLowerCase().split(/\s+/).filter(Boolean));
  let best = GOLDEN[0], bestScore = -1;
  for (const g of GOLDEN) {
    const score = g.brief.toLowerCase().split(/\s+/).filter((w) => words.has(w)).length;
    if (score > bestScore) { bestScore = score; best = g; }
  }
  return structuredClone(best.spec);
}

export function applyInputOverrides(spec: SceneSpec, input: GenInput): SceneSpec {
  const out = structuredClone(spec);
  if (input.look) out.look = input.look;
  if (input.behavior === "still") out.motion = { ...out.motion, kind: "still", speed: 0, amplitude: 0 };
  else if (input.behavior === "float-rotate") out.motion = { ...out.motion, kind: "drift" };
  if (input.brandMatch !== false && input.accent && /^#[0-9a-fA-F]{6}$/.test(input.accent)) {
    out.material = { ...out.material, accentLinked: true, colors: [input.accent, ...out.material.colors.slice(1)] };
  }
  return coerceSceneSpec(out);
}

export async function generateSceneSpec(input: GenInput, opts?: { provider?: Provider }): Promise<GenResult> {
  const provider = resolveProvider(opts);
  if (provider === "mock") {
    const base = input.devSpec != null ? coerceSceneSpec(input.devSpec) : nearestGolden(input.describe);
    return { spec: applyInputOverrides(base, input), provider, rerolls: 0, fallback: false };
  }
  const { runGemini } = await import("./generate-spec.gemini");
  const r = await runGemini(input);
  return { spec: applyInputOverrides(r.spec, input), provider, rerolls: r.rerolls, fallback: r.fallback };
}
