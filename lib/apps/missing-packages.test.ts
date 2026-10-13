import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingPackagesOfTurn, packageNameOf, tallyMissingPackages } from "./missing-packages";

describe("los cuatro mensajes siguen diciéndose así donde nacen", () => {
  const raiz = join(import.meta.dirname, "..", "..");
  it("🔴 la terminal y el compilador escriben los textos que el contador busca", () => {
    const terminal = readFileSync(join(raiz, "lib", "agent", "terminal", "trabajador.mjs"), "utf8");
    const compilador = readFileSync(join(raiz, "lib", "apps", "compilador.ts"), "utf8");
    expect(terminal).toContain("${p}: isn't available here — there is no npm;");
    expect(compilador).toContain('"${especificador}" is not available in this app.');
    expect(compilador).toContain('"${especificador}": imports from URLs or "${especificador.split(":")[0]}:" are not supported here.');
    expect(compilador).toContain('"${especificador}" is a package name, and packages can only be imported in an app.');
  });
});

// Los mensajes tal y como los escriben la terminal (trabajador.mjs, `npm
// install`) y el compilador (lib/apps/compilador.ts). Si uno cambia de texto,
// estas pruebas lo dicen: el contador dejaría de verlo en silencio.
const NPM = "three: isn't available here — there is no npm; the catalog has: react, react-dom\n@react-three/fiber: isn't available here — there is no npm; the catalog has: react, react-dom\n";
const IMPORT = `"three/examples/jsm/controls/PointerLockControls.js" is not available in this app. Available packages: react, react-dom. Anything else has to be written in the project.`;
const URL_IMPORT = `"https://esm.sh/leaflet@1.9.4": imports from URLs or "https:" are not supported here. Available packages: react.`;
const PAGINA = `"chart.js" is a package name, and packages can only be imported in an app. Import files by path (./file.js).`;

describe("packageNameOf", () => {
  it("se queda con el paquete: sin subruta ni versión, con su scope", () => {
    expect(packageNameOf("three/examples/jsm/x.js")).toBe("three");
    expect(packageNameOf("@react-three/fiber")).toBe("@react-three/fiber");
    expect(packageNameOf("@react-three/drei/core")).toBe("@react-three/drei");
    expect(packageNameOf("leaflet@1.9.4")).toBe("leaflet");
    expect(packageNameOf("@scope/pkg@2")).toBe("@scope/pkg");
  });

  it("de una URL de CDN saca el paquete; de otra URL, nada", () => {
    expect(packageNameOf("https://esm.sh/leaflet@1.9.4")).toBe("leaflet");
    expect(packageNameOf("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js")).toBe("three");
    expect(packageNameOf("https://unpkg.com/@react-three/fiber@8")).toBe("@react-three/fiber");
    expect(packageNameOf("https://cdn.skypack.dev/canvas-confetti")).toBe("canvas-confetti");
    expect(packageNameOf("https://example.com/lib.js")).toBeNull();
  });
});

describe("missingPackagesOfTurn", () => {
  it("encuentra los cuatro mensajes en cualquier sitio de la transcripción", () => {
    const transcript = {
      mensajes: [
        { role: "tool", content: NPM },
        { role: "tool", content: [{ type: "text", text: `<new-diagnostics>${IMPORT}</new-diagnostics>` }] },
        { role: "user", content: { nested: [URL_IMPORT, PAGINA] } },
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

  it("🔴 también dentro de una respuesta guardada como JSON (`contenidoDeRespuesta` hace JSON.stringify si no hay texto)", () => {
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

  it("un texto que empieza por llave pero no es JSON se lee tal cual", () => {
    expect(missingPackagesOfTurn({ m: `{ roto\n${NPM}` })).toEqual([
      { pkg: "three", source: "npm-install" },
      { pkg: "@react-three/fiber", source: "npm-install" },
    ]);
  });

  it("el mismo paquete repetido en el turno cuenta una vez por fuente", () => {
    const transcript = { mensajes: [{ content: NPM }, { content: NPM }, { content: IMPORT }, { content: IMPORT }] };
    expect(missingPackagesOfTurn(transcript).filter((h) => h.pkg === "three")).toHaveLength(2);
  });

  it("CONTROL: un paquete del catálogo o un fichero que falta no cuentan", () => {
    const transcript = {
      mensajes: [
        { content: "react: already available (catalog)\n" },
        { content: `Cannot find "./Boton" (imported from /src/App.tsx). Paths are resolved against the project's files.` },
      ],
    };
    expect(missingPackagesOfTurn(transcript)).toEqual([]);
  });

  it("una transcripción vacía o rara no lanza", () => {
    expect(missingPackagesOfTurn(null)).toEqual([]);
    expect(missingPackagesOfTurn("texto suelto")).toEqual([]);
    expect(missingPackagesOfTurn({ a: 1, b: [true, null] })).toEqual([]);
  });
});

describe("tallyMissingPackages", () => {
  const turno = (projectId: string, createdAt: string, ...contenidos: string[]) => ({
    projectId,
    createdAt: new Date(createdAt),
    transcript: { mensajes: contenidos.map((content) => ({ content })) },
  });

  it("cuenta turnos y proyectos por paquete, ordena por proyectos, y dice si ya está en el catálogo actual", () => {
    const filas = tallyMissingPackages(
      [
        turno("p1", "2026-10-10T10:00:00Z", NPM, IMPORT),
        turno("p1", "2026-10-11T10:00:00Z", IMPORT),
        turno("p2", "2026-10-12T10:00:00Z", IMPORT),
        turno("p3", "2026-10-12T11:00:00Z", `"framer-motion" is not available in this app. Available packages: react.`),
      ],
      ["react", "react-dom", "framer-motion"],
    );
    expect(filas[0]).toEqual({
      pkg: "three",
      projects: 2,
      turns: 3,
      sources: ["import", "npm-install"],
      lastSeen: "2026-10-12",
      inCurrentCatalog: false,
    });
    expect(filas.find((f) => f.pkg === "framer-motion")).toMatchObject({ projects: 1, inCurrentCatalog: true });
    expect(filas.find((f) => f.pkg === "@react-three/fiber")).toMatchObject({ projects: 1, turns: 1 });
  });
});
