// THE ASSISTANT'S FIGURE, FLAT (spec local 2026-11-10-figuras-del-asistente, §5.3): her look from the catalog as a
// plain SVG — what shows small (the rail, a card, the face beside a message) and under the live one until it paints
// (./live-figure.tsx). One drawing for every surface: lib/figure/flat.ts, which the published bubble bakes too.
import { flatFigureSvg } from "@/lib/figure/flat";
import type { FigureLook } from "@/lib/figure/look";

export function AssistantFigure({ look, size = 32, label }: { look: FigureLook; size?: number; label?: string }) {
  return (
    <span
      data-assistant-figure=""
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: "inline-flex", width: size, height: size, flex: "none", lineHeight: 0 }}
      // Built from a checked look: nothing of it reaches the markup unvalidated (flat.ts).
      dangerouslySetInnerHTML={{ __html: flatFigureSvg(look, size) }}
    />
  );
}
