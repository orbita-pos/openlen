// ENLACES A REDES QUE EL MODELO SE INVENTA.
//
// Regla 🔴 del prompt del Agente (`catalog.ts`): «NO TE INVENTES LA CUENTA.
// "Agrégame un botón de TikTok" sin haberte dado nunca su usuario se resuelve
// con href="#" y una pregunta, jamás con tiktok.com/@sunegocio deducido del
// nombre». MEDIDO el 2026-08-31, tres veces seguidas: inventó
// `tiktok.com/@minegocio`.
//
// Hasta hoy la regla vivía SÓLO en el prompt, y su coste no es cosmético: un
// enlace inventado APARENTA funcionar. El visitante toca «Instagram», aterriza
// en la cuenta de otra persona o en un 404, y el dueño no se entera nunca —
// nadie revisa sus propios enlaces.
//
// QUÉ HACE Y QUÉ NO. Avisa, no rechaza. La diferencia importa: el modelo puede
// estar escribiendo un handle legítimo que el usuario le dio hace tres turnos y
// que ya no está en la ventana de conversación. Bloquear eso le costaría al
// dueño un cambio que sí pidió; avisar sólo le cuesta al modelo una frase.
//
// La prueba es de PROCEDENCIA, no de existencia: no se comprueba que la cuenta
// exista (eso exigiría salir a la red), sino que el handle venga de algún sitio
// —la página que ya había, lo que el usuario acaba de escribir, o su brief— y
// no de la imaginación del modelo.

/** Los dominios donde un handle inventado hace daño, con cuántos segmentos de
 *  ruta hay que saltar antes de llegar a él. `linkedin.com/in/juan` y
 *  `youtube.com/@canal` no se parecen, y tratarlos igual da handles como "in". */
const REDES: ReadonlyArray<{ readonly host: RegExp; readonly saltar: number }> = [
  { host: /(^|\.)instagram\.com$/i, saltar: 0 },
  { host: /(^|\.)tiktok\.com$/i, saltar: 0 },
  { host: /(^|\.)facebook\.com$/i, saltar: 0 },
  { host: /(^|\.)twitter\.com$/i, saltar: 0 },
  { host: /(^|\.)x\.com$/i, saltar: 0 },
  { host: /(^|\.)threads\.net$/i, saltar: 0 },
  { host: /(^|\.)youtube\.com$/i, saltar: 0 },
  { host: /(^|\.)twitch\.tv$/i, saltar: 0 },
  { host: /(^|\.)pinterest\.com$/i, saltar: 0 },
  { host: /(^|\.)t\.me$/i, saltar: 0 },
  { host: /(^|\.)wa\.me$/i, saltar: 0 },
  // `linkedin.com/in/<handle>` y `linkedin.com/company/<handle>`.
  { host: /(^|\.)linkedin\.com$/i, saltar: 1 },
];

export interface EnlaceInventado {
  readonly href: string;
  readonly red: string;
  readonly handle: string;
}

/** Todos los `href` de un documento. Regex y no parser: esto corre en el camino
 *  caliente de cada edición, y para leer atributos `href` la diferencia entre
 *  las dos es ruido frente a lo que ya cuesta el turno. */
function hrefsDe(html: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/** El handle de una URL de red social, o `null` si no es una de ellas (o si
 *  apunta a la raíz del sitio, que no identifica a nadie). */
export function handleDeRed(href: string): { red: string; handle: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    // Relativa, `#ancla`, `mailto:`, `tel:` — ninguna inventa una cuenta.
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const red = REDES.find((r) => r.host.test(u.hostname));
  if (!red) return null;

  const partes = u.pathname.split("/").filter(Boolean);
  const bruto = partes[red.saltar];
  if (!bruto) return null;
  // La arroba es notación, no parte del nombre: el usuario escribe «@juan» y el
  // modelo pone «/@juan», y compararlos con la arroba dentro no casaría nunca.
  const handle = decodeURIComponent(bruto).replace(/^@/, "").trim();
  return handle ? { red: u.hostname.replace(/^www\./i, ""), handle } : null;
}

/**
 * Los enlaces de red social que aparecen NUEVOS en `despues` y cuyo handle no
 * sale por ningún lado: ni en la página que ya había, ni en lo que el usuario
 * escribió, ni en su brief.
 *
 * `fuentes` son textos libres — el prompt del turno, el brief. Se buscan como
 * subcadena y sin distinguir mayúsculas, que es deliberadamente PERMISIVO: el
 * coste de un falso positivo (una frase de más del modelo) es mucho menor que
 * el de un falso negativo, pero el de acusar constantemente es que se ignore
 * el aviso. Ante la duda, callar.
 */
export function enlacesInventados(args: {
  readonly antes: string;
  readonly despues: string;
  readonly fuentes: readonly (string | null | undefined)[];
}): EnlaceInventado[] {
  const previos = new Set(hrefsDe(args.antes).map((h) => h.toLowerCase()));
  const texto = [args.antes, ...args.fuentes]
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .join("\n")
    .toLowerCase();

  const vistos = new Set<string>();
  const out: EnlaceInventado[] = [];
  for (const href of hrefsDe(args.despues)) {
    // Un enlace que ya estaba no lo inventó ESTE turno. Lo que llegara mal, lo
    // dirá el turno que lo puso; repetirlo en cada edición posterior convierte
    // el aviso en ruido de fondo.
    if (previos.has(href.toLowerCase())) continue;
    const r = handleDeRed(href);
    if (!r) continue;
    if (texto.includes(r.handle.toLowerCase())) continue;
    const clave = `${r.red}|${r.handle}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({ href, red: r.red, handle: r.handle });
  }
  return out;
}

/** La frase que se le devuelve al modelo. Dice qué hacer, no sólo qué pasó: un
 *  aviso sin salida se lee como una queja y se ignora. */
export function avisoEnlacesInventados(enlaces: readonly EnlaceInventado[]): string {
  const lista = enlaces.map((e) => `${e.red}/${e.handle}`).join(", ");
  return (
    `Has puesto ${enlaces.length} enlace(s) de red social cuyo usuario no aparece ni en la página ni en lo que te ha dicho el usuario: ${lista}. ` +
    `Si te lo has deducido del nombre del negocio, es una cuenta INVENTADA: aparenta funcionar y manda al visitante al perfil de otra persona. ` +
    `Déjalo en href="#" y PREGÚNTALE al usuario cuál es su cuenta. Si el usuario sí te lo dio antes, ignora este aviso.`
  );
}
