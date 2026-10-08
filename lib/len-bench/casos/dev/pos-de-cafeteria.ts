// lib/len-bench/casos/dev/pos-de-cafeteria.ts — N3, UNA APP QUE NACE y crece
// por chat (tarea #15 de la spec local 2026-10-07-apps).
//
// El proyecto está EN BLANCO y el primer mensaje lleva la tarjeta App
// (`naceComo`): Len parte del esqueleto (`lib/apps/esqueleto.ts`) y hace un
// punto de venta para una cafetería. Luego el dueño vuelve CINCO veces, cada
// una con un cambio de los que pide quien ya usa su caja: un producto nuevo,
// quitar una línea del ticket, lo vendido en el día que sobrevive a cerrar la
// app, esas ventas en una pantalla aparte (una ruta hash, `#/ventas`) y un
// precio que sube.
//
// 🔴 LO QUE LO HACE UN CASO DE APP: la app tiene que pasar SU PROPIA
// VERIFICACIÓN —compila entera y el cascarón la arranca— tras CADA paso, no
// sólo al final (`app-verificada-tras-cada-cambio`, que lee lo que apuntó el
// conductor). El resto se mide en la publicada, con Chromium: una app pinta con
// JS, así que aquí no sirven los graders que leen el HTML servido (en una app
// es el cascarón) y todo va por `flujo` y `sigueAhi`, que miran lo pintado.
//
// Modelado sobre `punto-de-venta.ts` (la caja de una PÁGINA, la de `miga`).
// La corrida real cuesta modelo: se hace en local (`npm run bench:len --
// --solo=pos-de-cafeteria`); aquí sólo se valida a $0.
import { esqueletoDeApp } from "@/lib/apps/esqueleto";
import type { DatosDelCaso, Encargo } from "@/lib/len-bench/tipos";
import { flujo, sigueAhi, sinDesbordeMovil } from "@/lib/len-bench/graders";
import { appVerificadaTrasCadaCambio } from "@/lib/len-bench/app-verificada";

const ESQUELETO = esqueletoDeApp({ titulo: "Café Luna — Caja", idioma: "es" });

interface Opciones {
  readonly productos?: string;
  readonly caja?: (codigo: string) => string;
  readonly ventas?: string;
  readonly app?: string;
  readonly cascaron?: string;
}

const PRODUCTOS = `export const PRODUCTOS = [
  { id: "cafe-con-leche", nombre: "Café con leche", precio: 1.8 },
  { id: "cortado", nombre: "Cortado", precio: 1.6 },
  { id: "croissant", nombre: "Croissant", precio: 2.2 },
  { id: "tostada", nombre: "Tostada con tomate", precio: 2.5 },
  { id: "zumo", nombre: "Zumo de naranja natural", precio: 3 },
];
`;

const EUROS = `export function euros(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €";
}
`;

const VENTAS = `// Lo vendido HOY, en este dispositivo: sobrevive a cerrar la app.
const clave = () => "cafe-luna-ventas-" + new Date().toISOString().slice(0, 10);

export function ventasDeHoy() {
  try {
    return JSON.parse(localStorage.getItem(clave())) ?? { total: 0, tickets: 0 };
  } catch {
    return { total: 0, tickets: 0 };
  }
}

export function apuntarVenta(importe) {
  const v = ventasDeHoy();
  const nuevo = { total: Math.round((v.total + importe) * 100) / 100, tickets: v.tickets + 1 };
  localStorage.setItem(clave(), JSON.stringify(nuevo));
  return nuevo;
}
`;

const CAJA = `import { useState } from "react";
import { PRODUCTOS } from "../productos";
import { euros } from "../lib/euros";
import { apuntarVenta } from "../lib/ventas";

export default function Caja() {
  const [ticket, setTicket] = useState([]);
  const total = ticket.reduce((s, p) => s + p.precio, 0);
  const cobrar = () => {
    if (ticket.length === 0) return;
    apuntarVenta(total);
    setTicket([]);
  };
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="text-2xl font-semibold tracking-tight">Caja</h1>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PRODUCTOS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setTicket([...ticket, p])}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm active:scale-[.98]"
          >
            <span className="block font-medium">{p.nombre}</span>
            <span className="text-slate-500">{euros(p.precio)}</span>
          </button>
        ))}
      </div>
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Ticket</h2>
        <ul className="mt-2 divide-y divide-slate-100">
          {ticket.map((p, i) => (
            <li key={i} className="flex items-center justify-between py-2">
              <span>{p.nombre}</span>
              <span className="flex items-center gap-3">
                {euros(p.precio)}
                <button type="button" onClick={() => setTicket(ticket.filter((_, j) => j !== i))} className="text-sm text-rose-600">
                  Quitar
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xl">
          Total: <strong>{euros(total)}</strong>
        </p>
        <button type="button" onClick={cobrar} className="mt-3 w-full rounded-xl bg-slate-900 py-3 font-semibold text-white">
          Cobrar
        </button>
      </section>
    </main>
  );
}
`;

const PANTALLA_VENTAS = `import { euros } from "../lib/euros";
import { ventasDeHoy } from "../lib/ventas";

export default function Ventas() {
  const v = ventasDeHoy();
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="text-2xl font-semibold tracking-tight">Ventas del día</h1>
      <p className="mt-4 text-3xl font-semibold">{euros(v.total)}</p>
      <p className="text-slate-500">{v.tickets} tickets</p>
    </main>
  );
}
`;

const APP = `import { Routes, Route, Link } from "react-router-dom";
import Caja from "./screens/Caja";
import Ventas from "./screens/Ventas";

export default function App() {
  return (
    <>
      <nav className="flex gap-4 border-b border-slate-200 bg-white px-4 py-3 text-sm font-medium">
        <Link to="/">Caja</Link>
        <Link to="/ventas">Ventas del día</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Caja />} />
        <Route path="/ventas" element={<Ventas />} />
      </Routes>
    </>
  );
}
`;

function app(o: Opciones = {}): DatosDelCaso {
  const caja = o.caja ? o.caja(CAJA) : CAJA;
  return {
    html: o.cascaron ?? ESQUELETO.html,
    app: ESQUELETO.app,
    ficheros: {
      "/src/main.jsx": ESQUELETO.ficheros["/src/main.jsx"]!,
      "/src/lib/supabase.js": ESQUELETO.ficheros["/src/lib/supabase.js"]!,
      "/src/App.jsx": o.app ?? APP,
      "/src/productos.js": o.productos ?? PRODUCTOS,
      "/src/lib/euros.js": EUROS,
      "/src/lib/ventas.js": o.ventas ?? VENTAS,
      "/src/screens/Caja.jsx": caja,
      // Sin pantalla de ventas (la rota que las deja en la caja), no hay fichero.
      ...(o.app === undefined ? { "/src/screens/Ventas.jsx": PANTALLA_VENTAS } : {}),
    },
  };
}

/** Cambia un trozo que TIENE que estar: si no está, la rota sería la solución. */
function cambia(codigo: string, de: string, a: string): string {
  if (!codigo.includes(de)) throw new Error(`pos-de-cafeteria: «${de.slice(0, 40)}» no está en el código`);
  return codigo.replace(de, a);
}

export function crear(): Encargo {
  const solucion = app();
  return {
    id: "pos-de-cafeteria",
    nivel: "N3",
    resumen:
      "Una APP que nace en blanco: un punto de venta para una cafetería, y cinco cambios por chat (un producto, quitar del ticket, lo vendido en el día, su pantalla aparte y un precio); compila y arranca tras cada uno.",
    // En blanco, como el proyecto que abre /new: el primer mensaje lo hace app.
    inicio: { html: "" },
    naceComo: { como: "app", idioma: "es" },
    ficha: {
      negocio: "Cafetería de barrio en Madrid, con barra y mesas",
      datos: {
        precio_cafe_con_leche: "1,80 €",
        precio_cortado: "1,60 €",
        precio_croissant: "2,20 €",
        precio_tostada: "2,50 €",
        precio_zumo: "3 €",
      },
      gustos: ["la caja es para el camarero, la usa desde el móvil en la barra", "nada de cuentas ni login: es un solo dispositivo"],
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "hola! hazme un POS para mi cafetería. vendo café con leche a 1,80 €, cortado a 1,50 €, croissant a 2,20 € y tostada con tomate a 2,50 €. que cada cosa sea un botón que suma al ticket, y un botón de cobrar",
      },
      { tipo: "vuelve", mensaje: "añade el zumo de naranja natural, a 3 €" },
      { tipo: "vuelve", mensaje: "si me equivoco necesito poder quitar una cosa del ticket sin borrarlo entero" },
      { tipo: "vuelve", mensaje: "quiero ver lo que llevo vendido hoy y cuántos tickets, y que no se pierda si cierro la app" },
      { tipo: "vuelve", mensaje: "pon eso de las ventas del día en una pantalla aparte, que no me estorbe en la caja" },
      { tipo: "vuelve", mensaje: "hemos subido el cortado a 1,60 €, cámbialo porfa" },
    ],
    graders: [
      appVerificadaTrasCadaCambio(),
      // El zumo suma con SU precio (3 + 2,20): un botón que sólo se pinta no llega a 5,20.
      flujo("el-zumo-suma", "/", [{ pulsa: /zumo/i }, { pulsa: /croissant/i }, { ve: /5[.,]20/ }]),
      // Quitar UNA línea: 4,70 deja de verse y el ticket no se vació (2,20 sigue).
      flujo("quita-una-linea", "/", [
        { pulsa: /tostada/i },
        { pulsa: /croissant/i },
        { ve: /4[.,]70/ },
        { pulsa: /quitar|eliminar|^[−×✕-]$/i },
        { noVe: /4[.,]70/ },
      ]),
      // El cortado a 1,60: con el croissant, 3,80 (con el precio viejo, 3,70).
      flujo("cortado-a-precio-nuevo", "/", [{ pulsa: /cortado/i }, { pulsa: /croissant/i }, { ve: /3[.,]80/ }, { noVe: /3[.,]70/ }]),
      // Dos cobros, una recarga y la pantalla APARTE: 1,80 + 1,60 = 3,40 en 2 tickets.
      flujo("ventas-del-dia-aparte-y-recordadas", "/", [
        { pulsa: /caf[eé] con leche/i },
        { pulsa: /^cobrar\b/i },
        { pulsa: /cortado/i },
        { pulsa: /^cobrar\b/i },
        { recarga: true },
        { pulsa: /ventas/i },
        { ve: /3[.,]40/ },
        { ve: /\b2\s*(tickets?|ventas|cobros|pedidos)\b|(tickets?|ventas|cobros|pedidos)\W{0,3}2\b/i },
      ]),
      // Lo que nadie pidió cambiar sigue en la caja, con su precio.
      sigueAhi("sigue-la-carta", "/", [/caf[eé] con leche\s*1[.,]80/i, /croissant\s*2[.,]20/i, /tostada[^0-9]*2[.,]50/i]),
      sinDesbordeMovil(),
    ],
    solucion,
    rotas: [
      { nombre: "no-compila", datos: app({ caja: (c) => cambia(c, "</main>\n  );", "</main\n  );") }) },
      // Compila, pero el cascarón ya no carga la entrada: la app sale en blanco.
      { nombre: "cascaron-sin-entrada", datos: app({ cascaron: cambia(ESQUELETO.html, '<script type="module" src="/src/main.jsx"></script>', "") }) },
      { nombre: "sin-zumo", datos: app({ productos: cambia(PRODUCTOS, '  { id: "zumo", nombre: "Zumo de naranja natural", precio: 3 },\n', "") }) },
      { nombre: "cortado-a-precio-viejo", datos: app({ productos: cambia(PRODUCTOS, "precio: 1.6", "precio: 1.5") }) },
      {
        nombre: "no-quita",
        datos: app({
          caja: (c) =>
            cambia(
              c,
              `                <button type="button" onClick={() => setTicket(ticket.filter((_, j) => j !== i))} className="text-sm text-rose-600">
                  Quitar
                </button>
`,
              "",
            ),
        }),
      },
      // Lo vendido vive en memoria: al recargar, vuelve a cero.
      {
        nombre: "olvida-al-recargar",
        datos: app({
          ventas: `let hoy = { total: 0, tickets: 0 };
export function ventasDeHoy() {
  return hoy;
}
export function apuntarVenta(importe) {
  hoy = { total: Math.round((hoy.total + importe) * 100) / 100, tickets: hoy.tickets + 1 };
  return hoy;
}
`,
        }),
      },
      // Las ventas en la caja, sin pantalla aparte ni nada que lleve a ella.
      {
        nombre: "ventas-en-la-caja",
        datos: app({
          app: `import Caja from "./screens/Caja";

export default function App() {
  return <Caja />;
}
`,
          caja: (c) =>
            cambia(
              cambia(c, 'import { apuntarVenta } from "../lib/ventas";', 'import { apuntarVenta, ventasDeHoy } from "../lib/ventas";'),
              "      </section>\n    </main>",
              "      </section>\n      <p className=\"mt-4 text-slate-500\">Hoy: {euros(ventasDeHoy().total)} en {ventasDeHoy().tickets} tickets</p>\n    </main>",
            ),
        }),
      },
      { nombre: "quito-de-mas", datos: app({ productos: cambia(PRODUCTOS, '  { id: "tostada", nombre: "Tostada con tomate", precio: 2.5 },\n', "") }) },
      { nombre: "desborda", datos: app({ caja: (c) => cambia(c, "    </main>", '      <div style={{ width: 900 }}>x</div>\n    </main>') }) },
    ],
  };
}
