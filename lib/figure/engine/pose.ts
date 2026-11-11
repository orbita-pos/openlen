// WHAT EACH ACTIVITY ASKS OF THE BODY (spec local 2026-11-10-figuras-del-asistente, §5.4), and how it gets there.
// Pure: numbers in, numbers out. The engine never guesses what the assistant is doing — its host says so — and
// never jumps from one pose to the next: it approaches.

export type FigureActivity = "ready" | "listening" | "thinking" | "working" | "talking" | "asleep" | "error";

export interface Pose {
  /** Radians. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Up and down, in body units. */
  lift: number;
  /** 1 at rest; above, stretched tall; below, squashed. The engine keeps the volume. */
  stretch: number;
  /** 0 closed, 1 normal, up to 1.2 wide. */
  eyeOpen: number;
  /** -1..1, +x right, +y up. */
  gaze: readonly [number, number];
}

export const NEUTRAL_POSE: Pose = { yaw: 0, pitch: 0, roll: 0, lift: 0, stretch: 1, eyeOpen: 1, gaze: [0, 0] };

const CENTER: readonly [number, number] = [0, 0];
/** How long an error's shake lasts before the figure is simply ready again. */
const ERROR_SECONDS = 1.5;

/**
 * The pose to move toward. `t` is seconds SINCE THE ACTIVITY BEGAN (an error's shake dies out; the others only
 * need a phase). `gaze` is what the host asked with lookAt, or null.
 */
export function targetPose(activity: FigureActivity, t: number, gaze: readonly [number, number] | null): Pose {
  const breath = 1 + 0.018 * Math.sin(t * 1.6);
  const look = gaze ?? CENTER;
  switch (activity) {
    case "listening":
      return { yaw: 0, pitch: 0.16, roll: 0.08, lift: 0, stretch: breath, eyeOpen: 1.15, gaze: look };
    case "thinking":
      return { yaw: 0.18 * Math.sin(t * 0.9), pitch: -0.1, roll: -0.06, lift: 0.03 * Math.sin(t * 2.2), stretch: breath, eyeOpen: 0.8, gaze: [-0.7, 0.8] };
    case "working":
      return { yaw: 0.12 * Math.sin(t * 2.4), pitch: 0.06, roll: 0, lift: 0.05 * Math.abs(Math.sin(t * 3.2)), stretch: breath, eyeOpen: 0.95, gaze: look };
    case "talking": {
      // No audio to follow: a soft, repeatable rhythm stands in for a voice.
      const voice = (0.5 + 0.5 * Math.sin(t * 13)) * (0.6 + 0.4 * Math.sin(t * 3.1));
      return { yaw: 0, pitch: 0.03, roll: 0, lift: 0.04 * voice, stretch: breath + 0.07 * voice, eyeOpen: 1, gaze: look };
    }
    case "asleep":
      return { yaw: 0, pitch: 0.12, roll: 0.05, lift: 0, stretch: 1 + 0.025 * Math.sin(t * 0.8), eyeOpen: 0.04, gaze: CENTER };
    case "error":
      if (t >= ERROR_SECONDS) return targetPose("ready", t, gaze);
      return { yaw: 0, pitch: 0, roll: 0.22 * Math.sin(t * 22) * Math.exp(-t * 3.2), lift: 0, stretch: breath, eyeOpen: 1.1, gaze: look };
    default:
      return { yaw: 0, pitch: 0, roll: 0, lift: 0, stretch: breath, eyeOpen: 1, gaze: look };
  }
}

/** One step of an exponential approach. No time, no movement; it never passes its target. */
export function stepPose(from: Pose, to: Pose, dt: number): Pose {
  if (!(dt > 0)) return from;
  const k = 1 - Math.exp(-dt * 7);
  const mix = (a: number, b: number): number => a + (b - a) * k;
  return {
    yaw: mix(from.yaw, to.yaw),
    pitch: mix(from.pitch, to.pitch),
    roll: mix(from.roll, to.roll),
    lift: mix(from.lift, to.lift),
    stretch: mix(from.stretch, to.stretch),
    eyeOpen: mix(from.eyeOpen, to.eyeOpen),
    gaze: [mix(from.gaze[0], to.gaze[0]), mix(from.gaze[1], to.gaze[1])],
  };
}

const SLOT = 4;
const BLINK = 0.14;
const noise = (seed: number, k: number): number => {
  const x = Math.sin(seed * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * How closed the eyes are at `t` from blinking alone: 0 open, 1 closed. One blink of 140 ms somewhere in every
 * 4-second slot, placed by the seed — so two figures on a page do not blink together, and any `t` is answered
 * without replaying what came before.
 */
export function blinkAt(t: number, seed: number): number {
  if (!(t >= 0)) return 0;
  const slot = Math.floor(t / SLOT);
  const since = t - slot * SLOT - noise(seed, slot) * 2.5;
  return since >= 0 && since <= BLINK ? Math.sin((Math.PI * since) / BLINK) : 0;
}
