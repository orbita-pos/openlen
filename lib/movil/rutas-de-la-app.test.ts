// @vitest-environment node
// Guardia: cada ruta de la lista decide quién eres con la llave o la sesión,
// lleva CORS y contesta OPTIONS; y una ruta de fuera NO acepta la llave.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUTAS_DE_LA_APP } from "./rutas-de-la-app";

const leer = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

// Who reads the phone's key. A route takes it by calling `usuarioDeLaPeticion` itself or through one of the helpers that
// calls it for the route (`whoMay` — Len Watch's, `readDeliveredFile` — the deliveries'): a wrapper must not let a route
// escape the guard (G4+G5 review, minor 8). A NEW helper that wraps it joins this list.
const TAKES_THE_KEY = /usuarioDeLaPeticion|\bwhoMay\b|\breadDeliveredFile\b/;
const TAKES_THE_KEY_CALL = /usuarioDeLaPeticion\(req\)|\bwhoMay\(req\b|\breadDeliveredFile\(req\b/;

describe("las rutas de la app", () => {
  for (const r of RUTAS_DE_LA_APP) {
    it(`${r.fichero}: ${r.metodos.join(", ")} con la llave, CORS y OPTIONS`, () => {
      const src = leer(r.fichero);
      if (!r.fichero.endsWith("movil/llave/route.ts")) expect(src).toMatch(TAKES_THE_KEY_CALL);
      for (const m of r.metodos) expect(src).toMatch(new RegExp(`export const ${m} = paraLaApp\\(`));
      expect(src).toMatch(/export const OPTIONS = respuestaPrevia;/);
    });
  }

  // Her tab in Len móvil (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5).
  it("🔴 her routes are on the list", () => {
    const listed = new Map(RUTAS_DE_LA_APP.map((r) => [r.fichero, r.metodos]));
    // Created and connected from the phone (spec local 2026-11-16-movil-es-tu-asistente, §5.6, §5.8.3).
    expect(listed.get("app/api/assistants/route.ts")).toEqual(["GET", "POST"]);
    expect(listed.get("app/api/assistants/[id]/projects/route.ts")).toEqual(["POST"]);
    expect(listed.get("app/api/assistants/[id]/chat/route.ts")).toEqual(["GET"]);
    expect(listed.get("app/api/assistants/[id]/visits/route.ts")).toEqual(["GET"]);
    // Phase 4E: seeing her conversations marks them read.
    expect(listed.get("app/api/assistants/[id]/visits/read/route.ts")).toEqual(["POST"]);
    expect(listed.get("app/api/assistants/[id]/requests/route.ts")).toEqual(["GET"]);
    expect(listed.get("app/api/assistants/[id]/requests/[cardId]/route.ts")).toEqual(["POST"]);
    // Her chat's Len cards (spec local 2026-11-16-movil-es-tu-asistente, §5.8.5).
    expect(listed.get("app/api/assistants/[id]/len-requests/route.ts")).toEqual(["GET"]);
  });

  // OAuth of the MCP connectors on the phone (spec local 2026-11-17-oauth-de-conectores-mcp, §10.1): the route that
  // accepts the key for a method lists it (a method that takes the key without being here has no CORS for the app).
  // Final review, M5: the phone signs in (POST) but never disconnects — «Desconectar» is the Herramientas page's, on the web.
  it("🔴 the connector sign-in route lists the one method the phone calls", () => {
    const listed = new Map(RUTAS_DE_LA_APP.map((r) => [r.fichero, r.metodos]));
    expect(listed.get("app/api/mcp-connectors/[name]/oauth/route.ts")).toEqual(["POST"]);
    expect(listed.get("app/api/mcp-connectors/route.ts")).toEqual(["GET"]);
    expect(listed.get("app/api/mcp-connectors/directory/[id]/route.ts")).toEqual(["POST"]);
  });

  // 🔴 A route that takes the phone's key (`usuarioDeLaPeticion`) without being on the list has an app CORS nobody listed
  // and nobody reviewed — the A/B routes were that (review item 27). Every route that calls it is on the list; the ones
  // that were already off it when this guard was written are named here, so the allowance can only SHRINK: an entry that is
  // listed, or no longer calls it, must leave this array. (They are not the A/B work's to decide — see the report.)
  const PRE_EXISTING_UNLISTED: readonly string[] = [
    "app/api/agent/responder/route.ts",
    "app/api/agent/subagents/[id]/stop/route.ts",
    "app/api/agent/subagents/route.ts",
    "app/api/movil/canvas/route.ts",
    "app/api/projects/[id]/backend/environments/route.ts",
    "app/api/projects/[id]/event-cards/[cardId]/route.ts",
    "app/api/projects/[id]/event-cards/route.ts",
    "app/api/projects/[id]/security-review/route.ts",
  ];

  const routesUsingTheKey = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/^route\.tsx?$/.test(e.name) && TAKES_THE_KEY.test(leer(rel))) out.push(rel);
      }
    };
    walk("app/api");
    return out.sort();
  };

  it("🔴 no route takes the phone's key without being on the list (the allowance of the old ones only shrinks)", () => {
    const listed = new Set(RUTAS_DE_LA_APP.map((r) => r.fichero));
    const using = routesUsingTheKey();
    expect(using.filter((f) => !listed.has(f) && !PRE_EXISTING_UNLISTED.includes(f))).toEqual([]);
    expect(PRE_EXISTING_UNLISTED.filter((f) => listed.has(f) || !using.includes(f))).toEqual([]);
  });

  it("🔴 the A/B routes the phone doesn't call are web-session only: no phone key, no app CORS", () => {
    const listed = new Map(RUTAS_DE_LA_APP.map((r) => [r.fichero, r.metodos]));
    // What the phone calls: the assistant's decision cards, and the decision itself.
    expect(listed.get("app/api/assistants/[id]/ab-decisions/route.ts")).toEqual(["GET"]);
    expect(listed.get("app/api/projects/[id]/ab/[expId]/decide/route.ts")).toEqual(["POST"]);
    for (const f of [
      "app/api/projects/[id]/ab/route.ts",
      "app/api/projects/[id]/ab/[expId]/launch/route.ts",
      "app/api/projects/[id]/ab/[expId]/bring/route.ts",
      "app/api/projects/[id]/ab/[expId]/preview/route.ts",
    ]) {
      const src = leer(f);
      expect(src, f).not.toContain("usuarioDeLaPeticion");
      expect(src, f).not.toContain("paraLaApp");
      expect(src, f).not.toMatch(/export const OPTIONS/);
      expect(src, f).toContain("await auth()");
      expect(listed.has(f), f).toBe(false);
    }
  });

  // Len Watch on the phone (Gestión → Publicar): its state and switches, «Fix with Len», Approve and «Traer el arreglo».
  it("🔴 the Len Watch routes the phone calls are on the list (they take the key through `whoMay`)", () => {
    const listed = new Map(RUTAS_DE_LA_APP.map((r) => [r.fichero, r.metodos]));
    expect(listed.get("app/api/projects/[id]/len-watch/route.ts")).toEqual(["GET", "PUT"]);
    expect(listed.get("app/api/projects/[id]/len-watch/fix/route.ts")).toEqual(["POST"]);
    expect(listed.get("app/api/projects/[id]/len-watch/approve/route.ts")).toEqual(["POST"]);
    expect(listed.get("app/api/projects/[id]/len-watch/bring/route.ts")).toEqual(["POST"]);
  });

  // Managing an installed tool — switching it, removing it, restoring it — is the Herramientas page's, on the web: the phone
  // only uses tools (G4+G5 review, minor 8: these two took the key without the phone ever calling them).
  it("🔴 managing an installed tool is web-session only: no phone key, no app CORS", () => {
    for (const f of ["app/api/tools/[id]/route.ts", "app/api/tools/[id]/restore/route.ts"]) {
      const src = leer(f);
      expect(src, f).not.toMatch(TAKES_THE_KEY);
      expect(src, f).not.toContain("paraLaApp");
      expect(src, f).not.toMatch(/export const OPTIONS/);
      expect(src, f).toContain("await auth()");
    }
  });

  it("🔴 the visuals frame url route is on the list", () => {
    const listed = new Map(RUTAS_DE_LA_APP.map((r) => [r.fichero, r.metodos]));
    expect(listed.get("app/api/visual-frame-url/route.ts")).toEqual(["GET"]);
  });

  // An agent's tool on the phone (spec local 2026-11-22-artifacts-de-len, §2–§4): the list of its tools, opening one
  // on the phone's own label, its page's data, the stream every open screen follows it with, and the person deleting it. The
  // stream is read by the phone with a fetch reader, so it takes the key from the header: it needs the app's CORS like the rest.
  it("🔴 an agent's tool routes are on the list, with the methods the phone calls", () => {
    const listed = new Map(RUTAS_DE_LA_APP.map((r) => [r.fichero, r.metodos]));
    expect(listed.get("app/api/len-artifacts/route.ts")).toEqual(["GET"]);
    expect(listed.get("app/api/len-artifacts/[id]/route.ts")).toEqual(["DELETE"]);
    expect(listed.get("app/api/len-artifacts/[id]/data/route.ts")).toEqual(["POST"]);
    expect(listed.get("app/api/len-artifacts/[id]/follow/route.ts")).toEqual(["GET"]);
    expect(listed.get("app/api/movil/len-artifacts/[id]/open/route.ts")).toEqual(["POST"]);
  });

  it("una ruta de fuera de la lista sigue sólo con la sesión", () => {
    const src = leer("app/api/projects/[id]/versions/route.ts");
    expect(src).not.toContain("usuarioDeLaPeticion");
  });
});
