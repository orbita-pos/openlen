// lib/agent/revision/diff-del-turno.ts — lo que el turno cambió, como diff unificado.
//
// H14 (paso 8 de Len 2.5): la receta de `/code-review` de Claude Code empieza
// por aquí, «…».
// Aquí no hay git: cada fichero tiene su copia de ANTES del turno
// (`session.alEmpezar`, o nada si el turno lo creó) y la de AHORA.
//
// Un diff de líneas por el algoritmo de Myers (el de `git diff`), con tres
// líneas de contexto y la numeración de los dos lados, que es lo que deja a un
// revisor citar «fichero:línea». Puro y sin dependencias: no vale la pena
// instalar un paquete para ~80 líneas.

export interface FicheroDelTurno {
  /** La ruta del sitio, p. ej. `/index.html`. */
  readonly ruta: string;
  /** Cómo estaba al empezar el turno; `null` si el turno lo creó. */
  readonly antes: string | null;
  /** Cómo quedó guardado. */
  readonly despues: string;
}

type Op = { readonly tipo: " " | "-" | "+"; readonly texto: string; readonly a: number; readonly b: number };

/** Las operaciones mínimas que llevan de `a` a `b` (Myers, O((N+M)·D)). */
function operaciones(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trazas: Map<number, number>[] = [];
  let fin = -1;
  for (let d = 0; d <= max && fin < 0; d++) {
    trazas.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0)) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        fin = d;
        break;
      }
    }
  }
  // Se recorre la traza hacia atrás para sacar el camino.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = fin; d > 0; d--) {
    const vd = trazas[d];
    const k = x - y;
    const previoK = k === -d || (k !== d && (vd.get(k - 1) ?? 0) < (vd.get(k + 1) ?? 0)) ? k + 1 : k - 1;
    const px = vd.get(previoK) ?? 0;
    const py = px - previoK;
    while (x > px && y > py) {
      ops.push({ tipo: " ", texto: a[x - 1], a: x, b: y });
      x--;
      y--;
    }
    if (x === px) ops.push({ tipo: "+", texto: b[y - 1], a: x, b: y }), y--;
    else ops.push({ tipo: "-", texto: a[x - 1], a: x, b: y }), x--;
  }
  while (x > 0 && y > 0) {
    ops.push({ tipo: " ", texto: a[x - 1], a: x, b: y });
    x--;
    y--;
  }
  return ops.reverse();
}

const CONTEXTO = 3;

/** El diff unificado de un fichero, o `""` si no cambió. */
export function diffDeFichero(f: FicheroDelTurno): string {
  const a = f.antes === null ? [] : f.antes.split("\n");
  const b = f.despues.split("\n");
  const ops = operaciones(a, b);
  const cambios = ops.map((o, i) => (o.tipo === " " ? -1 : i)).filter((i) => i >= 0);
  if (cambios.length === 0) return "";

  // Los trozos: cada cambio con su contexto, fundidos si se tocan.
  const trozos: [number, number][] = [];
  for (const i of cambios) {
    const desde = Math.max(0, i - CONTEXTO);
    const hasta = Math.min(ops.length - 1, i + CONTEXTO);
    const ultimo = trozos.at(-1);
    if (ultimo && desde <= ultimo[1] + 1) ultimo[1] = Math.max(ultimo[1], hasta);
    else trozos.push([desde, hasta]);
  }
  const cabecera = `--- ${f.antes === null ? "/dev/null" : `a${f.ruta}`}\n+++ b${f.ruta}\n`;
  return (
    cabecera +
    trozos
      .map(([desde, hasta]) => {
        const lineas = ops.slice(desde, hasta + 1);
        const deA = lineas.filter((o) => o.tipo !== "+");
        const deB = lineas.filter((o) => o.tipo !== "-");
        // La línea de inicio de cada lado es la de su primera línea en el trozo.
        const inicioA = deA.length ? deA[0].a : lineas[0].a;
        const inicioB = deB.length ? deB[0].b : lineas[0].b;
        return `@@ -${inicioA},${deA.length} +${inicioB},${deB.length} @@\n${lineas.map((o) => `${o.tipo}${o.texto}`).join("\n")}`;
      })
      .join("\n")
  );
}

/** El diff de todo el turno: un bloque por fichero que cambió, en orden. */
export function diffDelTurno(ficheros: readonly FicheroDelTurno[]): string {
  return ficheros
    .map(diffDeFichero)
    .filter(Boolean)
    .join("\n");
}
