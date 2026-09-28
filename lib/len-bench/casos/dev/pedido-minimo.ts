// lib/len-bench/casos/dev/pedido-minimo.ts — N3, F03, sobre una página REAL de
// OpenLen (plantilla `huerta`, comida sana por suscripción).
//
// Pedidos sueltos con pedido mínimo: bowl de temporada $7, smoothie $4, bowl
// de fruta $4; por debajo de $20 no se puede pedir y la página dice cuánto
// falta. La vuelta sube el bowl a $8, un precio que vive también en el JS.
// `flujo` lo prueba como un cliente: 1 bowl → «te faltan $12»; 2 bowls + 2
// smoothies → «Total $24». Y con todo a 2 ($32) el pedido LLEGA a la bandeja.
// El mínimo se hace con el botón desactivado, no con un `preventDefault` en el
// `submit`: el script que inyecta la publicación envía igual (memoria
// el-script-de-formularios-no-respeta-la-pagina).
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

const CAMPO = "height:44px;width:90px;margin-left:8px;padding:0 12px;border:1px solid var(--line);border-radius:12px;background:transparent";
const TEXTO = "height:44px;width:100%;margin-top:6px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:transparent";

interface Pedido {
  readonly bowlEnTexto: number;
  readonly bowlEnJs: number;
  readonly smoothie: number;
  /** Dice cuánto falta para el mínimo. */
  readonly dicefalta: boolean;
  readonly sumaTotal: boolean;
  /** El botón no se activa nunca. */
  readonly bloqueado?: boolean;
}
const seccion = (p: Pedido) => `<!-- PEDIDO SUELTO -->
  <section id="pedido" class="wrap" style="padding:56px 24px 24px">
    <style>#pedido-enviar:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}</style>
    <h2 style="font-size:clamp(30px,4.6vw,48px)">Pedí suelto</h2>
    <p style="color:var(--muted);margin-top:10px">Pedido mínimo $20.</p>
    <form id="pedido-form" class="grid gap-4 mt-8" style="max-width:520px">
      <label>Bowls de temporada · $${p.bowlEnTexto}<input type="number" name="bowls" min="0" value="0" style="${CAMPO}"></label>
      <label>Smoothies de fruta · $${p.smoothie}<input type="number" name="smoothies" min="0" value="0" style="${CAMPO}"></label>
      <label>Bowls de fruta · $4<input type="number" name="fruta" min="0" value="0" style="${CAMPO}"></label>
      <label>Nombre<input type="text" name="nombre" style="${TEXTO}"></label>
      <label>Teléfono<input type="tel" name="telefono" style="${TEXTO}"></label>
      <p>${p.sumaTotal ? 'Total <span id="pedido-total">$0</span>' : ""}</p>
      <p id="pedido-falta" style="color:var(--muted)"></p>
      <button type="submit" id="pedido-enviar" class="btn btn-primary" disabled>Hacer pedido</button>
    </form>
  </section>

  <!-- CTA -->`;
const script = (p: Pedido) => `<script>
(function () {
  var PRECIOS = { bowls: ${p.bowlEnJs}, smoothies: ${p.smoothie}, fruta: 4 };
  var MINIMO = 20;
  var form = document.getElementById("pedido-form");
  function cuenta() {
    var t = 0;
    Object.keys(PRECIOS).forEach(function (k) { t += (parseInt(form.elements[k].value, 10) || 0) * PRECIOS[k]; });
    ${p.sumaTotal ? 'document.getElementById("pedido-total").textContent = "$" + t;' : ""}
    ${p.dicefalta ? 'document.getElementById("pedido-falta").textContent = t < MINIMO ? "Te faltan $" + (MINIMO - t) + " para el pedido mínimo." : "";' : ""}
    document.getElementById("pedido-enviar").disabled = ${p.bloqueado ? "true" : "t < MINIMO"};
  }
  form.addEventListener("input", cuenta);
  form.addEventListener("change", cuenta);
  cuenta();
})();
</script>
</body>`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "pedido-minimo.inicio.html"), "utf8");
  const con = (p: Pedido) => cambiar(inicio, [["<!-- CTA -->", seccion(p)], ["</body>", script(p)]]);
  const bien: Pedido = { bowlEnTexto: 8, bowlEnJs: 8, smoothie: 4, dicefalta: true, sumaTotal: true };
  const solucion = con(bien);

  return {
    id: "pedido-minimo",
    nivel: "N3",
    resumen: "Pedidos sueltos con pedido mínimo: sumar, decir cuánto falta, no dejar pedir por debajo y que el pedido llegue; y un precio que sube en la vuelta.",
    inicio: { html: inicio },
    ficha: { negocio: "Comida sana a domicilio por suscripción", datos: {} },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "quiero que tambien se pueda pedir suelto: bowl de temporada a $7, smoothie a $4 y bowl de fruta a $4. el pedido minimo es de $20, si no llegan que no puedan pedir y que les diga cuanto les falta. que me llegue con nombre y telefono",
      },
      { tipo: "vuelve", mensaje: "el bowl de temporada subelo a $8 porfa" },
    ],
    // `pide`, no `escribe`: en la calibración del 2026-09-24 Len hizo el pedido
    // con «Agregar» y «− n +» (foto, total, «te faltan $12», botón bloqueado:
    // todo bien) y la vara, que sólo sabía escribir en campos, lo suspendió
    // 3 de 3. Y `formulario-llega` pide 3 bowls ANTES de enviar: con el mínimo
    // bien hecho, la caja vacía no debe llegar.
    graders: [
      flujo("dice-cuanto-falta", "/", [{ pide: 1, de: /bowls? de temporada/i }, { ve: /falta[n]?[^$\d]{0,30}\$\s?12(?!\d)/i }]),
      flujo("suma-el-pedido", "/", [
        { pide: 2, de: /bowls? de temporada/i },
        { pide: 2, de: /smoothie/i },
        // «Total» o «Subtotal»: los dos enseñan la suma (revisión de E, 26/09).
        { ve: /total[^$\d]{0,20}\$\s?24(?!\d)/i },
      ]),
      formularioLlega("/", 3, { antes: [{ pide: 3, de: /bowls? de temporada/i }] }),
      formularioPide("/", { nombre: /nombre/i, telefono: /tel[eé]fono|whats|celular|m[oó]vil/i }),
      // «TAMBIÉN suelto»: los planes semanales, con su precio, se quedan.
      sigueAhi("siguen-los-planes", "/", [/Semana Verde[^$]{0,120}\$32/, /Mesa Completa[^$]{0,120}\$58/, /Toda la Casa[^$]{0,120}\$96/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "precio-viejo-en-el-js", datos: { html: con({ ...bien, bowlEnJs: 7 }) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["$58", ""]]) } },
      { nombre: "no-dice-cuanto-falta", datos: { html: con({ ...bien, dicefalta: false }) } },
      { nombre: "sin-total", datos: { html: con({ ...bien, sumaTotal: false }) } },
      { nombre: "boton-siempre-bloqueado", datos: { html: con({ ...bien, bloqueado: true }) } },
      { nombre: "precio-inventado", datos: { html: con({ ...bien, smoothie: 5 }) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/empresas/">Empresas</a></nav>']]) } },
    ],
  };
}
