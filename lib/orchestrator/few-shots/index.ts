import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AestheticDirection } from "../design-tokens";

// ─────────────────────────────────────────────────────────────────────────────
// Few-shot corpus loader + rotation.
//
// At any given step that benefits from few-shot examples (html / copy / plan)
// we inject EXACTLY THREE reference variants — one per aesthetic direction —
// into the master system prompt's `<few_shot_examples>` block. The model
// pattern-matches against the craft demonstrated, not the literal structure.
//
// Rotation policy:
//   - Three directions × three variants = 27 possible triples.
//   - A round-robin counter walks the variant index per direction, so two
//     consecutive calls will not pick the same triple.
//   - If a `preferredDirection` is supplied, its variant is emitted FIRST so
//     that the example most semantically aligned with the brief is the closest
//     reference to the user message (per Lost-in-the-Middle ordering).
//
// File cache: each .jsx file is read from disk once per Node.js process. The
// corpus is ~322 KB total; caching all 9 files only after first request keeps
// the resident memory footprint tight in serverless environments.
// ─────────────────────────────────────────────────────────────────────────────

export interface FewShotExample {
  direction: AestheticDirection;
  variant: string;
  content: string;
}

// Manifest of available variants per direction. Order matters — index 0 is the
// first variant served when the rotation counter is zero. Keep alphabetical so
// the rotation pattern is predictable when debugging witness recordings.
const VARIANTS_PER_DIRECTION: Record<string, readonly string[]> = {
  "technical-minimal": ["arrow", "glass", "tide"],
  "refined-editorial": ["brace", "folio", "letter"],
  "warm-humanist": ["cohort", "daybreak", "kettle"],
};

// The three aesthetic directions we currently have few-shot corpora for.
// Extra directions exist in the design-tokens type union (editorial-maximalist,
// brutalist-technical) but the few-shot corpus only covers these three.
const COVERED_DIRECTIONS = [
  "technical-minimal",
  "refined-editorial",
  "warm-humanist",
] as const satisfies readonly AestheticDirection[];

const fileCache = new Map<string, string>();

async function loadVariant(direction: string, variant: string): Promise<string> {
  const key = `${direction}/${variant}`;
  const cached = fileCache.get(key);
  if (cached !== undefined) return cached;
  const filepath = path.join(
    process.cwd(),
    "lib",
    "orchestrator",
    "few-shots",
    direction,
    `${variant}.jsx`,
  );
  const content = await readFile(filepath, "utf8");
  fileCache.set(key, content);
  return content;
}

// Session-scoped rotation state. In production this could be Redis-backed; for
// now an in-memory counter is enough — the rotation only needs to avoid
// emitting the same triple twice in a row.
let rotationCounter = 0;

export interface LoadFewShotsOptions {
  /** Aesthetic direction to position first in the returned triple. */
  preferredDirection?: AestheticDirection;
}

/**
 * Load three few-shot examples, one per aesthetic direction. The example whose
 * direction matches `preferredDirection` (if supplied and covered) is placed
 * first; the other two follow.
 *
 * Each call advances the rotation counter so that successive invocations pick
 * different variants per direction. Three consecutive calls cycle through all
 * variants for each direction before repeating.
 */
export async function loadFewShots(
  options: LoadFewShotsOptions = {},
): Promise<FewShotExample[]> {
  const ordered = orderDirections(options.preferredDirection);
  const baseCounter = rotationCounter;
  rotationCounter += 1;

  const examples: FewShotExample[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const direction = ordered[i];
    const variants = VARIANTS_PER_DIRECTION[direction];
    if (!variants || variants.length === 0) continue;
    // Offset by `i` so the picked variants differ across directions for the
    // same call. This avoids the case where rotationCounter=0 would pick
    // variants[0] for all three directions every Nth call.
    const variantIdx = (baseCounter + i) % variants.length;
    const variant = variants[variantIdx];
    const content = await loadVariant(direction, variant);
    examples.push({
      direction: direction as AestheticDirection,
      variant,
      content,
    });
  }
  return examples;
}

function orderDirections(preferred?: AestheticDirection): string[] {
  if (!preferred || !COVERED_DIRECTIONS.includes(preferred as (typeof COVERED_DIRECTIONS)[number])) {
    return [...COVERED_DIRECTIONS];
  }
  return [preferred, ...COVERED_DIRECTIONS.filter((d) => d !== preferred)];
}

/**
 * Reset the rotation counter — used by tests and the token-budget measurement
 * script so successive runs produce deterministic output.
 */
export function resetFewShotRotation(): void {
  rotationCounter = 0;
}
