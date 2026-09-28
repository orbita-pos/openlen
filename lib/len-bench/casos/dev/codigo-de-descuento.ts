// lib/len-bench/casos/dev/codigo-de-descuento.ts — N3, F03, sobre una página REAL
// de OpenLen (plantilla `aura`, skincare botánico, precios en euros).
//
// Un campo de código de descuento en el bloque de compra: BIENVENIDA10 baja un
// 10 % el ritual (78€ → 70,20€), un código que no existe dice que no vale, y la
// vuelta suma AMIGA15 (15 % → 66,30€) sin romper el primero. Todo viene en los
// mensajes: lo difícil es la lógica de punta a punta (el precio que cambia de
// verdad, los céntimos, el error), no preguntar. Tres `flujo` separados, cada
// uno con un visitante nuevo, para que la tabla diga cuál falla.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import { enlacesInternosVan, flujo, nadaInventado, sigueAhi, sinCifrasInventadas, sinDesbordeMovil } from "@/lib/len-bench/graders";

const CTA = '<a href="#comprar" class="btn" style="background:var(--on-accent);color:var(--accent-deep)">Comprar el ritual · 78€</a>';
const CTA_CON_PRECIO =
  '<a href="#comprar" class="btn" style="background:var(--on-accent);color:var(--accent-deep)">Comprar el ritual · <span id="precio-ritual">78€</span></a>';
const CIERRE_DE_BOTONES = '<a href="#linea" class="btn" style="border:1px solid rgba(252,246,240,.5);color:var(--on-accent)">Ver la línea</a>\n        </div>';
const CAJA_DEL_CODIGO = `
        <div class="mt-7 flex flex-wrap items-center justify-center gap-2">
          <label for="codigo-input" style="font-size:14px;color:rgba(252,246,240,.86)">¿Tienes un código de descuento?</label>
          <input id="codigo-input" type="text" autocomplete="off" placeholder="Código" style="height:44px;width:170px;padding:0 16px;border-radius:999px;border:1px solid rgba(252,246,240,.5);background:transparent;color:var(--on-accent)">
          <button type="button" id="codigo-aplicar" class="btn" style="border:1px solid rgba(252,246,240,.5);color:var(--on-accent)">Aplicar</button>
          <p id="codigo-msg" aria-live="polite" style="width:100%;font-size:14px;color:rgba(252,246,240,.86)"></p>
        </div>`;

interface Codigos {
  readonly codigos: Readonly<Record<string, number>>;
  /** Resta el porcentaje como si fueran euros (78 − 10). */
  readonly restaEuros?: boolean;
  /** Un código desconocido también descuenta. */
  readonly aceptaCualquiera?: boolean;
}
const script = (c: Codigos) => `<script>
(function () {
  var CODIGOS = ${JSON.stringify(c.codigos)};
  var BASE = 78;
  var inp = document.getElementById("codigo-input");
  var msg = document.getElementById("codigo-msg");
  var precio = document.getElementById("precio-ritual");
  function euros(n) { return n.toFixed(2).replace(".", ",") + "€"; }
  document.getElementById("codigo-aplicar").addEventListener("click", function () {
    var d = CODIGOS[inp.value.trim().toUpperCase()]${c.aceptaCualquiera ? " || 10" : ""};
    if (!d) { msg.textContent = "Ese código no es válido."; precio.textContent = "78€"; return; }
    precio.textContent = euros(${c.restaEuros ? "BASE - d" : "BASE * (100 - d) / 100"});
    msg.textContent = "Código aplicado: " + d + "% de descuento.";
  });
})();
</script>
</body>`;

const NO_VALE = /(no\s+(es\s+)?v[aá]lid|inv[aá]lid|no\s+existe|incorrect|no\s+(funciona|aplica|sirve))/i;
const CAMPO = /c[oó]digo|cup[oó]n|descuento/i;
const APLICAR = /aplicar|usar|canjear|validar/i;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "codigo-de-descuento.inicio.html"), "utf8");
  const con = (c: Codigos) =>
    cambiar(inicio, [
      [CTA, CTA_CON_PRECIO],
      [CIERRE_DE_BOTONES, CIERRE_DE_BOTONES + CAJA_DEL_CODIGO],
      ["</body>", script(c)],
    ]);
  const LOS_DOS = { BIENVENIDA10: 10, AMIGA15: 15 };
  const solucion = con({ codigos: LOS_DOS });

  return {
    id: "codigo-de-descuento",
    nivel: "N3",
    resumen: "Un campo de código de descuento que baja el precio de verdad (con céntimos), rechaza el que no existe, y un segundo código en la vuelta.",
    inicio: { html: inicio },
    ficha: { negocio: "Marca de skincare botánico con tienda en línea", datos: {} },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "quiero que en la parte de comprar haya un campito para poner un codigo de descuento. el codigo BIENVENIDA10 les baja 10% al ritual. si ponen un codigo que no existe que les diga que no es valido",
      },
      { tipo: "vuelve", mensaje: "agrega tambien el codigo AMIGA15, ese es de 15%" },
    ],
    graders: [
      flujo("bienvenida-baja-el-10", "/", [{ escribe: "BIENVENIDA10", en: CAMPO }, { pulsa: APLICAR }, { ve: /70[,.]20?\s?€/ }]),
      flujo("amiga-baja-el-15", "/", [{ escribe: "AMIGA15", en: CAMPO }, { pulsa: APLICAR }, { ve: /66[,.]30?\s?€/ }]),
      flujo("el-que-no-existe-no-vale", "/", [{ escribe: "HOLA20", en: CAMPO }, { pulsa: APLICAR }, { ve: NO_VALE }]),
      // El código baja el ritual cuando se aplica: los precios de cada pieza
      // y el envío gratis no se tocan.
      sigueAhi("siguen-los-precios-de-cada-pieza", "/", [
        /Crema Equilibra\s*32\s?€/,
        /Limpiador Calma\s*24\s?€/,
        /Barra Esencial\s*16\s?€/,
        /Envío gratis a partir de 40\s?€/,
      ]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "solo-el-primero", datos: { html: con({ codigos: { BIENVENIDA10: 10 } }) } },
      // Le bajó el 10 % a una pieza suelta, a la vista, sin código.
      { nombre: "toco-de-mas", datos: { html: cambiar(solucion, [[">32€<", ">28,80€<"]]) } },
      { nombre: "resta-euros", datos: { html: con({ codigos: LOS_DOS, restaEuros: true }) } },
      { nombre: "acepta-cualquiera", datos: { html: con({ codigos: LOS_DOS, aceptaCualquiera: true }) } },
      {
        nombre: "envio-inventado",
        datos: { html: cambiar(solucion, [["Envío gratis a partir de 40€", "Envío gratis a partir de 30€"]]) },
      },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/regalos/">Regalos</a></nav>']]) } },
    ],
  };
}
