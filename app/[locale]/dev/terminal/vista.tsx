"use client";

// La lente «Terminal» con datos de ejemplo (ver page.tsx). Usa el PreviewArea
// DE VERDAD: lo único falso es la respuesta de /api/projects/demo/terminal, que
// se contesta aquí, y un comando «en vivo» empujado al mismo almacén que usa el
// Chat. Sólo existe en desarrollo.

import { useEffect, useState } from "react";

import "../../new/tokens.css";
import { PreviewArea, type Lente } from "@/components/workspace-v2/preview-area";
import { FicherosDelTurnoEnVivo } from "@/components/workspace-v2/ficheros-del-turno";
import { AgentActionCard, type AgentAction } from "@/components/workspace-v2/agent-action-card";
import { resumenDelComando } from "@/lib/agent/terminal/resumen-del-comando";
import { terminalEnVivo } from "@/lib/workspace-v2/terminal-en-vivo";
import { cambiosEnVivo } from "@/lib/workspace-v2/cambios-en-vivo";

const PROYECTO = "demo-terminal";

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
      ],
    },
  ],
};

// Las tarjetas que el Chat habría pintado para el turno «t1»: lo que guarda
// la tarjeta de cada comando es su resumen (`herramienta.ts`).
const TARJETAS: AgentAction[] = HISTORIAL.turnos[0]!.comandos.map((c) =>
  c.exitCode === 0
    ? { tool: "bash", status: "done", summary: resumenDelComando(c.command) }
    : { tool: "bash", status: "error", summary: resumenDelComando(c.command), motivo: `exit code ${c.exitCode}` },
);

let preparado = false;
function preparar() {
  if (preparado || typeof window === "undefined") return;
  preparado = true;
  const original = window.fetch.bind(window);
  window.fetch = (entrada, init) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.endsWith(`/api/projects/${PROYECTO}/terminal`)) {
      return Promise.resolve(new Response(JSON.stringify(HISTORIAL), { headers: { "content-type": "application/json" } }));
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
        <aside className="hidden w-80 shrink-0 flex-col justify-end gap-2 border-r bd bg-app p-3 md:flex">
          {/* Las tarjetas de sus comandos: se despliegan con la salida, que
              sale del historial falso de arriba (el turno «t1»). */}
          <div className="space-y-1">
            {TARJETAS.map((a, i) => (
              <AgentActionCard
                key={i}
                action={a}
                {...(a.tool === "bash" ? { terminal: { projectId: PROYECTO, turnId: "t1", indice: i } } : {})}
              />
            ))}
          </div>
          <div className="inline-block max-w-full rounded-2xl border bd bg-elev px-3 py-2">
            <p className="text-[12.5px] fg leading-relaxed">Listo: cambié la dirección en las tres páginas, creé la página de clases y apunté la mudanza.</p>
            <FicherosDelTurnoEnVivo projectId={PROYECTO} turnId="t1" />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <PreviewArea doc={DOC} lente={lente} onLente={setLente} projectId={PROYECTO} docKey={PROYECTO} />
        </div>
      </div>
    </div>
  );
}
