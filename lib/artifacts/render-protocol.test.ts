// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RENDER_FRAME, validateRenderPacket, type ArtifactRenderPacket } from "./render-protocol";
import { dashboardManifest } from "./adapters/dashboard/manifest";
import { dashboardFixture } from "./testing/dashboard";
import { dashboardManual } from "../agent/artifact-manuals/dashboard";

const packet = (over: Record<string, unknown> = {}) =>
  ({ version: 1, kind: "dashboard", html: "<p>x</p>", width: 1280, height: 720, probes: [], ...over }) as unknown as ArtifactRenderPacket;

function reason(run: () => unknown): { code?: string; message: string } | null {
  try { run(); return null; } catch (error) { return { code: (error as { code?: string }).code, message: (error as Error).message }; }
}

describe("a render packet that is refused says what to change", () => {
  it("accepts a dashboard inside the frame", () => {
    expect(reason(() => validateRenderPacket(packet()))).toBeNull();
  });

  it("names the height, its value and the range, keeping the code", () => {
    expect(reason(() => validateRenderPacket(packet({ height: 1200 })))).toEqual({
      code: "invalid_render_packet",
      message: '"height" is 1200; it must be a whole number of px from 240 to 1080',
    });
  });

  it("names the width the same way", () => {
    expect(reason(() => validateRenderPacket(packet({ width: 5000 })))?.message).toBe('"width" is 5000; it must be a whole number of px from 320 to 1920');
  });

  it("shows a value of the wrong type as it came", () => {
    expect(reason(() => validateRenderPacket(packet({ height: "720" })))?.message).toBe('"height" is "720"; it must be a whole number of px from 240 to 1080');
  });

  it("says how many probes there are and the most allowed", () => {
    const probes = Array.from({ length: 21 }, () => ({ expect: { selector: "#x", text: "1" } }));
    expect(reason(() => validateRenderPacket(packet({ probes })))?.message).toBe('"probes" has 21; at most 20');
  });

  it("names a motion packet's fixed frame", () => {
    const motion = packet({ kind: "motion", width: 1920, height: 1080, fps: 30, durationSeconds: 2, frameCount: 60 });
    expect(reason(() => validateRenderPacket(motion))?.message).toBe("a motion render is 1280×720 at 30 fps (got 1920×1080 at 30 fps)");
  });

  it("keeps the frame limits in one place", () => {
    expect(RENDER_FRAME).toEqual({ width: { min: 320, max: 1920 }, height: { min: 240, max: 1080 } });
  });
});

describe("a dashboard.json outside the frame", () => {
  it("points at the file and the field, as the other manifest errors do", () => {
    const input = dashboardFixture();
    const manifest = JSON.parse(input.revision.files["dashboard.json"]!);
    const tall = { ...input, revision: { ...input.revision, files: { ...input.revision.files, "dashboard.json": JSON.stringify({ ...manifest, height: 1200 }) } } };
    expect(reason(() => dashboardManifest(tall))).toEqual({
      code: "invalid_render_packet",
      message: 'dashboard.json "height" is 1200; it must be a whole number of px from 240 to 1080',
    });
  });

  it("the manual states the limits before Len writes it", () => {
    expect(dashboardManual).toContain(`"width" ${RENDER_FRAME.width.min}–${RENDER_FRAME.width.max}`);
    expect(dashboardManual).toContain(`"height" ${RENDER_FRAME.height.min}–${RENDER_FRAME.height.max}`);
  });
});
