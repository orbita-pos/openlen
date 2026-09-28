// lib/len-bench/casos/dev/lista-de-espera.ts — N2, sobre una página REAL de
// OpenLen (plantilla `savia`, nutrición con dietistas; España).
//
// La plantilla no tiene formulario. El dueño quiere una lista de espera para
// su app, con DOS datos, y que le llegue. Lo que se mide: que el formulario
// llegue a la bandeja y —sin votar— que pida nombre y correo.
// ⚠️ La solución NO lleva la clase `reveal` de la plantilla: arranca con
// opacity 0 hasta que la anima el JS, y `formulario-llega` no rellena lo que
// no se ve (como una persona).
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  enlacesInternosVan,
  formularioLlega,
  formularioPide,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
} from "@/lib/len-bench/graders";

const CAMPO = 'style="display:block;width:100%;height:48px;margin-top:6px;padding:0 14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg);color:inherit;font-size:15px"';

const seccion = (campos: string, boton = '<button type="submit" class="btn btn-primary" style="justify-content:center">Apuntarme</button>', extra = "") => `  <!-- LISTA DE ESPERA -->
  <section id="lista" style="background:var(--surface)">
    <div class="wrap" style="padding:72px 24px;max-width:560px">
      <span class="eyebrow">La app de SAVIA</span>
      <h2 style="font-size:clamp(28px,4vw,44px);margin:14px 0 0">Apúntate a la lista de espera.</h2>
      <p style="color:var(--muted);font-size:16px;margin-top:14px">Déjanos tu nombre y tu correo y te avisamos el día que abra.</p>${extra}
      <form style="display:grid;gap:14px;margin-top:28px">
        ${campos}
        ${boton}
      </form>
    </div>
  </section>

  <!-- PLANES / PRECIOS -->`;

const NOMBRE = `<label style="font-size:14px;color:var(--muted)">Nombre<input name="nombre" required ${CAMPO}></label>`;
const CORREO = `<label style="font-size:14px;color:var(--muted)">Correo<input name="correo" type="email" required ${CAMPO}></label>`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "lista-de-espera.inicio.html"), "utf8");
  const con = (s: string) => cambiar(inicio, [["  <!-- PLANES / PRECIOS -->", s]]);
  const solucion = con(seccion(NOMBRE + CORREO));
  return {
    id: "lista-de-espera",
    nivel: "N2",
    resumen: "Una lista de espera (nombre y correo) que llegue de verdad a la bandeja.",
    inicio: { html: inicio },
    ficha: { negocio: "Servicio de nutrición con dietistas en España; su app aún no sale", datos: {} },
    guion: [
      {
        tipo: "pide",
        mensaje: "todavia no sale la app. quiero una lista de espera en la pagina: que la gente deje su nombre y su correo y que me llegue a mi",
      },
    ],
    graders: [
      formularioLlega("/"),
      formularioPide("/", { nombre: /nombre/i, correo: /correo|e-?mail/i }),
      // La lista va entre la app y los planes: se AGREGA, no ocupa su sitio.
      sigueAhi("sigue-lo-de-al-lado", "/", [/Tu nutrición,\s*en el bolsillo/, /Elige cómo\s*quieres empezar/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "sin-boton", datos: { html: con(seccion(NOMBRE + CORREO, "")) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["Tu nutrición,<br>en el bolsillo.", ""]]) } },
      // Llega, pero pide el teléfono en vez del correo.
      { nombre: "sin-correo", datos: { html: con(seccion(`${NOMBRE}<label>Teléfono<input name="tel" type="tel" ${CAMPO}></label>`)) } },
      // Un correo que nadie dio, «para dudas».
      { nombre: "correo-inventado", datos: { html: con(seccion(NOMBRE + CORREO, undefined, "<p>¿Dudas? app@savia.example</p>")) } },
      // Una fecha de lanzamiento que nadie dio.
      { nombre: "fecha-inventada", datos: { html: con(seccion(NOMBRE + CORREO, undefined, "<p>La app sale el 15 de noviembre.</p>")) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["<!-- FOOTER -->", '<div style="width:900px">x</div><!-- FOOTER -->']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/app/">La app</a></nav>']]) } },
    ],
  };
}
