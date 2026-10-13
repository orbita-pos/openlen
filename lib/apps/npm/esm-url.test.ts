import { describe, expect, it } from "vitest";
import { esmUrl, externalsFor, rawUrl } from "./esm-url";

describe("esmUrl", () => {
  it("pins the exact version and the target, sorts externals, marks development", () => {
    expect(esmUrl({ name: "@react-three/fiber", version: "9.8.1", subpath: "", mode: "development", externals: ["react-dom", "three", "react"] }, "https://esm.sh")).toBe(
      "https://esm.sh/@react-three/fiber@9.8.1?target=es2022&external=react,react-dom,three&dev",
    );
    expect(esmUrl({ name: "three", version: "0.186.1", subpath: "examples/jsm/controls/OrbitControls.js", mode: "production", externals: [] }, "https://esm.sh")).toBe(
      "https://esm.sh/three@0.186.1/examples/jsm/controls/OrbitControls.js?target=es2022",
    );
  });

  it("raw files go with ?raw", () => {
    expect(rawUrl("leaflet", "1.9.4", "dist/leaflet.css", "https://esm.sh")).toBe("https://esm.sh/leaflet@1.9.4/dist/leaflet.css?raw");
  });
});

describe("externalsFor", () => {
  it("🔴 only what the package declares: React, and the app's own esm.sh packages", () => {
    const fiber = { peerDependencies: { react: ">=19 <19.4", "react-dom": ">=19 <19.4", three: ">=0.156" }, dependencies: { zustand: "^5.0.3" } };
    expect(externalsFor(fiber, new Set(["three"]))).toEqual(["react", "react-dom", "three"]);
    expect(externalsFor(fiber, new Set())).toEqual(["react", "react-dom"]);
  });

  it("🔴 a package that declares nothing gets no external (its path must match the one other packages import)", () => {
    expect(externalsFor({ dependencies: {} }, new Set(["three", "@react-three/fiber"]))).toEqual([]);
  });
});
