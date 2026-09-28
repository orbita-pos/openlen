// scripts/len-bench-validar.ts — las reglas 2 y 3 del diseño y la 4 (lo que no se pidió tocar), SIN MODELO y sin coste.
//
//   npm run bench:len:validar -- --juego=pendientes [--solo=taqueria-menu-whatsapp]
//
// Cada variante —la solución, la partida y cada rota— se publica de verdad con
// `publishProject` en un proyecto de usar y tirar, se sirve como Caddy y se
// califica: el mismo camino que una corrida, menos Len. Lo que decide si el
// caso cumple está en lib/len-bench/validar.ts. Sale con 1 si alguno incumple.
//
// El servidor de Len-Bench sólo hace falta si algún caso envía un formulario
// (`formulario-llega`): es el único grader que habla con Next.

import { createThrowawayProject, deleteThrowawayProject, resolveEvalUser } from "@/lib/len-bench/proyecto-de-eval";
import { apagarEnEsteProceso, BASE_LEN_BENCH, exigirBaseLocal } from "@/lib/len-bench/entorno";
import { calificarDatos } from "@/lib/len-bench/conductor";
import { lanzarNavegador } from "@/lib/len-bench/navegador";
import { conversacionAlValidar, publicadaAlValidar, revisarCaso } from "@/lib/len-bench/validar";
import { cargarEncargos, type Juego } from "@/lib/len-bench/casos/cargar";
import { avisosDelEncargo } from "@/lib/len-bench/avisos";
import type { Encargo, ResultadoDeGrader } from "@/lib/len-bench/tipos";
import type { ProjectData } from "@/lib/projects/types";

async function main(): Promise<number> {
  const juego = (process.argv.find((a) => a.startsWith("--juego="))?.slice(8) ?? "pendientes") as Juego;
  const solo = process.argv.find((a) => a.startsWith("--solo="))?.slice(7).split(",").filter(Boolean);
  const encargos = (await cargarEncargos(juego)).filter((x) => !solo || solo.includes(x.id));
  if (encargos.length === 0) throw new Error(`no hay casos que validar en «${juego}»${solo ? ` con --solo=${solo.join(",")}` : ""}`);
  // La validación da la solución por publicada sin pasar por la tarjeta: esto
  // es lo que le dice que, con Len, ese grader no podría pasar.
  for (const e of encargos) for (const a of avisosDelEncargo(e)) console.log(`⚠ caso «${e.id}»: ${a}`);

  if (encargos.some((e) => e.graders.some((g) => g.nombre === "formulario-llega"))) {
    const vivo = await fetch(`${BASE_LEN_BENCH}/api/auth/session`).then(
      () => true,
      () => false,
    );
    if (!vivo) throw new Error(`hay casos con formulario y el servidor de Len-Bench no contesta en ${BASE_LEN_BENCH}: npm run bench:len:servidor`);
  }

  apagarEnEsteProceso(process.cwd());
  await exigirBaseLocal();
  const owner = await resolveEvalUser();
  const navegador = await lanzarNavegador();

  async function con(e: Encargo, datos: ProjectData, etiqueta: string): Promise<ResultadoDeGrader[]> {
    const id = await createThrowawayProject(owner.id, `len-bench-validar-${e.id}-${etiqueta}`, datos);
    try {
      return (await calificarDatos(e, id, { base: BASE_LEN_BENCH, owner, navegador, conservar: false }, {
        conversacion: conversacionAlValidar(e),
        publicadaPorLen: publicadaAlValidar(e, etiqueta),
      })).graders;
    } finally {
      await deleteThrowawayProject(id);
    }
  }

  let malos = 0;
  try {
    for (const e of encargos) {
      const solucion = await con(e, e.solucion, "solucion");
      const variantes: { nombre: string; graders: ResultadoDeGrader[] }[] = [];
      for (const [nombre, datos] of [["inicio", e.inicio] as const, ...e.rotas.map((r) => [r.nombre, r.datos] as const)]) {
        variantes.push({ nombre, graders: await con(e, datos, nombre) });
      }
      const { ok, problemas } = revisarCaso(e, { solucion, variantes });
      if (!ok) malos++;
      console.log(`${ok ? "✔" : "✘"} ${e.id}`);
      for (const [nombre, graders] of [["solucion", solucion] as const, ...variantes.map((v) => [v.nombre, v.graders] as const)]) {
        const rojos = graders.filter((g) => g.puntua && !g.paso).map((g) => g.nombre);
        console.log(`    ${nombre.padEnd(22)} ${rojos.length === 0 ? "todos en verde" : `rojo: ${rojos.join(", ")}`}`);
      }
      for (const p of problemas) console.log(`    ${p}`);
    }
  } finally {
    await navegador.close();
  }
  console.log(malos === 0 ? "\nTodos los casos cumplen las reglas 2, 3 y 4." : `\n${malos} caso(s) incumplen.`);
  return malos;
}

void main().then(
  (malos) => process.exit(malos === 0 ? 0 : 1),
  (e: unknown) => {
    console.error(`len-bench-validar: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
