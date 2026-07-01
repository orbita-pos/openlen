import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { optimizeGlb, prepareModelGlb } from "./optimize";

const FIXTURE = resolve("models", "starter", "deco-crystal.glb");

describe("optimizeGlb", () => {
  it("shrinks the GLB and keeps it loadable", async () => {
    const input = await readFile(FIXTURE);
    const { glb, report } = await optimizeGlb(input);
    expect(glb.byteLength).toBeLessThan(input.byteLength);
    expect(report.beforeBytes).toBe(input.byteLength);
    expect(report.afterBytes).toBe(glb.byteLength);
    // Round-trips through a decoder-equipped reader (what the runtime effectively does).
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const doc = await io.readBinary(new Uint8Array(glb));
    expect(doc.getRoot().listMeshes().length).toBeGreaterThan(0);
  });
  it("prepareModelGlb with optimize:false is identity", async () => {
    const input = await readFile(FIXTURE);
    const { glb, report } = await prepareModelGlb(input, { optimize: false });
    expect(glb.equals(input)).toBe(true);
    expect(report).toBeNull();
  });
});
