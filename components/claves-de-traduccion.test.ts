// ¿PIDE ALGÚN COMPONENTE UNA CLAVE QUE NO EXISTE EN SU NAMESPACE?
//
// 🔴 POR QUÉ EXISTE ESTO. `account-menu.tsx` nació el 2026-08-31 con
// `useTranslations("wsChrome")` cuando sus textos —el tema, el sonido, la
// cuenta— viven en `topbar`. next-intl NO FALLA con eso: devuelve la RUTA DE LA
// CLAVE, así que el menú salía en producción con «wsChrome.account.editorSound»
// de etiqueta y «wsChrome.account.signOut» de botón. Compilaba, pasaba el lint,
// pasaba los 4.307 tests, y lo vio Jesús.
//
// Es la forma de fallo típica de mover un componente de sitio, y agosto ha sido
// un mes de mover componentes de sitio.
//
// LO QUE **NO** MIDE, y hay que decirlo: sólo ve las claves LITERALES. Una
// `t(\`errors.${code}\`)` se le escapa, y también un namespace que llega por
// prop. No es una red completa — es la red del error que ya se cometió.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { sinComentarios } from "@/lib/sin-comentarios";

const RAIZ = path.resolve(__dirname, "..");
const MSG = path.join(RAIZ, "messages/en");

const dominios: Record<string, unknown> = {};
for (const f of fs.readdirSync(MSG)) {
  dominios[f.replace(/[.]json$/, "")] = JSON.parse(fs.readFileSync(path.join(MSG, f), "utf8"));
}

function baja(obj: unknown, ruta: string): unknown {
  // Una ruta VACÍA es el objeto entero. Sin esta línea un namespace sin punto
  // ("auth") pedía `obj[""]` y los 17 ficheros de auth salían como rotos.
  if (!ruta) return obj;
  return ruta
    .split(".")
    .reduce<unknown>(
      (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    );
}

// 🔴 SE QUITAN LOS COMENTARIOS ANTES DE MIRAR. `chat-panel.tsx` explica en un
// comentario que «`tAgent("errors.agent_off")` nunca se llama y no tiene clave»
// — y eso es CIERTO y está bien escrito. Un escáner que lea el fichero crudo
// convierte esa explicación correcta en un fallo inventado. Ya me pasó hoy con
// otra guarda: el código muerto sigue hablando, y los comentarios vivos también.

const COMILLA = String.fromCharCode(34) + String.fromCharCode(39);
const DECL = new RegExp(
  "(?:const|let)[ ]+([A-Za-z0-9_]+)[ ]*=[ ]*(?:await[ ]+)?(?:useTranslations|getTranslations)[(][ ]*[" +
    COMILLA +
    "`]([A-Za-z0-9_.]+)[" +
    COMILLA +
    "`]",
  "g",
);

function ficheros(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ficheros(p, out);
    else if (/[.]tsx?$/.test(e.name) && !/[.]test[.]/.test(e.name)) out.push(p);
  }
  return out;
}

describe("cada t() apunta a una clave que existe en su namespace", () => {
  it("ningún componente pide una clave inexistente", () => {
    const rotas: string[] = [];
    const revisados: string[] = [];

    for (const f of [...ficheros(path.join(RAIZ, "app")), ...ficheros(path.join(RAIZ, "components"))]) {
      const src = sinComentarios(fs.readFileSync(f, "utf8"));
      const decls = [...src.matchAll(DECL)].map((m) => ({
        pos: m.index ?? 0,
        nombre: m[1],
        ns: m[2],
      }));
      if (!decls.length) continue;
      revisados.push(f);
      const corto = path.relative(RAIZ, f).split(path.sep).join("/");

      const USO = new RegExp(
        "(?:^|[^A-Za-z0-9_.])([A-Za-z0-9_]+)(?:[.]rich)?[(][ ]*[" +
          COMILLA +
          "]([A-Za-z0-9_.-]+)[" +
          COMILLA +
          "]",
        "g",
      );
      for (const m of src.matchAll(USO)) {
        // La declaración VIGENTE es la última anterior a este uso: un fichero
        // puede declarar varias `t` distintas (inspector-fields.tsx tiene tres),
        // y quedarse con la última del fichero inventa fallos.
        let mia: { nombre: string; ns: string; pos: number } | null = null;
        for (const d of decls) if (d.nombre === m[1] && d.pos < (m.index ?? 0)) mia = d;
        if (!mia) continue;
        // Un namespace anidado ("wsPage.agent") es legal en next-intl.
        const dominio = baja(dominios[mia.ns.split(".")[0]], mia.ns.split(".").slice(1).join("."));
        if (dominio === undefined) {
          rotas.push(`${corto}: el namespace "${mia.ns}" no existe`);
          continue;
        }
        if (baja(dominio, m[2]) === undefined) {
          rotas.push(`${corto} → ${m[1]}("${m[2]}") no existe en "${mia.ns}"`);
        }
      }
    }

    // Brazo de control: si el escáner deja de encontrar ficheros —un cambio de
    // rutas, un refactor— saldría verde por vacío y no guardaría nada. Hoy son
    // 77; el suelo está en 60 para que consolidar componentes no lo rompa, pero
    // un derrumbe sí.
    expect(revisados.length, "el escáner no encontró componentes con traducciones").toBeGreaterThan(
      60,
    );
    // Sin repetir y con techo: un namespace mal escrito rompe TODAS las claves
    // de su fichero, y un volcado de mil líneas idénticas esconde el fallo.
    expect([...new Set(rotas)].slice(0, 25)).toEqual([]);
  });
});
