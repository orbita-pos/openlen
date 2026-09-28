// lib/len-bench/casos/dev/oficina-y-whatsapp.ts — N2, F01/F02, sobre una página
// REAL de OpenLen (plantilla `fuero`, despacho de abogados en España).
//
// Dos números distintos en un mensaje: la oficina (para llamar) y el WhatsApp,
// dichos SIN la lada. Lo que suele salir mal: cruzarlos (el `tel:` al WhatsApp
// o al revés), dejar el número viejo en el pie («+34 900 000 000» sale dos
// veces), o ponerle a `wa.me` una lada que nadie dio. La ficha los trae con
// +34: preguntarlo vale, y deducirlo de la página (todo va con +34) también;
// otra lada es inventada. El de WhatsApp lleva el mensaje que pidió el dueño.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  botonesDeWhatsAppVan,
  botonesQueDicenVan,
  enlacesInternosVan,
  flujo,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const LLAMANOS = '<div><div style="font-weight:600">Llámanos</div><div style="color:var(--muted)">+34 900 000 000 · L–V 9:00–19:00</div></div>';
const PIE = "L–V · 9:00–19:00<br>+34 900 000 000</p>";

interface Numeros {
  readonly tel: string;
  readonly wa: string;
  readonly conMensaje: boolean;
  readonly pie: string;
}
const contacto = (n: Numeros) =>
  `<div><div style="font-weight:600"><a href="tel:+${n.tel}">Llámanos</a></div><div style="color:var(--muted)">+34 91 555 12 34 · L–V 9:00–19:00</div>` +
  `<a href="https://wa.me/${n.wa}${n.conMensaje ? "?text=" + encodeURIComponent("Hola, quiero una consulta") : ""}" class="btn btn-primary mt-3" style="display:inline-flex">Escríbenos por WhatsApp</a></div>`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "oficina-y-whatsapp.inicio.html"), "utf8");
  const con = (n: Numeros) => cambiar(inicio, [[LLAMANOS, contacto(n)], [PIE, `L–V · 9:00–19:00<br>${n.pie}</p>`]]);
  const bien: Numeros = { tel: "34915551234", wa: "34612345678", conMensaje: true, pie: "+34 91 555 12 34" };
  const solucion = con(bien);

  return {
    id: "oficina-y-whatsapp",
    nivel: "N2",
    resumen: "Dos números sin lada (oficina y WhatsApp) cada uno en su botón, el viejo fuera de toda la página y el WhatsApp con el mensaje pedido.",
    inicio: { html: inicio },
    ficha: { negocio: "Despacho de abogados de familia en Madrid", datos: { oficina: "+34 91 555 12 34", whatsapp: "+34 612 34 56 78" } },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "cambiamos de telefono. el de la oficina ahora es el 91 555 12 34 y el whatsapp es el 612 34 56 78. pon un boton para llamar a la oficina y otro para escribir por whatsapp, y que el de whatsapp ya lleve escrito 'Hola, quiero una consulta'",
      },
    ],
    graders: [
      botonesQueDicenVan("llamar-va-a-la-oficina", /ll[aá]m/i, "oficina"),
      botonesDeWhatsAppVan("whatsapp"),
      yaNoAparece("sin-el-telefono-viejo", "+34 900 000 000"),
      // Cambian los teléfonos; el correo, la dirección y el horario, que van
      // al lado, se quedan.
      sigueAhi("sigue-lo-de-al-lado", "/", [/hola@fuero\.example/, /Paseo de la Audiencia 8/, /L–V\s*·?\s*9:00\s*[–-]\s*19:00/]),
      flujo("whatsapp-con-mensaje", "/", [{ pulsa: /whatsapp/i }, { abre: /34612345678\?text=[\s\S]*consulta/i }]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "numeros-cruzados", datos: { html: con({ ...bien, tel: "34612345678", wa: "34915551234" }) } },
      { nombre: "pie-con-el-viejo", datos: { html: con({ ...bien, pie: "+34 900 000 000" }) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["hola@fuero.example", ""]]) } },
      { nombre: "whatsapp-sin-mensaje", datos: { html: con({ ...bien, conMensaje: false }) } },
      { nombre: "lada-inventada", datos: { html: con({ ...bien, wa: "52612345678" }) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/honorarios/">Honorarios</a></nav>']]) } },
    ],
  };
}
