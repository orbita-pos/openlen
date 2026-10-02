"use client";

// La lente «Terminal» con datos de ejemplo (ver page.tsx). Usa el PreviewArea
// DE VERDAD: lo único falso es la respuesta de /api/projects/demo/terminal, que
// se contesta aquí, y un comando «en vivo» empujado al mismo almacén que usa el
// Chat. Sólo existe en desarrollo.

import { useState } from "react";

import "../../new/tokens.css";
import { PreviewArea, type Lente } from "@/components/workspace-v2/preview-area";
import { terminalEnVivo } from "@/lib/workspace-v2/terminal-en-vivo";

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
            "/index.html:88:      <p class=\"text-sm\">Calle Marea 12, Sayulita</p>\n/menu/index.html:41:  <footer>Calle Marea 12</footer>\n/contacto/index.html:23:        <address>Calle Marea 12, Sayulita, Nay.</address>\n[Command finished with exit code 0]",
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
}

const DOC = `<!doctype html><html><head><style>body{font-family:system-ui;margin:0;padding:48px;background:#f6efe6;color:#1d2a33}h1{font-size:44px}</style></head><body><h1>Casa Oleaje</h1><p>Clases de surf en Sayulita · Calle Gaviotas 7</p></body></html>`;

export function VistaDeLaTerminal({ oscuro }: { oscuro: boolean }) {
  preparar();
  const [lente, setLente] = useState<Lente>("terminal");
  return (
    <div className={oscuro ? "dark" : ""} style={{ width: "100vw", height: "100vh" }}>
      <div className="workspace-v2 flex h-full flex-col">
        <PreviewArea doc={DOC} lente={lente} onLente={setLente} projectId={PROYECTO} docKey={PROYECTO} />
      </div>
    </div>
  );
}
