// lib/len-bench/casos/hard/quote-wizard.ts — «cotizador-por-pasos», N3, del juego
// DIFÍCIL (plans/len-2/corridas/2026-10-03-dynamis).
//
// Sobre la plantilla REAL `reforma` (reformas integrales, euros) del
// `presupuesto-que-llega` de dev, que trae un formulario FALSO. Tres mensajes:
// un cotizador de tres pasos (qué reforma y su precio por metro, cuántos
// metros, los extras) con «Atrás» y «Siguiente» que no borran lo elegido; al
// final un formulario que MANDE el presupuesto, no sólo el nombre; y al volver,
// un 8 % de descuento por encima de 80 m² que se vea.
//
// Todo en el navegador (`flujo`): se recorre como un cliente, se vuelve atrás,
// se lee el total y se manda la solicitud (`envia`: el envío tiene que llegar
// CON el total). Los totales no salen en ninguna otra parte de la página.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import { flujo, nadaInventado, sigueAhi, sinCifrasInventadas, sinDesbordeMovil } from "@/lib/len-bench/graders";

const ANCLA = "<!-- PRESUPUESTO CTA — el módulo de captación reemplaza el interior al publicar -->";
const CAMPO =
  'style="display:block;width:100%;height:48px;border:1px solid var(--line);border-radius:var(--radius);margin-top:6px;padding:0 14px;font-size:14px;background:transparent;color:inherit"';
const OPCION = 'style="display:flex;align-items:center;gap:10px;padding:14px 16px;border:1px solid var(--line);border-radius:var(--radius);font-size:15px;cursor:pointer"';

interface Cotizador {
  /** «Atrás» vuelve a empezar de cero (borra lo elegido). */
  readonly atrasBorra?: boolean;
  /** El formulario no lleva el presupuesto: sólo nombre y teléfono. */
  readonly formularioSinPresupuesto?: boolean;
  /** Sin el descuento de la vuelta, o con él a partir de 80 (inclusive). */
  readonly descuento?: "bien" | "sin" | "desde-80";
  /** Un precio cambiado a mano (el del baño). */
  readonly bano?: number;
  /** Sin el cotizador: sólo el formulario de verdad (la vuelta sobre la página de antes). */
  readonly sinCotizador?: boolean;
}

const cotizador = (c: Cotizador) => `<!-- COTIZADOR -->
  <section id="cotizador" class="wrap" style="padding:72px 24px">
    <span class="eyebrow">Cotizador</span>
    <h2 class="display" style="font-size:clamp(30px,4.6vw,48px);margin-top:12px">Calcula tu reforma</h2>
    <div style="max-width:640px;margin-top:28px">
      <div data-paso="1" class="grid gap-3">
        <p style="font-weight:600">1. ¿Qué reforma quieres?</p>
        <label ${OPCION}><input type="radio" name="cot-tipo" value="690" data-nombre="Cocina" checked> Cocina — 690€ el m²</label>
        <label ${OPCION}><input type="radio" name="cot-tipo" value="${c.bano ?? 580}" data-nombre="Baño"> Baño — ${c.bano ?? 580}€ el m²</label>
        <label ${OPCION}><input type="radio" name="cot-tipo" value="450" data-nombre="Integral"> Integral — 450€ el m²</label>
      </div>
      <div data-paso="2" hidden>
        <label style="font-weight:600">2. ¿Cuántos metros?<input id="cot-metros" type="number" min="1" step="1" placeholder="Metros cuadrados" ${CAMPO}></label>
      </div>
      <div data-paso="3" class="grid gap-3" hidden>
        <p style="font-weight:600">3. Extras</p>
        <label ${OPCION}><input type="checkbox" id="cot-diseno" value="1200" data-nombre="Proyecto de diseño"> Proyecto de diseño — 1.200€</label>
        <label ${OPCION}><input type="checkbox" id="cot-licencias" value="450" data-nombre="Gestión de licencias"> Gestión de licencias — 450€</label>
      </div>
      <div data-paso="4" hidden>
        <p style="font-weight:600">Tu presupuesto</p>
        <p id="cot-resumen" style="color:var(--muted);margin-top:8px"></p>
        <p id="cot-descuento" style="color:var(--accent);margin-top:6px"></p>
        <p class="display" style="font-size:28px;margin-top:8px">Total: <span id="cot-total"></span></p>
        <form class="grid gap-3" style="margin-top:20px">
          <input type="hidden" name="reforma" id="cot-form-reforma">
          <input type="hidden" name="metros" id="cot-form-metros">
          <input type="hidden" name="extras" id="cot-form-extras">
          ${c.formularioSinPresupuesto ? "" : '<input type="hidden" name="total" id="cot-form-total">'}
          <label class="text-[12px]" style="color:var(--faint)">Nombre<input name="nombre" required ${CAMPO}></label>
          <label class="text-[12px]" style="color:var(--faint)">Teléfono<input type="tel" name="telefono" required ${CAMPO}></label>
          <button type="submit" class="btn btn-primary">Mandar mi presupuesto</button>
        </form>
      </div>
      <div class="flex" style="gap:12px;margin-top:24px">
        <button type="button" id="cot-atras" class="btn btn-ghost" hidden>Atrás</button>
        <button type="button" id="cot-siguiente" class="btn btn-primary">Siguiente</button>
      </div>
    </div>
  </section>
  <script>
  (function () {
    var paso = 1;
    var euros = function (n) { return Math.round(n).toLocaleString("es-ES") + "€"; };
    function calcula() {
      var tipo = document.querySelector('input[name="cot-tipo"]:checked');
      var metros = Number(document.getElementById("cot-metros").value) || 0;
      var extras = Array.prototype.filter.call(document.querySelectorAll("#cot-diseno, #cot-licencias"), function (x) { return x.checked; });
      var bruto = Number(tipo.value) * metros + extras.reduce(function (s, x) { return s + Number(x.value); }, 0);
      var conDescuento = ${c.descuento === "sin" ? "false" : c.descuento === "desde-80" ? "metros >= 80" : "metros > 80"};
      var total = conDescuento ? bruto * 0.92 : bruto;
      var nombres = extras.map(function (x) { return x.getAttribute("data-nombre"); });
      document.getElementById("cot-resumen").textContent = tipo.getAttribute("data-nombre") + " · " + metros + " m²" + (nombres.length ? " · " + nombres.join(", ") : "");
      document.getElementById("cot-descuento").textContent = conDescuento ? "Descuento del 8% por más de 80 m²: −" + euros(bruto - total) : "";
      document.getElementById("cot-total").textContent = euros(total);
      document.getElementById("cot-form-reforma").value = tipo.getAttribute("data-nombre");
      document.getElementById("cot-form-metros").value = metros;
      document.getElementById("cot-form-extras").value = nombres.join(", ") || "ninguno";
      ${c.formularioSinPresupuesto ? "" : 'document.getElementById("cot-form-total").value = euros(total);'}
    }
    function muestra() {
      document.querySelectorAll("#cotizador [data-paso]").forEach(function (p) { p.hidden = Number(p.getAttribute("data-paso")) !== paso; });
      document.getElementById("cot-atras").hidden = paso === 1;
      document.getElementById("cot-siguiente").hidden = paso === 4;
      if (paso === 4) calcula();
    }
    document.getElementById("cot-siguiente").addEventListener("click", function () { if (paso < 4) { paso += 1; muestra(); } });
    document.getElementById("cot-atras").addEventListener("click", function () {
      ${c.atrasBorra ? 'document.querySelectorAll("#cotizador input").forEach(function (x) { if (x.type === "checkbox") x.checked = false; else if (x.type === "number") x.value = ""; });' : ""}
      if (paso > 1) { paso -= 1; muestra(); }
    });
    muestra();
  })();
  </script>

  `;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "presupuesto-que-llega.inicio.html"), "utf8");
  const con = (c: Cotizador = {}) => cambiar(inicio, [[ANCLA, `${c.sinCotizador ? "" : cotizador(c)}${ANCLA}`]]);
  const solucion = con();

  return {
    id: "cotizador-por-pasos",
    nivel: "N3",
    resumen:
      "Cotizador de reformas de 3 pasos (tipo y precio por m², metros, extras) con Atrás/Siguiente que no borran, total, formulario que manda el presupuesto y 8 % de descuento por encima de 80 m².",
    inicio: { html: inicio },
    ficha: {
      negocio: "Empresa de reformas integrales en España (REFORMA)",
      datos: {
        cocina: "690€ el m²",
        bano: "580€ el m²",
        integral: "450€ el m²",
        proyecto_de_diseno: "1.200€",
        gestion_de_licencias: "450€",
        descuento: "8% si son más de 80 m²",
      },
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "quiero un cotizador en la pagina, por pasos: primero que elijan que reforma (cocina 690€ el m², baño 580€ el m² o integral 450€ el m²), luego cuantos metros, y luego los extras: proyecto de diseño 1.200€ y gestion de licencias 450€. con botones de siguiente y atras que no borren lo que ya eligieron, y al final que salga el total",
      },
      {
        tipo: "pide",
        mensaje: "y al final del cotizador un formulario con nombre y telefono que me mande el presupuesto: que reforma, cuantos metros, los extras y el total",
      },
      { tipo: "vuelve", mensaje: "ah, y si son mas de 80 metros hazles un 8% de descuento, y que se vea que se les aplico" },
    ],
    graders: [
      // 12 × 690 + 1.200 = 9.480.
      flujo("calcula-con-extra", "/", [
        { elige: /cocina/i },
        { pulsa: /siguiente/i },
        { escribe: "12", en: /metro/i },
        { pulsa: /siguiente/i },
        { elige: /proyecto de dise/i },
        { pulsa: /siguiente|ver.*total|calcular/i, siHay: true },
        { ve: /9[.,\s]?480\s?€/ },
      ]),
      // 7 × 580 + 450 = 4.510, después de ir atrás dos veces y volver.
      flujo("atras-no-borra", "/", [
        { elige: /ba[ñn]o/i },
        { pulsa: /siguiente/i },
        { escribe: "7", en: /metro/i },
        { pulsa: /siguiente/i },
        { pulsa: /atr[aá]s|anterior|volver/i },
        { pulsa: /atr[aá]s|anterior|volver/i },
        { pulsa: /siguiente/i },
        { pulsa: /siguiente/i },
        { elige: /licencias/i },
        { pulsa: /siguiente|ver.*total|calcular/i, siHay: true },
        { ve: /4[.,\s]?510\s?€/ },
      ]),
      // 100 × 450 = 45.000, con el 8 %: 41.400.
      flujo("descuento-de-mas-de-80", "/", [
        { elige: /integral/i },
        { pulsa: /siguiente/i },
        { escribe: "100", en: /metro/i },
        { pulsa: /siguiente/i },
        { pulsa: /siguiente|ver.*total|calcular/i, siHay: true },
        { ve: /41[.,\s]?400\s?€/ },
        { ve: /descuento/i },
      ]),
      // 80 × 450 = 36.000, sin descuento: «más de 80».
      flujo("sin-descuento-en-80", "/", [
        { elige: /integral/i },
        { pulsa: /siguiente/i },
        { escribe: "80", en: /metro/i },
        { pulsa: /siguiente/i },
        { pulsa: /siguiente|ver.*total|calcular/i, siHay: true },
        { ve: /36[.,\s]?000\s?€/ },
        { noVe: /33[.,\s]?120/ },
      ]),
      // La solicitud llega CON el presupuesto: 9.480.
      flujo("el-formulario-manda-el-presupuesto", "/", [
        { elige: /cocina/i },
        { pulsa: /siguiente/i },
        { escribe: "12", en: /metro/i },
        { pulsa: /siguiente/i },
        { elige: /proyecto de dise/i },
        { pulsa: /siguiente|ver.*total|calcular/i, siHay: true },
        { envia: /9[.,\s]?480/ },
      ]),
      // Lo de alrededor se queda: nadie pidió tocar los servicios ni el contacto.
      sigueAhi("siguen-los-servicios", "/", [/Reforma de cocina/, /Reforma de baño/, /Reforma integral/, /\+34 900 123 456/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "atras-borra", datos: { html: con({ atrasBorra: true }) } },
      { nombre: "formulario-sin-presupuesto", datos: { html: con({ formularioSinPresupuesto: true }) } },
      { nombre: "sin-descuento", datos: { html: con({ descuento: "sin" }) } },
      { nombre: "descuento-desde-80", datos: { html: con({ descuento: "desde-80" }) } },
      { nombre: "precio-del-bano-cambiado", datos: { html: con({ bano: 600 }) } },
      { nombre: "contacto-borrado", datos: { html: cambiar(solucion, [["+34 900 123 456", "", 2]]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["<!-- COTIZADOR -->", '<div style="width:900px">x</div><!-- COTIZADOR -->']]) } },
    ],
  };
}
