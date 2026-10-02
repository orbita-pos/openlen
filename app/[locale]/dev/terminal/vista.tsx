"use client";

// La lente «Terminal» con datos de ejemplo (ver page.tsx). Usa el PreviewArea
// DE VERDAD: lo único falso es la respuesta de /api/projects/demo/terminal, que
// se contesta aquí, y un comando «en vivo» empujado al mismo almacén que usa el
// Chat. Sólo existe en desarrollo.

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import "../../new/tokens.css";
import { PreviewArea, type Lente } from "@/components/workspace-v2/preview-area";
import { FicherosDelTurnoEnVivo } from "@/components/workspace-v2/ficheros-del-turno";
import { AgentActionCard, type AgentAction } from "@/components/workspace-v2/agent-action-card";
import { TextoDeLen } from "@/components/workspace-v2/texto-de-len";
import { ProcesoPlegable } from "@/components/workspace-v2/proceso-plegable";
import { duracionLegible } from "@/lib/workspace-v2/proceso-del-turno";
import { resumenDelComando } from "@/lib/agent/terminal/resumen-del-comando";
import { cambiosDelComando } from "@/lib/agent/terminal/cambios-del-comando";
import { abrirEnElCodigo, abrirFicheroDelTurno, rutasDelTurno } from "@/lib/workspace-v2/abrir-fichero";
import { terminalEnVivo } from "@/lib/workspace-v2/terminal-en-vivo";
import { cambiosEnVivo } from "@/lib/workspace-v2/cambios-en-vivo";

const PROYECTO = "demo-terminal";

// La #10: lo que cambió cada comando, calculado con la función DE VERDAD sobre
// un sitio de ejemplo (en el servidor sale de la foto de la terminal).
const pagina = (cuerpo: string) => `<!doctype html>\n<html>\n<body>\n${cuerpo}\n</body>\n</html>\n`;
const SITIO: Record<string, string> = {
  "/index.html": pagina(
    '  <h1>Escuela de surf Marejada</h1>\n  <p class="text-sm">Calle Marea 12, Sayulita</p>\n  <a href="https://maps.google.com/?q=Calle+Marea+12">Cómo llegar</a>',
  ),
  "/menu/index.html": pagina("  <h1>Clases</h1>\n  <footer>Calle Marea 12</footer>"),
  "/contacto/index.html": pagina("  <h1>Contacto</h1>\n  <address>Calle Marea 12, Sayulita, Nay.</address>"),
};
const conGaviotas = (sitio: Record<string, string>) =>
  Object.fromEntries(Object.entries(sitio).map(([r, t]) => [r, t.replaceAll("Calle Marea 12", "Calle Gaviotas 7")]));
// Y uno grande para tu terminal: 7 ficheros (se ven 5) y uno de 60 líneas (se ven 40).
const SITIO_GRANDE: Record<string, string> = {
  ...SITIO,
  "/clases/index.html": pagina(Array.from({ length: 60 }, (_, i) => `  <p>Clase ${i + 1}: Calle Marea 12</p>`).join("\n")),
  "/precios/index.html": pagina("  <p>Calle Marea 12</p>"),
  "/blog/index.html": pagina("  <p>Calle Marea 12</p>"),
  "/faq/index.html": pagina("  <p>Calle Marea 12</p>"),
};

const HISTORIAL = {
  encendida: true,
  turnos: [
    {
      id: "t1",
      pedido: "Cambia la dirección vieja por Calle Gaviotas 7 en todo el sitio",
      creado: "2026-10-02T09:12:00.000Z",
      comandos: [
        {
          command: "grep -rn 'Calle Marea 12' /",
          salida:
            "/index.html:88:      <p class=\"text-sm\">Calle Marea 12, Sayulita</p>\n/index.html:131:      <a href=\"https://maps.google.com/?q=Calle+Marea+12\">Cómo llegar</a>\n/menu/index.html:41:  <footer>Calle Marea 12</footer>\n/contacto/index.html:23:        <address>Calle Marea 12, Sayulita, Nay.</address>\n/contacto/index.html:58:  <iframe title=\"Mapa: Calle Marea 12\" src=\"https://maps.google.com/maps?q=Calle+Marea+12&output=embed\"></iframe>\n/memoria/proyecto.md:3:- La escuela está en Calle Marea 12.\n[Command finished with exit code 0]",
          exitCode: 0,
        },
        {
          command: "sed -i 's/Calle Marea 12/Calle Gaviotas 7/g' /index.html /menu/index.html /contacto/index.html",
          salida: "contacto/index.html: saved.\nindex.html: saved.\nmenu/index.html: saved.\n[Command finished with exit code 0]",
          exitCode: 0,
          cambios: cambiosDelComando(SITIO, conGaviotas(SITIO)),
        },
        {
          command: "echo nota >> /AGENTS.md",
          salida: "AGENTS.md: not saved — the platform manual is read-only.\n[Command finished with exit code 1]",
          exitCode: 1,
        },
      ],
    },
    {
      id: "t2",
      pedido: "¿Quién reservó clase para el sábado?",
      creado: "2026-10-02T10:40:00.000Z",
      comandos: [
        {
          command: "jq -r '.[] | select(.dia==\"sábado\") | .nombre' /datos/reservas.json",
          salida: "Ana Ruiz\nMarco Díaz\n[Command finished with exit code 0]",
          exitCode: 0,
        },
        // Una salida LARGA (la #14): plegada, las 8 primeras y las 8 últimas.
        {
          command: "cat -n /clases/index.html",
          salida: `${Array.from({ length: 30 }, (_, i) => `${String(i + 1).padStart(6)}\t${i === 0 ? "<!doctype html>" : i === 29 ? "</html>" : `  <p>Línea ${i + 1} de la página de clases</p>`}`).join("\n")}\n[Command finished with exit code 0]`,
          exitCode: 0,
        },
      ],
    },
  ],
};

// Las tarjetas que el Chat habría pintado para el turno «t1»: lo que guarda
// la tarjeta de cada comando es su resumen (`herramienta.ts`).
const TARJETAS: AgentAction[] = HISTORIAL.turnos[0]!.comandos.map((c): AgentAction =>
  c.exitCode === 0
    ? { tool: "bash", status: "done", summary: resumenDelComando(c.command) }
    : { tool: "bash", status: "error", summary: resumenDelComando(c.command), motivo: `exit code ${c.exitCode}` },
).concat([
  // La #9: las de ficheros abren el suyo. Éstos cambiaron en «t1»: van a «Cambios».
  { tool: "Edit", status: "done", summary: "contacto/index.html: «Calle Marea 12» → «Calle Gaviotas 7»" },
  { tool: "Write", status: "done", summary: "clases/index.html (página nueva)" },
]);

// Y un turno que sólo LEYÓ («t2»): sus rutas van a «Código».
const TARJETAS_T2: AgentAction[] = [{ tool: "Read", status: "done", summary: "datos/reservas.json" }];

// Lo que Len escribió. `index.html` es la ruta de la portada (casa exacta), no
// un nombre suelto; `notas.txt` no lo leyó ni lo cambió nadie: se queda en texto.
const TEXTO_T1 =
  "Listo: cambié la dirección en `contacto/index.html`, en `menu/index.html` y en `index.html`, y creé `clases/index.html`. También lo apunté en `memoria/proyecto.md`; `notas.txt` no hacía falta.";
const TEXTO_T2 = "El sábado reservaron **Ana Ruiz** y **Marco Díaz** (lo saqué de `datos/reservas.json`).";

const rutasDe = (turnId: string, tarjetas: readonly AgentAction[]) =>
  rutasDelTurno(tarjetas, cambiosEnVivo.turnos(PROYECTO).find((x) => x.turnId === turnId)?.ficheros.map((f) => f.ruta) ?? []);
const abrir = (turnId: string, ruta: string) =>
  abrirFicheroDelTurno(PROYECTO, turnId, ruta, { cambios: cambiosEnVivo, codigo: abrirEnElCodigo });

// Lo que la lente «Código» pide al abrirse (`/api/projects/[id]/ficheros`).
const FICHEROS = () => ({
  ficheros: [
    { ruta: "/index.html", contenido: INDEX_DESPUES },
    { ruta: "/contacto/index.html", contenido: CONTACTO("Calle Gaviotas 7") },
    { ruta: "/clases/index.html", contenido: CLASES },
    { ruta: "/datos/reservas.json", contenido: RESERVAS_DESPUES },
  ],
  // Se calcula al abrirlo: hasta entonces, la búsqueda sólo lo encuentra por nombre.
  perezosos: ["/resultados/visitas.json"],
});

let preparado = false;
function preparar() {
  if (preparado || typeof window === "undefined") return;
  preparado = true;
  const original = window.fetch.bind(window);
  window.fetch = (entrada, init) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.endsWith(`/api/projects/${PROYECTO}/terminal`) && init?.method === "POST") {
      // Tu terminal (la #17), de mentira: aquí no hay servidor con sesión. La de
      // verdad la prueban las de node:test en herramientas-de-ficheros.test.ts.
      const { command } = JSON.parse(String(init.body)) as { command: string };
      const sed = command.includes("sed -i");
      const salida = command.trim().startsWith("ls")
        ? "AGENTS.md\nclases\ncontacto\ndatos\nindex.html\nresultados\n[Command finished with exit code 0]"
        : sed
          ? `${Object.keys(SITIO_GRANDE)
              .sort()
              .map((r) => `${r.slice(1)}: saved.`)
              .join("\n")}\n[Command finished with exit code 0]`
          : `(ejemplo: aquí no corre «${command}»)\n[Command finished with exit code 0]`;
      // Con un `sed -i`, lo que habría cambiado (la #10).
      const cambios = sed ? cambiosDelComando(SITIO_GRANDE, conGaviotas(SITIO_GRANDE)) : null;
      const cuerpo = JSON.stringify({ command, salida, exitCode: 0, cambio: sed, ...(cambios ? { cambios } : {}) });
      return new Promise((r) =>
        setTimeout(() => r(new Response(cuerpo, { headers: { "content-type": "application/json" } })), 500),
      );
    }
    if (url.endsWith(`/api/projects/${PROYECTO}/terminal`)) {
      return Promise.resolve(new Response(JSON.stringify(HISTORIAL), { headers: { "content-type": "application/json" } }));
    }
    if (url.endsWith(`/api/projects/${PROYECTO}/ficheros`)) {
      return Promise.resolve(new Response(JSON.stringify(FICHEROS()), { headers: { "content-type": "application/json" } }));
    }
    if (url.includes(`/api/projects/${PROYECTO}/ficheros?ruta=`)) {
      return Promise.resolve(new Response(JSON.stringify({ contenido: '{\n  "hoy": 12,\n  "semana": 81\n}\n' }), { headers: { "content-type": "application/json" } }));
    }
    return original(entrada, init);
  };
  terminalEnVivo.empujar(PROYECTO, {
    command: "find / -name 'index.html' -path '*/clases/*'",
    salida: "/clases/index.html\n[Command finished with exit code 0]",
    exitCode: 0,
  });
  // La lente «Cambios»: dos turnos de ejemplo, como los dejaría el evento `cambios`.
  cambiosEnVivo.guardar(PROYECTO, {
    turnId: "t0",
    pedido: "Pon el horario de verano en la portada",
    ficheros: [{ ruta: "/index.html", tipo: "texto", antes: INDEX_VIEJO, despues: INDEX_ANTES }],
  });
  cambiosEnVivo.guardar(PROYECTO, {
    turnId: "t1",
    pedido: "Cambia la dirección vieja por Calle Gaviotas 7 en todo el sitio y añade la página de clases",
    ficheros: [
      { ruta: "/clases/index.html", tipo: "texto", antes: null, despues: CLASES },
      { ruta: "/contacto/index.html", tipo: "texto", antes: CONTACTO("Calle Marea 12"), despues: CONTACTO("Calle Gaviotas 7") },
      { ruta: "/datos/reservas.json", tipo: "texto", antes: RESERVAS_ANTES, despues: RESERVAS_DESPUES },
      { ruta: "/index.html", tipo: "texto", antes: INDEX_ANTES, despues: INDEX_DESPUES },
      { ruta: "/memoria/proyecto.md", tipo: "texto", antes: "- Escuela de surf en Sayulita.\n", despues: "- Escuela de surf en Sayulita.\n- Se mudó a Calle Gaviotas 7 (oct. 2026).\n" },
      { ruta: "/menu/index.html", tipo: "grande", nuevo: false, borrado: false },
    ],
  });
}

const CABEZA = [
  "<!doctype html>",
  '<html lang="es">',
  "<head>",
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1">',
  "  <title>Casa Oleaje · Escuela de surf</title>",
  '  <script src="https://cdn.tailwindcss.com"></script>',
  "</head>",
  '<body class="bg-[#f6efe6] text-[#1d2a33]">',
  '  <header class="flex items-center justify-between px-6 py-4">',
  '    <a href="/" class="font-semibold">Casa Oleaje</a>',
  '    <nav class="flex gap-4 text-sm"><a href="/clases/">Clases</a><a href="/contacto/">Contacto</a></nav>',
  "  </header>",
];
const pie = (direccion: string, horario: string) =>
  [
    '  <main class="px-6 py-16">',
    '    <h1 class="text-5xl font-semibold">Aprende a surfear en Sayulita</h1>',
    '    <p class="mt-4 max-w-xl">Clases para principiantes y avanzados, con tabla y traje incluidos. Grupos de cuatro personas como máximo para que el instructor te vea en cada ola.</p>',
    '    <a href="/contacto/" class="mt-8 inline-block rounded-full bg-[#1d2a33] px-6 py-3 text-white">Reserva tu clase</a>',
    "  </main>",
    '  <section class="px-6 py-12">',
    '    <h2 class="text-2xl font-semibold">Horario</h2>',
    `    <p>${horario}</p>`,
    "  </section>",
    '  <footer class="px-6 py-8 text-sm">',
    `    <p class="text-sm">${direccion}, Sayulita</p>`,
    "    <p>© 2026 Casa Oleaje</p>",
    "  </footer>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
const INDEX_VIEJO = [...CABEZA, pie("Calle Marea 12", "Todos los días, de 8:00 a 17:00.")].join("\n");
const INDEX_ANTES = [...CABEZA, pie("Calle Marea 12", "Todos los días, de 7:00 a 19:00 (verano).")].join("\n");
const INDEX_DESPUES = [...CABEZA, pie("Calle Gaviotas 7", "Todos los días, de 7:00 a 19:00 (verano).")].join("\n");
const CONTACTO = (direccion: string) =>
  [...CABEZA, '  <main class="px-6 py-16">', '    <h1 class="text-4xl">Contacto</h1>', `    <address>${direccion}, Sayulita, Nay.</address>`, "  </main>", "</body>", "</html>", ""].join("\n");
const CLASES = [...CABEZA, '  <main class="px-6 py-16">', '    <h1 class="text-4xl">Clases</h1>', "    <ul>", "      <li>Principiantes · 2 h · $650</li>", "      <li>Avanzados · 2 h · $800</li>", "    </ul>", "  </main>", "</body>", "</html>", ""].join("\n");
const RESERVAS_ANTES = JSON.stringify([{ id: "r1", nombre: "Ana Ruiz", dia: "sábado" }], null, 2) + "\n";
const RESERVAS_DESPUES =
  JSON.stringify([{ id: "r1", nombre: "Ana Ruiz", dia: "sábado" }, { id: "r2", nombre: "Marco Díaz", dia: "sábado" }], null, 2) + "\n";

const DOC = `<!doctype html><html><head><style>body{font-family:system-ui;margin:0;padding:48px;background:#f6efe6;color:#1d2a33}h1{font-size:44px}</style></head><body><h1>Casa Oleaje</h1><p>Clases de surf en Sayulita · Calle Gaviotas 7</p></body></html>`;

export function VistaDeLaTerminal({ oscuro, cambios }: { oscuro: boolean; cambios: boolean }) {
  const [lente, setLente] = useState<Lente>(cambios ? "cambios" : "terminal");
  const tc = useTranslations("panelsChat");
  const locale = useLocale();
  const [t1Cerrado, setT1Cerrado] = useState(false);
  // Los datos de ejemplo, DESPUÉS de montar y antes de pintar el lienzo: rellenar
  // los almacenes mientras se pinta avisaba a otros componentes a media pintura,
  // y en el servidor no hay ninguno que enseñar.
  const [montado, setMontado] = useState(false);
  useEffect(() => {
    preparar();
    setMontado(true);
  }, []);
  if (!montado) return null;
  return (
    <div className={oscuro ? "dark" : ""} style={{ width: "100vw", height: "100vh" }}>
      <div className="workspace-v2 flex h-full">
        {/* El pie de un turno del Chat, con su tarjeta: pulsar una fila abre la lente. */}
        <aside className="hidden w-80 shrink-0 flex-col justify-end gap-2 overflow-auto border-r bd bg-app p-3 md:flex">
          {/* El turno «t1»: las tarjetas de sus comandos se despliegan con la
              salida (del historial falso de arriba); las de ficheros, y las
              rutas del texto, abren el fichero (la #9). */}
          {/* La #13: corriendo, los pasos a la vista; al terminar, detrás de
              «Completado en …», como en TurnView. El botón lo termina. */}
          {!t1Cerrado && (
            <button type="button" onClick={() => setT1Cerrado(true)} className="self-start text-[10.5px] text-accent hover:underline">
              (ejemplo) terminar el turno
            </button>
          )}
          <ProcesoPlegable
            plegable={t1Cerrado}
            titulo={tc.rich("proceso.completadoEn", {
              duracion: duracionLegible(64_000, locale),
              d: (trozo) => <span className="font-mono tabular-nums">{trozo}</span>,
            })}
          >
            <div className="space-y-1">
              {TARJETAS.map((a, i) => (
                <AgentActionCard
                  key={i}
                  action={a}
                  onAbrirFichero={(ruta) => abrir("t1", ruta)}
                  {...(a.tool === "bash" ? { terminal: { projectId: PROYECTO, turnId: "t1", indice: i } } : {})}
                />
              ))}
            </div>
          </ProcesoPlegable>
          <div className="inline-block max-w-full rounded-2xl border bd bg-elev px-3 py-2">
            <p className="text-[12.5px] fg leading-relaxed">
              <TextoDeLen texto={TEXTO_T1} rutas={rutasDe("t1", TARJETAS)} onAbrir={(ruta) => abrir("t1", ruta)} />
            </p>
            <FicherosDelTurnoEnVivo projectId={PROYECTO} turnId="t1" />
          </div>
          {/* El turno «t2» sólo leyó: sus rutas van a «Código». */}
          {/* Recargado: se sabe que cerró, no cuándo empezó. La fila, sin duración. */}
          <ProcesoPlegable plegable titulo={tc("proceso.completado")}>
            <div className="space-y-1">
              {TARJETAS_T2.map((a, i) => (
                <AgentActionCard key={i} action={a} onAbrirFichero={(ruta) => abrir("t2", ruta)} />
              ))}
            </div>
          </ProcesoPlegable>
          <div className="inline-block max-w-full rounded-2xl border bd bg-elev px-3 py-2">
            <p className="text-[12.5px] fg leading-relaxed">
              <TextoDeLen texto={TEXTO_T2} rutas={rutasDe("t2", TARJETAS_T2)} onAbrir={(ruta) => abrir("t2", ruta)} />
            </p>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <PreviewArea doc={DOC} lente={lente} onLente={setLente} projectId={PROYECTO} docKey={PROYECTO} />
        </div>
      </div>
    </div>
  );
}
