import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TODO COMANDO DE `package.json` TIENE QUE PODER CORRER.
 *
 * Medido el 2026-08-25: **26 de 130 comandos apuntaban a un fichero que ya no
 * existe**. Todos venían de dos retiradas deliberadas —el Visual Engine
 * (`2db58d78`, unas 37.000 líneas) y el catálogo de secciones— que se llevaron
 * los scripts pero dejaron sus claves aquí.
 *
 * POR QUÉ IMPORTA, y no es cosmético. `npm run <lo-que-sea>` con un fichero
 * ausente falla en `tsx`, no en npm, así que el error habla de un módulo que no
 * resuelve — no de un comando retirado. Y lo que había en esa lista no era
 * inofensivo: `sections:reclassify-navbars` estaba anotado como «producción
 * necesita esta corrida», así que alguien podía intentar correr una reparación
 * de datos contra la base y leer un fallo de import como un problema de entorno.
 * (No lo era: la tabla `sections` tampoco existe ya. Nada que reparar.)
 *
 * Un comando que no puede correr es peor que un comando ausente: el ausente se
 * nota al buscarlo, el roto se nota cuando lo necesitas.
 */
describe("los comandos de package.json apuntan a ficheros que existen", () => {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  // Sólo operandos LOCALES: `tsx scripts/foo.ts` sí, `next build` no y
  // `npx alguna-herramienta` tampoco — esos los resuelve npm o el PATH, y
  // exigir que existan en el árbol daría un falso positivo por cada binario.
  const OPERANDO = /(?:^|\s)((?:scripts|infra|crates)\/[\w./-]+\.(?:ts|cjs|mjs|js|ps1|sh))/g;

  const rotos = Object.entries(pkg.scripts).flatMap(([nombre, cmd]) =>
    [...cmd.matchAll(OPERANDO)]
      .map((m) => m[1]!)
      .filter((f) => !existsSync(join(process.cwd(), f)))
      .map((f) => `${nombre} → ${f}`),
  );

  it("ninguno apunta a un fichero borrado", () => {
    expect(rotos, `comandos que no pueden correr:\n  ${rotos.join("\n  ")}`).toEqual([]);
  });

  // CONTRA-PRUEBA del regex: si dejara de casar nada, la prueba de arriba
  // pasaría siempre y no vigilaría nada. Esto exige que SÍ esté mirando
  // operandos locales de verdad.
  it("y la comprobación mira operandos de verdad, no una lista vacía", () => {
    const vistos = Object.values(pkg.scripts).flatMap((cmd) =>
      [...cmd.matchAll(OPERANDO)].map((m) => m[1]!),
    );
    expect(vistos.length).toBeGreaterThan(20);
    expect(vistos.some((f) => f.startsWith("scripts/"))).toBe(true);
  });
});
