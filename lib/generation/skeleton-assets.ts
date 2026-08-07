import { parse } from "node-html-parser";
import type { CreativeDirection, SkeletonAdaptationPlan, SkeletonInventory } from "@/lib/generation/creative-contracts";
import { replaceableContentImages } from "@/lib/generation/structural-fingerprint";
import { imageTone, loadCuratedImages, type CuratedImage } from "@/lib/imagery/manifest";

const STOP_WORDS = new Set([
  "a", "an", "and", "art", "asset", "background", "children", "for", "image", "in", "of", "on", "or", "page", "photo", "picture", "scene", "soft", "storybook", "the", "to", "with",
]);

type AssetFailureCode = "required_asset_unavailable" | "asset_slot_unavailable";

export type SkeletonAssetResult =
  | { ok: true; html: string; applied: number; assigned: Array<{ slotIndex: number; imageId: string }> }
  | { ok: false; code: AssetFailureCode; slotIndex: number };

export interface ResolveSkeletonAssetsInput {
  html: string;
  inventory: SkeletonInventory;
  direction: CreativeDirection;
  plan: Pick<SkeletonAdaptationPlan, "assets">;
}

export interface SkeletonAssetDependencies {
  loadImages?: () => Promise<CuratedImage[]>;
}

function tokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function hasOverlap(needles: readonly string[], haystack: readonly string[]): number {
  let matches = 0;
  for (const needle of needles) {
    if (haystack.some((candidate) => candidate === needle || candidate.startsWith(needle) || needle.startsWith(candidate))) matches += 1;
  }
  return matches;
}

function imageMediaType(image: CuratedImage): "photo" | "illustration" | "texture" {
  const description = `${image.id} ${image.style} ${image.alt}`.toLowerCase();
  if (/illustration|drawn|drawing|artwork|cartoon|vector/.test(description)) return "illustration";
  if (/texture|pattern|grain|paper/.test(description)) return "texture";
  return "photo";
}

function strategyAllows(image: CuratedImage, direction: CreativeDirection): boolean {
  const mediaType = imageMediaType(image);
  if (direction.imagery.strategy === "illustration_first") return mediaType === "illustration";
  if (direction.imagery.strategy === "photo_first") return mediaType === "photo";
  if (direction.imagery.strategy === "texture_first") return mediaType === "texture";
  return true;
}

function forbiddenTokens(direction: CreativeDirection): string[] {
  return [...direction.imagery.avoid, ...direction.forbiddenVisualSignals].flatMap(tokens);
}

function hasForbiddenToken(image: CuratedImage, forbidden: readonly string[]): boolean {
  const imageTokens = tokens(`${image.id} ${image.style} ${image.family.join(" ")} ${image.alt}`);
  return hasOverlap(forbidden, imageTokens) > 0;
}

/** Returns eligible image IDs in deterministic best-first order. */
export function rankSkeletonAssets(input: { query: string; direction: CreativeDirection; images: readonly CuratedImage[] }): string[] {
  // The instruction query supplies the requested subject; direction constrains
  // the visual treatment but must not turn an unrelated request into a match.
  const subjectTokens = tokens(input.query);
  const forbidden = forbiddenTokens(input.direction);
  const desiredTone = input.direction.mode === "dark" ? "dark" : "light";
  return input.images
    .map((image) => {
      if (!strategyAllows(image, input.direction) || hasForbiddenToken(image, forbidden)) return null;
      const haystack = tokens(`${image.id} ${image.style} ${image.family.join(" ")} ${image.alt}`);
      const signal = hasOverlap(subjectTokens, haystack);
      if (signal === 0) return null;
      const tone = imageTone(image.alt);
      const toneBonus = tone === desiredTone ? 1 : tone === "neutral" ? 0.5 : 0;
      return { id: image.id, score: signal * 10 + toneBonus };
    })
    .filter((candidate): candidate is { id: string; score: number } => candidate !== null)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .map((candidate) => candidate.id);
}

function srcsetFor(image: CuratedImage): string {
  return `${image.src.thumb} 400w, ${image.src.tablet} 800w, ${image.src.hero} 1920w`;
}

function originalIsSafe(image: { getAttribute(name: string): string | undefined }, direction: CreativeDirection): boolean {
  const forbidden = forbiddenTokens(direction);
  return hasOverlap(forbidden, tokens(`${image.getAttribute("alt") ?? ""} ${image.getAttribute("style") ?? ""}`)) === 0;
}

export async function resolveSkeletonAssets(
  input: ResolveSkeletonAssetsInput,
  deps: SkeletonAssetDependencies = {},
): Promise<SkeletonAssetResult> {
  const root = parse(input.html);
  const images = replaceableContentImages(root);
  const catalog = await (deps.loadImages ?? loadCuratedImages)();
  const catalogById = new Map(catalog.map((image) => [image.id, image]));
  const used = new Set<string>();
  const assigned: Array<{ slotIndex: number; imageId: string }> = [];

  for (const instruction of input.plan.assets) {
    if (instruction.action === "keep") continue;
    const slot = input.inventory.assetSlots.find((asset) => asset.slotIndex === instruction.slotIndex);
    const image = images[instruction.slotIndex];
    if (!slot || !slot.replaceable || !image) return { ok: false, code: "asset_slot_unavailable", slotIndex: instruction.slotIndex };

    const candidate = rankSkeletonAssets({ query: instruction.query ?? "", direction: input.direction, images: catalog })
      .map((id) => catalogById.get(id))
      .find((item): item is CuratedImage => Boolean(item) && imageMediaType(item!) === instruction.mediaType && !used.has(item!.id));

    if (!candidate) {
      if (!instruction.required && originalIsSafe(image, input.direction)) continue;
      return { ok: false, code: "required_asset_unavailable", slotIndex: instruction.slotIndex };
    }

    image.setAttribute("src", candidate.src.hero);
    image.setAttribute("srcset", srcsetFor(candidate));
    image.setAttribute("alt", instruction.alt ?? candidate.alt);
    used.add(candidate.id);
    assigned.push({ slotIndex: instruction.slotIndex, imageId: candidate.id });
  }

  return { ok: true, html: root.toString(), applied: assigned.length, assigned };
}
