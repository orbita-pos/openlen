import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingPackagesOfTurn, packageNameOf, tallyMissingPackages } from "./missing-packages";

describe("the messages are still worded like this where they're born", () => {
  const root = join(import.meta.dirname, "..", "..");
  const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
  it("🔴 the compiler, the gate and the installer write the texts the counter looks for", () => {
    const compiler = read("lib", "apps", "compilador.ts");
    const gate = read("lib", "apps", "npm", "gate.ts");
    const install = read("lib", "apps", "npm", "install.ts");
    expect(compiler).toContain('"${especificador}" is not installed in this app.');
    expect(compiler).toContain('"${especificador}" is a package name, and packages can only be imported in an app.');
    expect(gate).toContain(": every matching version is newer than ${MIN_VERSION_AGE_DAYS} days");
    expect(gate).toContain(": published ${Math.floor(ageDays(created, now))} days ago; packages must be at least ${MIN_PACKAGE_AGE_DAYS} days old.");
    expect(gate).toContain("is flagged as malware (");
    expect(install).toContain(": esm.sh could not build it: ");
  });

  it("🔴 the script's SQL prefilter lets every message through (otherwise Postgres drops the turn before the counter sees it)", () => {
    const script = read("scripts", "missing-packages.ts");
    const anyMessage = new RegExp(/const ANY_MESSAGE =\s*"([^"]+)"/.exec(script)![1]!);
    for (const m of [NOT_INSTALLED, PAGE, ...TERMINAL.split("\n").slice(0, 4), ON_SAVE]) expect(m).toMatch(anyMessage);
  });
});

// The messages exactly as the compiler, the gate (lib/apps/npm/gate.ts) and
// the installer (lib/apps/npm/install.ts) write them, as Len reads them: in a
// <new-diagnostics> line (installing on save) or after `npm error` (the
// terminal). If one changes its text, these tests say so: otherwise the
// counter would silently stop seeing it.
const NOT_INSTALLED = `"three/examples/jsm/controls/PointerLockControls.js" is not installed in this app. It installs when a file that imports it is saved (or with npm install three); if that failed, the reason is in this same report.`;
const PAGE = `"chart.js" is a package name, and packages can only be imported in an app. Import files by path (./file.js).`;
const TERMINAL = [
  "npm error young: published 10 days ago; packages must be at least 30 days old.",
  "npm error three@^0.181.0: every matching version is newer than 7 days (newest allowed: 0.180.0).",
  "npm error @evil/pkg@1.2.3 is flagged as malware (MAL-2026-1) and was not installed.",
  "npm error sharpish@1.0.0: esm.sh could not build it: Could not resolve fs.",
  "npm error this app already has 50 packages outside its catalog; big was not installed.",
  "npm warn three@0.186.1 has no TypeScript types; what it exports is typed as any.",
].join("\n");
const ON_SAVE = `<new-diagnostics>The following new diagnostic issues were detected:\n\n/package.json:\n  ✘ [Line 1:1] fresh: published 3 days ago; packages must be at least 30 days old. [npm] (npm)\n  ✘ [Line 1:1] zod@^4.9.0: every matching version is newer than 7 days. [npm] (npm)\n</new-diagnostics>`;

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
  it("🔴 the terminal's npm errors name what the gate or esm.sh refused, by reason", () => {
    expect(missingPackagesOfTurn({ m: TERMINAL })).toEqual([
      { pkg: "three", source: "too-new" },
      { pkg: "young", source: "too-young" },
      { pkg: "@evil/pkg", source: "malware" },
      { pkg: "sharpish", source: "build-failed" },
    ]);
  });

  it("🔴 the same refusals inside a <new-diagnostics> line (installing on save)", () => {
    expect(missingPackagesOfTurn({ m: ON_SAVE })).toEqual([
      { pkg: "zod", source: "too-new" },
      { pkg: "fresh", source: "too-young" },
    ]);
  });

  it("finds the compiler's messages anywhere in the transcript", () => {
    const transcript = {
      mensajes: [
        { role: "tool", content: [{ type: "text", text: `<new-diagnostics>${NOT_INSTALLED}</new-diagnostics>` }] },
        { role: "user", content: { nested: [PAGE] } },
      ],
      leidos: [],
    };
    expect(missingPackagesOfTurn(transcript)).toEqual([
      { pkg: "three", source: "not-installed" },
      { pkg: "chart.js", source: "page-import" },
    ]);
  });

  it("the wording before open npm still counts, as not installed (turns already stored)", () => {
    const old = [
      `"three" is not available in this app. Available packages: react, react-dom. Anything else has to be written in the project.`,
      "leaflet: isn't available here — there is no npm; the catalog has: react, react-dom",
    ].join("\n");
    expect(missingPackagesOfTurn({ m: old })).toEqual([
      { pkg: "three", source: "not-installed" },
      { pkg: "leaflet", source: "not-installed" },
    ]);
  });

  it("🔴 also inside a response stored as JSON (`contenidoDeRespuesta` stringifies it when there's no text)", () => {
    const transcript = {
      mensajes: [
        { role: "tool", content: JSON.stringify({ exitCode: 1, output: TERMINAL }) },
        { role: "tool", content: JSON.stringify({ ok: false, diagnostics: [NOT_INSTALLED] }) },
      ],
    };
    expect(missingPackagesOfTurn(transcript).map((h) => `${h.source}:${h.pkg}`)).toEqual([
      "too-new:three",
      "too-young:young",
      "malware:@evil/pkg",
      "build-failed:sharpish",
      "not-installed:three",
    ]);
  });

  it("a text that starts with a brace but isn't JSON is read as is", () => {
    expect(missingPackagesOfTurn({ m: `{ broken\n${NOT_INSTALLED}` })).toEqual([{ pkg: "three", source: "not-installed" }]);
  });

  it("the same package repeated in the turn counts once per source", () => {
    const transcript = { mensajes: [{ content: TERMINAL }, { content: TERMINAL }, { content: NOT_INSTALLED }, { content: NOT_INSTALLED }] };
    expect(missingPackagesOfTurn(transcript).filter((h) => h.pkg === "three")).toHaveLength(2);
  });

  it("CONTROL: a package that installed, a warning or a missing file don't count", () => {
    const transcript = {
      mensajes: [
        { content: "Installed three@0.186.1 from npm (esm.sh).\n+ three@0.186.1\nadded 1 package in 1.2s\n" },
        { content: "npm warn three@0.186.1 declares react ^18; this app uses 19.2.6." },
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
        turn("p1", "2026-10-10T10:00:00Z", TERMINAL, NOT_INSTALLED),
        turn("p1", "2026-10-11T10:00:00Z", NOT_INSTALLED),
        turn("p2", "2026-10-12T10:00:00Z", NOT_INSTALLED),
        turn("p3", "2026-10-12T11:00:00Z", `"framer-motion" is not installed in this app. It installs when a file that imports it is saved (or with npm install framer-motion); if that failed, the reason is in this same report.`),
      ],
      ["react", "react-dom", "framer-motion"],
    );
    expect(rows[0]).toEqual({
      pkg: "three",
      projects: 2,
      turns: 3,
      sources: ["not-installed", "too-new"],
      lastSeen: "2026-10-12",
      inCurrentCatalog: false,
    });
    expect(rows.find((f) => f.pkg === "framer-motion")).toMatchObject({ projects: 1, inCurrentCatalog: true });
    expect(rows.find((f) => f.pkg === "young")).toMatchObject({ projects: 1, turns: 1, sources: ["too-young"] });
  });
});
