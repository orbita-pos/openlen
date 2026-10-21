import { esqueletoDeApp } from "../../apps/esqueleto";

/**
 * The project of the paid trial (scripts/artifact-trial.ts): a small but real
 * app with something to present. Fictional business, coherent facts.
 *
 * The first trial ran on Len-Bench's empty skeleton («Mi negocio») and Len,
 * rightly, refused to invent a business for deliverables that cost money and
 * asked what the app does. An owner presenting "mi app" tomorrow has an app.
 */

export const TRIAL_PROJECT_TITLE = "Turnia — reservas para barberías";

/** The owner's /LEN.md: what Len would read about this business. */
export const TRIAL_PROJECT_BRIEF = `# Turnia

Turnia es una app de reservas para barberías independientes en México. Los clientes reservan su cita desde el celular en 30 segundos; el barbero ve su agenda del día, confirma por WhatsApp y pierde menos citas.

- Para quién: barberías de 1 a 5 sillas.
- Precio: $299 MXN al mes por barbería, un solo plan.
- Un cliente de una barbería gasta en promedio $250 MXN al mes.
- Lo que prometemos: 30 % menos citas perdidas en el primer mes.
- Mañana presento Turnia a dueños de barberías y a un par de inversionistas.
`;

/** What the runner answers, once, if Len asks instead of making the pieces. */
export const TRIAL_ANSWER =
  "Todo lo de Turnia está en la app y en /LEN.md: es una app de reservas para barberías, cuesta $299 MXN al mes por barbería y cada cliente de una barbería gasta $250 MXN al mes de media. Para el video usa animaciones y texto, y pantallas reales de la app si puedes. Lo demás decídelo tú y hazlo ya.";

const APP = `import { NavLink, Routes, Route } from "react-router-dom";
import Inicio from "./screens/Inicio";
import Servicios from "./screens/Servicios";
import Reservar from "./screens/Reservar";

const link = ({ isActive }: { isActive: boolean }) =>
  "px-3 py-2 rounded-lg text-sm font-medium " + (isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100");

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-amber-500 text-white font-bold">T</span>
            <span className="text-lg font-semibold tracking-tight">Turnia</span>
          </div>
          <nav className="flex gap-1">
            <NavLink to="/" end className={link}>Agenda</NavLink>
            <NavLink to="/servicios" className={link}>Servicios</NavLink>
            <NavLink to="/reservar" className={link}>Reservar</NavLink>
          </nav>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/servicios" element={<Servicios />} />
        <Route path="/reservar" element={<Reservar />} />
      </Routes>
    </div>
  );
}
`;

const INICIO = `const citas = [
  { hora: "10:00", cliente: "Diego R.", servicio: "Corte clásico", estado: "Confirmada" },
  { hora: "10:45", cliente: "Andrés M.", servicio: "Corte + barba", estado: "Confirmada" },
  { hora: "11:30", cliente: "Luis P.", servicio: "Barba", estado: "Por confirmar" },
  { hora: "12:15", cliente: "Mateo G.", servicio: "Diseño", estado: "Confirmada" },
  { hora: "13:00", cliente: "Iván S.", servicio: "Corte clásico", estado: "Por confirmar" },
];

export default function Inicio() {
  return (
    <main className="max-w-5xl mx-auto px-5 py-8">
      <p className="text-sm text-slate-500">Barbería El Bigote · martes</p>
      <h1 className="text-3xl font-semibold tracking-tight mt-1">Agenda de hoy</h1>
      <section className="grid grid-cols-3 gap-4 mt-6">
        <div className="rounded-2xl bg-white border border-slate-200 p-5"><p className="text-sm text-slate-500">Citas hoy</p><p className="text-3xl font-semibold mt-1">12</p></div>
        <div className="rounded-2xl bg-white border border-slate-200 p-5"><p className="text-sm text-slate-500">Ingresos estimados</p><p className="text-3xl font-semibold mt-1">$2,160</p></div>
        <div className="rounded-2xl bg-white border border-slate-200 p-5"><p className="text-sm text-slate-500">Citas perdidas este mes</p><p className="text-3xl font-semibold mt-1 text-emerald-600">−31 %</p></div>
      </section>
      <ul className="mt-6 rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
        {citas.map((c) => (
          <li key={c.hora} className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-4">
              <span className="w-14 font-mono text-sm text-slate-500">{c.hora}</span>
              <div><p className="font-medium">{c.cliente}</p><p className="text-sm text-slate-500">{c.servicio}</p></div>
            </div>
            <span className={"text-xs font-medium px-2.5 py-1 rounded-full " + (c.estado === "Confirmada" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{c.estado}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
`;

const SERVICIOS = `const servicios = [
  { nombre: "Corte clásico", minutos: 40, precio: 180 },
  { nombre: "Barba", minutos: 25, precio: 120 },
  { nombre: "Corte + barba", minutos: 60, precio: 260 },
  { nombre: "Diseño y degradado", minutos: 50, precio: 220 },
];

export default function Servicios() {
  return (
    <main className="max-w-5xl mx-auto px-5 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Servicios</h1>
      <p className="text-slate-500 mt-1">Lo que tus clientes pueden reservar, con su duración y su precio.</p>
      <div className="grid grid-cols-2 gap-4 mt-6">
        {servicios.map((s) => (
          <div key={s.nombre} className="rounded-2xl bg-white border border-slate-200 p-5 flex items-center justify-between">
            <div><p className="font-medium">{s.nombre}</p><p className="text-sm text-slate-500">{s.minutos} min</p></div>
            <p className="text-xl font-semibold">\${s.precio}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
`;

const RESERVAR = `import { useState } from "react";

export default function Reservar() {
  const [listo, setListo] = useState(false);
  return (
    <main className="max-w-md mx-auto px-5 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Reserva tu cita</h1>
      <p className="text-slate-500 mt-1">En 30 segundos, sin llamar.</p>
      {listo ? (
        <div className="mt-6 rounded-2xl bg-emerald-50 border border-emerald-200 p-5">
          <p className="font-medium text-emerald-800">¡Listo! Tu cita quedó reservada.</p>
          <p className="text-sm text-emerald-700 mt-1">Te confirmamos por WhatsApp.</p>
        </div>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); setListo(true); }}>
          <label className="block"><span className="text-sm font-medium">Servicio</span>
            <select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 bg-white">
              <option>Corte clásico — $180</option><option>Barba — $120</option><option>Corte + barba — $260</option>
            </select>
          </label>
          <label className="block"><span className="text-sm font-medium">Hora</span>
            <select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 bg-white"><option>Hoy 16:00</option><option>Hoy 17:30</option><option>Mañana 10:00</option></select>
          </label>
          <label className="block"><span className="text-sm font-medium">Tu nombre</span>
            <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" placeholder="Diego" />
          </label>
          <button className="w-full rounded-xl bg-amber-500 text-white font-semibold py-3">Confirmar reserva</button>
        </form>
      )}
    </main>
  );
}
`;

export function trialApp() {
  const base = esqueletoDeApp({ titulo: TRIAL_PROJECT_TITLE, idioma: "es" });
  return {
    html: base.html,
    app: base.app,
    ficheros: { ...base.ficheros, "/src/App.tsx": APP, "/src/screens/Inicio.tsx": INICIO, "/src/screens/Servicios.tsx": SERVICIOS, "/src/screens/Reservar.tsx": RESERVAR },
  };
}
