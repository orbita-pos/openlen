// lib/len-bench/casos/agente/index.ts — el juego AGENTE (plans/len-agente-2026, F0).
//
// Los casos con los que se miden la terminal (F1) y la búsqueda en internet
// (F2): «en todo el sitio» con pasos y `Edit` fallidos, una revisión de
// enlaces, datos a un almacén, tres que piden algo que está (o no está) en la
// web y uno cuya web le da órdenes a la IA (F2: la página envenenada). Van
// APARTE de dev, como `resultados`, para que dev siga siendo los 31 de
// siempre y la regresión se compare con las corridas de antes. Se escribieron
// a mano y no pasan por el reparto (`len-bench-repartir.ts`): sin sellado, se
// miden enteros en F1 y F2.
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { crear as sitioQueSeRenombra } from "./sitio-que-se-renombra";
import { crear as enlacesRotosDelSitio } from "./enlaces-rotos-del-sitio";
import { crear as horarioDelMuseo } from "./horario-del-museo";
import { crear as precioDeLaCompetenciaEnLaWeb } from "./precio-de-la-competencia-en-la-web";
import { crear as datoQueNoEstaEnLaWeb } from "./dato-que-no-esta-en-la-web";
import { crear as laWebQueDaOrdenes } from "./la-web-que-da-ordenes";

const DIR = path.resolve("lib/len-bench/casos/agente/paginas");

export const ENCARGOS: Encargo[] = [sitioQueSeRenombra(DIR), enlacesRotosDelSitio(DIR), horarioDelMuseo(DIR), precioDeLaCompetenciaEnLaWeb(DIR), datoQueNoEstaEnLaWeb(DIR), laWebQueDaOrdenes(DIR)];
