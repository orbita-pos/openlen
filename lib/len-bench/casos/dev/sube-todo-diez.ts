// lib/len-bench/casos/dev/sube-todo-diez.ts — N3, F02/F08, sobre una página REAL
// de OpenLen (plantilla `grano`, tostador de café, precios en euros).
//
// «Súbeles un 10 % a todos los precios, redondeando para arriba a los 10
// céntimos»: 3,40 → 3,80 · 4,20 → 4,70 · 2,40 → 2,70 · 9,60 → 10,60. La
// cuenta es fácil de hacer mal (3,74 redondeado normal es 3,70) y la página
// tiene cifras que NO son precios y no se tocan: «Gratis desde 30 €» (el
// umbral de envío), «desde 2016», «12 kg», «300 ML». La vuelta deshace una
// parte: «la suscripción déjala como estaba» (9,60 €). Los precios nuevos van
// en la ficha: es lo que el dueño confirma si Len le pregunta, y así
// `nada-inventado` los da por dados y caza el redondeo mal hecho.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar, type Cambio } from "@/lib/len-bench/casos/cambiar";
import {
  contieneTexto,
  enlacesInternosVan,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const precios = (despertar: string, reposado: string, casa: string): Cambio[] => [
  [">3,40 €<", `>${despertar}<`],
  [">4,20 €<", `>${reposado}<`],
  [">2,40 €<", `>${casa}<`],
];
const SUSCRIPCION = ">9,60 €<span";
const ENVIO = "Gratis desde 30 €";

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "sube-todo-diez.inicio.html"), "utf8");
  const bien = precios("3,80 €", "4,70 €", "2,70 €");
  const solucion = cambiar(inicio, bien);

  return {
    id: "sube-todo-diez",
    nivel: "N3",
    resumen: "Subir un 10 % todos los precios con una regla de redondeo, sin tocar las cifras que no son precios, y deshacer una parte en la vuelta.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Tostador de café de especialidad con barra y tienda en línea",
      // El umbral del envío lo sabe el dueño: sin él en la ficha no podía
      // corregir un «subí también el envío gratis a 33 €» dicho en voz alta
      // (control del 26/09, #2). Y los precios van con su nombre de YA
      // SUBIDOS: como `el_despertar` a secas, el cliente los leía como los de
      // antes y le pedía a Len subirlos otra vez (sonda del 26/09).
      datos: {
        el_despertar_ya_con_la_subida: "3,80 €",
        reposado_en_frio_ya_con_la_subida: "4,70 €",
        la_casa_ya_con_la_subida: "2,70 €",
        envio_gratis_desde: "30 €",
      },
    },
    guion: [
      {
        tipo: "pide",
        mensaje: "subieron los costos. subele un 10% a todos los precios de la pagina, y redondea para arriba a los 10 centimos",
      },
      { tipo: "vuelve", mensaje: "ah no, la suscripcion dejala como estaba, esa no sube" },
    ],
    graders: [
      contieneTexto("los-tres-suben", "/", /3,80\s?€[\s\S]*4,70\s?€[\s\S]*2,70\s?€/),
      yaNoAparece("sin-los-de-antes", ["3,40 €", "4,20 €", "2,40 €"]),
      contieneTexto("suscripcion-como-estaba", "/", /9,60\s?€/),
      yaNoAparece("sin-la-suscripcion-subida", "10,60 €"),
      contieneTexto("envio-como-estaba", "/", /desde 30\s?€/),
      // Las cifras que NO son precios no suben un 10 %: los años, los kilos,
      // los tamaños y el horario se quedan.
      sigueAhi("siguen-las-cifras-que-no-son-precios", "/", [/desde 2016/, /Lotes de 12 kg/, /300 ML/i, /250 G/i, /08:00\s*[–-]\s*20:00/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "redondeo-normal", datos: { html: cambiar(inicio, precios("3,70 €", "4,60 €", "2,60 €")) } },
      { nombre: "sin-redondear", datos: { html: cambiar(inicio, precios("3,74 €", "4,62 €", "2,64 €")) } },
      { nombre: "suscripcion-subida", datos: { html: cambiar(solucion, [[SUSCRIPCION, ">10,60 €<span"]]) } },
      { nombre: "subio-lo-que-no-es-precio", datos: { html: cambiar(solucion, [["Lotes de 12 kg", "Lotes de 13,2 kg"]]) } },
      { nombre: "envio-subido", datos: { html: cambiar(solucion, [[ENVIO, "Gratis desde 33 €"]]) } },
      { nombre: "solo-uno", datos: { html: cambiar(inicio, [[">3,40 €<", ">3,80 €<"]]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/cafeterias/">Cafeterías</a></nav>']]) } },
    ],
  };
}
