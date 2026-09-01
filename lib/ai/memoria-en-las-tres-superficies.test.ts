import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { userMemoryBlock } from "@/lib/agent/context";

// ¿LAS TRES SUPERFICIES SABEN QUIÉN ES ESTA PERSONA?
//
// 🔴 POR QUÉ EXISTE. `recordar_preferencia` le promete al usuario, con estas
// palabras, que la preferencia se recuerda «aunque cambie de proyecto o pasen
// semanas» — y su ficha OBLIGA al modelo a confirmárselo en voz alta. Hasta el
// 2026-09-01 `getUserMemory` tenía UN solo llamador: la ruta del Agente.
//
// O sea: el usuario le decía a Len «nunca uses amarillo», Len se lo confirmaba,
// el usuario creaba una página nueva… y salía amarilla. La promesa se hacía a
// la CARA del usuario en la superficie que sí la lee, y se rompía en la que
// hace las páginas.
//
// Es el hallazgo 15 de [la-jaula-abierta-y-el-cartel-puesto], de la familia
// «una capacidad vive en UNA ruta y nunca se mudó a las otras» — la misma de
// `buildScopedView` (14). La regla que salió de ese barrido: lo que vive en un
// `route.ts` deriva; lo que vive en el suelo compartido, no. Aquí el
// formateador YA era compartido y puro (`userMemoryBlock`, en context.ts, libre
// de @/lib/db a propósito); lo que faltaba era que dos rutas lo llamaran.
//
// Esta prueba es de GREP, y lo es a sabiendas: montar las tres rutas de verdad
// exige auth, base de datos y un proveedor. Lo que se puede afirmar sin nada de
// eso —y es lo que se rompió— es que las tres LEEN la memoria.

const RAIZ = path.resolve(__dirname, "../..");

// Cada una llega al MISMO formateador por un camino distinto, y el token lo
// dice en vez de esconderlo tras un OR de conveniencia: Crear y el Chat llaman
// a `userMemoryBlock` en la propia ruta; el Agente le pasa `userMemory` a
// `buildAgentMessages`, que lo formatea dentro (`buildAgentContext`). Las tres
// formas son legítimas — lo que no lo es es que una no lea la memoria.
const SUPERFICIES: [string, string, string][] = [
  ["crear", "app/api/generate/route.ts", "userMemoryBlock("],
  ["chat (ai-design)", "app/api/templates/ai-design/route.ts", "userMemoryBlock("],
  ["len (agente)", "app/api/agent/route.ts", "userMemory:"],
];

describe("las tres superficies leen la memoria de la persona", () => {
  for (const [nombre, rel, tokenDeFormateo] of SUPERFICIES) {
    const src = readFileSync(path.join(RAIZ, rel), "utf8");

    it(`${nombre} — el extractor está leyendo el fichero de verdad`, () => {
      // Sin este candado, un renombrado dejaría `src` vacío y las dos
      // aserciones de abajo pasarían sin comprobar nada.
      expect(src).toContain("export async function POST");
    });

    it(`${nombre} — la lee, y por la vía ACOTADA`, () => {
      expect(src).toContain("getUserMemoryBounded(");
    });

    it(`${nombre} — y la lleva al prompt por el formateador compartido`, () => {
      // No basta con leerla: hay que meterla con el MISMO texto en las tres, o
      // el modelo recibe tres contratos distintos sobre qué es esa memoria y
      // cuánto manda frente a lo que se pide hoy.
      expect(src).toContain(tokenDeFormateo);
    });
  }
});

describe("el formateador compartido", () => {
  it("sin memoria devuelve cadena VACÍA, no un bloque vacío", () => {
    // Importa de verdad: quien nunca guardó nada tiene que pagar exactamente
    // los mismos tokens que antes de que esto existiera, y su prefijo cacheado
    // no se puede invalidar por una cabecera que no dice nada.
    expect(userMemoryBlock(null)).toBe("");
    expect(userMemoryBlock(undefined)).toBe("");
    expect(userMemoryBlock("   ")).toBe("");
  });

  it("con memoria la incluye y dice que lo de HOY manda", () => {
    const b = userMemoryBlock("nunca uses amarillo");
    expect(b).toContain("nunca uses amarillo");
    // La regla de precedencia no es adorno: sin ella el modelo trata una
    // preferencia vieja como una orden y discute con lo que le piden ahora.
    expect(b).toContain("manda lo de hoy");
  });
});
