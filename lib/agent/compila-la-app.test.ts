// @vitest-environment node
// Lo que no compila de una app, de vuelta a Len (F3 de las apps web).
import { describe, expect, it } from "vitest";
import { diagnosticosDeLaApp, problemasDelCascaron } from "./compila-la-app";

const APP = { catalogo: "2026-10", entrada: "/src/main.jsx" };
const CASCARON = '<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>';
const BIEN = {
  "/src/main.jsx": 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);',
  "/src/App.jsx": "export default () => <h1>Caja</h1>;",
  "/tests/caja.spec.ts": 'import { test } from "@playwright/test";\ntest;',
  "/supabase/migrations/1_a.sql": "create table a();",
};

describe("diagnosticosDeLaApp", () => {
  it("una app sana no dice nada, y /tests y /supabase no se compilan como app", () => {
    expect(diagnosticosDeLaApp({ app: APP, ahora: BIEN, alEmpezar: BIEN, escritos: ["/src/App.jsx"], cascaron: CASCARON })).toEqual([]);
  });

  it("lo que rompe este turno, sí; lo que ya estaba roto en otro fichero, no", () => {
    const antes = { ...BIEN, "/src/Viejo.jsx": "export default () => <div" };
    const ahora = { ...antes, "/src/App.jsx": "export const App = 1;" };
    const d = diagnosticosDeLaApp({ app: APP, ahora, alEmpezar: antes, escritos: ["/src/App.jsx"], cascaron: CASCARON });
    expect(d.map((x) => x.ruta)).toEqual(["/src/main.jsx"]);
    expect(d[0]).toMatchObject({ linea: 2, gravedad: "Error", codigo: "compila", fuente: "compiler" });
  });

  it("🔴 lo que Len escribió se dice SIEMPRE, aunque el fallo fuera el mismo antes", () => {
    const roto = { ...BIEN, "/src/App.jsx": "export default () => <div" };
    const d = diagnosticosDeLaApp({ app: APP, ahora: roto, alEmpezar: roto, escritos: ["/src/App.jsx"], cascaron: CASCARON });
    expect(d.map((x) => x.ruta)).toEqual(["/src/App.jsx"]);
  });
});

describe("el cascarón", () => {
  it("sin el script de la entrada, sin la entrada, o sin el #root que monta, no arranca", () => {
    expect(problemasDelCascaron(APP, CASCARON, BIEN)).toEqual([]);
    expect(problemasDelCascaron(APP, '<div id="root"></div>', BIEN)[0]!.codigo).toBe("cascaron");
    expect(problemasDelCascaron(APP, '<div id="root"></div><script src="/src/main.jsx"></script>', BIEN)[0]!.codigo).toBe("cascaron");
    expect(problemasDelCascaron(APP, CASCARON, { "/src/App.jsx": "" }).map((x) => x.codigo)).toEqual(["entrada"]);
    expect(problemasDelCascaron(APP, '<div id="app"></div><script type="module" src="/src/main.jsx"></script>', BIEN).map((x) => x.codigo)).toEqual(["raiz"]);
  });
});
