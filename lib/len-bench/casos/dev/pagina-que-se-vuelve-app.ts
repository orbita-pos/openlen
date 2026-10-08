// lib/len-bench/casos/dev/pagina-que-se-vuelve-app.ts — N3, una página de TRES
// páginas que se convierte en app (F4 de la spec local 2026-10-07-apps).
//
// El sitio de una panadería-cafetería: la portada, la carta (con un filtro en
// JavaScript suelto) y el contacto (con un formulario), con la cabecera y el
// pie repetidos en las tres. El dueño pide algo que ya no es una página —una
// caja para la barra, con la carta de botones— y que su web pase a ser una
// app. Len lo propone, el dueño acepta (su ficha lo dice) y Len la convierte EN
// UN TURNO: las páginas pasan a pantallas (/carta/index.html → `#/carta`), lo
// repetido a componentes, el filtro a estado de React, y `convert_to_app`
// voltea el proyecto (lib/agent/convertir-en-app.ts).
//
// Se mide que es una app sin páginas sueltas, que pasa su verificación (compila
// y arranca), que lo que había SIGUE —la portada, la carta con sus precios, el
// contacto— en su pantalla, que la caja suma, y (sin votar) que Len avisó de lo
// que se pierde. Como `pos-de-cafeteria`, todo lo pintado va por Chromium.
//
// La corrida real cuesta modelo: se hace en local; aquí sólo se valida a $0.
import { esqueletoDeApp } from "@/lib/apps/esqueleto";
import type { DatosDelCaso, Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import { flujo, sigueAhi, sinDesbordeMovil } from "@/lib/len-bench/graders";
import { appVerificadaTrasCadaCambio } from "@/lib/len-bench/app-verificada";
import { avisaDeLoQueSePierde, seConvirtioEnApp } from "@/lib/len-bench/conversion";

// ─── La página de partida: tres páginas con cabecera y pie repetidos ─────────

const cabeza = (titulo: string) => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<meta name="description" content="Pan de masa madre y café de especialidad en Malasaña.">
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-amber-50 text-stone-900">
<header class="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-amber-200">
  <a href="/" class="font-semibold text-lg">Horno Alba</a>
  <nav class="flex gap-4 text-sm"><a href="/">Inicio</a><a href="/carta/">La carta</a><a href="/contacto/">Contacto</a></nav>
</header>
`;

const PIE = `<footer class="px-6 py-8 text-sm text-stone-600 border-t border-amber-200">
  <p>Horno Alba · Calle del Pez 12, Madrid · 910 123 456</p>
</footer>
</body>
</html>
`;

const PORTADA = `${cabeza("Horno Alba · Panadería y café")}<main class="px-6 py-16 max-w-3xl">
  <h1 class="text-4xl font-semibold">Pan de masa madre y café de especialidad</h1>
  <p class="mt-4 text-lg">Desde 1998 en Malasaña. Abrimos de 8:00 a 20:00, todos los días.</p>
  <a href="/carta/" class="inline-block mt-6 px-5 py-3 rounded-full bg-stone-900 text-white">Ver la carta</a>
</main>
${PIE}`;

const CARTA = `${cabeza("La carta · Horno Alba")}<main class="px-6 py-12 max-w-3xl">
  <h1 class="text-3xl font-semibold">La carta</h1>
  <div class="mt-4 flex gap-2" id="filtros">
    <button type="button" data-cat="todo" class="px-3 py-1 rounded-full border">Todo</button>
    <button type="button" data-cat="bebida" class="px-3 py-1 rounded-full border">Bebidas</button>
    <button type="button" data-cat="bolleria" class="px-3 py-1 rounded-full border">Bollería</button>
  </div>
  <ul class="mt-6 divide-y divide-amber-200" id="productos">
    <li data-cat="bebida" class="flex justify-between py-3"><span>Café con leche</span><span>1,80 €</span></li>
    <li data-cat="bebida" class="flex justify-between py-3"><span>Cortado</span><span>1,50 €</span></li>
    <li data-cat="bebida" class="flex justify-between py-3"><span>Zumo de naranja</span><span>3,00 €</span></li>
    <li data-cat="bolleria" class="flex justify-between py-3"><span>Croissant</span><span>2,20 €</span></li>
    <li data-cat="bolleria" class="flex justify-between py-3"><span>Napolitana de chocolate</span><span>2,40 €</span></li>
  </ul>
</main>
<script>
  document.querySelectorAll("#filtros [data-cat]").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#productos li").forEach(function (li) {
        li.style.display = b.dataset.cat === "todo" || li.dataset.cat === b.dataset.cat ? "" : "none";
      });
    });
  });
</script>
${PIE}`;

const CONTACTO = `${cabeza("Contacto · Horno Alba")}<main class="px-6 py-12 max-w-3xl">
  <h1 class="text-3xl font-semibold">Contacto</h1>
  <p class="mt-4">Calle del Pez 12, Madrid · Teléfono 910 123 456</p>
  <form id="escribenos" class="mt-6 grid gap-3 max-w-md">
    <label>Nombre <input name="nombre" required class="block w-full border rounded px-3 py-2"></label>
    <label>Correo <input name="correo" type="email" required class="block w-full border rounded px-3 py-2"></label>
    <label>Mensaje <textarea name="mensaje" class="block w-full border rounded px-3 py-2"></textarea></label>
    <button class="px-5 py-3 rounded-full bg-stone-900 text-white">Enviar</button>
  </form>
  <p id="gracias" hidden class="mt-4">¡Gracias! Te contestamos enseguida.</p>
</main>
<script>
  document.getElementById("escribenos").addEventListener("submit", function (e) {
    e.preventDefault();
    e.target.hidden = true;
    document.getElementById("gracias").hidden = false;
  });
</script>
${PIE}`;

const INICIO: DatosDelCaso = {
  html: PORTADA,
  pages: {
    carta: { html: CARTA, title: "La carta" },
    contacto: { html: CONTACTO, title: "Contacto" },
  },
};

// ─── La solución: la misma web, como app, con la caja ────────────────────────

const ESQUELETO = esqueletoDeApp({ titulo: "Horno Alba · Panadería y café", idioma: "es" });

const PRODUCTOS = `export const PRODUCTOS = [
  { id: "cafe-con-leche", nombre: "Café con leche", precio: 1.8, cat: "bebida" },
  { id: "cortado", nombre: "Cortado", precio: 1.5, cat: "bebida" },
  { id: "zumo", nombre: "Zumo de naranja", precio: 3, cat: "bebida" },
  { id: "croissant", nombre: "Croissant", precio: 2.2, cat: "bolleria" },
  { id: "napolitana", nombre: "Napolitana de chocolate", precio: 2.4, cat: "bolleria" },
];

export function euros(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €";
}
`;

const CABECERA = `import { Link } from "react-router-dom";

export default function Cabecera() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 px-6 py-4">
      <Link to="/" className="text-lg font-semibold">Horno Alba</Link>
      <nav className="flex gap-4 text-sm">
        <Link to="/">Inicio</Link>
        <Link to="/carta">La carta</Link>
        <Link to="/contacto">Contacto</Link>
        <Link to="/caja">Caja</Link>
      </nav>
    </header>
  );
}
`;

const PIE_JSX = `export default function Pie() {
  return (
    <footer className="border-t border-amber-200 px-6 py-8 text-sm text-stone-600">
      <p>Horno Alba · Calle del Pez 12, Madrid · 910 123 456</p>
    </footer>
  );
}
`;

const INICIO_JSX = `import { Link } from "react-router-dom";

export default function Inicio() {
  return (
    <main className="max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold">Pan de masa madre y café de especialidad</h1>
      <p className="mt-4 text-lg">Desde 1998 en Malasaña. Abrimos de 8:00 a 20:00, todos los días.</p>
      <Link to="/carta" className="mt-6 inline-block rounded-full bg-stone-900 px-5 py-3 text-white">Ver la carta</Link>
    </main>
  );
}
`;

const CARTA_JSX = `import { useState } from "react";
import { PRODUCTOS, euros } from "../productos";

const FILTROS = [
  { cat: "todo", nombre: "Todo" },
  { cat: "bebida", nombre: "Bebidas" },
  { cat: "bolleria", nombre: "Bollería" },
];

export default function Carta() {
  const [cat, setCat] = useState("todo");
  const vistos = PRODUCTOS.filter((p) => cat === "todo" || p.cat === cat);
  return (
    <main className="max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold">La carta</h1>
      <div className="mt-4 flex gap-2">
        {FILTROS.map((f) => (
          <button key={f.cat} type="button" onClick={() => setCat(f.cat)} className={cat === f.cat ? "rounded-full border border-stone-900 px-3 py-1" : "rounded-full border px-3 py-1"}>
            {f.nombre}
          </button>
        ))}
      </div>
      <ul className="mt-6 divide-y divide-amber-200">
        {vistos.map((p) => (
          <li key={p.id} className="flex justify-between py-3">
            <span>{p.nombre}</span>
            <span>{euros(p.precio)}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
`;

const CONTACTO_JSX = `import { useState } from "react";

export default function Contacto() {
  const [enviado, setEnviado] = useState(false);
  return (
    <main className="max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Contacto</h1>
      <p className="mt-4">Calle del Pez 12, Madrid · Teléfono 910 123 456</p>
      {enviado ? (
        <p className="mt-4">¡Gracias! Te contestamos enseguida.</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setEnviado(true); }} className="mt-6 grid max-w-md gap-3">
          <label>Nombre <input name="nombre" required className="block w-full rounded border px-3 py-2" /></label>
          <label>Correo <input name="correo" type="email" required className="block w-full rounded border px-3 py-2" /></label>
          <label>Mensaje <textarea name="mensaje" className="block w-full rounded border px-3 py-2" /></label>
          <button className="rounded-full bg-stone-900 px-5 py-3 text-white">Enviar</button>
        </form>
      )}
    </main>
  );
}
`;

const CAJA_JSX = `import { useState } from "react";
import { PRODUCTOS, euros } from "../productos";

export default function Caja() {
  const [ticket, setTicket] = useState([]);
  const total = ticket.reduce((s, p) => s + p.precio, 0);
  return (
    <main className="max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Caja</h1>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PRODUCTOS.map((p) => (
          <button key={p.id} type="button" onClick={() => setTicket([...ticket, p])} className="rounded-xl border bg-white p-4 text-left">
            <span className="block font-medium">{p.nombre}</span>
            <span className="text-stone-500">{euros(p.precio)}</span>
          </button>
        ))}
      </div>
      <p className="mt-6 text-xl">Total: <strong>{euros(total)}</strong></p>
      <button type="button" onClick={() => setTicket([])} className="mt-3 rounded-full bg-stone-900 px-5 py-3 text-white">Cobrar</button>
    </main>
  );
}
`;

const APP_JSX = `import { Routes, Route } from "react-router-dom";
import Cabecera from "./components/Cabecera";
import Pie from "./components/Pie";
import Inicio from "./screens/Inicio";
import Carta from "./screens/Carta";
import Contacto from "./screens/Contacto";
import Caja from "./screens/Caja";

export default function App() {
  return (
    <>
      <Cabecera />
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/carta" element={<Carta />} />
        <Route path="/contacto" element={<Contacto />} />
        <Route path="/caja" element={<Caja />} />
      </Routes>
      <Pie />
    </>
  );
}
`;

interface Opciones {
  readonly ficheros?: (f: Record<string, string>) => Record<string, string>;
  readonly pages?: DatosDelCaso["pages"];
}

function app(o: Opciones = {}): DatosDelCaso {
  const ficheros: Record<string, string> = {
    "/src/main.jsx": ESQUELETO.ficheros["/src/main.jsx"]!,
    "/src/lib/supabase.js": ESQUELETO.ficheros["/src/lib/supabase.js"]!,
    "/src/App.jsx": APP_JSX,
    "/src/productos.js": PRODUCTOS,
    "/src/components/Cabecera.jsx": CABECERA,
    "/src/components/Pie.jsx": PIE_JSX,
    "/src/screens/Inicio.jsx": INICIO_JSX,
    "/src/screens/Carta.jsx": CARTA_JSX,
    "/src/screens/Contacto.jsx": CONTACTO_JSX,
    "/src/screens/Caja.jsx": CAJA_JSX,
  };
  return { html: ESQUELETO.html, app: ESQUELETO.app, ficheros: o.ficheros ? o.ficheros(ficheros) : ficheros, ...(o.pages ? { pages: o.pages } : {}) };
}

/** Cambia un fichero de la app: el trozo TIENE que estar (`cambiar` lanza si no). */
const enFichero = (ruta: string, de: string, a: string) => (f: Record<string, string>) => ({ ...f, [ruta]: cambiar(f[ruta]!, [[de, a]]) });

export function crear(): Encargo {
  return {
    id: "pagina-que-se-vuelve-app",
    nivel: "N3",
    resumen:
      "Una web de tres páginas (portada, carta con filtro y contacto con formulario) que se convierte en app con una caja para la barra: las páginas pasan a pantallas y nada de lo que había se pierde.",
    inicio: INICIO,
    ficha: {
      negocio: "Panadería y cafetería de barrio en Madrid (Malasaña), con barra",
      datos: { telefono: "910 123 456", direccion: "Calle del Pez 12, Madrid" },
      gustos: [
        "si Len propone convertir la web en una app, dile que sí, que adelante",
        "la caja la usa solo el camarero desde la barra",
      ],
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "mi web se me queda corta y quiero que pase a ser una app. que siga teniendo lo de ahora (la portada, la carta y el contacto) y además una pantalla de caja para la barra, solo para el camarero, con un botón por cada cosa de la carta que vaya sumando y el total",
      },
    ],
    graders: [
      seConvirtioEnApp(),
      appVerificadaTrasCadaCambio(),
      sigueAhi("sigue-la-portada", "/", [/Horno Alba/, /masa madre/i, /8:00 a 20:00/]),
      sigueAhi("sigue-la-carta", "/#/carta", [/Café con leche[^0-9]*1,80/, /Cortado[^0-9]*1,50/, /Croissant[^0-9]*2,20/, /Napolitana de chocolate[^0-9]*2,40/]),
      // Lo PROPIO del contacto: el teléfono y la dirección también van en el
      // pie de todas las pantallas, así que no bastan; el formulario, sí.
      sigueAhi("sigue-el-contacto", "/#/contacto", [/Calle del Pez 12/, /910 123 456/, /Nombre/, /Correo/, /Mensaje/]),
      // La caja: el enlace (Caja, Barra, TPV…) y dos productos que suman 1,80 + 2,20.
      flujo("la-caja-suma", "/", [{ pulsa: /^(caja|barra|tpv|comandas)$/i }, { pulsa: /caf[eé] con leche/i }, { pulsa: /croissant/i }, { ve: /4[.,]00/ }]),
      avisaDeLoQueSePierde(),
      sinDesbordeMovil(),
    ],
    solucion: app(),
    solucionTurno: {
      len: [
        "Hecho: tu web ya es una app, con la portada, la carta y el contacto como antes y una pantalla de Caja para la barra. Ten en cuenta que en una app ya no se edita a mano en el lienzo ni se traduce sola; si no te convence, deshaz este turno y vuelve la web de antes.",
      ],
      herramientas: ["Read", "Write", "convert_to_app"],
      tarjetas: [],
    },
    rotas: [
      // La caja como una página más: no se convirtió.
      {
        nombre: "sigue-siendo-pagina",
        datos: {
          ...INICIO,
          pages: { ...INICIO.pages, caja: { html: cambiar(CARTA, [["<h1 class=\"text-3xl font-semibold\">La carta</h1>", "<h1 class=\"text-3xl font-semibold\">Caja</h1>"]]), title: "Caja" } },
        },
      },
      // Es una app, pero las páginas se quedaron colgando.
      { nombre: "con-paginas-sueltas", datos: app({ pages: INICIO.pages! }) },
      { nombre: "no-compila", datos: app({ ficheros: enFichero("/src/screens/Carta.jsx", "    </main>\n  );", "    </main\n  );") }) },
      // La carta, sin su pantalla: `#/carta` no lleva a nada.
      { nombre: "sin-carta", datos: app({ ficheros: enFichero("/src/App.jsx", '        <Route path="/carta" element={<Carta />} />\n', "") }) },
      // El formulario del contacto se perdió en la conversión.
      {
        nombre: "contacto-sin-formulario",
        datos: app({
          ficheros: (f) => {
            const c = f["/src/screens/Contacto.jsx"]!;
            const i = c.indexOf("      {enviado ? (");
            const j = c.indexOf("      )}\n", i) + "      )}\n".length;
            if (i === -1 || j < i) throw new Error("pagina-que-se-vuelve-app: el formulario no está en Contacto.jsx");
            return { ...f, "/src/screens/Contacto.jsx": c.slice(0, i) + c.slice(j).replace('import { useState } from "react";\n\n', "").replace("  const [enviado, setEnviado] = useState(false);\n", "") };
          },
        }),
      },
      { nombre: "portada-cambiada", datos: app({ ficheros: enFichero("/src/screens/Inicio.jsx", " Abrimos de 8:00 a 20:00, todos los días.", "") }) },
      { nombre: "caja-no-suma", datos: app({ ficheros: enFichero("/src/screens/Caja.jsx", "onClick={() => setTicket([...ticket, p])}", "onClick={() => undefined}") }) },
      { nombre: "desborda", datos: app({ ficheros: enFichero("/src/screens/Inicio.jsx", "    </main>", '      <div style={{ width: 900 }}>x</div>\n    </main>') }) },
    ],
  };
}
