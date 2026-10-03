// lib/len-bench/casos/hard/one-page-to-site.ts — «de-una-pagina-a-sitio», N3, del
// juego DIFÍCIL (plans/len-2/corridas/2026-10-03-dynamis).
//
// Sobre la plantilla REAL `marejada` (hostal de surf en Sayulita), de UNA
// página, como la deja la plantilla: el menú son anclas y los botones de
// reservar y de WhatsApp no llevan a ningún lado. Tres mensajes: partirla en un
// sitio (inicio con lo de arriba y las reseñas, cuartos, la casa y surf, y un
// contacto NUEVO con formulario), con el mismo menú y pie en todas; que reservar
// y WhatsApp lleven al número del hostal con un mensaje que diga DESDE QUÉ
// PÁGINA escriben; y al volver, la calle nueva donde salga.
//
// Las slugs no se dictan: el sitio se recorre por su MENÚ, como un visitante
// (`flujo` pulsa «Cuartos», «Surf», «Contacto»…), y lo que se mira es que cada
// página sea OTRA página (sin las reseñas de la home) con lo suyo dentro.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar, type Cambio } from "@/lib/len-bench/casos/cambiar";
import { enPagina, enTodas, partirEnPaginas } from "@/lib/len-bench/casos/partir";
import {
  enCadaPagina,
  enlacesInternosVan,
  flujo,
  nadaInventado,
  ningunEnlaceRoto,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const WHATSAPP = "523227654321";
const RESENA = /Vine tres noches y me quedé once/;
const CAMPO = 'class="mt-1 block h-11 w-full rounded-[var(--radius)] border hairline bg-transparent px-3 text-[14px]"';

const CONTACTO = `<!-- CONTACTO -->
<section id="contacto" class="border-t hairline">
  <div class="mx-auto max-w-xl px-5 py-16 md:py-20">
    <div class="eyebrow">Contacto</div>
    <h2 class="display mt-3 text-[34px] sm:text-[42px]">Escríbenos y te apartamos la cama.</h2>
    <form class="mt-8 grid gap-4">
      <label class="text-[13px]">Nombre<input name="nombre" required ${CAMPO}></label>
      <label class="text-[13px]">Correo<input type="email" name="correo" required ${CAMPO}></label>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-[13px]">Llegada<input type="date" name="llegada" required ${CAMPO}></label>
        <label class="text-[13px]">Salida<input type="date" name="salida" required ${CAMPO}></label>
      </div>
      <label class="text-[13px]">Personas<input type="number" name="personas" min="1" required ${CAMPO}></label>
      <button type="submit" class="lift inline-flex h-11 items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[14px] font-semibold text-[color:var(--accent-ink)]">Mandar</button>
    </form>
  </div>
</section>

`;

/** El script que pone el WhatsApp en reservar, con la página en el mensaje. */
const WHATSAPP_JS = (conPagina: boolean) => `<script>
// Reservar y WhatsApp: al número del hostal, diciendo desde qué página escriben.
(function () {
  var paginas = { "/": "Inicio", "/cuartos/": "Cuartos", "/la-casa/": "La casa", "/surf/": "Surf", "/contacto/": "Contacto" };
  var donde = paginas[location.pathname] || paginas[location.pathname + "/"] || "Inicio";
  var texto = ${conPagina ? '"Hola, Marejada: les escribo desde la página de " + donde + "."' : '"Hola, Marejada: quiero reservar."'};
  document.querySelectorAll("[data-whatsapp]").forEach(function (a) {
    a.href = "https://wa.me/${WHATSAPP}?text=" + encodeURIComponent(texto);
  });
})();
</script>
</body>`;

interface Sitio {
  readonly conPagina?: boolean;
  readonly sinContacto?: boolean;
  readonly contactoFueraDelMenu?: boolean;
}

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "sitio-que-se-renombra.plantilla.html"), "utf8");

  const sitio = (s: Sitio = {}) => {
    const conLoNuevo = cambiar(inicio, [
      // El menú lleva a la página nueva.
      ...(s.contactoFueraDelMenu || s.sinContacto
        ? []
        : ([
            [
              '<a href="#surf" class="hover:text-[color:var(--fg)]">Surf</a>',
              '<a href="#surf" class="hover:text-[color:var(--fg)]">Surf</a>\n      <a href="/contacto/" class="hover:text-[color:var(--fg)]">Contacto</a>',
            ],
          ] as Cambio[])),
      // Reservar (menú, cuartos y llamada final) y WhatsApp (pie), al número.
      ['<a href="#reservar" ', '<a href="#reservar" data-whatsapp '],
      ['<a id="reservar" href="#" class=', '<a id="reservar" href="#" data-whatsapp class='],
      ['<a href="#" class="lift inline-flex h-11 items-center rounded-full bg-[var(--bg)]', '<a href="#" data-whatsapp class="lift inline-flex h-11 items-center rounded-full bg-[var(--bg)]'],
      ['<a href="#" class="hover:text-[color:var(--fg)]">WhatsApp</a>', '<a href="#" data-whatsapp class="hover:text-[color:var(--fg)]">WhatsApp</a>'],
      ["</body>", WHATSAPP_JS(s.conPagina !== false)],
      ["<!-- CTA FULL-BLEED -->", `${s.sinContacto ? "" : CONTACTO}<!-- CTA FULL-BLEED -->`],
      // La calle nueva (la vuelta).
      ["Calle Pelícanos 12, Sayulita, Nay.", "Calle Gaviotas 7, Sayulita, Nay."],
    ]);
    const fin = s.sinContacto ? "<!-- CTA FULL-BLEED -->" : "<!-- CONTACTO -->";
    return partirEnPaginas(conLoNuevo, {
      cabeceraHasta: "<!-- HERO EDITORIAL SPLIT -->",
      pieDesde: "<!-- FOOTER LOCAL -->",
      paginas: [
        { slug: "", title: "Inicio", trozos: [["<!-- HERO EDITORIAL SPLIT -->", "<!-- CUARTOS -->"], ["<!-- RESEÑAS -->", fin], ["<!-- CTA FULL-BLEED -->", "<!-- FOOTER LOCAL -->"]] },
        { slug: "cuartos", title: "Cuartos", trozos: [["<!-- CUARTOS -->", "<!-- LA CASA -->"], ["<!-- CTA FULL-BLEED -->", "<!-- FOOTER LOCAL -->"]] },
        { slug: "la-casa", title: "La casa", trozos: [["<!-- LA CASA -->", "<!-- SURF -->"], ["<!-- CTA FULL-BLEED -->", "<!-- FOOTER LOCAL -->"]] },
        { slug: "surf", title: "Surf", trozos: [["<!-- SURF -->", "<!-- RESEÑAS -->"], ["<!-- CTA FULL-BLEED -->", "<!-- FOOTER LOCAL -->"]] },
        ...(s.sinContacto ? [] : [{ slug: "contacto", title: "Contacto", trozos: [["<!-- CONTACTO -->", "<!-- CTA FULL-BLEED -->"], ["<!-- CTA FULL-BLEED -->", "<!-- FOOTER LOCAL -->"]] as const }]),
      ],
    });
  };
  const solucion = sitio();

  // Una página de verdad, y no la misma con un ancla: el menú lleva a otra
  // dirección donde está lo suyo y NO están las reseñas de la home.
  const visita = (boton: RegExp, lo: RegExp) => [{ pulsa: boton }, { ve: lo }, { noVe: RESENA }] as const;

  return {
    id: "de-una-pagina-a-sitio",
    nivel: "N3",
    resumen:
      "Partir el one-page de un hostal en 5 páginas (con un contacto nuevo y su formulario), mismo menú y pie en todas, WhatsApp que dice desde qué página escriben, y la calle nueva donde salga.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Hostal de surf en Sayulita, Nayarit (Marejada)",
      datos: { whatsapp: "+52 322 765 4321", direccion: "Calle Gaviotas 7, Sayulita" },
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "la pagina ya es muy larga, partela en un sitio: que el inicio se quede con lo de arriba y las reseñas, y que los cuartos, la casa y el surf tengan cada uno su pagina. y una pagina nueva de contacto con un formulario: nombre, correo, fecha de llegada, fecha de salida y cuantas personas. el menu y el pie iguales en todas, y que el menu lleve a cada pagina",
      },
      {
        tipo: "pide",
        mensaje:
          "los botones de reservar y el de whatsapp no llevan a ningun lado: que lleven a nuestro whatsapp +52 322 765 4321, con un mensaje que diga desde que pagina nos escriben",
      },
      { tipo: "vuelve", mensaje: "ah, y nos cambiamos de calle: ahora estamos en Calle Gaviotas 7, aqui mismo en Sayulita. cambialo donde salga" },
    ],
    graders: [
      flujo("el-menu-lleva-a-cuartos", "/", visita(/^\s*cuartos\s*$/i, /Privada con terraza[\s\S]*\$1,350/)),
      flujo("el-menu-lleva-a-la-casa", "/", visita(/^\s*la casa\s*$/i, /silencio de 11 pm a 7 am/i)),
      flujo("el-menu-lleva-a-surf", "/", visita(/^\s*surf\s*$/i, /Clase privada[\s\S]{0,20}\$1,100/)),
      // El menú es el mismo en todas: se va de página en página por él.
      flujo("el-menu-esta-en-todas", "/", [
        { pulsa: /^\s*surf\s*$/i },
        { pulsa: /^\s*contacto\s*$/i },
        { pulsa: /^\s*la casa\s*$/i },
        { pulsa: /^\s*cuartos\s*$/i },
        { ve: /Dorm de mujeres/ },
        { noVe: RESENA },
      ]),
      flujo("el-contacto-manda", "/", [{ pulsa: /^\s*contacto\s*$/i }, { noVe: RESENA }, { envia: /Prueba Len-Bench/ }]),
      flujo("whatsapp-dice-desde-surf", "/", [
        { pulsa: /^\s*surf\s*$/i },
        { pulsa: /reserva|whats\s?app/i },
        { abre: new RegExp(`wa\\.me/${WHATSAPP}\\?text=[\\s\\S]*surf`, "i") },
      ]),
      flujo("whatsapp-dice-desde-cuartos", "/", [
        { pulsa: /^\s*cuartos\s*$/i },
        { pulsa: /reserva|whats\s?app/i },
        { abre: new RegExp(`wa\\.me/${WHATSAPP}\\?text=[\\s\\S]*cuartos`, "i") },
      ]),
      sigueAhi("la-home-sigue-con-sus-resenas", "/", [RESENA, /Léa · Montreal/]),
      yaNoAparece("sin-la-calle-vieja", ["Pelícanos 12"]),
      enCadaPagina("calle-nueva-en-cada-pie", /Gaviotas 7/),
      ningunEnlaceRoto(),
      enlacesInternosVan(),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
    ],
    solucion,
    rotas: [
      // Lo que hace un «sitio» que no lo es: el menú sigue siendo de anclas.
      { nombre: "sigue-en-una-pagina", datos: { html: cambiar(inicio, [["Calle Pelícanos 12, Sayulita, Nay.", "Calle Gaviotas 7, Sayulita, Nay."]]) } },
      { nombre: "sin-contacto", datos: sitio({ sinContacto: true }) },
      { nombre: "contacto-fuera-del-menu", datos: sitio({ contactoFueraDelMenu: true }) },
      { nombre: "whatsapp-sin-la-pagina", datos: sitio({ conPagina: false }) },
      { nombre: "calle-vieja-en-surf", datos: enPagina(solucion, "surf", [["Calle Gaviotas 7, Sayulita, Nay.", "Calle Pelícanos 12, Sayulita, Nay."]]) },
      { nombre: "sin-resenas", datos: enPagina(solucion, "", [[`"Vine tres noches y me quedé once. Paré mi primera ola el segundo día y nadie me dejó pagar la cerveza esa noche."`, ""]]) },
      { nombre: "precio-inventado", datos: enPagina(solucion, "cuartos", [["$1,350", "$1,450"]]) },
      { nombre: "enlace-roto", datos: enTodas(solucion, [['<a href="/contacto/" class', '<a href="/contactanos/" class']]) },
      { nombre: "desborda", datos: enPagina(solucion, "la-casa", [["<!-- FOOTER LOCAL -->", '<div style="width:900px">x</div><!-- FOOTER LOCAL -->']]) },
    ],
  };
}
