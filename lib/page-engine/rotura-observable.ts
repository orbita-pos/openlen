// Lo que el motor MIDIÓ y se puede afirmar sin juicio, dicho en una frase por
// defecto.
//
// 🔴 EXISTE PORQUE ESTABA EN UN SITIO Y HACÍA FALTA EN DOS. La ruta de crear
// componía esta lista a mano para la PORTADA, y la subpágina —que pasa por el
// mismo `preparePage`, con el mismo Chromium y la misma `objectiveBreakage`—
// tiraba su informe sin leerlo. Copiar la composición allí habría creado la
// segunda copia que después se queda vieja en un sitio y no en el otro, que es
// el defecto que este repo ya ha pagado varias veces.
//
// NO ES UN JUICIO, y por eso caben las tres cosas juntas: algo desbordó o gritó
// en el render, una fórmula no compila, un selector no puede casar nunca. Las
// tres son ciertas pase lo que pase, y ninguna dice si la página es bonita.
//
// Lo que se HACE con esta lista no es cosa suya: la regla de la casa es que
// corrige el usuario, no nosotros, así que quien la llama la DICE (`emit`) y no
// repara. Ver la lápida de la reparación automática en `app/api/generate/route.ts`.

import type { PrepareReport } from "./contract";

/**
 * Las roturas observables de un informe, ya redactadas.
 *
 * Devuelve `[]` cuando no hay ninguna, que es el caso normal: una lista vacía
 * es «no se midió nada afirmable», no «la página está bien». Esa distinción es
 * la misma que `medicionLimpia` guarda en `lib/agent/aviso-medido.ts`.
 */
export function roturaObservable(report: PrepareReport): string[] {
  return [
    ...report.breakage,
    ...(report.calcIssues ?? []).map(
      (i) => `la fórmula ${i.attr}="${i.formula}" ${i.message}`,
    ),
    ...(report.deadRules ?? []).map(
      (r) =>
        `el selector \`${r.selector}\` no aplica NUNCA: falta class="${r.ausentes[0]}" en el documento`,
    ),
  ];
}
