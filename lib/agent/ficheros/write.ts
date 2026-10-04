/**
 * WRITE, con el contrato de Claude Code (plans/len-2/ficheros-plan.md §A).
 *
 * Crea un fichero o lo reescribe entero. Un fichero que existe no se pisa sin
 * haberlo leído, ni si cambió desde la lectura — y aquí, a diferencia de Edit,
 * no hay recuperación: sin un trozo que casar no se puede saber si lo nuevo se
 * lleva por delante lo del otro.
 *
 * Una página nueva del sitio es un Write a `/<slug>/index.html` que no existe:
 * en Claude Code no hay «copiar el esqueleto de la home», se lee `index.html` y
 * se escribe (decisión B7). Como `planearEdit`, esto no guarda nada.
 */
import { esFicheroDeSupabase } from "./supabase";
import { almacenDeRuta, noDeclarado } from "./datos";
import { paginaDeRuta, resolverRuta } from "./sitio";
import { normalizarFinales, type Leidos, type SitioLegible } from "./read";
import { CAMBIADO_DESDE_LA_LECTURA, NO_LEIDO, NOTA_ESTADO_AL_DIA, type PlanDeEdit } from "./edit";
import { fallo } from "./resultado";
import { esDeLaPlataforma, MANUAL_SOLO_LECTURA } from "./manual";

export interface EntradaWrite {
  readonly file_path: string;
  readonly content: string;
}

const ALIAS_DEL_CONTENIDO = ["file_text", "file_content"] as const;

/**
 * Los nombres de otros modelos, y la nota que se lo dice. `file_text` o
 * `file_content` sólo se toman si viene UNO y no hay `content`: con dos no se
 * adivina cuál era.
 */
export function coercerEntradaWrite(raw: Record<string, unknown>): { entrada: EntradaWrite; nota?: string } {
  const dichas: string[] = [];
  let file_path = typeof raw.file_path === "string" ? raw.file_path : "";
  if (!Object.hasOwn(raw, "file_path") && typeof raw.path === "string") {
    file_path = raw.path;
    dichas.push("`path` was taken as `file_path`.");
  }
  let content = typeof raw.content === "string" ? raw.content : "";
  const alias = ALIAS_DEL_CONTENIDO.filter((k) => Object.hasOwn(raw, k));
  const [unico] = alias;
  if (unico !== undefined && alias.length === 1 && !Object.hasOwn(raw, "content") && typeof raw[unico] === "string") {
    content = raw[unico] as string;
    dichas.push(`\`${unico}\` was taken as \`content\`.`);
  }
  if (Object.hasOwn(raw, "description")) dichas.push("`description` is not a parameter and was left out.");
  const entrada = { file_path, content };
  return dichas.length
    ? { entrada, nota: `Note: Write takes \`file_path\` and \`content\`. ${dichas.join(" ")}` }
    : { entrada };
}

/** `/menu.html` → `/menu/index.html`: la página que se quiso crear con la
 *  forma de fichero suelto. Sólo para un `.html` en la raíz; lo demás no es
 *  una página y no se le inventa una. */
function paginaQueQuisoCrear(ruta: string): string | undefined {
  const m = /^\/([^/]+)\.html?$/i.exec(ruta);
  if (!m) return undefined;
  const destino = `/${m[1]!.toLowerCase()}/index.html`;
  return paginaDeRuta(destino) ? destino : undefined;
}

export function planearWrite(entrada: EntradaWrite, sitio: SitioLegible, leidos: Leidos): PlanDeEdit {
  const ruta = resolverRuta(entrada.file_path);
  if (esDeLaPlataforma(ruta)) return { ok: false, resultado: fallo(MANUAL_SOLO_LECTURA) };
  const crudo = sitio.contenido(ruta);

  if (crudo === null) {
    // Claude Code crearía cualquier fichero. Aquí los ficheros son páginas y no
    // hay dónde guardar otra cosa: se dice, y se sugiere la ruta que sí es.
    const almacen = almacenDeRuta(ruta);
    if (almacen !== null) return { ok: false, resultado: fallo(noDeclarado(almacen)) };
    if (!paginaDeRuta(ruta) && !esFicheroDeSupabase(ruta)) {
      const parecida = paginaQueQuisoCrear(ruta);
      return {
        ok: false,
        resultado: fallo(
          `Cannot create ${ruta}: this site only has pages, at /index.html and /<slug>/index.html, and the data files of its declared stores, at /datos/<store>.json, and its Supabase files, under /supabase/.${parecida ? ` Did you mean ${parecida}?` : ""}`,
        ),
      };
    }
    return {
      ok: true,
      ruta,
      contenido: entrada.content,
      crea: true,
      respuesta: ({ guardadoIgual }) =>
        `Created ${entrada.file_path}.${guardadoIgual ? NOTA_ESTADO_AL_DIA : ""}`,
    };
  }

  const lectura = leidos.get(ruta);
  if (!lectura || lectura.vistaParcial) return { ok: false, resultado: fallo(NO_LEIDO) };
  if (lectura.instantanea !== normalizarFinales(crudo)) {
    return { ok: false, resultado: fallo(CAMBIADO_DESDE_LA_LECTURA) };
  }
  return {
    ok: true,
    ruta,
    contenido: entrada.content,
    crea: false,
    respuesta: ({ guardadoIgual }) =>
      `Replaced the whole content of ${entrada.file_path}.${guardadoIgual ? NOTA_ESTADO_AL_DIA : ""}`,
  };
}
