// @vitest-environment node
// What a game is born with (spec local 2026-11-05-modo-juego-design, §8.3): an app without router, backend or
// engine, full screen. It must compile and start as it is, like the app's skeleton.
import { describe, expect, it } from "vitest";

import { problemasDelCascaron } from "@/lib/agent/compila-la-app";
import { compilarCarpeta, textoDeDiagnostico } from "@/lib/apps/compilador";
import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";
import { cascaronDeLaApp, ENTRADA, esqueletoDeApp } from "@/lib/apps/esqueleto";

import { gameSkeleton } from "./skeleton";

describe("the game skeleton", () => {
  const s = gameSkeleton({ title: "Naves", locale: "es" });

  it("🔴 compiles whole and the shell starts it", () => {
    expect(compilarCarpeta({ carpeta: s.files, catalogo: s.app.catalogo }).errores.map(textoDeDiagnostico)).toEqual([]);
    expect(problemasDelCascaron(s.app, s.html, s.files)).toEqual([]);
  });

  it("brings only a game's files: no router, no backend, no engine", () => {
    expect(Object.keys(s.files).sort()).toEqual(["/package.json", "/src/App.tsx", "/src/game/Game.tsx", "/src/main.tsx"]);
    const pkg = JSON.parse(s.files["/package.json"]!) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["react", "react-dom"]);
    expect(s.files["/src/main.tsx"]).not.toContain("HashRouter");
  });

  it("is an app of the current catalog, with data.game", () => {
    expect(s.app).toEqual({ catalogo: CATALOGO_ACTUAL, entrada: ENTRADA });
    expect(typeof s.game.bornAt).toBe("string");
    expect(Number.isNaN(Date.parse(s.game.bornAt))).toBe(false);
  });

  it("the shell fills the window, and the game's canvas takes touches for itself", () => {
    expect(s.html).toMatch(/html,\s*body,\s*#root\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/);
    expect(s.html).toContain('<html lang="es">');
    expect(s.html).toContain("<title>Naves</title>");
    expect(s.files["/src/game/Game.tsx"]).toContain("touchAction");
  });

  it("the game component cleans up what it starts when it unmounts", () => {
    const game = s.files["/src/game/Game.tsx"]!;
    expect(game).toMatch(/useEffect\([\s\S]*return \(\) =>/);
    expect(game).toContain("cancelAnimationFrame");
  });

  it("a title with quotes or tags breaks neither the shell nor the JSX", () => {
    const odd = gameSkeleton({ title: '<script>alert("x")</script> & "Cía"', locale: "xx-!!" });
    expect(odd.html).toContain("<title>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Cía&quot;</title>");
    expect(odd.html).toContain('<html lang="en">');
    expect(compilarCarpeta({ carpeta: odd.files, catalogo: odd.app.catalogo }).errores).toEqual([]);
  });

  it("without pantallaCompleta, an app's shell comes out byte for byte as before", () => {
    expect(cascaronDeLaApp({ titulo: "Caja", idioma: "es" })).toBe(esqueletoDeApp({ titulo: "Caja", idioma: "es" }).html);
  });
});
