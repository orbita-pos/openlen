// QUÉ PAQUETES PIDE LEN QUE SU CATÁLOGO NO TIENE, para que el catálogo crezca
// con datos y no a ojo.
//
// No hay registro aparte: cada choque ya queda en la transcripción del turno
// (`projectChatMessages.transcript`), con el texto exacto que leyó el modelo.
// Son cuatro mensajes, y éste es su único lector:
//
//   npm-install  la terminal de una app (`trabajador.mjs`, `npmInstall`):
//                «three: isn't available here — there is no npm; …»
//   import       el compilador, un nombre que el catálogo no tiene:
//                «"three" is not available in this app. …»
//   url-import   el compilador, un import desde un CDN:
//                «"https://esm.sh/three": imports from URLs or "https:" are not supported here.»
//   page-import  el compilador, un paquete importado en una PÁGINA (no app):
//                «"chart.js" is a package name, and packages can only be imported in an app.»
//
// Si cambia uno de esos textos, `missing-packages.test.ts` lo dice.

export type MissingSource = "npm-install" | "import" | "url-import" | "page-import";

export interface MissingHit {
  readonly pkg: string;
  readonly source: MissingSource;
}

export interface MissingPackageRow {
  readonly pkg: string;
  /** Proyectos distintos que lo pidieron. */
  readonly projects: number;
  /** Turnos en los que apareció (por cualquier fuente). */
  readonly turns: number;
  readonly sources: readonly MissingSource[];
  /** Fecha (AAAA-MM-DD, UTC) del último turno que lo pidió. */
  readonly lastSeen: string;
  /** Ya está en el catálogo con el que nacen las apps nuevas: lo pidió una app de un catálogo anterior. */
  readonly inCurrentCatalog: boolean;
}

const PATRONES: readonly (readonly [MissingSource, RegExp])[] = [
  ["npm-install", /^(\S+): isn't available here — there is no npm;/gm],
  ["import", /"([^"]+)" is not available in this app\./g],
  ["url-import", /"([^"]+)": imports from URLs or "[^"]*" are not supported here\./g],
  ["page-import", /"([^"]+)" is a package name, and packages can only be imported in an app\./g],
];

// Los CDN que sirven npm por su nombre: lo que va detrás del prefijo es `paquete[@versión][/ruta]`.
const CDNS: readonly RegExp[] = [
  /^https?:\/\/esm\.sh\/(?:v\d+\/|stable\/)?(.+)$/i,
  /^https?:\/\/cdn\.jsdelivr\.net\/npm\/(.+)$/i,
  /^https?:\/\/unpkg\.com\/(.+)$/i,
  /^https?:\/\/cdn\.skypack\.dev\/(.+)$/i,
  /^https?:\/\/ga\.jspm\.io\/npm:(.+)$/i,
];

const NOMBRE_NPM = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

/** El paquete de un especificador (`three/examples/x.js` → `three`) o de una URL de CDN; `null` si no lo hay. */
export function packageNameOf(especificador: string): string | null {
  let s = especificador.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    const cdn = CDNS.map((re) => re.exec(s)).find(Boolean);
    if (!cdn) return null;
    s = cdn[1]!.split(/[?#]/)[0]!;
  }
  const partes = s.split("/");
  const tramos = partes.slice(0, s.startsWith("@") ? 2 : 1);
  const ultimo = tramos.length - 1;
  tramos[ultimo] = tramos[ultimo]!.replace(/@.*$/, "");
  const nombre = tramos.join("/");
  return NOMBRE_NPM.test(nombre) ? nombre : null;
}

// Una respuesta de herramienta sin texto propio se guarda como
// `JSON.stringify(respuesta)` (`contenidoDeRespuesta`, lib/agent/fireworks-bridge.ts):
// dentro, el mensaje no empieza línea y sus comillas van escapadas. Se abre y se
// recorre como lo demás.
function* textosDe(valor: unknown): Generator<string> {
  if (typeof valor === "string") {
    const t = valor.trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      let abierto: unknown;
      try {
        abierto = JSON.parse(valor);
      } catch {
        yield valor;
        return;
      }
      yield* textosDe(abierto);
      return;
    }
    yield valor;
  } else if (Array.isArray(valor)) {
    for (const v of valor) yield* textosDe(v);
  } else if (valor && typeof valor === "object") {
    for (const v of Object.values(valor)) yield* textosDe(v);
  }
}

/** Los paquetes que faltaron en UN turno: cada uno una vez por fuente, en el orden en que salieron. */
export function missingPackagesOfTurn(transcript: unknown): MissingHit[] {
  const vistos = new Set<string>();
  const out: MissingHit[] = [];
  for (const texto of textosDe(transcript)) {
    for (const [source, patron] of PATRONES) {
      for (const m of texto.matchAll(patron)) {
        const pkg = packageNameOf(m[1]!);
        if (!pkg || vistos.has(`${source}\0${pkg}`)) continue;
        vistos.add(`${source}\0${pkg}`);
        out.push({ pkg, source });
      }
    }
  }
  return out;
}

export interface TurnForTally {
  readonly projectId: string;
  readonly createdAt: Date;
  readonly transcript: unknown;
}

/** La tabla por paquete: más proyectos primero, luego más turnos. */
export function tallyMissingPackages(
  turnos: readonly TurnForTally[],
  currentCatalog: readonly string[],
): MissingPackageRow[] {
  const enCatalogo = new Set(currentCatalog.map((e) => packageNameOf(e) ?? e));
  const porPaquete = new Map<string, { projects: Set<string>; turns: number; sources: Set<MissingSource>; last: Date }>();
  for (const t of turnos) {
    const hits = missingPackagesOfTurn(t.transcript);
    for (const pkg of new Set(hits.map((h) => h.pkg))) {
      const fila = porPaquete.get(pkg) ?? { projects: new Set(), turns: 0, sources: new Set(), last: t.createdAt };
      fila.projects.add(t.projectId);
      fila.turns += 1;
      for (const h of hits) if (h.pkg === pkg) fila.sources.add(h.source);
      if (t.createdAt > fila.last) fila.last = t.createdAt;
      porPaquete.set(pkg, fila);
    }
  }
  return [...porPaquete.entries()]
    .map(([pkg, f]) => ({
      pkg,
      projects: f.projects.size,
      turns: f.turns,
      sources: [...f.sources].sort(),
      lastSeen: f.last.toISOString().slice(0, 10),
      inCurrentCatalog: enCatalogo.has(pkg),
    }))
    .sort((a, b) => b.projects - a.projects || b.turns - a.turns || a.pkg.localeCompare(b.pkg));
}
