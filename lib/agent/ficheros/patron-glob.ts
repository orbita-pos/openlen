/**
 * Un glob como expresión regular anclada: `**`, `*`, `?`, `{a,b}` y `[…]`.
 *
 * Claude Code delega en ripgrep (Grep) y en su buscador de ficheros (Glob). Aquí
 * los ficheros son pocos y virtuales, así que basta con esto — y sin una
 * dependencia nueva para un puñado de rutas.
 */
export function globARegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` puede no ser ninguna carpeta; `**` al final, cualquier cosa.
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const cierre = glob.indexOf("}", i);
      if (cierre === -1) re += "\\{";
      else {
        const opciones = glob.slice(i + 1, cierre).split(",");
        re += `(?:${opciones.map((o) => globARegExp(o).source.slice(1, -1)).join("|")})`;
        i = cierre;
      }
    } else if (c === "[") {
      const cierre = glob.indexOf("]", i + 1);
      if (cierre === -1) re += "\\[";
      else {
        const dentro = glob.slice(i + 1, cierre).replace(/^!/, "^").replace(/\\/g, "\\\\");
        re += `[${dentro}]`;
        i = cierre;
      }
    } else re += c.replace(/[.+^$()|\\/]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * ¿Pasa un fichero los `--glob` de ripgrep? Un glob sin `/` mira el nombre del
 * fichero; con `/`, la ruta relativa a la carpeta donde se busca. Los que
 * empiezan por `!` excluyen. Con globs positivos, hay que casar alguno.
 */
export function pasaLosGlobs(relativa: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return true;
  const nombre = relativa.split("/").pop() ?? relativa;
  const casa = (g: string) => globARegExp(g).test(g.includes("/") ? relativa : nombre);
  const positivos = globs.filter((g) => !g.startsWith("!"));
  const negativos = globs.filter((g) => g.startsWith("!") && g.length > 1).map((g) => g.slice(1));
  if (negativos.some(casa)) return false;
  return positivos.length === 0 || positivos.some(casa);
}

/** Como Claude Code parte `glob`: por espacios, y por comas salvo dentro de
 *  llaves (`*.{ts,tsx}` es UN glob). */
export function partirGlobs(glob: string): string[] {
  const salida: string[] = [];
  for (const trozo of glob.split(/\s+/)) {
    if (trozo.includes("{") && trozo.includes("}")) salida.push(trozo);
    else salida.push(...trozo.split(",").filter(Boolean));
  }
  return salida.filter(Boolean);
}
