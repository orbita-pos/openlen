/**
 * Shared icon helper for blocks that accept an `icon` slot.
 *
 * The orchestrator's section.fill step returns icon names as strings from the
 * `IconName` union (see `types.ts`). This module maps each name to a
 * lucide-react component, so block components can render icons without
 * importing lucide-react themselves.
 *
 * Why this exists separately: keeps the lucide-react import surface to one
 * file, and gives a single source of truth if we ever swap icon libraries.
 */
import {
  Check,
  CircuitBoard,
  Cloud,
  Code,
  Compass,
  Gauge,
  Globe,
  Layers,
  Lock,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Wand,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { IconName } from "./types";

const ICON_MAP: Record<IconName, LucideIcon> = {
  sparkles: Sparkles,
  code: Code,
  zap: Zap,
  shield: Shield,
  rocket: Rocket,
  globe: Globe,
  layers: Layers,
  wand: Wand,
  gauge: Gauge,
  check: Check,
  star: Star,
  circuit: CircuitBoard,
  cloud: Cloud,
  lock: Lock,
  compass: Compass,
};

/**
 * Returns the lucide-react component for the given icon name. Falls back to
 * `Sparkles` for unknown names so block rendering can never crash on bad slot
 * data — but `slotsSchema` should already have caught that at fill time.
 */
export function getIcon(name: IconName | string): LucideIcon {
  return (ICON_MAP as Record<string, LucideIcon>)[name] ?? Sparkles;
}
