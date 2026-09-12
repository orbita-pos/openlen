import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * TODA LECTURA DE `users` TIENE QUE PROYECTAR SUS COLUMNAS.
 *
 * POR QUE EXISTE. `db.select()` sin argumentos pide TODAS las columnas
 * declaradas en el esquema. Eso convierte «una columna declarada cuya migracion
 * todavia no ha corrido» —un estado normal entre commit y despliegue, y el
 * estado permanente de cualquier rama sin migrar— en un 42703 que revienta la
 * consulta entera.
 *
 * MEDIDO el 2026-09-12, en vivo y en la peor puerta posible: con
 * `users.agentEffort` en el esquema y sin migrar, `auth.ts` hacia `.select()` a
 * secas y NADIE PODIA ENTRAR. No era un rasgo a medias: era la autenticacion
 * caida.
 *
 * 🔴 Y LO PEOR ES QUE SE HABIA AFIRMADO LO CONTRARIO. El registro de la sesion
 * anterior decia, con un barrido detras: «NO existe ni un
 * `db.select().from(users)` sin proyeccion en todo el repo — 21 lecturas, todas
 * `select({...})`». Era falso. El barrido miro `lib/` y `app/`, y `auth.ts`
 * esta en la RAIZ del repo. Un barrido que afirma ausencia vale lo que valga su
 * alcance, y por eso esta prueba INCLUYE la raiz y DICE cuantos ficheros miro.
 */

const RAICES = ["lib", "app", "components", "scripts", "tools"];
const SALTAR = new Set(["node_modules", ".next", "dist", "target", "coverage", ".git"]);
const EXT = [".ts", ".tsx"];

function bajo(raiz: string): string[] {
  let dentro: string[];
  try {
    dentro = readdirSync(raiz);
  } catch {
    return [];
  }
  const salida: string[] = [];
  for (const nombre of dentro) {
    if (SALTAR.has(nombre)) continue;
    const ruta = join(raiz, nombre);
    let esDir = false;
    try {
      esDir = statSync(ruta).isDirectory();
    } catch {
      continue;
    }
    if (esDir) salida.push(...bajo(ruta));
    else if (EXT.some((e) => nombre.endsWith(e))) salida.push(ruta);
  }
  return salida;
}

/** Los `.ts` sueltos de la RAIZ — `auth.ts`, `auth.config.ts`, `middleware.ts`.
 *  Es justo lo que se le escapo al barrido que dio el falso «limpio». */
function enLaRaiz(): string[] {
  return readdirSync(".")
    .filter((n) => EXT.some((e) => n.endsWith(e)))
    .filter((n) => {
      try {
        return statSync(n).isFile();
      } catch {
        return false;
      }
    });
}

function todos(): string[] {
  return [...enLaRaiz(), ...RAICES.flatMap(bajo)];
}

/** Para cada `.from(schema.users)`, mira hacia atras el `.select` mas cercano y
 *  dice si venia vacio. Se hace por texto a proposito: la alternativa es un
 *  parser, y lo que se vigila es una forma de escritura. */
/** El salto de linea, DERIVADO. Teclearlo como escape en un heredoc lo
 *  convierte en un salto real y parte la cadena — paso al escribir esta
 *  misma guarda. Ver [[el-byte-que-deja-el-fichero-invisible]]. */
const SALTO = String.fromCharCode(10);

function lecturasSinProyectar(texto: string): number[] {
  const lineas: number[] = [];
  const re = /\.from\(\s*schema\.users\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const antes = texto.slice(0, m.index);
    const i = antes.lastIndexOf(".select");
    if (i === -1) continue;
    // Lo que hay entre `.select` y el `.from`: si es `()` la lectura no proyecta.
    const entre = antes.slice(i + ".select".length).replace(/\s/g, "");
    if (entre === "()") lineas.push(antes.split(SALTO).length);
  }
  return lineas;
}

describe("las lecturas de `users` proyectan sus columnas", () => {
  it("ningun `db.select()` pelado sobre `users`, raiz incluida", () => {
    const ficheros = todos();
    const culpables: string[] = [];
    for (const f of ficheros) {
      const texto = readFileSync(f, "utf8");
      if (!texto.includes("schema.users")) continue;
      for (const l of lecturasSinProyectar(texto)) culpables.push(`${f}:${l}`);
    }

    expect(
      culpables,
      `Estas lecturas piden TODAS las columnas de \`users\`, asi que una columna `
        + `declarada y aun sin migrar las revienta con 42703. Proyecta los campos `
        + `que uses: .select({ id: schema.users.id, ... }). `
        + `(barridos ${ficheros.length} ficheros)`,
    ).toEqual([]);

    // 🔴 EL BRAZO DE CONTROL DEL BARRIDO. Sin esto, un glob roto o una raiz
    // renombrada darian «limpio» por haber mirado CERO ficheros — que es
    // exactamente como se colo el falso «limpio» que dejo esto pasar.
    expect(ficheros.length).toBeGreaterThan(200);
    expect(ficheros).toContain("auth.ts");
  });

  // Y que la de arriba no pase por no saber reconocer el patron.
  it("BRAZO DE CONTROL: el detector reconoce un `.select()` pelado", () => {
    const malo = ["const r = await db", "  .select()", "  .from(schema.users)", "  .limit(1);"].join(SALTO);
    const bueno = ["const r = await db", "  .select({ id: schema.users.id })", "  .from(schema.users);"].join(SALTO);
    expect(lecturasSinProyectar(malo)).toHaveLength(1);
    expect(lecturasSinProyectar(bueno)).toHaveLength(0);
  });
});
