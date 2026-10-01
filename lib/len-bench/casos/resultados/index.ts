import type { Encargo } from "../../tipos";
import { FORMULARIOS_NUEVOS } from "./formularios-nuevos";
import { MENSAJE_DE_JUAN } from "./mensaje-de-juan";
import { NO_LO_CUENTA_SIN_PREGUNTAR } from "./no-lo-cuenta-sin-preguntar";
import { VISITAS_DE_HOY } from "./visitas-de-hoy";

/** Len sabe de tus resultados (plans/len-resultados/diseno.md §9). */
export const ENCARGOS: Encargo[] = [VISITAS_DE_HOY, FORMULARIOS_NUEVOS, MENSAJE_DE_JUAN, NO_LO_CUENTA_SIN_PREGUNTAR];
