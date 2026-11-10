import { describe, expect, it } from "vitest";
import { NEUTRAL_POSE, blinkAt, stepPose, targetPose, type Pose } from "./pose";

const times = (from: number, to: number, step = 0.05): number[] => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
const span = (values: number[]): number => Math.max(...values) - Math.min(...values);
const FIELDS = ["yaw", "pitch", "roll", "lift", "stretch", "eyeOpen"] as const;

describe("targetPose", () => {
  it("closes the eyes when asleep and ignores where it was told to look", () => {
    for (const t of times(0, 6, 0.5)) {
      const pose = targetPose("asleep", t, [1, 1]);
      expect(pose.eyeOpen).toBeLessThan(0.1);
      expect(pose.gaze).toEqual([0, 0]);
    }
  });

  it("leans in with wide eyes when listening", () => {
    const pose = targetPose("listening", 1, null);
    expect(pose.pitch).toBeGreaterThan(0.1);
    expect(pose.eyeOpen).toBeGreaterThan(1.05);
  });

  it("looks up and aside when thinking, whatever it was asked, and sways", () => {
    expect(targetPose("thinking", 0, [1, -1]).gaze[1]).toBeGreaterThan(0.5);
    expect(targetPose("thinking", 0.3, null).yaw).not.toBeCloseTo(targetPose("thinking", 1.3, null).yaw, 3);
  });

  it("moves more when working than when ready", () => {
    const lift = (activity: "working" | "ready") => span(times(0, 4).map((t) => targetPose(activity, t, null).lift));
    expect(lift("working")).toBeGreaterThanOrEqual(lift("ready") * 2);
    expect(lift("working")).toBeGreaterThan(0.02);
  });

  it("bounces while talking, within bounds", () => {
    const stretch = times(0, 1, 0.02).map((t) => targetPose("talking", t, null).stretch);
    expect(span(stretch)).toBeGreaterThan(0.03);
    expect(Math.min(...stretch)).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...stretch)).toBeLessThanOrEqual(1.12);
  });

  it("shakes on an error and settles back to ready", () => {
    const early = Math.max(...times(0.05, 0.3, 0.01).map((t) => Math.abs(targetPose("error", t, null).roll)));
    const late = Math.max(...times(1.1, 1.3, 0.01).map((t) => Math.abs(targetPose("error", t, null).roll)));
    expect(early).toBeGreaterThan(0.05);
    expect(late).toBeLessThan(early / 3);
    expect(targetPose("error", 2, null)).toEqual(targetPose("ready", 2, null));
  });

  it("follows the gaze it was given when ready", () => {
    expect(targetPose("ready", 1, [0.6, -0.4]).gaze).toEqual([0.6, -0.4]);
    expect(targetPose("ready", 1, null).gaze).toEqual([0, 0]);
  });

  it("is the neutral pose, breathing aside, when ready", () => {
    const pose = targetPose("ready", 0.7, null);
    expect(pose.yaw).toBe(NEUTRAL_POSE.yaw);
    expect(pose.eyeOpen).toBe(NEUTRAL_POSE.eyeOpen);
    expect(Math.abs(pose.stretch - 1)).toBeLessThan(0.03);
  });
});

describe("stepPose", () => {
  const from: Pose = { ...NEUTRAL_POSE };
  const to: Pose = { yaw: 0.4, pitch: -0.2, roll: 0.1, lift: 0.08, stretch: 1.1, eyeOpen: 0.2, gaze: [0.5, -0.5] };

  it("does not move when no time passed", () => {
    expect(stepPose(from, to, 0)).toEqual(from);
  });

  it("arrives, and never overshoots on the way", () => {
    let pose = from;
    for (let i = 0; i < 200; i++) {
      pose = stepPose(pose, to, 1 / 60);
      for (const f of FIELDS) {
        expect(pose[f]).toBeGreaterThanOrEqual(Math.min(from[f], to[f]) - 1e-9);
        expect(pose[f]).toBeLessThanOrEqual(Math.max(from[f], to[f]) + 1e-9);
      }
    }
    for (const f of FIELDS) expect(pose[f]).toBeCloseTo(to[f], 3);
    expect(pose.gaze[0]).toBeCloseTo(0.5, 3);
    expect(pose.gaze[1]).toBeCloseTo(-0.5, 3);
  });

  it("survives a huge or negative step", () => {
    expect(stepPose(from, to, 100).yaw).toBeCloseTo(to.yaw, 6);
    expect(stepPose(from, to, -1)).toEqual(from);
  });
});

describe("blinkAt", () => {
  const blinks = (seed: number): number[] => {
    const starts: number[] = [];
    let closed = false;
    for (const t of times(0, 60, 0.01)) {
      const now = blinkAt(t, seed) > 0.5;
      if (now && !closed) starts.push(t);
      closed = now;
    }
    return starts;
  };

  it("blinks every few seconds", () => {
    const n = blinks(1).length;
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(24);
  });

  it("is the same every time for the same seed", () => {
    for (const t of [0.3, 4.2, 17.9]) expect(blinkAt(t, 5)).toBe(blinkAt(t, 5));
  });

  it("does not blink in step with another seed", () => {
    const a = blinks(1), b = blinks(2);
    expect(a.filter((t) => b.some((u) => Math.abs(u - t) < 0.05)).length).toBeLessThan(a.length / 2);
  });

  it("stays between open and closed", () => {
    for (const t of times(0, 20, 0.013)) {
      const v = blinkAt(t, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
