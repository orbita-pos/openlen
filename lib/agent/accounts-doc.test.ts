// El documento de cuentas que lee Len es una COPIA de lo que hace el código, y
// una copia se queda atrás sin que nadie se entere (memoria
// `la-documentacion-no-tiene-compilador`). Esto la ata a lo que describe: cada
// ruta que nombra existe, cada error que promete lo devuelve esa ruta, y los
// ejemplos de bloque se leen como dice el texto.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACCOUNTS_DOC } from "./accounts-doc";
import { documentosDeLaPlataforma, buildManualDeLaPlataforma } from "./manual-de-la-plataforma";
import { RUTA_ACCOUNTS } from "./ficheros/manual";
import { readAccountsDeclaration } from "@/lib/page-accounts/declaration";
import { leerDeclaracion } from "@/lib/page-data/declaracion";
import { permite } from "@/lib/page-data/permisos";

const ruta = (r: string) => join(process.cwd(), "app", "api", "a", r, "route.ts");
const fuente = (r: string) => readFileSync(ruta(r), "utf8");

describe("/.openlen/docs/accounts.md", () => {
  it("es un fichero de /.openlen/docs y el índice de /AGENTS.md lo nombra", () => {
    expect(documentosDeLaPlataforma()[RUTA_ACCOUNTS]).toBe(ACCOUNTS_DOC);
    expect(buildManualDeLaPlataforma()).toContain(RUTA_ACCOUNTS);
  });

  it("cada ruta que nombra existe", () => {
    const nombradas = [...new Set(ACCOUNTS_DOC.match(/\/api\/a\/[a-z-]+/g) ?? [])].map((r) => r.slice("/api/a/".length));
    expect(nombradas.sort()).toEqual(["accounts", "login", "logout", "me", "owner-start", "password"]);
    for (const r of nombradas) expect(existsSync(ruta(r)), r).toBe(true);
    expect(existsSync(ruta("accounts/[id]"))).toBe(true);
  });

  it("cada error que promete lo devuelve la ruta que dice", () => {
    expect(fuente("login")).toContain('"invalid_credentials"');
    expect(fuente("login")).toContain("429");
    expect(fuente("accounts")).toMatch(/"email_taken" \}, 409/);
    expect(fuente("accounts")).toMatch(/"unknown_role".*422/);
    expect(fuente("accounts")).toMatch(/"owner_only" \}, 403/);
    expect(readFileSync(join(process.cwd(), "app", "api", "a", "_shared.ts"), "utf8")).toMatch(/"accounts_not_declared" \}, 404/);
  });

  it("los ejemplos se leen como dice el texto", () => {
    const html = (bloques: string) => `<body>${bloques}</body>`;
    const cuentas = ACCOUNTS_DOC.match(/<script type="application\/json" data-ol-accounts>(.*?)<\/script>/)![1]!;
    expect(readAccountsDeclaration(html(`<script type="application/json" data-ol-accounts>${cuentas}</script>`))).toEqual({
      registro: "cerrado",
      papeles: ["cajero"],
    });
    const almacenes = ACCOUNTS_DOC.split("\n").find((l) => l.startsWith('{"ventas"'))!;
    const d = leerDeclaracion(html(`<script type="application/json" data-ol-stores>${almacenes}</script>`));
    // Los dos almacenes sobreviven: el ejemplo no tiene una errata que los descarte.
    expect(Object.keys(d).sort()).toEqual(["productos", "ventas"]);
    const cajero = { tipo: "cuenta" as const, id: "a", papel: "cajero" };
    const visitante = { tipo: "visitante" as const, id: "v" };
    // «whoever has not signed in reaches NOTHING»
    expect(permite(d.ventas!.modo, visitante, "leer", d.ventas!.papeles)).toBe("ninguno");
    // «"propios" (only the rows that same account wrote)»
    expect(permite(d.ventas!.modo, cajero, "leer", d.ventas!.papeles)).toBe("propios");
    // «["leer","crear"] is short for both with "todos"» — y el visitante del menú sigue leyendo
    expect(permite(d.productos!.modo, cajero, "modificar", d.productos!.papeles)).toBe("todos");
    expect(permite(d.productos!.modo, cajero, "leer", d.productos!.papeles)).toBe("todos");
  });
});
