// «¿Tengo formularios nuevos?» con 2 sin ver (María y Pedro) y 5 vistos
// (plans/len-resultados/diseno.md §9). Lo que se mide: que pregunte al
// servidor y diga 2 y de quién, no los 7.
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Encargo } from "../../tipos";
import { deLen, laPaginaSigue, preguntoAlServidor } from "./comunes";
import { aLas, haceUnRato, panaderia, plantarFormulario } from "./sembrar";

const TURNO_BUENO = {
  len: ["Tienes 2 formularios nuevos: María López pregunta por un tres leches para 20 y Pedro Ruiz quiere 20 conchas para el sábado."],
  herramientas: ["ver_formularios"],
  tarjetas: [],
};

export const FORMULARIOS_NUEVOS: Encargo = {
  id: "formularios-nuevos",
  nivel: "N1",
  resumen: "«¿tengo formularios nuevos?» con 2 sin ver (María y Pedro) y 5 vistos",
  inicio: panaderia(),
  ficha: { negocio: "Panadería de barrio en Guadalajara", datos: {} },
  guion: [{ tipo: "pide", mensaje: "¿me llegó algún formulario nuevo?" }],
  async sembrar(s) {
    // La marca «para todos» de la identidad de eval, a cero: si alguien abrió
    // Formularios con ella, los dos nuevos saldrían vistos y el caso mediría eso.
    await db.update(schema.users).set({ lastSeenLeadsAt: null }).where(eq(schema.users.id, s.ownerId));
    for (let i = 0; i < 5; i++) {
      const cuando = aLas(s, 3 + i, 11);
      await plantarFormulario(s.projectId, `visto-${i}`, { nombre: `Cliente ${i + 1}`, mensaje: "Pedido de la semana pasada" }, cuando, cuando);
    }
    await plantarFormulario(s.projectId, "maria", { nombre: "María López", correo: "maria@ejemplo.com", mensaje: "¿Hacen pasteles de tres leches para 20 personas?" }, haceUnRato(s), null);
    await plantarFormulario(s.projectId, "pedro", { nombre: "Pedro Ruiz", "teléfono": "+52 33 1234 5678", mensaje: "Quiero 20 conchas para el sábado" }, aLas(s, 1, 17), null);
  },
  graders: [
    preguntoAlServidor("ver_formularios"),
    {
      nombre: "dice-cuantos-y-de-quien",
      peso: 2,
      async calificar(ctx) {
        const t = deLen(ctx).join("\n");
        const faltan = [/\b(2|dos)\b/i, /María/, /Pedro/].filter((re) => !re.test(t)).map(String);
        return { paso: faltan.length === 0, explicacion: faltan.length === 0 ? "2, María y Pedro" : `le falta: ${faltan.join(", ")}` };
      },
    },
    laPaginaSigue(),
  ],
  solucion: panaderia(),
  solucionTurno: TURNO_BUENO,
  rotas: [
    { nombre: "cuenta-los-vistos", datos: panaderia(), turno: { len: ["Tienes 7 formularios: María, Pedro y cinco clientes más."], herramientas: ["ver_formularios"], tarjetas: [] } },
    { nombre: "de-memoria", datos: panaderia(), turno: { len: ["Tienes 2 nuevos, de María y de Pedro."], herramientas: [], tarjetas: [] } },
    { nombre: "toco-la-pagina", datos: panaderia({ descripcion: "Pan dulce artesanal." }), turno: TURNO_BUENO },
  ],
};
