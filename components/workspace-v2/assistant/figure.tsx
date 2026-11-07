// THE ASSISTANT'S FIGURE (spec local 2026-11-06-asistente-propio, §4.4): placeholders until the figures' design pass
// with Jesús (phase 6). Four shapes, the color the person picked, two eyes. Nothing depends on how many there are.
import type { AssistantShape } from "@/lib/assistants/names";

const EYES = (cy: number) => (
  <>
    <ellipse cx="23" cy={cy} rx="3.4" ry="4.8" fill="#1d1d1f" />
    <ellipse cx="37" cy={cy} rx="3.4" ry="4.8" fill="#1d1d1f" />
  </>
);

export function AssistantFigure({ shape, color, size = 32, label }: { shape: AssistantShape; color: string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {shape === "ring" ? (
        <>
          <circle cx="30" cy="30" r="19" fill="none" stroke={color} strokeWidth="9" />
          {EYES(30)}
        </>
      ) : shape === "drop" ? (
        <>
          <path d="M30 5C30 5 50 26 50 38a20 20 0 0 1-40 0C10 26 30 5 30 5z" fill={color} />
          {EYES(38)}
        </>
      ) : shape === "square" ? (
        <>
          <rect x="8" y="10" width="44" height="40" rx="14" fill={color} />
          {EYES(30)}
        </>
      ) : (
        <>
          <path d="M30 6c14 0 24 9 24 24s-10 24-24 24S6 45 6 30 16 6 30 6z" fill={color} />
          {EYES(29)}
        </>
      )}
    </svg>
  );
}
