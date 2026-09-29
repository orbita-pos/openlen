// lib/agent/datos-inventados.ts — precios, cifras y reseñas que nadie dio (H13).
//
// 🔴 EL FALLO QUE CIERRA. Una página enseña «4,9 ★ en 312 reseñas», «más de
// 4.800 viajeros» o tres testimonios con nombre, y nada de eso lo dio el
// usuario. Aparenta ser cierto: el visitante se lo cree y el usuario no lo
// revisa. Producción, 19–21/09 (la agencia de viajes: diez testimonios con
// nombre); Len-Bench, `resenas-que-no-dio` #3 del 27/09 (tres «reseñas de
// arranque» presentadas como reales).
//
// La regla ya está en el prompt («lo que no puedes decidir por él… no se
// inventa»), y con los enlaces pasó lo mismo: el modelo lee la regla, dice que
// la cumple y hace otra cosa. Por eso, como `enlaces-inventados` y
// `prefijo-inventado`, un DETECTOR: avisa, no rechaza. El dato pudo darlo el
// usuario hace tres turnos, fuera de lo que esto ve, y bloquearlo le costaría
// un cambio que sí pidió; avisar sólo le cuesta al modelo una frase.
//
// La prueba es de PROCEDENCIA, no de verdad: el dato tiene que salir de algún
// sitio —lo que dijo el usuario, su brief, cualquier fichero de su sitio tal
// como estaba al empezar el turno (también sus almacenes y su memoria)—. Las
// fuentes se leen ENTERAS, con su JavaScript y sus atributos: un precio que
// estaba en el carrito del script y Len pasa al texto no lo inventó él. Lo que
// se vigila es sólo lo VISIBLE que esta escritura añade. Ante la duda, callar:
// un aviso que salta sin motivo enseña a ignorarlos todos.
//
// No se importa nada de `lib/len-bench/`: la vara mide a Len y no puede
// compartir el ojo con él, o lo que éste no vea tampoco lo vería ella.

export type TipoDeDato = "precio" | "cifra" | "reseña";

export interface DatoInventado {
  readonly tipo: TipoDeDato;
  /** Tal como está en la página: «$450», «más de 4.800 clientes», el principio de la reseña. */
  readonly texto: string;
}

// ── Texto ──────────────────────────────────────────────────────────────────

const ENTIDADES: Readonly<Record<string, string>> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  euro: "€",
  pound: "£",
  star: "☆",
};

function sinEntidades(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTIDADES[n.toLowerCase()] ?? m);
}

/**
 * Lo que un visitante lee, con un espacio entre nodos. El `textoVisible` del
 * motor de páginas junta los nodos sin separador —es lo correcto para saber si
 * la copia cambió—, pero aquí dos celdas «450» y «500» se leerían «450500».
 */
export function textoLeible(html: string): string {
  return sinEntidades(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Sin mayúsculas, acentos ni puntuación: para comparar citas. */
function llano(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

// ── Números ────────────────────────────────────────────────────────────────

/**
 * Una cifra en una sola forma: «4,9» y «4.9» son la misma nota; «1.240»,
 * «1,240» y «1240», las mismas reseñas; «450.00», «450». Si cada grupo tras el
 * primero tiene 3 cifras, los separadores son de miles.
 */
export function unaCifra(crudo: string): string {
  const limpio = crudo.replace(/\s/g, "");
  const seps = limpio.match(/[.,]/g) ?? [];
  if (seps.length === 0) return String(Number(limpio));
  const grupos = limpio.split(/[.,]/);
  if (new Set(seps).size === 1 && grupos.slice(1).every((g) => g.length === 3)) return String(Number(grupos.join("")));
  const ultimo = seps[seps.length - 1]!;
  const corte = limpio.lastIndexOf(ultimo);
  return String(Number(`${limpio.slice(0, corte).replace(/[.,]/g, "")}.${limpio.slice(corte + 1)}`));
}

/** Todos los números de un texto, en su forma única. */
function numerosDe(texto: string): Set<string> {
  return new Set([...texto.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => unaCifra(m[0])));
}

/**
 * Los números de una FUENTE: su texto, su JavaScript y sus datos, pero no su
 * estilo. Un `<style>`, un `class="text-[13.5px] mt-38"` o un `style="…"`
 * están llenos de números que no dicen nada del negocio, y darlos por dados
 * tapaba el precio inventado que casara con uno (medido en las grabaciones:
 * una «Tostada $38» que nadie dio pasaba por el «38» de una clase).
 */
function numerosDeFuente(texto: string): Set<string> {
  return numerosDe(
    texto
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
      // Sólo DENTRO de una etiqueta. Suelto sobre el texto, unas comillas sin
      // cerrar del mensaje del usuario se emparejaban con otras de más abajo y
      // se comían lo de en medio, con su precio (medido: el «$6,200,000» que
      // dictó el dueño de `propiedad-vendida` salía como inventado).
      .replace(/<[a-z][^<>]*>/gi, (etiqueta) =>
        etiqueta.replace(/\s(?:class|style|width|height|viewBox|d|points|transform|x|y|cx|cy|r)\s*=\s*("[^"]*"|'[^']*')/gi, " "),
      ),
  );
}

// ── Precios ────────────────────────────────────────────────────────────────

const IMPORTE = String.raw`(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const PRECIO_DELANTE = new RegExp(String.raw`(?:US\$|MX\$|\$|€|£|MXN\s?\$?|USD\s?\$?)\s?${IMPORTE}`, "gi");
const PRECIO_DETRAS = new RegExp(
  String.raw`${IMPORTE}\s?(?:€|euros?\b|pesos\b|MXN\b|USD\b|d[oó]lares\b|soles\b|COP\b|ARS\b|CLP\b)`,
  "gi",
);

interface Hallado {
  readonly texto: string;
  readonly cifra: string;
}

function preciosDe(texto: string): Hallado[] {
  const out: Hallado[] = [];
  for (const re of [PRECIO_DELANTE, PRECIO_DETRAS]) {
    for (const m of texto.matchAll(re)) out.push({ texto: m[0].trim(), cifra: unaCifra(m[1]!) });
  }
  return out;
}

/**
 * ¿Lo pudo CALCULAR la página con lo dado? Un total de 3 × $150; $150 con el
 * 10 % que dijo el usuario («les baja 10 %»); o sus precios con el 10 % de
 * subida y redondeados «para arriba a los 10 céntimos» (`sube-todo-diez`: 4,20 €
 * pasa a 4,70 €). No es un dato nuevo del negocio. Estrecho a propósito:
 * cantidades de 2 a 20, porcentajes dados de 1 a 90, y los redondeos de
 * siempre (céntimos, décimos, enteros).
 */
function calculado(cifra: string, dados: ReadonlySet<string>): boolean {
  const c = Number(cifra);
  if (!Number.isFinite(c) || c <= 0) return false;
  const valores = [...dados].map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const porcentajes = valores.filter((n) => n >= 1 && n <= 90);
  const redondeos = (x: number) => [
    x,
    Math.round(x * 100) / 100,
    Math.round(x * 10) / 10,
    Math.ceil(x * 10 - 1e-9) / 10,
    Math.floor(x * 10 + 1e-9) / 10,
    Math.round(x),
    Math.ceil(x - 1e-9),
    Math.floor(x + 1e-9),
  ];
  const casi = (x: number) => redondeos(x).some((r) => Math.abs(r - c) < 0.011);
  for (const p of valores) {
    for (const q of porcentajes) {
      if (casi((p * (100 - q)) / 100) || casi((p * (100 + q)) / 100) || casi((p * q) / 100)) return true;
    }
    if (p >= c) continue;
    const veces = c / p;
    if (veces >= 2 && veces <= 20 && Math.abs(veces - Math.round(veces)) < 1e-9) return true;
  }
  return false;
}

// ── Cifras que afirman algo del negocio ────────────────────────────────────

const COSAS =
  "clientes|pacientes|alumnos|estudiantes|proyectos|eventos|viajeros|familias|usuarios|pedidos|ventas|bodas|casos|personas|empresas|seguidores|reseñas|opiniones|valoraciones|visitantes|servicios|platos|comensales|customers|clients|students|projects|events|users|orders|reviews|followers|guests|travelers|travellers";
const CIFRA = String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d)?)`;

/**
 * Las formas con las que una página AFIRMA algo del negocio. Estrechas a
 * propósito: un «Paso 3», «300 g», «Top 10» o el «© 2026» del pie no afirman
 * nada, y llenarían el aviso de ruido.
 */
const AFIRMACIONES: readonly RegExp[] = [
  // «desde 2019», «desde el año 2019», «fundada en 2012», «since 2015».
  new RegExp(String.raw`\b(?:desde\s+(?:el\s+)?(?:a[ñn]o\s+)?|fundad[oa]s?\s+en\s+|since\s+|established\s+in\s+|founded\s+in\s+)((?:19|20)\d{2})\b`, "gi"),
  // «20 años de experiencia», «15+ years of experience».
  new RegExp(String.raw`\b(\d{1,3})\s*\+?\s+(?:a[ñn]os\s+de\s+(?:experiencia|trayectoria|historia)|years?\s+of\s+(?:experience|history))`, "gi"),
  // «más de 4.800 clientes», «+500 proyectos», «over 1,200 customers».
  new RegExp(String.raw`(?:\bm[aá]s\s+de\s+|\bover\s+|\bmore\s+than\s+|\+\s?)${CIFRA}\s*(?:mil\s+|k\s+)?(?:\p{L}+\s+){0,2}?(?:${COSAS})\b`, "giu"),
  // «4.800 clientes satisfechos», «1,200 happy customers».
  new RegExp(String.raw`\b${CIFRA}\s*\+?\s+(?:(?:${COSAS})\s+(?:satisfech[oa]s|felices|atendid[oa]s)|(?:happy|satisfied)\s+(?:${COSAS}))`, "giu"),
  // «4,9 ★», «4.8/5», «4,9 de 5», «4.9 estrellas».
  new RegExp(String.raw`\b([1-5][.,]\d)\s*(?:★|⭐|\/\s*5\b|de\s+5\b|estrellas|stars)`, "gi"),
  new RegExp(String.raw`(?:★|⭐)\s*([1-5][.,]\d)\b`, "g"),
  // «en 312 reseñas», «1.240 opiniones», «500 reviews».
  new RegExp(String.raw`\b${CIFRA}\s+(?:reseñas|opiniones|valoraciones|calificaciones|reviews|ratings)\b`, "giu"),
  // «98 % de satisfacción», «99% satisfaction».
  new RegExp(String.raw`\b(\d{2,3}(?:[.,]\d)?)\s?%\s+(?:de\s+)?(?:satisfacci[oó]n|clientes\s+satisfechos|recomendaci[oó]n|[eé]xito|satisfaction|satisfied)`, "gi"),
];

function afirmacionesDe(texto: string): Hallado[] {
  const out: Hallado[] = [];
  for (const re of AFIRMACIONES) {
    for (const m of texto.matchAll(re)) out.push({ texto: m[0].trim(), cifra: unaCifra(m[1]!) });
  }
  return out;
}

// ── Reseñas ────────────────────────────────────────────────────────────────

/**
 * Lo que se presenta como la opinión de alguien: un `<blockquote>` (su parte
 * entre comillas, si la hay: el autor de debajo no es la reseña), o un texto
 * entre comillas FIRMADO («…» — Lucía M.). Unas comillas sin firma no cuentan:
 * un eslogan entrecomillado en la portada no es una reseña.
 */
function resenasDe(html: string): string[] {
  const deBloques = [...html.matchAll(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi)].map((m) => {
    const t = textoLeible(m[1]!);
    return /[“"«]([^”"»]{15,400})[”"»]/.exec(t)?.[1] ?? t.replace(/\s[—–-]\s.*$/, "");
  });
  const firmadas = [...textoLeible(html).matchAll(/[“"«]([^”"»]{15,400})[”"»]\s*[—–-]\s*\p{Lu}/gu)].map((m) => m[1]!);
  return [...deBloques, ...firmadas].map((c) => c.replace(/\s+/g, " ").trim()).filter((c) => llano(c).split(" ").length >= 5);
}

function recortar(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

// ── El detector ────────────────────────────────────────────────────────────

/**
 * Los precios, las cifras que afirman algo del negocio y las reseñas que
 * aparecen NUEVOS y visibles en `despues` y no salen de ninguna fuente.
 *
 * `fuentes` son textos libres y se leen enteros: lo que dijo el usuario, su
 * brief, el sitio como estaba al empezar el turno. Lo que ya estaba en `antes`
 * no lo inventó ESTA escritura: lo dirá, si acaso, la que lo puso.
 */
export function datosInventados(args: {
  readonly antes: string;
  readonly despues: string;
  readonly fuentes: readonly (string | null | undefined)[];
}): DatoInventado[] {
  const fuentes = [args.antes, ...args.fuentes].filter((t): t is string => typeof t === "string" && t.length > 0);
  const crudo = sinEntidades(fuentes.join("\n"));
  // Cada fuente por su lado: lo que se limpia de una no puede tocar a otra.
  const dados = new Set(fuentes.flatMap((f) => [...numerosDeFuente(sinEntidades(f))]));
  const citasDadas = llano(crudo);
  const leibleAntes = textoLeible(args.antes);
  const numerosAntes = numerosDe(leibleAntes);
  // Sin los <select>: sus opciones («Desde $450.000», «Más de 2.000.000 €») son
  // lo que ELIGE el visitante —su presupuesto, un filtro—, no un dato del
  // negocio. La misma excepción que aprendió la vara (calibración del 24/09).
  const leible = textoLeible(args.despues.replace(/<select\b[\s\S]*?<\/select>/gi, " "));

  const out: DatoInventado[] = [];
  const vistos = new Set<string>();
  const anotar = (tipo: TipoDeDato, texto: string, clave: string) => {
    const k = `${tipo}|${clave}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    out.push({ tipo, texto });
  };

  for (const p of preciosDe(leible)) {
    if (p.cifra === "0" || numerosAntes.has(p.cifra) || dados.has(p.cifra) || calculado(p.cifra, dados)) continue;
    anotar("precio", p.texto, p.cifra);
  }
  for (const a of afirmacionesDe(leible)) {
    if (numerosAntes.has(a.cifra) || dados.has(a.cifra)) continue;
    anotar("cifra", a.texto, a.cifra);
  }
  const citasAntes = llano(leibleAntes);
  for (const r of resenasDe(args.despues)) {
    const l = llano(r);
    if (citasAntes.includes(l) || citasDadas.includes(l)) continue;
    anotar("reseña", recortar(r), l);
  }
  return out;
}
