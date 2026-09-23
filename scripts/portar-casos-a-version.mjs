// scripts/portar-casos-a-version.mjs — lleva casos de la batería de HOY a una
// versión VIEJA de Len, para correrlos contra su código.
//
//   git worktree add --detach ../openlen-len-1.0 f6c0f915
//   node scripts/portar-casos-a-version.mjs --desde=19162e5a --a=../openlen-len-1.0 \
//     --ayudantes=conAncla dos-cosas-opuestas lada-que-nadie-dio …
//   cd ../openlen-len-1.0 && npm run evals:agent -- --only=… --yes --budget-usd=0.10
//
// Nació el 2026-09-23 para decidir si Len ya era 1.5: la batería de 1.0 estaba al
// 97 % y no podía enseñar ningún salto, así que la única medida que decidía era
// correr contra 1.0 los casos escritos DESPUÉS.
//
// COPIA LITERAL, y es el punto. Los bloques salen de `git show <desde>:…/cases.ts`
// tal cual —mismo prompt, mismo `setup`, mismo `assert`— para que la vara sea la
// misma en las dos versiones. Los ayudantes que un caso necesita y la versión vieja
// no tiene se nombran con --ayudantes y se copian también; los que ya existen allí
// NO se tocan, así que antes de fiarse de la comparación hay que comprobar que son
// idénticos en las dos versiones (el 23/09 lo eran: `nombraLoPendiente`,
// `withTelefonoEnCuatroPaginas`, `actionFired`, `hasConfirm`).
//
// 🔴 QUÉ NO SE PORTA. Un caso que pide maquinaria del ARNÉS que la versión vieja no
// tenía (conversación previa, cortes, choques al guardar, promesas en JS) no se
// porta: habría que inventarle a esa versión un comportamiento que nunca tuvo. El
// script no lo detecta solo: el arnés viejo IGNORA los campos que no conoce y el caso
// correría sin lo que mide. Mira el `EvalCase` de las dos versiones antes de elegir.
//
// Sólo escribe en el worktree de destino. Nada de esto se commitea allí.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CASOS = "lib/agent/evals/cases.ts";
const ARRANQUE = "export const EVAL_CASES: EvalCase[] = [";

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

const args = process.argv.slice(2);
const opcion = (nombre) => args.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
const desde = opcion("desde");
const destino = opcion("a");
const ayudantes = (opcion("ayudantes") ?? "").split(",").filter(Boolean);
const ids = args.filter((a) => !a.startsWith("--"));
if (!desde || !destino || ids.length === 0)
  fail("uso: --desde=<commit> --a=<worktree> [--ayudantes=a,b] <id-de-caso> …");

const fuente = execFileSync("git", ["show", `${desde}:${CASOS}`], { encoding: "utf8", maxBuffer: 1e8 });
const rutaDestino = join(destino, CASOS);
let viejo = readFileSync(rutaDestino, "utf8");
if (!viejo.includes(ARRANQUE)) fail(`${rutaDestino}: no encuentro «${ARRANQUE}»`);

/** El objeto del caso, desde su `{` hasta antes del siguiente caso o del `];`. */
function bloqueDelCaso(id) {
  const i = fuente.indexOf(`id: "${id}"`);
  if (i < 0) fail(`${desde}: no hay ningún caso «${id}»`);
  const inicio = fuente.lastIndexOf("\n  {", i);
  const siguiente = fuente.indexOf("\n  {\n    id:", i + 5);
  const fin = fuente.indexOf("\n];", i);
  const corte = siguiente >= 0 && siguiente < fin ? siguiente : fin;
  // Un comentario de sección al final pertenece al caso de DESPUÉS.
  return fuente.slice(inicio, corte).replace(/\n\s*\/\/[^\n]*\s*$/, "");
}

/** Una función de nivel superior, de `function nombre(` a su `}` de columna 0. */
function ayudante(nombre) {
  const i = fuente.search(new RegExp(`^(?:export )?function ${nombre}\\(`, "m"));
  if (i < 0) fail(`${desde}: no hay ninguna función «${nombre}» de nivel superior`);
  return fuente.slice(i, fuente.indexOf("\n}\n", i) + 3);
}

for (const id of ids) if (viejo.includes(`id: "${id}"`)) fail(`${rutaDestino}: «${id}» ya está`);
for (const n of ayudantes)
  if (new RegExp(`^(?:export )?function ${n}\\(`, "m").test(viejo)) fail(`${rutaDestino}: «${n}» ya existe allí`);

const marca = `PORTADO de ${desde} con scripts/portar-casos-a-version.mjs`;
if (ayudantes.length > 0)
  viejo = viejo.replace(ARRANQUE, `// ${marca}\n${ayudantes.map(ayudante).join("\n")}\n${ARRANQUE}`);
const inicio = viejo.indexOf(ARRANQUE);
const cierre = viejo.indexOf("\n];", inicio);
viejo = `${viejo.slice(0, cierre)}\n  // ── ${marca} ──${ids.map(bloqueDelCaso).join("")}${viejo.slice(cierre)}`;
writeFileSync(rutaDestino, viejo);
console.log(`✔ ${ids.length} caso(s) y ${ayudantes.length} ayudante(s) portados de ${desde} a ${rutaDestino}`);
