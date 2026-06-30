import { describe, it, expect } from "vitest";
import { buildSceneHostHtml } from "./scene-host";
import { SAMPLE_SPEC } from "../three3d/scene-spec";

describe("buildSceneHostHtml", () => {
  it("inlines the runtime, calls mount, and exposes a ready flag", () => {
    const html = buildSceneHostHtml(SAMPLE_SPEC, "window.OpenLen3D={mount:function(){}};");
    expect(html).toContain("OpenLen3D");
    expect(html).toContain("OpenLen3D.mount");
    expect(html).toContain("three-ready");
    expect(html).toContain("__ol3dReady");
    expect(html).toContain('"kind":"iridescent"'); // spec serialized in
    expect(html).toContain("<canvas");
  });
});
