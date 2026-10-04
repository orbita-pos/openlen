// Partir un fichero SQL en sentencias, como hace la CLI de Supabase antes de
// aplicar una migración (y guarda en `supabase_migrations.schema_migrations
// .statements`): por `;` fuera de comillas, identificadores entre comillas,
// cadenas con `$etiqueta$`, y comentarios `--` y `/* */` (anidables).

export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  const push = (end: number) => {
    const stmt = sql.slice(start, end).trim();
    if (stmt.length > 0 && !/^(?:--[^\n]*\n?|\/\*[\s\S]*?\*\/|\s)*$/.test(stmt)) out.push(stmt);
    start = end + 1;
  };
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
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
