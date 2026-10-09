// lib/agent/compila-la-app.ts — LO QUE NO COMPILA, DE VUELTA A LEN EN EL ACTO
// (F3 de la spec local docs/superpowers/specs/2026-10-07-apps-design.md, §5.2.5).
//
// En una app, un fichero que no compila deja la app EN BLANCO: el lienzo no lo
// sirve (`servirRutaDeLaApp` contesta con un módulo que lanza) y la publicación
// se niega. Len tiene que enterarse en la escritura, como en cualquier editor
// con un compilador detrás: en el `<new-diagnostics>` de la tanda, con fichero,
// línea y por qué (T9).
//
// QUÉ SE DICE. Lo que no compila AHORA y o bien está en un fichero que Len
// escribió en este turno, o bien no pasaba al empezarlo. Así un fallo que el
// dueño ya tenía en otro fichero no se le carga a Len en cada escritura, y uno
// que Len provoca en otro fichero —borra un componente que alguien importa,
// renombra un export— sí se le dice, aunque no tocara ese fichero.
//
// CUÁNDO. Una vez por HERRAMIENTA, con la carpeta ya guardada: un `sed -i` que
// renombra un export en dos ficheros pasa un instante por un estado roto entre
// el primero y el segundo, y decirlo sería mentirle.
//
// Y EL CASCARÓN: /index.html tiene que seguir cargando la entrada, o la app no
// arranca aunque todo compile.
//
// Puro: la carpeta y el cascarón los pone quien llama.

import { compilarCarpeta, textoDeDiagnostico, type Diagnostico as DeCompilacion } from "@/lib/apps/compilador";
import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";
import type { Diagnostico } from "@/lib/agent/diagnosticos";
import type { AppDeProyecto } from "@/lib/projects/types";
import { readTwConfigProblem } from "@/lib/publish/tw-config";

type Carpeta = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

const FUENTE = "compiler";

function publicable(carpeta: Carpeta): Record<string, string> {
  const pares = carpeta instanceof Map ? [...carpeta.entries()] : Object.entries(carpeta);
  return Object.fromEntries(pares.filter(([ruta]) => isPublishableFolderPath(ruta)));
}

/** Lo que no compila de la app con esta carpeta. */
export function erroresDeLaApp(app: AppDeProyecto, carpeta: Carpeta): readonly DeCompilacion[] {
  return compilarCarpeta({ carpeta: publicable(carpeta), catalogo: app.catalogo, entrada: app.entrada }).errores;
}

/** Lo que le falta al cascarón para arrancar la app, o `[]`. */
export function problemasDelCascaron(app: AppDeProyecto, cascaron: string, carpeta: Carpeta): Diagnostico[] {
  const enLaCarpeta = publicable(carpeta);
  const fuera: Diagnostico[] = [];
  const diag = (mensaje: string, codigo: string): Diagnostico => ({
    ruta: "/index.html",
    linea: 1,
    columna: 1,
    gravedad: "Error",
    mensaje,
    codigo,
    fuente: FUENTE,
  });
  const escapada = app.entrada.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const carga = new RegExp(`<script\\b[^>]*\\bsrc\\s*=\\s*["']${escapada}["'][^>]*>`, "i").exec(cascaron);
  if (!carga || !/\btype\s*=\s*["']module["']/i.test(carga[0])) {
    fuera.push(
      diag(
        `The shell no longer loads the app: it needs <script type="module" src="${app.entrada}"></script> in its <body>. Without it the app doesn't start.`,
        "cascaron",
      ),
    );
  }
  // UNA APP ES UN PAQUETE (plan 02): el cascarón sólo arranca la entrada. Otro
  // <script type="module"> —en línea, o a otro fichero— ya no tiene import map
  // ni catálogo suelto con que importar: no funcionaría en ningún camino.
  for (const m of cascaron.matchAll(/<script\b([^>]*)>/gi)) {
    const atributos = m[1] ?? "";
    if (!/\btype\s*=\s*["']module["']/i.test(atributos)) continue;
    if (new RegExp(`\\bsrc\\s*=\\s*["']${escapada}["']`, "i").test(atributos)) continue;
    fuera.push(
      diag(
        `In an app the shell only starts ${app.entrada}: the app is bundled from there. Move this <script type="module"> into /src and import it from ${app.entrada}.`,
        "cascaron-modulo",
      ),
    );
    break;
  }
  if (!Object.hasOwn(enLaCarpeta, app.entrada)) {
    fuera.push(diag(`The app starts at ${app.entrada}, and that file doesn't exist: the app doesn't start.`, "entrada"));
  } else {
    const id = /getElementById\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(enLaCarpeta[app.entrada]!)?.[1];
    if (id && !new RegExp(`\\bid\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(cascaron)) {
      fuera.push(diag(`${app.entrada} mounts the app in #${id}, and the shell has no element with id="${id}".`, "raiz"));
    }
  }
  // EL TAILWIND.CONFIG, leído por el MISMO lector que la publicación
  // (`readTwConfigProblem`, lib/publish/tw-config.ts), no adivinado con una regex:
  // lo que dice aquí es lo que pasará al publicar. El de shadcn trae `plugins:
  // [require("tailwindcss-animate")]` por reflejo; con eso, o con una función o
  // una variable, la publicación no lo puede leer (se queda el CDN) y en el
  // navegador un `require` o una variable sin definir lanza: la config ENTERA
  // —colores, radios, modo oscuro— se pierde.
  if (readTwConfigProblem(cascaron) !== null) {
    fuera.push(
      diag(
        "The shell's tailwind.config isn't plain data: it has code (require(), a plugin, a function, a variable or a spread). In the browser require() or an undefined variable throws and the whole config is lost (colors, radius, dark mode), and publishing can't read it. Keep the config as plain data, with no plugins; write keyframes and animations in theme.extend.",
        "tailwind-config",
      ),
    );
  }
  return fuera;
}

/**
 * Lo que hay que decirle a Len tras una herramienta que cambió la app.
 *
 * @param ahora la carpeta YA guardada.
 * @param alEmpezar la carpeta al empezar el turno (antes de su primera escritura).
 * @param escritos lo que Len escribió en este turno.
 */
export function diagnosticosDeLaApp(args: {
  readonly app: AppDeProyecto;
  readonly ahora: Carpeta;
  readonly alEmpezar: Carpeta | null;
  readonly escritos: readonly string[];
  readonly cascaron: string;
}): Diagnostico[] {
  const ahora = erroresDeLaApp(args.app, args.ahora);
  const antes = new Set((args.alEmpezar ? erroresDeLaApp(args.app, args.alEmpezar) : []).map(textoDeDiagnostico));
  const suyos = new Set(args.escritos);
  const nuevos: Diagnostico[] = ahora
    .filter((e) => suyos.has(e.ruta) || !antes.has(textoDeDiagnostico(e)))
    .map((e) => ({
      ruta: e.ruta,
      linea: e.linea ?? 1,
      columna: e.columna ?? 1,
      gravedad: "Error" as const,
      mensaje: `${e.mensaje} Until this is fixed, the app doesn't load.`,
      codigo: "compila",
      fuente: FUENTE,
    }));
  return [...nuevos, ...problemasDelCascaron(args.app, args.cascaron, args.ahora)];
}
