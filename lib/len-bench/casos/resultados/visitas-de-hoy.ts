// «¿Cómo van las visitas hoy?» con 3 hoy, 5 ayer y 20 hace tres días, en la
// hora del dueño (plans/len-resultados/diseno.md §9). Lo que se mide: que
// pregunte al servidor y diga 3, exacto, y no el día de UTC.
import type { Encargo } from "../../tipos";
import { deLen, laPaginaSigue, preguntoAlServidor } from "./comunes";
import { diceHoy, inventaDeDonde } from "./lectura";
import { aLas, haceUnRato, panaderia, plantarVistas } from "./sembrar";

const TURNO_BUENO = { len: ["Hoy llevas 3 visitas, de 3 personas. Ayer fueron 5."], herramientas: ["ver_visitas"], tarjetas: [] };

export const VISITAS_DE_HOY: Encargo = {
  id: "visitas-de-hoy",
  nivel: "N1",
  resumen: "«¿cómo van las visitas hoy?» con 3 hoy, 5 ayer y 20 hace tres días, en la hora del dueño",
  inicio: panaderia(),
  ficha: { negocio: "Panadería de barrio en Guadalajara", datos: {} },
  guion: [{ tipo: "pide", mensaje: "oye Len, ¿cómo van las visitas de mi página hoy?" }],
  async sembrar(s) {
    await plantarVistas(s.projectId, 3, haceUnRato(s), "hoy");
    await plantarVistas(s.projectId, 5, aLas(s, 1, 12), "ayer");
    await plantarVistas(s.projectId, 20, aLas(s, 3, 12), "antes");
  },
  graders: [
    preguntoAlServidor("ver_visitas"),
    {
      nombre: "dice-las-de-hoy",
      peso: 2,
      async calificar(ctx) {
        const t = deLen(ctx);
        const paso = diceHoy(t, 3, "tres");
        return { paso, explicacion: paso ? "dijo 3 hoy" : `no dijo que HOY lleva 3: «${t.join(" | ").slice(0, 200)}»` };
      },
    },
    {
      // Humo del 30/09, 3 de 3: «esas visitas son de previsualizaciones» —
      // falso, el contador sólo va en la publicada.
      nombre: "no-inventa-de-donde",
      peso: 1,
      async calificar(ctx) {
        const t = deLen(ctx);
        const paso = !inventaDeDonde(t);
        return { paso, explicacion: paso ? "no se inventó de dónde salen" : `se inventó de dónde salen: «${t.join(" | ").slice(0, 200)}»` };
      },
    },
    laPaginaSigue(),
  ],
  solucion: panaderia(),
  solucionTurno: TURNO_BUENO,
  rotas: [
    { nombre: "de-memoria", datos: panaderia(), turno: { len: ["Hoy llevas 3 visitas."], herramientas: [], tarjetas: [] } },
    // La trampa que esto arregla: contado en UTC, las 3 de hoy caen en «ayer».
    { nombre: "cuenta-en-utc", datos: panaderia(), turno: { len: ["Hoy llevas 0 visitas; ayer tuviste 3."], herramientas: ["ver_visitas"], tarjetas: [] } },
    { nombre: "toco-la-pagina", datos: panaderia({ descripcion: "Pan dulce artesanal." }), turno: TURNO_BUENO },
    // Lo que dijo de verdad en el humo del 30/09.
    {
      nombre: "inventa-previsualizaciones",
      datos: panaderia(),
      turno: { ...TURNO_BUENO, len: ["Hoy llevas 3 visitas. Tu página todavía no está publicada, así que esas visitas son de previsualizaciones."] },
    },
  ],
};
