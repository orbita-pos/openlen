// THE ASSISTANT'S FIGURE AS MARKUP (spec local 2026-11-06-asistente-propio, §6.10; phase 2A): what the published
// page's bubble wears. The same drawing as the workspace's AssistantFigure (components/workspace-v2/assistant/
// figure.tsx), pinned equal by figure-svg.test. Placeholders until the figures' design pass (phase 6).
//
// Pure. `color` must already be a checked #RRGGBB (lib/assistants/names.ts).
import type { AssistantShape } from "./names";

const eyes = (cy: number) => `<ellipse cx="23" cy="${cy}" rx="3.4" ry="4.8" fill="#1d1d1f"></ellipse><ellipse cx="37" cy="${cy}" rx="3.4" ry="4.8" fill="#1d1d1f"></ellipse>`;

function body(shape: AssistantShape, color: string): string {
  switch (shape) {
    case "ring":
      return `<circle cx="30" cy="30" r="19" fill="none" stroke="${color}" stroke-width="9"></circle>${eyes(30)}`;
    case "drop":
      return `<path d="M30 5C30 5 50 26 50 38a20 20 0 0 1-40 0C10 26 30 5 30 5z" fill="${color}"></path>${eyes(38)}`;
    case "square":
      return `<rect x="8" y="10" width="44" height="40" rx="14" fill="${color}"></rect>${eyes(30)}`;
    default:
      return `<path d="M30 6c14 0 24 9 24 24s-10 24-24 24S6 45 6 30 16 6 30 6z" fill="${color}"></path>${eyes(29)}`;
  }
}

export function figureSvg(shape: AssistantShape, color: string, size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 60 60" aria-hidden="true">${body(shape, color)}</svg>`;
}
