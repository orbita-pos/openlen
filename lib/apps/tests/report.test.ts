// @vitest-environment node
// El informe de `npm test` (plan 04, tarea 6): el de vitest, línea a línea.
import { describe, expect, it } from "vitest";
import { formatVitestReport } from "./report";
import type { TestRun } from "./run-tests";

const SUMA = 'import { describe, it, expect } from "vitest";\ndescribe("suma", () => {\n  it("bien", () => { expect(1 + 1).toBe(2); });\n  it("mal", () => {\n    expect(1 + 2).toBe(4);\n  });\n  it.skip("luego", () => {});\n});\n';
const RUN: TestRun = {
  ms: 911,
  notRun: [],
  blocked: [],
  files: [
    { file: "/src/ok.test.js", ms: 2, fileError: null, unhandled: [], tests: [{ name: ["ok"], state: "pass", ms: 1, error: null }] },
    {
      file: "/src/suma.test.js",
      ms: 11,
      fileError: null,
      unhandled: [],
      tests: [
        { name: ["suma", "bien"], state: "pass", ms: 1, error: null },
        { name: ["suma", "mal"], state: "fail", ms: 8, error: { name: "AssertionError", message: "expected 3 to be 4 // Object.is equality", diff: "- Expected\n+ Received\n\n- 4\n+ 3", site: { ruta: "/src/suma.test.js", linea: 5, columna: 19 } } },
        { name: ["suma", "luego"], state: "skip", ms: 0, error: null },
      ],
    },
  ],
};

describe("formatVitestReport", () => {
  it("🔴 el texto de vitest, con el diff y el marco de código; sale con 1", () => {
    const r = formatVitestReport(RUN, { "/src/suma.test.js": SUMA }, new Date(2026, 9, 9, 12, 17, 43));
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe(
      [
        "",
        " RUN  v4.1.11 /",
        "",
        " ✓ src/ok.test.js (1 test) 2ms",
        " ❯ src/suma.test.js (3 tests | 1 failed | 1 skipped) 11ms",
        "   × suma > mal 8ms",
        "     → expected 3 to be 4 // Object.is equality",
        "",
        "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
        "",
        " FAIL  src/suma.test.js > suma > mal",
        "AssertionError: expected 3 to be 4 // Object.is equality",
        "",
        "- Expected",
        "+ Received",
        "",
        "- 4",
        "+ 3",
        "",
        " ❯ src/suma.test.js:5:19",
        "      3|   it(\"bien\", () => { expect(1 + 1).toBe(2); });",
        "      4|   it(\"mal\", () => {",
        "      5|     expect(1 + 2).toBe(4);",
        "       |                   ^",
        "      6|   });",
        "      7|   it.skip(\"luego\", () => {});",
        "",
        "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯",
        "",
        " Test Files  1 failed | 1 passed (2)",
        "      Tests  1 failed | 2 passed | 1 skipped (4)",
        "   Start at  12:17:43",
        "   Duration  911ms",
        "",
      ].join("\n"),
    );
  });

  it("todo bien: sale con 0, y el fichero sin desplegar", () => {
    const r = formatVitestReport({ ...RUN, files: [RUN.files[0]!] }, {}, new Date(2026, 9, 9, 12, 0, 0));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(" Test Files  1 passed (1)\n      Tests  1 passed (1)\n");
  });

  it("sin ficheros: como vitest, con el include, y sale con 1", () => {
    const r = formatVitestReport({ files: [], notRun: [], blocked: [], ms: 5 }, {});
    expect(r).toEqual({ stdout: "\nNo test files found, exiting with code 1\n\ninclude: **/*.{test,spec}.?(c|m)[jt]s?(x)\n", exitCode: 1 });
  });

  it("un fichero que no cargó: FAIL con su error, y cuenta como fallido", () => {
    const r = formatVitestReport(
      { files: [{ file: "/src/a.test.js", tests: [], unhandled: [], ms: 0, fileError: { name: "Error", message: "/src/a.test.js:2 — Unexpected token", diff: null, site: null } }], notRun: [], blocked: [], ms: 3 },
      {},
      new Date(2026, 9, 9, 12, 0, 0),
    );
    expect(r.stdout).toContain(" ❯ src/a.test.js (0 test)\n");
    expect(r.stdout).toContain("⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  src/a.test.js [ src/a.test.js ]\nError: /src/a.test.js:2 — Unexpected token\n");
    expect(r.stdout).toContain(" Test Files  1 failed (1)\n      Tests  no tests\n");
    expect(r.exitCode).toBe(1);
  });

  it("lo que cortó el guardia se dice al final", () => {
    const r = formatVitestReport({ ...RUN, files: [RUN.files[0]!], blocked: ["https://example.com/x"] }, {});
    expect(r.stdout).toContain("\nBlocked network requests (tests run in a sandboxed browser): https://example.com/x\n");
    expect(r.exitCode).toBe(0);
  });

  it("🔴 sin tiempo para todo: lo que vitest imprime hasta que lo matan (la cabecera y los ficheros acabados), sin resumen; timedOut", () => {
    const r = formatVitestReport({ ...RUN, files: [RUN.files[0]!], notRun: ["/src/lento.test.js"] }, {});
    expect(r).toEqual({ stdout: "\n RUN  v4.1.11 /\n\n ✓ src/ok.test.js (1 test) 2ms\n", exitCode: 143, timedOut: true });
  });

  it("🔴 un fichero con todo saltado (-t que no casa) va con ↓ y sin ms, y cuenta como skipped; sale con 0 (medido en vitest 2.1.9)", () => {
    const saltado = (file: string, n: number) => ({ file, ms: 1, fileError: null, unhandled: [], tests: Array.from({ length: n }, (_, i) => ({ name: [`t${i}`], state: "skip" as const, ms: 0, error: null })) });
    const nada = formatVitestReport({ ms: 5, notRun: [], blocked: [], files: [saltado("/src/b.test.js", 1), saltado("/src/a.test.js", 2)] }, {}, new Date(2026, 9, 9, 17, 4, 24));
    expect(nada.stdout).toContain(" ↓ src/b.test.js (1 test | 1 skipped)\n ↓ src/a.test.js (2 tests | 2 skipped)\n\n Test Files  2 skipped (2)\n      Tests  3 skipped (3)\n");
    expect(nada.exitCode).toBe(0);
    const parte = formatVitestReport({ ms: 5, notRun: [], blocked: [], files: [saltado("/src/b.test.js", 1), { ...RUN.files[0]!, tests: [...RUN.files[0]!.tests, { name: ["y"], state: "skip", ms: 0, error: null }] }] }, {});
    expect(parte.stdout).toContain(" ↓ src/b.test.js (1 test | 1 skipped)\n ✓ src/ok.test.js (2 tests | 1 skipped) 2ms\n");
    expect(parte.stdout).toContain(" Test Files  1 passed | 1 skipped (2)\n      Tests  1 passed | 2 skipped (3)\n");
  });
});
