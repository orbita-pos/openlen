import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingPackagesOfTurn, packageNameOf, tallyMissingPackages } from "./missing-packages";

describe("the four messages are still worded like this where they're born", () => {
  const root = join(import.meta.dirname, "..", "..");
  it("🔴 the terminal and the compiler write the texts the counter looks for", () => {
    const terminal = readFileSync(join(root, "lib", "agent", "terminal", "herramientas-de-app.ts"), "utf8");
    const compiler = readFileSync(join(root, "lib", "apps", "compilador.ts"), "utf8");
    expect(terminal).toContain("errors.map((n) => `npm error ${n.message}`)");
    expect(compiler).toContain('"${especificador}" is not installed in this app.');
    expect(compiler).toContain('"${especificador}": imports from URLs or "${especificador.split(":")[0]}:" are not supported here.');
    expect(compiler).toContain('"${especificador}" is a package name, and packages can only be imported in an app.');
  });
});

// The messages exactly as the terminal (trabajador.mjs, `npm install`) and the
// compiler (lib/apps/compilador.ts) write them. If one changes its text, these
// tests say so: otherwise the counter would silently stop seeing it.
const NPM = "three: isn't available here — there is no npm; the catalog has: react, react-dom\n@react-three/fiber: isn't available here — there is no npm; the catalog has: react, react-dom\n";
const IMPORT = `"three/examples/jsm/controls/PointerLockControls.js" is not installed in this app. It installs when a file that imports it is saved (or with npm install three); if that failed, the reason is in this same report.`;
const URL_IMPORT = `"https://esm.sh/leaflet@1.9.4": imports from URLs or "https:" are not supported here. Import the package by its name and it installs from npm.`;
const PAGE = `"chart.js" is a package name, and packages can only be imported in an app. Import files by path (./file.js).`;

describe("packageNameOf", () => {
  it("keeps the package: no subpath or version, with its scope", () => {
    expect(packageNameOf("three/examples/jsm/x.js")).toBe("three");
    expect(packageNameOf("@react-three/fiber")).toBe("@react-three/fiber");
    expect(packageNameOf("@react-three/drei/core")).toBe("@react-three/drei");
    expect(packageNameOf("leaflet@1.9.4")).toBe("leaflet");
    expect(packageNameOf("@scope/pkg@2")).toBe("@scope/pkg");
  });

  it("gets the package out of a CDN URL; out of any other URL, nothing", () => {
    expect(packageNameOf("https://esm.sh/leaflet@1.9.4")).toBe("leaflet");
    expect(packageNameOf("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js")).toBe("three");
    expect(packageNameOf("https://unpkg.com/@react-three/fiber@8")).toBe("@react-three/fiber");
    expect(packageNameOf("https://cdn.skypack.dev/canvas-confetti")).toBe("canvas-confetti");
    expect(packageNameOf("https://example.com/lib.js")).toBeNull();
  });
});

describe("missingPackagesOfTurn", () => {
  it("finds the four messages anywhere in the transcript", () => {
    const transcript = {
      mensajes: [
        { role: "tool", content: NPM },
        { role: "tool", content: [{ type: "text", text: `<new-diagnostics>${IMPORT}</new-diagnostics>` }] },
        { role: "user", content: { nested: [URL_IMPORT, PAGE] } },
      ],
      leidos: [],
    };
    expect(missingPackagesOfTurn(transcript)).toEqual([
      { pkg: "three", source: "npm-install" },
      { pkg: "@react-three/fiber", source: "npm-install" },
      { pkg: "three", source: "import" },
      { pkg: "leaflet", source: "url-import" },
      { pkg: "chart.js", source: "page-import" },
    ]);
  });

  it("🔴 also inside a response stored as JSON (`contenidoDeRespuesta` stringifies it when there's no text)", () => {
    const transcript = {
      mensajes: [
        { role: "tool", content: JSON.stringify({ exitCode: 1, output: NPM }) },
        { role: "tool", content: JSON.stringify({ ok: false, diagnostics: [IMPORT] }) },
      ],
    };
    expect(missingPackagesOfTurn(transcript)).toEqual([
      { pkg: "three", source: "npm-install" },
      { pkg: "@react-three/fiber", source: "npm-install" },
      { pkg: "three", source: "import" },
    ]);
  });

  it("🔴 open npm: `npm install` errors name the package the gate or esm.sh refused", () => {
    const out = [
      "npm error young: published 10 days ago; packages must be at least 30 days old.",
      "npm error three@^0.181.0: every matching version is newer than 7 days (newest allowed: 0.180.0).",
      "npm error @evil/pkg@1.2.3 is flagged as malware (MAL-2026-1) and was not installed.",
      "npm error shaky@1.0.0 depends on fresh@1.0.0, published 2 days ago; not installed.",
      "npm error this app already has 50 packages outside its catalog; big was not installed.",
      "npm warn three@0.186.1 has no TypeScript types; what it exports is typed as any.",
    ].join("\n");
    expect(missingPackagesOfTurn({ m: out })).toEqual([
      { pkg: "young", source: "npm-install" },
      { pkg: "three", source: "npm-install" },
      { pkg: "@evil/pkg", source: "npm-install" },
      { pkg: "shaky", source: "npm-install" },
    ]);
  });

  it("the compiler's wording before open npm still counts (turns already stored)", () => {
    const old = `"three" is not available in this app. Available packages: react, react-dom. Anything else has to be written in the project.`;
    expect(missingPackagesOfTurn({ m: old })).toEqual([{ pkg: "three", source: "import" }]);
  });

  it("a text that starts with a brace but isn't JSON is read as is", () => {
    expect(missingPackagesOfTurn({ m: `{ broken\n${NPM}` })).toEqual([
      { pkg: "three", source: "npm-install" },
      { pkg: "@react-three/fiber", source: "npm-install" },
    ]);
  });

  it("the same package repeated in the turn counts once per source", () => {
    const transcript = { mensajes: [{ content: NPM }, { content: NPM }, { content: IMPORT }, { content: IMPORT }] };
    expect(missingPackagesOfTurn(transcript).filter((h) => h.pkg === "three")).toHaveLength(2);
  });

  it("CONTROL: a catalog package or a missing file don't count", () => {
    const transcript = {
      mensajes: [
        { content: "react: already available (catalog)\n" },
        { content: `Cannot find "./Boton" (imported from /src/App.tsx). Paths are resolved against the project's files.` },
      ],
    };
    expect(missingPackagesOfTurn(transcript)).toEqual([]);
  });

  it("an empty or odd transcript doesn't throw", () => {
    expect(missingPackagesOfTurn(null)).toEqual([]);
    expect(missingPackagesOfTurn("loose text")).toEqual([]);
    expect(missingPackagesOfTurn({ a: 1, b: [true, null] })).toEqual([]);
  });
});

describe("tallyMissingPackages", () => {
  const turn = (projectId: string, createdAt: string, ...contents: string[]) => ({
    projectId,
    createdAt: new Date(createdAt),
    transcript: { mensajes: contents.map((content) => ({ content })) },
  });

  it("counts turns and projects per package, sorts by projects, and says whether it's already in the current catalog", () => {
    const rows = tallyMissingPackages(
      [
        turn("p1", "2026-10-10T10:00:00Z", NPM, IMPORT),
        turn("p1", "2026-10-11T10:00:00Z", IMPORT),
        turn("p2", "2026-10-12T10:00:00Z", IMPORT),
        turn("p3", "2026-10-12T11:00:00Z", `"framer-motion" is not installed in this app. It installs when a file that imports it is saved (or with npm install framer-motion); if that failed, the reason is in this same report.`),
      ],
      ["react", "react-dom", "framer-motion"],
    );
    expect(rows[0]).toEqual({
      pkg: "three",
      projects: 2,
      turns: 3,
      sources: ["import", "npm-install"],
      lastSeen: "2026-10-12",
      inCurrentCatalog: false,
    });
    expect(rows.find((f) => f.pkg === "framer-motion")).toMatchObject({ projects: 1, inCurrentCatalog: true });
    expect(rows.find((f) => f.pkg === "@react-three/fiber")).toMatchObject({ projects: 1, turns: 1 });
  });
});
