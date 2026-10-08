// lib/len-bench/app-verificada.ts — UNA APP PASA SU PROPIA VERIFICACIÓN TRAS
// CADA CAMBIO (tarea #15 de la spec local 2026-10-07-apps).
//
// La verificación de una app es la de la plataforma, la misma que cierra la
// puerta de publicar (`toolPublicar`) y que le vuelve a Len en el
// `<new-diagnostics>`: la carpeta compila entera con el compilador (sucrase,
// fichero a fichero, contra el catálogo congelado) y el cascarón sigue
// arrancando la entrada. Una app que no la pasa se ve EN BLANCO.
//
// En un encargo de app no basta con que el final compile: el dueño mira su app
// después de CADA mensaje, y una que se queda en blanco entre el segundo y el
// tercero es una que el dueño vio rota. Por eso el conductor la corre al cerrar
// cada paso del guion (`verificaciones` en el contexto) y este grader pide
// todas en verde. Al validar no hay pasos: mira el estado que se califica.
//
// $0: sin modelo ni navegador.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { erroresDeLaApp, problemasDelCascaron } from "@/lib/agent/compila-la-app";
import { textoDeDiagnostico } from "@/lib/apps/compilador";
import { listProjectFiles } from "@/lib/backend/files";
import type { ProjectData } from "@/lib/projects/types";
import type { Grader } from "./tipos";

/** Lo que falla de la app, en una línea por problema. `null` si no es una app. */
export function problemasDeLaApp(data: Pick<ProjectData, "html" | "app">, ficheros: Readonly<Record<string, string>>): string[] | null {
  const app = data.app ?? null;
  if (!app) return null;
  return [
    ...erroresDeLaApp(app, ficheros).map(textoDeDiagnostico),
    ...problemasDelCascaron(app, data.html ?? "", ficheros).map((d) => `${d.ruta} — ${d.mensaje}`),
  ];
}

/** La verificación del proyecto tal como está en la base ahora. */
export async function verificarAppDelProyecto(projectId: string): Promise<{ ok: boolean; problemas: string[] }> {
  const fila = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const data = (fila[0]?.data ?? {}) as ProjectData;
  const problemas = problemasDeLaApp(data, await listProjectFiles(projectId));
  if (problemas === null) return { ok: false, problemas: ["el proyecto no es una app (no tiene data.app)"] };
  return { ok: problemas.length === 0, problemas };
}

const resumir = (ps: readonly string[]) => ps.slice(0, 3).join(" · ") + (ps.length > 3 ? ` (+${ps.length - 3})` : "");

/**
 * La app compila y arranca tras CADA paso del guion. En la corrida lee las
 * `verificaciones` que apuntó el conductor; al validar, verifica el estado que
 * se califica.
 */
export function appVerificadaTrasCadaCambio(peso = 3): Grader {
  return {
    nombre: "app-verificada-tras-cada-cambio",
    peso,
    async calificar(ctx) {
      if (ctx.verificaciones) {
        if (ctx.verificaciones.length === 0) return { paso: false, explicacion: "no se verificó ningún paso: el guion no llegó a correr" };
        const rotas = ctx.verificaciones.filter((v) => !v.ok);
        return rotas.length === 0
          ? { paso: true, explicacion: `la app compiló y arrancó tras los ${ctx.verificaciones.length} pasos` }
          : {
              paso: false,
              explicacion: `la app no pasaba su verificación tras ${rotas.map((v) => `el paso ${v.paso + 1}`).join(", ")}: ${resumir(rotas[0]!.problemas)}`,
            };
      }
      const v = await verificarAppDelProyecto(ctx.projectId);
      return v.ok
        ? { paso: true, explicacion: "la app compila y el cascarón la arranca" }
        : { paso: false, explicacion: `la app no pasa su verificación: ${resumir(v.problemas)}` };
    },
  };
}
