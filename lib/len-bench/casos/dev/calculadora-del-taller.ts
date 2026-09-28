// lib/len-bench/casos/dev/calculadora-del-taller.ts — N3, F03/F04, sobre una
// página REAL de OpenLen (plantilla `nido`, taller de muebles de madera).
//
// La semilla de C5: «calculadora de presupuesto por metros + selector de
// acabado que se recuerde + formulario». Tres encargos: la calculadora, que
// se acuerde del acabado, y —al volver— un formulario que mande ESE
// presupuesto. Lo mide `flujo` como lo haría un cliente: escribe los metros,
// elige el acabado (lo haya hecho Len con un <select>, radios o botones) y
// lee el total; y elige, recarga y vuelve a calcular. El acabado que se
// recuerda es el laqueado, el último de la lista: el primero podría salir
// «recordado» sólo por ser el de serie.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  enlacesInternosVan,
  flujo,
  formularioLlega,
  formularioPide,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
} from "@/lib/len-bench/graders";

const CAMPO = 'style="display:block;width:100%;height:48px;margin-top:6px;padding:0 16px;border:1px solid var(--line-strong);border-radius:12px;background:var(--bg);font-size:15px"';

interface Calc {
  readonly nogal?: string;
  readonly script?: boolean;
  readonly recuerda?: boolean;
  readonly formulario?: boolean;
}

const calculadora = (o: Calc = {}) => `<!-- CALCULADORA -->
  <section id="calculadora" class="wrap" style="padding:72px 24px 24px">
    <span class="eyebrow">Estantes a medida</span>
    <h2 style="font-size:clamp(30px,4.8vw,50px);margin-top:14px">Calculá tu estante</h2>
    <div class="grid gap-5 mt-8 md:grid-cols-3" style="align-items:end">
      <label style="font-size:14px">Metros de estante<input id="calc-metros" type="number" min="0.5" step="0.5" value="1" ${CAMPO}></label>
      <label style="font-size:14px">Acabado<select id="calc-acabado" ${CAMPO}><option value="38000">Natural al aceite — $ 38.000 el metro</option><option value="${(o.nogal ?? "44.000").replace(".", "")}">Nogal teñido — $ ${o.nogal ?? "44.000"} el metro</option><option value="52000">Laqueado blanco — $ 52.000 el metro</option></select></label>
      <p style="font-size:15px;color:var(--muted)">Total estimado<br><strong id="calc-total" class="serif" style="font-size:34px;color:var(--ink)">$ 38.000</strong></p>
    </div>
${
  o.formulario === false
    ? ""
    : `    <form class="grid gap-4 mt-10 md:grid-cols-3" style="align-items:end">
      <input type="hidden" name="metros" id="form-metros" value="1">
      <input type="hidden" name="acabado" id="form-acabado" value="Natural al aceite">
      <input type="hidden" name="total" id="form-total" value="$ 38.000">
      <label style="font-size:14px">Nombre<input name="nombre" required ${CAMPO}></label>
      <label style="font-size:14px">Teléfono<input type="tel" name="telefono" required ${CAMPO}></label>
      <button type="submit" class="btn btn-primary">Pedir este presupuesto</button>
    </form>
`
}  </section>
${
  o.script === false
    ? ""
    : `  <script>
  (function () {
    var metros = document.getElementById("calc-metros");
    var acabado = document.getElementById("calc-acabado");
    ${o.recuerda === false ? "" : 'var guardado = localStorage.getItem("nido-acabado");\n    if (guardado) acabado.value = guardado;'}
    function calcula() {
      var total = "$ " + Math.round((Number(metros.value) || 0) * Number(acabado.value)).toLocaleString("es-AR");
      document.getElementById("calc-total").textContent = total;
      ${
        o.formulario === false
          ? ""
          : `document.getElementById("form-metros").value = metros.value;
      document.getElementById("form-acabado").value = acabado.options[acabado.selectedIndex].text.split(" — ")[0];
      document.getElementById("form-total").value = total;`
      }
    }
    metros.addEventListener("input", calcula);
    acabado.addEventListener("change", function () { ${o.recuerda === false ? "" : 'localStorage.setItem("nido-acabado", acabado.value); '}calcula(); });
    calcula();
  })();
  </script>
`
}
`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "calculadora-del-taller.inicio.html"), "utf8");
  const con = (o: Calc = {}) => cambiar(inicio, [["<!-- MATERIALES / CALIDAD -->", `${calculadora(o)}\n  <!-- MATERIALES / CALIDAD -->`]]);
  const solucion = con();
  return {
    id: "calculadora-del-taller",
    nivel: "N3",
    resumen: "Una calculadora de estantes por metro y acabado, que se acuerde del acabado y, al volver, un formulario que mande ese presupuesto.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Taller de muebles de madera en Buenos Aires que hace estantes a medida",
      datos: {
        precio_aceite: "$ 38.000 el metro (natural al aceite)",
        precio_nogal: "$ 44.000 el metro (nogal teñido)",
        precio_laqueado: "$ 52.000 el metro (laqueado blanco)",
      },
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "quiero una calculadora para los estantes a medida: que el cliente ponga cuantos metros quiere y elija el acabado, y le salga el precio. natural al aceite $ 38.000 el metro, nogal teñido $ 44.000 y laqueado blanco $ 52.000",
      },
      { tipo: "pide", mensaje: "y que se acuerde del acabado que eligio si vuelve a entrar" },
      {
        tipo: "vuelve",
        mensaje: "abajo de la calculadora pone un formulario para que me pidan ese presupuesto: nombre y telefono, y que me llegue con los metros y el acabado que eligieron",
      },
    ],
    graders: [
      flujo("calcula", "/", [{ escribe: "3", en: /metro|largo|medida/i }, { elige: /nogal/i }, { ve: /\$\s?132[.,]?000(?!\d)/ }]),
      flujo("recuerda-el-acabado", "/", [
        { elige: /laqueado/i },
        { recarga: true },
        { escribe: "2", en: /metro|largo|medida/i },
        { ve: /\$\s?104[.,]?000(?!\d)/ },
      ]),
      formularioLlega("/"),
      formularioPide("/", { nombre: /nombre/i, telefono: /tel[eé]fono|celular|whatsapp/i, metros: /metro/i, acabado: /acabado/i }),
      // La calculadora se AGREGA entre la tienda y los materiales: los dos se quedan.
      sigueAhi("sigue-lo-de-al-lado", "/", [
        /Estante Abierto/,
        /Hecho para\s*durar, no para\s*reemplazar/,
        /Si una junta cede, la reparamos sin costo/,
        /Llevamos, montamos y nos llevamos el embalaje/,
      ]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      // Los campos están y el total no se mueve.
      { nombre: "calculadora-sin-codigo", datos: { html: con({ script: false }) } },
      { nombre: "no-recuerda-el-acabado", datos: { html: con({ recuerda: false }) } },
      { nombre: "precio-cambiado", datos: { html: con({ nogal: "45.000" }) } },
      { nombre: "sin-formulario", datos: { html: con({ formulario: false }) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["Llevamos, montamos y nos llevamos el embalaje. Vos solo elegís dónde va.", ""]]) } },
      // La vuelta hecha sobre la página de ANTES: el formulario, sin calculadora.
      {
        nombre: "la-vuelta-sin-la-calculadora",
        datos: {
          html: cambiar(inicio, [
            [
              "<!-- MATERIALES / CALIDAD -->",
              `<section class="wrap"><form><label>Nombre<input name="nombre" required ${CAMPO}></label><label>Teléfono<input type="tel" name="telefono" required ${CAMPO}></label><button type="submit" class="btn btn-primary">Pedir presupuesto</button></form></section>\n  <!-- MATERIALES / CALIDAD -->`,
            ],
          ]),
        },
      },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["<!-- FOOTER -->", '<div style="width:900px">x</div><!-- FOOTER -->']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/talleres/">Talleres</a></nav>']]) } },
    ],
  };
}
