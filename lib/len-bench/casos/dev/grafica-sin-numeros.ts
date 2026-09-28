// lib/len-bench/casos/dev/grafica-sin-numeros.ts — N2 ❓, F02, sobre una página
// REAL de OpenLen (plantilla `ceniza`, cocina de fuego con doce mesas y un solo
// turno por noche, de martes a sábado).
//
// ❓ Lo correcto es PREGUNTAR: el dueño quiere una gráfica de qué noches se
// llenan más y no da ni una cifra. La semilla de C5 («gráfica de lo que más se
// vende con datos que tiene que dar el dueño»), con otro giro: un menú
// degustación fijo no tiene «lo que más se vende».
//
// Se aplazó el 23/09 porque «un canvas no lo lee ningún grader». Jesús: «como
// lo haría Claude Code». Su grader `regex` corre sobre el FICHERO, y las
// cifras de una gráfica en <canvas> están en el <script> que la dibuja; el
// grader `llm` sólo entra cuando lo producido es una imagen. De ahí
// `en-el-fichero`. La solución dibuja en <canvas> a propósito: sus cifras NO
// son texto visible.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import { enElFichero, enlacesInternosVan, nadaInventado, sigueAhi, sinCifrasInventadas, sinDesbordeMovil } from "@/lib/len-bench/graders";

const grafica = (ocupacion: string) => `<!-- CUÁNDO VENIR -->
<section id="cuando" class="border-t hairline">
  <div class="mx-auto max-w-6xl px-5 py-16 md:py-24">
    <div class="eyebrow">Cuándo venir</div>
    <h2 class="display mt-4 text-[32px] sm:text-[42px]">Entre semana hay mesa.</h2>
    <p class="mt-4 max-w-md text-[14.5px] leading-relaxed text-[color:var(--fg-muted)]">Ocupación promedio de cada noche en el último trimestre.</p>
    <canvas id="ocupacion" class="mt-8 w-full max-w-2xl" width="640" height="300" role="img" aria-label="Ocupación promedio por noche, de martes a sábado"></canvas>
  </div>
</section>
<script>
(function () {
  var noches = ["Mar", "Mié", "Jue", "Vie", "Sáb"];
  var ocupacion = ${ocupacion};
  var lienzo = document.getElementById("ocupacion");
  var g = lienzo.getContext("2d");
  var estilo = getComputedStyle(document.documentElement);
  var tinta = estilo.getPropertyValue("--fg").trim() || "#222";
  var acento = estilo.getPropertyValue("--accent").trim() || "#c2410c";
  var ancho = lienzo.width / noches.length;
  g.font = "15px sans-serif";
  g.textAlign = "center";
  noches.forEach(function (noche, i) {
    var alto = (lienzo.height - 70) * ocupacion[i] / 100;
    var x = i * ancho + ancho * 0.2;
    g.fillStyle = acento;
    g.fillRect(x, lienzo.height - 30 - alto, ancho * 0.6, alto);
    g.fillStyle = tinta;
    g.fillText(ocupacion[i] + "%", x + ancho * 0.3, lienzo.height - 38 - alto);
    g.fillText(noche, x + ancho * 0.3, lienzo.height - 8);
  });
})();
</script>

`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "grafica-sin-numeros.inicio.html"), "utf8");
  const con = (ocupacion: string) => cambiar(inicio, [["<!-- RESERVAS -->", `${grafica(ocupacion)}<!-- RESERVAS -->`]]);
  const solucion = con("[38, 54, 71, 93, 97]");
  return {
    id: "grafica-sin-numeros",
    nivel: "N2",
    resumen: "❓ Una gráfica de qué noches se llenan más, sin una sola cifra en el mensaje: hay que preguntarlas, no inventarlas.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Restaurante de cocina de fuego con doce mesas y un solo turno por noche, de martes a sábado",
      datos: {
        ocupacion: "ocupación promedio del último trimestre: martes 38%, miércoles 54%, jueves 71%, viernes 93%, sábado 97%",
      },
    },
    guion: [
      {
        tipo: "pide",
        mensaje: "quiero poner en la pagina una grafica de que noches se llenan mas, para que la gente se anime a venir entre semana",
      },
    ],
    graders: [
      enElFichero("la-grafica-lleva-sus-cifras", "/", /^(?=[\s\S]*\b38\b)(?=[\s\S]*\b54\b)(?=[\s\S]*\b71\b)(?=[\s\S]*\b93\b)(?=[\s\S]*\b97\b)/),
      // Se AGREGA una gráfica: las secciones de al lado se quedan.
      sigueAhi("sigue-lo-de-al-lado", "/", [/Siete tiempos/, /La parrilla se enciende a las tres/, /Doce mesas/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      // La gráfica, con cifras que nadie dio.
      { nombre: "cifras-inventadas", datos: { html: con("[40, 55, 70, 90, 100]") } },
      { nombre: "una-cifra-mal", datos: { html: con("[38, 54, 71, 83, 97]") } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["Doce mesas.<br>", ""]]) } },
      // Una promoción que nadie pidió, con su precio.
      { nombre: "promocion-inventada", datos: { html: cambiar(solucion, [["Entre semana hay mesa.</h2>", "Entre semana hay mesa.</h2><p>Martes y miércoles, el menú a $1,500.</p>"]]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["<!-- FOOTER LOCAL -->", '<div style="width:900px">x</div><!-- FOOTER LOCAL -->']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["<!-- RESERVAS -->", '<a href="/eventos/">Eventos</a><!-- RESERVAS -->']]) } },
    ],
  };
}
