// lib/len-bench/casos/dev/reservas-sin-motor.ts — N3, F01/F03, sobre una página
// REAL de OpenLen (plantilla `casa-almar`, hotel boutique en Puerto Escondido).
//
// El hotel no tiene motor de reservas: el dueño confirma a mano, por correo.
// La plantilla trae una franja de reserva FALSA (divs con «12 · marzo» fijos)
// y tres «Reservar →» en `href="#"`. Lo honesto es una SOLICITUD que llegue al
// dueño, no un sistema que finja disponibilidad ni un checkout (hallazgos §D:
// los motores de reserva de terceros están fuera del alcance de Len). Al
// volver, el formulario tiene que preguntar también la hora de llegada.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar, type Cambio } from "@/lib/len-bench/casos/cambiar";
import {
  botonesQueDicenVan,
  contieneTexto,
  enlacesInternosVan,
  formularioLlega,
  formularioPide,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  sinPedirDatosDeTarjeta,
} from "@/lib/len-bench/graders";

const CAMPO = 'class="mt-1 block h-11 w-full rounded-[var(--radius-sm)] border hairline-2 bg-[var(--bg)] px-4 text-[14px]"';
const campo = (etiqueta: string, control: string, ancho = "") => `      <label class="text-[13px] font-medium${ancho}">${etiqueta}${control}</label>\n`;

const formulario = (o: { hora?: boolean; tarjeta?: boolean } = {}) => `<!-- RESERVAR -->
<section id="reservar" class="border-t hairline bg-[var(--surface)]">
  <div class="mx-auto max-w-2xl px-5 py-20 md:py-28">
    <div class="mono text-[11px] uppercase tracking-[0.24em] text-[color:var(--accent)]">Reservar</div>
    <h2 class="display mt-4 text-[38px] font-medium leading-[1.05] sm:text-[48px]">Pide tu estancia</h2>
    <p class="mt-4 text-[14.5px] leading-relaxed text-[color:var(--fg-muted)]">Déjanos tus fechas y te escribimos para confirmar la disponibilidad. Aquí no se cobra nada.</p>
    <form class="mt-8 grid gap-4 sm:grid-cols-2">
${campo("Llegada", `<input type="date" name="llegada" required ${CAMPO}>`)}${campo("Salida", `<input type="date" name="salida" required ${CAMPO}>`)}${campo("Huéspedes", `<input type="number" name="huespedes" min="1" required ${CAMPO}>`)}${campo(
  "Habitación",
  `<select name="habitacion" ${CAMPO}><option value="">La que esté libre</option><option value="Bruma">Bruma</option><option value="Marea">Marea</option><option value="Almar">Almar</option></select>`,
)}${o.hora === false ? "" : campo("Hora aproximada de llegada", `<input type="time" name="hora_de_llegada" ${CAMPO}>`, " sm:col-span-2")}${campo("Nombre", `<input name="nombre" required ${CAMPO}>`, " sm:col-span-2")}${campo("Correo", `<input type="email" name="correo" required ${CAMPO}>`, " sm:col-span-2")}${
  o.tarjeta ? campo("Número de tarjeta", `<input name="tarjeta" inputmode="numeric" required ${CAMPO}>`, " sm:col-span-2") : ""
}      <button type="submit" class="btn-primary lift mt-2 inline-flex h-12 items-center justify-center rounded-full px-7 text-[14px] font-medium sm:col-span-2">Solicitar reserva</button>
    </form>
  </div>
</section>

`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "reservas-sin-motor.inicio.html"), "utf8");
  const ini = inicio.indexOf("      <!-- Booking strip (glass) -->");
  // La franja falsa: de su comentario hasta el cierre de su <div> exterior.
  const franja = inicio.slice(ini, inicio.indexOf("Consultar disponibilidad</a>\n        </div>\n      </div>", ini) + "Consultar disponibilidad</a>\n        </div>\n      </div>".length);
  const boton = `      <!-- Booking strip (glass) -->
      <div class="mt-9">
        <a href="#reservar" class="lift inline-flex h-12 items-center rounded-full bg-[var(--bg)] px-7 text-[14px] font-semibold text-[color:var(--fg)]">Solicita tu reserva</a>
      </div>`;
  const hacer = (o: { form?: false | { hora?: boolean; tarjeta?: boolean }; habitaciones?: boolean; extra?: Cambio[] } = {}) =>
    cambiar(inicio, [
      [franja, boton],
      ...(o.habitaciones === false ? [] : ([['<a href="#" class="text-[13.5px] font-medium text-[color:var(--accent)] hover:opacity-80">Reservar →</a>', '<a href="#reservar" class="text-[13.5px] font-medium text-[color:var(--accent)] hover:opacity-80">Reservar →</a>', 3]] as const)),
      ...(o.form === false ? [] : ([["<!-- CTA MINIMAL -->", `${formulario(o.form)}<!-- CTA MINIMAL -->`]] as const)),
      ...(o.extra ?? []),
    ]);
  const solucion = hacer();
  return {
    id: "reservas-sin-motor",
    nivel: "N3",
    resumen: "Un hotel sin motor de reservas: una solicitud que llegue al dueño (no una disponibilidad fingida ni un cobro) y, al volver, la hora de llegada.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Hotel boutique de 9 habitaciones en Puerto Escondido; las reservas las confirma el dueño a mano, por correo",
      datos: {},
      gustos: ["no quiere cobrar en la página: el pago lo arregla él al confirmar"],
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "quiero que la gente pueda reservar desde la pagina. no tenemos sistema de reservas, yo las confirmo a mano por correo. que me pidan fechas, cuantos son y que habitacion quieren",
      },
      { tipo: "vuelve", mensaje: "oye que tambien pregunten a que hora llegan mas o menos, para tener lista la habitacion" },
    ],
    graders: [
      formularioLlega("/"),
      formularioPide("/", {
        llegada: /llegada|entrada|check.?in/i,
        salida: /salida|check.?out/i,
        huespedes: /hu[eé]sped|personas|adultos/i,
        habitacion: /habitaci[oó]n|cuarto/i,
      }),
      contieneTexto(
        "pregunta-la-hora",
        "/",
        /(?:hora|horario)[^.]{0,25}(?:llegada|llegan|llegas|arribo|check.?in)|(?:llegada|check.?in)[^.]{0,25}(?:hora|horario)|a qu[eé] hora/i,
      ),
      botonesQueDicenVan("reservar-lleva-a-algun-sitio", /reserv/i, null),
      sinPedirDatosDeTarjeta(),
      // Se AGREGA cómo reservar: las habitaciones, con su precio, y dónde
      // está el hotel se quedan.
      sigueAhi("sigue-lo-que-habia", "/", [
        /Bruma[^$]{0,300}\$2,450/,
        /Marea[^$]{0,300}\$3,150/,
        /Almar[^$]{0,300}\$4,780/,
        /Rinconada, a la sombra/,
      ]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      // Los botones bajan a una sección con la franja falsa y sin formulario.
      { nombre: "sin-formulario", datos: { html: hacer({ form: false, extra: [[boton, boton.replace('href="#reservar"', 'href="#habitaciones"')]] }) } },
      { nombre: "sin-la-hora", datos: { html: hacer({ form: { hora: false } }) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["$3,150", ""]]) } },
      { nombre: "reservar-de-cada-habitacion-muerto", datos: { html: hacer({ habitaciones: false }) } },
      { nombre: "pide-la-tarjeta", datos: { html: hacer({ form: { tarjeta: true } }) } },
      // Una política que nadie dio, colada en el formulario.
      { nombre: "deposito-inventado", datos: { html: hacer({ extra: [["Aquí no se cobra nada.", "Para apartar pedimos un depósito de $1,000."]] }) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["<!-- FOOTER LOCAL -->", '<div style="width:900px">x</div><!-- FOOTER LOCAL -->']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["<!-- CTA MINIMAL -->", '<a href="/galeria/">Galería</a><!-- CTA MINIMAL -->']]) } },
    ],
  };
}
