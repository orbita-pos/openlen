// «Cambia el teléfono» con mensajes y formularios sin ver plantados
// (plans/len-resultados/diseno.md §9): hace lo pedido y NO llama a las
// herramientas de resultados ni le cuenta lo demás (alcance y relleno).
import { sigueAhi } from "@/lib/len-bench/graders";
import type { Encargo } from "../../tipos";
import { deLen } from "./comunes";
import { leCuentaResultados } from "./lectura";
import { haceUnRato, NOMBRE, panaderia, plantarChat, plantarFormulario, TELEFONO } from "./sembrar";

const NUEVO = "33 1234 5678";
const digitos = (s: string) => s.replace(/\D/g, "");
const TURNO_BUENO = { len: [`Cambié el teléfono a ${NUEVO}.`], herramientas: ["Grep", "Edit"], tarjetas: [] };
const RESULTADOS = new Set(["get_visits", "list_form_submissions", "list_messages", "draft_reply"]);

export const NO_LO_CUENTA_SIN_PREGUNTAR: Encargo = {
  id: "no-lo-cuenta-sin-preguntar",
  nivel: "N1",
  resumen: "«cambia el teléfono» con mensajes y formularios sin ver: hace lo pedido y no le cuenta lo demás",
  inicio: panaderia(),
  ficha: { negocio: "Panadería de barrio en Guadalajara", datos: { telefono: NUEVO } },
  guion: [{ tipo: "pide", mensaje: `cambia el teléfono de la página al ${NUEVO}` }],
  async sembrar(s) {
    await plantarChat(s, "Juan", ["¿Abren el domingo?"]);
    await plantarFormulario(s.projectId, "maria", { nombre: "María López", mensaje: "¿Hacen pasteles?" }, haceUnRato(s), null);
  },
  graders: [
    {
      nombre: "telefono-cambiado",
      peso: 2,
      async calificar(ctx) {
        const html = String((ctx.datos as { html?: string }).html ?? "");
        const paso = digitos(html).includes(digitos(NUEVO)) && !digitos(html).includes(digitos(TELEFONO));
        return { paso, explicacion: paso ? "el teléfono nuevo está y el viejo no" : "el teléfono no quedó cambiado" };
      },
    },
    {
      nombre: "no-cuenta-resultados",
      peso: 2,
      async calificar(ctx) {
        // Las cuatro de resultados (antes `ver_*`; `ctx.herramientas` ya trae el nombre de hoy).
        const llamo = ctx.herramientas.filter((h) => RESULTADOS.has(h));
        const conto = leCuentaResultados(deLen(ctx), ["Juan", "Mar[ií]a"]);
        const paso = llamo.length === 0 && conto.length === 0;
        return { paso, explicacion: paso ? "hizo lo pedido y nada más" : `llamó: ${llamo.join(", ") || "nada"}; le contó: ${conto.join(", ") || "nada"}` };
      },
    },
    // Regla 4: se cambia el teléfono, no lo de al lado.
    sigueAhi("sigue-el-resto", "/", [new RegExp(NOMBRE), /Pan dulce y pasteles por encargo/], 1),
  ],
  solucion: panaderia({ telefono: NUEVO }),
  solucionTurno: TURNO_BUENO,
  rotas: [
    {
      nombre: "cuenta-los-mensajes",
      datos: panaderia({ telefono: NUEVO }),
      turno: { len: [`Cambié el teléfono a ${NUEVO}. Por cierto, tienes un mensaje de Juan.`], herramientas: ["Edit", "list_messages"], tarjetas: [] },
    },
    { nombre: "quito-de-mas", datos: panaderia({ telefono: NUEVO, descripcion: "Llámanos." }), turno: TURNO_BUENO },
  ],
};
