import { describe, expect, it } from "vitest";
import { isAssetSubpath, parseBareSpecifier, specifierOf } from "./specifier";

describe("parseBareSpecifier", () => {
  it("splits package name and subpath, scoped or not", () => {
    expect(parseBareSpecifier("three")).toEqual({ name: "three", subpath: "" });
    expect(parseBareSpecifier("three/examples/jsm/controls/OrbitControls.js")).toEqual({ name: "three", subpath: "examples/jsm/controls/OrbitControls.js" });
    expect(parseBareSpecifier("@react-three/fiber")).toEqual({ name: "@react-three/fiber", subpath: "" });
    expect(parseBareSpecifier("@react-three/drei/core")).toEqual({ name: "@react-three/drei", subpath: "core" });
  });

  it("is null for relative paths, absolute paths, URLs and node: builtins", () => {
    for (const s of ["./x", "../x", "/src/x", "https://esm.sh/three", "node:fs", ""]) expect(parseBareSpecifier(s)).toBeNull();
  });
});

describe("isAssetSubpath / specifierOf", () => {
  it("knows CSS, images and fonts", () => {
    expect(isAssetSubpath("dist/leaflet.css")).toBe(true);
    expect(isAssetSubpath("dist/images/marker-icon.png")).toBe(true);
    expect(isAssetSubpath("files/inter-latin-400-normal.woff2")).toBe(true);
    expect(isAssetSubpath("examples/jsm/controls/OrbitControls.js")).toBe(false);
  });

  it("joins name and subpath back", () => {
    expect(specifierOf("three", "")).toBe("three");
    expect(specifierOf("leaflet", "dist/leaflet.css")).toBe("leaflet/dist/leaflet.css");
  });
});
