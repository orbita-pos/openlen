/**
 * THE MANUAL THAT `read_me` RETURNS (local spec 2026-10-16-len-inline-visuals,
 * §4.2). Stub for Task 1; Task 2 writes it.
 */
import type { VisualModule } from "./widget";

export type VisualPlatform = "mobile" | "desktop" | "unknown";

export function buildVisualsManual(modules: readonly VisualModule[], platform: VisualPlatform): string {
  return [`Visuals manual (${platform}).`, ...modules.map((m) => `## ${m}`)].join("\n\n");
}
