import { boldTech } from "./bold-tech";
import { modernFintech } from "./modern-fintech";
import { playfulProduct } from "./playful-product";
import { premiumPolish } from "./premium-polish";
import { technicalDark } from "./technical-dark";
import type { VibeBrief } from "./types";
import { warmEditorial } from "./warm-editorial";

/** Source of truth for the 6 launch vibes. Order here is the order shown in
 *  the workspace gallery — change deliberately. */
export const VIBES: VibeBrief[] = [
  technicalDark,
  warmEditorial,
  modernFintech,
  boldTech,
  playfulProduct,
  premiumPolish,
];

export function getVibe(id: string): VibeBrief | undefined {
  return VIBES.find((v) => v.id === id);
}

export type { VibeBrief } from "./types";
