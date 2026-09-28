// lib/len-bench/casos/dev/taqueria-menu-whatsapp.ts — el caso molde (N2) y el del humo.
//
// Los datos NO vienen en el mensaje del dueño: Len tiene que PREGUNTARLOS, y el
// cliente simulado se los da de su ficha. Si los inventa, `nada-inventado` y
// `datos-de-la-ficha` lo dicen. El WhatsApp va CON lada de país en la ficha:
// wa.me no funciona sin ella, y ponerla sin que la den es `lada-que-nadie-dio`.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { datosDeLaFicha, enlaceWhatsApp, enlacesInternosVan, nadaInventado, sigueAhi, sinCifrasInventadas, sinDesbordeMovil } from "@/lib/len-bench/graders";

export function crear(dirPaginas: string): Encargo {
  const leer = (n: string) => fs.readFileSync(path.join(dirPaginas, `taqueria-menu-whatsapp.${n}.html`), "utf8");
  const inicio = leer("inicio");
  const solucion = leer("solucion");
  return {
    id: "taqueria-menu-whatsapp",
    nivel: "N2",
    resumen: "Menú con precios y pedidos por WhatsApp; los datos NO vienen en el mensaje: hay que preguntarlos.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Taquería de barrio en Guadalajara, abierta de noche",
      datos: {
        plato_1: "Taco al pastor",
        precio_1: "$25",
        plato_2: "Taco de suadero",
        precio_2: "$25",
        plato_3: "Gringa",
        precio_3: "$70",
        plato_4: "Agua de horchata",
        precio_4: "$30",
        whatsapp: "+52 33 1234 5678",
      },
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "oye quiero que mi pagina tenga el menu con los precios y un boton para que me pidan por whatsapp, y que se vea bien en el cel",
      },
    ],
    graders: [
      datosDeLaFicha(["plato_1", "precio_1", "plato_2", "plato_3", "precio_3", "plato_4", "precio_4"]),
      enlaceWhatsApp("whatsapp"),
      // Se pide el menú; lo que la página ya decía se queda.
      sigueAhi("sigue-lo-que-habia", "/", [/Tacos al carbón desde el barrio/, /Somos una taquería familiar/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "quito-de-mas", datos: { html: solucion.replace("<p>Somos una taquería familiar. Abrimos todas las noches.</p>", "") } },
      // WhatsApp con un 1 de más, el prefijo de móvil viejo de México: el fallo de lada-que-nadie-dio.
      { nombre: "whatsapp-inventado", datos: { html: solucion.replace("wa.me/523312345678", "wa.me/5213312345678") } },
      { nombre: "desborda", datos: { html: solucion.replace("</footer>", '<div style="width:900px">x</div></footer>') } },
      {
        nombre: "enlace-roto",
        datos: { html: solucion.replace('<a href="#menu">Menú</a>', '<a href="#menu">Menú</a><a href="/reservas/">Reservas</a>') },
      },
    ],
  };
}
