// Editor sound — a tiny client-only Web Audio singleton that plays a short,
// pleasant click on meaningful UI actions in the /new workspace.
//
// IMPORTANT: EDITOR-ONLY. Never import from lib/publish/* or bake into a
// published page. Published pages stay silent.
//
// $0, no AI, no credits. The click is SYNTHESIZED by default (zero bytes). A
// satisfying "pop"/"tok" comes from a fast downward PITCH DROP (not a static
// sine, which reads as a cheap beep) + a soft attack + a low-pass for warmth +
// almost no broadband noise (noise is what makes a synth click harsh).
//
// Optional sample: if a file exists at /sounds/click.mp3 (public/sounds/), it
// REPLACES the synth — a well-recorded click sounds nicer than any blind synth.

type VoiceId = "thock" | "soft" | "tick";

interface Voice {
  /** Pitch at the attack (Hz). */
  freqStart: number;
  /** Pitch it settles toward (Hz). The drop start→end is the "tok". */
  freqEnd: number;
  /** How fast the pitch drops (ms). */
  pitchDecayMs: number;
  /** Total length (ms). */
  durationMs: number;
  /** Attack ramp (ms) — softens the transient. */
  attackMs: number;
  /** Amplitude decay time-constant (ms). */
  ampDecayMs: number;
  /** Low-pass cutoff (Hz) — lower = warmer/creamier. */
  lowpassHz: number;
  /** 0–1 grain. Keep tiny; broadband noise is the harsh part. */
  noise: number;
}

// Pick by EAR: change VOICE, reload /new.
//   MÁS CREMOSO = bajar lowpassHz (menos brillo) + subir attackMs (onset suave).
//   MÁS PRESENCIA/SNAP = subir lowpassHz / bajar attackMs.
const VOICES: Record<VoiceId, Voice> = {
  // "thock" — warm, creamy, woody (with low-end body). Recommended default.
  thock: { freqStart: 340, freqEnd: 145, pitchDecayMs: 16, durationMs: 95, attackMs: 6, ampDecayMs: 68, lowpassHz: 1500, noise: 0 },
  // "soft" — EXTRA creamy: darker, rounder, pillowy.
  soft: { freqStart: 280, freqEnd: 120, pitchDecayMs: 24, durationMs: 110, attackMs: 9, ampDecayMs: 90, lowpassHz: 1050, noise: 0 },
  // "tick" — brighter + snappier, if you want more presence.
  tick: { freqStart: 620, freqEnd: 230, pitchDecayMs: 9, durationMs: 60, attackMs: 3, ampDecayMs: 40, lowpassHz: 2600, noise: 0.03 },
};

const VOICE: VoiceId = "soft";

const DEBOUNCE_MS = 70;
const DEFAULT_VOLUME = 0.7; // 0–1 slider position
const MAX_GAIN = 1.35; // volume 1.0 → only light soft-clip → stays clean/creamy
const SAMPLE_URL = "/sounds/click.mp3"; // optional override; 404 = use synth

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let shaper: WaveShaperNode | null = null;
// The reward has its OWN clean bus (no soft-clip): summed chord notes through
// the click's saturator distort into a harsh "error" sound.
let rewardBus: GainNode | null = null;
let buffer: AudioBuffer | null = null;
let sampleTried = false;
let lastPlay = 0;
let currentVolume = DEFAULT_VOLUME;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

// Gentle tanh soft-clip: lets the master drive past 1.0 for loudness while
// saturating SMOOTHLY (a low k keeps it clean, not buzzy/harsh).
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const k = 1.5;
  const norm = Math.tanh(k);
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = currentVolume * MAX_GAIN;
    shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = "2x";
    master.connect(shaper);
    shaper.connect(ctx.destination);
    rewardBus = ctx.createGain();
    rewardBus.gain.value = currentVolume;
    rewardBus.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Master volume (0–1 slider position). 0 = muted. Applied live. */
export function setVolume(v: number): void {
  currentVolume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = currentVolume * MAX_GAIN;
  if (rewardBus) rewardBus.gain.value = currentVolume;
}

/** Synthesize the pitch-drop click into a normalized mono AudioBuffer. */
function synth(ac: AudioContext): AudioBuffer {
  const v = VOICES[VOICE];
  const sr = ac.sampleRate;
  const len = Math.max(1, Math.ceil((v.durationMs / 1000) * sr));
  const buf = ac.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const attackS = Math.max(0.0005, v.attackMs / 1000);
  const ampDecayS = v.ampDecayMs / 1000;
  const pitchDecayS = v.pitchDecayMs / 1000;
  const twoPiOverSr = (Math.PI * 2) / sr;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const freq = v.freqEnd + (v.freqStart - v.freqEnd) * Math.exp(-t / pitchDecayS);
    phase += twoPiOverSr * freq; // accumulate phase since frequency glides
    const attack = Math.min(1, t / attackS);
    const env = attack * Math.exp(-t / ampDecayS);
    // Fundamental + a sub-octave for low-end body/warmth — a pure sine is too
    // thin to read as a "creamy thock"; the sub fills it out.
    const body = Math.sin(phase) + 0.4 * Math.sin(phase * 0.5);
    const grain = (Math.random() * 2 - 1) * v.noise;
    d[i] = (body * (1 - v.noise) + grain) * env;
  }
  // Normalize to near full scale so loudness is predictable.
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) {
    const g = 0.99 / peak;
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}

/** Best-effort: load /sounds/click.mp3 and use it instead of the synth. */
async function loadSample(ac: AudioContext): Promise<void> {
  try {
    const res = await fetch(SAMPLE_URL, { cache: "force-cache" });
    if (!res.ok) return;
    const arr = await res.arrayBuffer();
    buffer = await ac.decodeAudioData(arr);
  } catch {
    /* no sample / decode failed → keep the synth buffer */
  }
}

/** Play one click. No-op when muted, outside the browser, or with no Web Audio.
 *  Debounced so rapid tab-mashing never machine-guns. Caller gates on volume.
 *  Everything is built LAZILY here — playClick only runs from a user gesture, so
 *  the AudioContext is never created/resumed outside one. */
export function playClick(): void {
  if (typeof window === "undefined" || currentVolume <= 0) return;
  const now = performance.now();
  if (now - lastPlay < DEBOUNCE_MS) return;
  lastPlay = now;

  const ac = ensureContext();
  if (!ac || !master) return;
  if (!buffer) buffer = synth(ac);
  if (!sampleTried) {
    sampleTried = true;
    void loadSample(ac); // swap in /sounds/click.mp3 if present (best-effort)
  }

  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 0.97 + Math.random() * 0.06; // ±~3% pitch jitter

  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = VOICES[VOICE].lowpassHz;
  lp.Q.value = 0.7;

  src.connect(lp).connect(master);
  src.start();
}

// ── Reward "bloom" — the publish-success moment (the actual delight) ──────────
let bloomBuffer: AudioBuffer | null = null;
let rewardSampleTried = false;
let rewardIsSample = false;
const REWARD_SAMPLE_URL = "/sounds/publish.mp3"; // optional override, 404 = synth

/** A warm, sustained tone that blooms + fades — one note of the success chord. */
function synthBloom(ac: AudioContext): AudioBuffer {
  const sr = ac.sampleRate;
  const len = Math.max(1, Math.ceil(0.5 * sr));
  const buf = ac.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const freq = 330;
  const attackS = 0.008;
  const decayS = 0.3; // longer ring → bell/bloom, not a beep
  const twoPi = Math.PI * 2;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.min(1, t / attackS) * Math.exp(-t / decayS);
    const body = Math.sin(twoPi * freq * t) + 0.4 * Math.sin(twoPi * (freq / 2) * t);
    d[i] = body * env;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) {
    const g = 0.99 / peak;
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}

async function loadRewardSample(ac: AudioContext): Promise<void> {
  try {
    const res = await fetch(REWARD_SAMPLE_URL, { cache: "force-cache" });
    if (!res.ok) return;
    const arr = await res.arrayBuffer();
    bloomBuffer = await ac.decodeAudioData(arr);
    rewardIsSample = true;
  } catch {
    /* keep the synth bloom */
  }
}

/** Play the publish-success reward — a warm ascending major arpeggio (or, if
 *  /sounds/publish.mp3 exists, that sample played once). Respects volume/mute. */
export function playReward(): void {
  if (typeof window === "undefined" || currentVolume <= 0) return;
  const ac = ensureContext();
  if (!ac || !rewardBus) return;
  if (!bloomBuffer) bloomBuffer = synthBloom(ac);
  if (!rewardSampleTried) {
    rewardSampleTried = true;
    void loadRewardSample(ac);
  }
  const t0 = ac.currentTime;

  if (rewardIsSample) {
    const src = ac.createBufferSource();
    src.buffer = bloomBuffer;
    src.connect(rewardBus);
    src.start(t0);
    return;
  }

  // 3-note ascending major arpeggio (root · major third · fifth) — overlapping
  // with a long ring so they bloom into a warm chord. Clean bus, no soft-clip.
  const ratios = [1, 1.25, 1.5];
  const gap = 0.08;
  for (let i = 0; i < ratios.length; i++) {
    const src = ac.createBufferSource();
    src.buffer = bloomBuffer;
    src.playbackRate.value = ratios[i];
    const g = ac.createGain();
    g.gain.value = 0.28;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1600; // warmer, less beepy
    lp.Q.value = 0.7;
    src.connect(lp).connect(g).connect(rewardBus);
    src.start(t0 + i * gap);
  }
}

// Dev-only: audition the reward from the console — window.__olReward() — without
// having to publish. Stripped from production builds. Needs sound on (volume>0).
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __olReward?: () => void }).__olReward = playReward;
}
