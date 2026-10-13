import { describe, expect, it } from "vitest";
import { nodeOnlyBuiltinsIn, packageVersionsIn, scanModule } from "./module-scan";

const FIBER_ENTRY = `/* esm.sh - @react-three/fiber@9.8.1 */
import "/its-fine@^2.1.1?external=react&target=es2022";
import "/node/process.mjs";
import "/three@0.186.1/es2022/three.mjs";
export * from "/@react-three/fiber@9.8.1/X-ZHRocmVlQDAuMTg2LjEKZXJlYWN0LHJlYWN0LWRvbQ/es2022/fiber.mjs";`;

describe("scanModule", () => {
  it("separates esm.sh paths, relative paths and bare names", async () => {
    const s = await scanModule(`${FIBER_ENTRY}\nimport * as R from "react";\nimport { jsx } from "react/jsx-runtime";\nimport "./local.mjs";\nconst lazy = () => import("/lazy@1.0.0/es2022/lazy.mjs");`);
    expect(s.absolute).toEqual([
      "/its-fine@^2.1.1?external=react&target=es2022",
      "/node/process.mjs",
      "/three@0.186.1/es2022/three.mjs",
      "/@react-three/fiber@9.8.1/X-ZHRocmVlQDAuMTg2LjEKZXJlYWN0LHJlYWN0LWRvbQ/es2022/fiber.mjs",
      "/lazy@1.0.0/es2022/lazy.mjs",
    ]);
    expect(s.bare).toEqual(["react", "react/jsx-runtime"]);
    expect(s.relative).toEqual(["./local.mjs"]);
  });
});

describe("packageVersionsIn", () => {
  it("reads exact versions from built paths, scoped or not; ranges and polyfills are not versions", () => {
    expect(packageVersionsIn("https://esm.sh/its-fine@2.1.1/X-ZXJlYWN0/es2022/its-fine.mjs")).toEqual([{ name: "its-fine", version: "2.1.1" }]);
    expect(packageVersionsIn("/@react-three/fiber@9.8.1/X-abc/es2022/fiber.mjs")).toEqual([{ name: "@react-three/fiber", version: "9.8.1" }]);
    expect(packageVersionsIn("/zustand@^5.0.3/traditional?external=react&target=es2022")).toEqual([]);
    expect(packageVersionsIn("/node/process.mjs")).toEqual([]);
  });
});

describe("nodeOnlyBuiltinsIn", () => {
  it("names the Node-only polyfills a graph pulls in (they throw in the browser)", () => {
    expect(nodeOnlyBuiltinsIn(["https://esm.sh/node/child_process.mjs", "/node/process.mjs", "/node/fs.mjs", "/node/buffer.mjs"])).toEqual(["child_process", "fs"]);
  });
});
