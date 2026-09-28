// lib/len-bench/casos/dev/presupuesto-que-llega.ts — N2, sobre una página REAL de
// OpenLen (plantilla `reforma`, reformas integrales).
//
// La plantilla trae un formulario FALSO: `div` con forma de campo, un texto
// para el visitante que dice «Conecta el módulo de Formularios…» y un botón que
// es un enlace a `#presupuesto`. No se puede rellenar ni envía nada: la
// «interfaz Potemkin» de los carriles (C3). El dueño lo nota porque no le
// llega nada. Lo que se mide: que haya un formulario que LLEGA de verdad a la
// bandeja (la publicación cablea cualquier <form> a /api/f/<sub>), y que el
// texto de plantilla no quede a la vista del visitante.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  enlacesInternosVan,
  formularioLlega,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const CAMPO =
  'style="display:block;width:100%;height:48px;border:1px solid var(--line);border-radius:var(--radius);margin-top:6px;padding:0 14px;font-size:14px;background:transparent;color:inherit"';
const ETIQUETA = 'class="text-[12px]" style="color:var(--faint)"';

// El formulario de verdad, con el mismo aspecto que el falso.
const FORMULARIO = `<form class="grid gap-3">
              <label ${ETIQUETA}>Nombre<input name="nombre" required placeholder="Tu nombre" ${CAMPO}></label>
              <div class="grid grid-cols-2 gap-3">
                <label ${ETIQUETA}>Teléfono<input name="telefono" type="tel" required placeholder="600 000 000" ${CAMPO}></label>
                <label ${ETIQUETA}>Tipo<select name="tipo" ${CAMPO}><option>Cocina</option><option>Baño</option><option>Integral</option></select></label>
              </div>
              <button type="submit" class="btn btn-primary w-full mt-4" style="justify-content:center">Pedir presupuesto gratis</button>
            </form>`;

function bloqueFalso(html: string): string {
  const ini = html.indexOf('<p class="text-[13.5px]" style="color:var(--muted);margin-bottom:20px">Conecta el módulo');
  const cierre = "Pedir presupuesto gratis</a>";
  const fin = html.indexOf(cierre);
  if (ini < 0 || fin < ini) throw new Error("la partida ya no trae el formulario falso donde se esperaba");
  return html.slice(ini, fin + cierre.length);
}

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "presupuesto-que-llega.inicio.html"), "utf8");
  const solucion = cambiar(inicio, [[bloqueFalso(inicio), FORMULARIO]]);
  return {
    id: "presupuesto-que-llega",
    nivel: "N2",
    resumen: "El formulario de presupuesto de la plantilla es falso (divs y un enlace): hacer uno que llegue de verdad.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Empresa de reformas integrales en Valencia (España)",
      datos: { telefono: "+34 900 123 456", correo: "hola@reforma.example" },
      gustos: ["que el formulario sea corto, que la gente no se canse"],
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "el formulario de pedir presupuesto no sirve, la gente no puede ni escribir y no me llega nada. arreglalo para que me lleguen las solicitudes",
      },
    ],
    graders: [
      formularioLlega("/"),
      yaNoAparece("sin-texto-de-plantilla", "Conecta el módulo de Formularios", 1),
      // Se cambia el formulario falso; lo que tiene al lado se queda.
      sigueAhi("sigue-lo-de-al-lado", "/", [/Déjanos tus datos y un técnico/, /Toda la provincia/, /Si nos retrasamos,\s*te compensamos/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["Toda la provincia", ""]]) } },
      // Hay formulario, pero nada con qué enviarlo.
      {
        nombre: "sin-boton",
        datos: {
          html: cambiar(solucion, [
            ['<button type="submit" class="btn btn-primary w-full mt-4" style="justify-content:center">Pedir presupuesto gratis</button>', ""],
          ]),
        },
      },
      // Un teléfono que el dueño no dio.
      { nombre: "telefono-inventado", datos: { html: cambiar(solucion, [["</form>", "</form><p>O llámanos al 961 234 567</p>"]]) } },
      // Relleno «de confianza» que nadie dio (la agencia de viajes, prod 19–21/09).
      { nombre: "cifras-de-relleno", datos: { html: cambiar(solucion, [["</form>", "</form><p>Más de 350 reformas entregadas desde 2012</p>"]]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["<!-- FOOTER -->", '<div style="width:900px">x</div><!-- FOOTER -->']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</form>", '</form><a href="/contacto/">Contacto</a>']]) } },
    ],
  };
}
