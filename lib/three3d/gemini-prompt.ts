import { GOLDEN } from "./golden-specs";
import type { GenInput } from "./gen-types";

export function buildSystemPrompt(): string {
  const examples = GOLDEN.slice(0, 6)
    .map((g) => `Brief: "${g.brief}"\n${JSON.stringify(g.spec)}`)
    .join("\n\n");
  return `You generate a single DECORATIVE/ABSTRACT 3D "SceneSpec" for a web page hero background. Output ONLY one JSON object matching this exact schema — no prose, no markdown, JSON only.

SceneSpec shape (all numeric params are 0..1):
- version: 1
- preset: "background" | "accent" | "divider"
- geometry.kind: "sphere" | "torus" | "torusKnot" | "icosa" | "blob" | "particles" | "plane"
- geometry.params: { scale, detail, distort, density }
- material.kind: "matte" | "metal" | "glass" | "iridescent" | "gradient" | "chrome" | "emissive"
- material: { roughness, metalness, opacity, accentLinked: boolean, colors: ["#rrggbb", ...] }
- motion.kind: "still" | "drift" | "rotate" | "pulse" | "parallax"  (prefer "drift" or "still"; "rotate" for spin)
- motion: { speed, amplitude }
- look: "studio" | "soft" | "dramatic" | "neutral"  (lighting recipe)
- camera.framing: "centered" | "offset" | "wide"
- background: "transparent" | "color" | "gradient"
Behavior mapping: "float-rotate" → motion.kind "drift"; "still" → motion.kind "still".

Rules: it must be ABSTRACT/decorative (no recognizable real objects — those are unsupported). Set accentLinked:true when the brand color should drive the material; otherwise pick tasteful colors. Keep it premium and varied.
Glass/iridescent/transmissive materials MUST use background: "gradient" — they need a colored backdrop to read well and look dull on transparent/black.

Examples:
${examples}`;
}

export function buildUserPrompt(input: GenInput): string {
  const parts = [`Brief: "${input.describe}"`];
  if (input.look) parts.push(`Look: ${input.look}`);
  if (input.behavior) {
    if (input.behavior === "still") {
      parts.push("Motion: still — no movement (use motion.kind \"still\", speed 0, amplitude 0).");
    } else if (input.behavior === "float-rotate") {
      parts.push("Motion: gentle floating drift with slow rotation (use motion.kind \"drift\").");
    }
  }
  if (input.brandMatch !== false && input.accent) parts.push(`Brand accent: ${input.accent} (set accentLinked:true and use it)`);
  parts.push("Output ONLY the JSON SceneSpec.");
  return parts.join("\n");
}
