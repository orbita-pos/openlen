// Partir un fichero SQL en sentencias, como hace la CLI de Supabase antes de
// aplicar una migración (y guarda en `supabase_migrations.schema_migrations
// .statements`): por `;` fuera de comillas, identificadores entre comillas,
// cadenas con `$etiqueta$`, y comentarios `--` y `/* */` (anidables).

export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  // Si desde el último `;` ha salido algo que no es comentario ni espacio. Lo
  // anota el propio recorrido, que ya se salta los comentarios: hasta el 14/10
  // lo decidía una regex sobre cada trozo, `^(?:--[^\n]*\n?|…|\s)*$`, que con
  // un separador `-- PERFILES ------…` delante del SQL probaba 2^n maneras de
  // partir los guiones y colgaba el hilo principal (ver la prueba).
  let hasCode = false;
  const push = (end: number) => {
    const stmt = sql.slice(start, end).trim();
    if (hasCode && stmt.length > 0) out.push(stmt);
    start = end + 1;
    hasCode = false;
  };
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c !== ";" && !(c === "-" && next === "-") && !(c === "/" && next === "*") && !/\s/.test(c)) hasCode = true;
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
        continue;
      }
    }
    if (c === ";") {
      push(i);
      i++;
      continue;
    }
    i++;
  }
  push(n);
  return out;
}
