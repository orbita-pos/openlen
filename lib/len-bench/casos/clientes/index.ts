// lib/len-bench/casos/clientes/index.ts — THE CUSTOMERS GAME: battery 1 of Len 3.1.
//
// Plan local 2026-11-15-len-3-1-bateria-de-paginas-gratis, task 9 (spec local 2026-11-12-len-3-1-ruta, §5 piece 5):
// each case is a real customer's page project — their first message and follow-ups in order —, started from the
// page they started on, graded against their final page in production with a generic rubric (rubric.ts). In the
// repo, ids only (cases.json); the text is fetched read-only into a folder outside it (fetched.ts).
import fs from "node:fs";
import path from "node:path";

import type { Encargo } from "../../tipos";
import { readFetchedCase, type FetchedCase } from "./fetched";
import { customerGraders, customerRotas } from "./rubric";

export { customerGraders, customerRotas } from "./rubric";

export function customerCase(f: FetchedCase): Encargo {
  const datos: Record<string, string> = {};
  f.cardAnswers.forEach((a, i) => {
    datos[`respuesta_${i + 1}`] = a.answer;
  });
  if (f.published) datos.subdominio = f.published.subdomain;
  const n = f.ownerMessages.length;
  return {
    id: `cliente-${f.projectId.slice(0, 8)}`,
    nivel: "N2",
    origen: "cliente",
    resumen: `Proyecto real de un cliente: ${n} mensaje${n === 1 ? "" : "s"} del dueño${f.published ? ", publicada" : ""}.`,
    inicio: f.start,
    ficha: { negocio: "cliente real", datos },
    guion: f.ownerMessages.map((mensaje) => ({ tipo: "pide" as const, mensaje })),
    graders: customerGraders(f),
    solucion: f.final,
    rotas: customerRotas(f),
    publicaLen: f.published !== null,
  };
}

/** The cases of cases.json, each read from where the fetch left it. A case never fetched stops the load and says
 *  how to fetch it. */
export function loadCustomerCases(raiz = process.cwd()): Encargo[] {
  const ids = JSON.parse(fs.readFileSync(path.join(raiz, "lib/len-bench/casos/clientes/cases.json"), "utf8")) as { projectId: string }[];
  return ids.map(({ projectId }) => customerCase(readFetchedCase(projectId)));
}
