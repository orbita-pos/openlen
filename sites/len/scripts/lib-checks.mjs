// Las puertas del contenido: funciones puras, sin disco ni git. check-content.mjs
// les da los datos. Cada una devuelve la lista de errores; vacía = pasa.

export const LANGS = ["en", "es"];

// Los nombres de modelos y proveedores caducan, y un post caducado es una
// mentira pública (le pasó a content/blog/the-models-behind-your-page.tsx).
export const MODELOS_PROHIBIDOS =
  /\b(gemini|gpt-?\d[\w.-]*|chatgpt|openai|anthropic|claude|qwen|deepseek|kimi|llama|mistral|fireworks|grok|fable|mythos|opus|sonnet|haiku)\b/i;

export function checkParity(files) {
  const errors = [];
  const bases = new Map();
  for (const f of files) {
    const m = f.match(/^(.*)\.(en|es)\.mdx$/);
    if (!m) {
      errors.push(`${f}: el nombre debe acabar en .en.mdx o .es.mdx`);
      continue;
    }
    const set = bases.get(m[1]) ?? new Set();
    set.add(m[2]);
    bases.set(m[1], set);
  }
  for (const [base, set] of bases) {
    for (const lang of LANGS) if (!set.has(lang)) errors.push(`${base}: falta la versión ${lang}`);
  }
  return errors;
}

export function extractCommits(src) {
  return [...src.matchAll(/commit="([0-9a-f]{7,40})"/g)].map((m) => m[1]);
}

export function checkCifrasSinCommit(src, file) {
  return [...src.matchAll(/<(?:Cifra|CifraGrande)\b[^>]*>/g)]
    .filter((m) => !/commit="[0-9a-f]{7,40}"/.test(m[0]))
    .map((m) => `${file}: <Cifra> sin commit — ${m[0]}`);
}

export function checkCommits(hashes, isPublic) {
  return [...new Set(hashes)]
    .filter((h) => !isPublic(h))
    .map((h) => `${h}: no existe o no está en origin/master`);
}

export function checkDenylist(src, file) {
  const m = src.match(MODELOS_PROHIBIDOS);
  return m ? [`${file}: nombra un modelo o proveedor («${m[0]}»)`] : [];
}

export function checkAbierto(src, file) {
  return /^research\//.test(file) && !/<Abierto[\s>]/.test(src)
    ? [`${file}: todo artículo lleva <Abierto>`]
    : [];
}

export function checkIndice(src, file) {
  const ids = [...src.matchAll(/indice:\s*\[([\s\S]*?)\]/g)].flatMap((m) =>
    [...m[1].matchAll(/id:\s*"([^"]+)"/g)].map((x) => x[1]),
  );
  return ids
    .filter((id) => !src.includes(`id="${id}"`))
    .map((id) => `${file}: el índice apunta a #${id} y no hay ningún id así`);
}

export function catalogToolNames(catalogSrc) {
  return [...catalogSrc.matchAll(/^\s+name:\s*"([a-z_]+)",?\s*$/gm)].map((m) => m[1]);
}

export function checkToolGroups(groups, catalogNames) {
  const errors = [];
  const listed = groups.flatMap((g) => g.herramientas);
  const seen = new Set();
  for (const n of listed) {
    if (seen.has(n)) errors.push(`repetida en la tarjeta: ${n}`);
    seen.add(n);
  }
  for (const n of catalogNames) if (!seen.has(n)) errors.push(`falta en la tarjeta: ${n}`);
  for (const n of seen) if (!catalogNames.includes(n)) errors.push(`no existe en el catálogo: ${n}`);
  return errors;
}

// ── Los números escritos a mano en la tarjeta ────────────────────────────────
//
// `checkToolGroups` compara NOMBRES, así que si el catálogo pasa de 27 a 28 la
// puerta obliga a tocar `herramientas.json` — y el titular sigue diciendo
// «Veintisiete». El total se calcula en `components/tarjeta-len.tsx`, pero sólo
// acaba en un atributo `data-total` que no se ve. Lo mismo vale para la `nota`
// de un grupo: los seis grupos sin nota derivan su número del JSON, y el que
// tiene nota lo lleva a mano.
//
// Un número caducado en el titular es una mentira pública, igual que un nombre
// de modelo. Así que se comprueba, en los dos idiomas.

const ES_U = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const ES_10 = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciseis", "diecisiete", "dieciocho", "diecinueve"];
const ES_20 = ["veinte", "veintiuno", "veintidos", "veintitres", "veinticuatro", "veinticinco", "veintiseis", "veintisiete", "veintiocho", "veintinueve"];
const ES_D = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const EN_U = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const EN_10 = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_D = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Las formas ACEPTADAS de escribir `n` con letra. Varias, porque «veintiún
 *  herramientas» y «veintiuno» son la misma cifra. Van sin tilde a propósito:
 *  la comparación normaliza. Fuera de 0–99 devuelve [] y entonces sólo vale el
 *  dígito — no vamos a tener novecientas herramientas. */
export function enPalabras(n, lang) {
  if (!Number.isInteger(n) || n < 0 || n > 99) return [];
  if (lang === "en") {
    if (n < 10) return [EN_U[n]];
    if (n < 20) return [EN_10[n - 10]];
    const d = EN_D[Math.floor(n / 10)];
    const u = n % 10;
    return u === 0 ? [d] : [`${d}-${EN_U[u]}`, `${d} ${EN_U[u]}`];
  }
  if (n < 10) return [ES_U[n]];
  if (n < 20) return [ES_10[n - 10]];
  if (n < 30) return n === 21 ? ["veintiuno", "veintiun"] : [ES_20[n - 20]];
  const d = ES_D[Math.floor(n / 10)];
  const u = n % 10;
  if (u === 0) return [d];
  return u === 1 ? [`${d} y uno`, `${d} y un`] : [`${d} y ${ES_U[u]}`];
}

/** Sin tildes y en minúscula, para que «Veintisiete» case con «veintisiete». */
export function normaliza(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** ¿Este texto nombra el número `n`, con cifra o con letra? */
export function mencionaEl(texto, n, lang) {
  const t = normaliza(texto);
  if (new RegExp(`(?<!\\d)${n}(?!\\d)`).test(t)) return true;
  return enPalabras(n, lang).some((p) => t.includes(p));
}

const HERRAMIENTAS = { es: "herramientas?", en: "tools?" };
const escapa = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/** ¿Nombra `n` HERRAMIENTAS? Pegado a la palabra, y ahí está el punto: la nota
 *  de «Mirar» dice «1 herramienta · 2 modos», así que buscar un «2» suelto la
 *  daría por buena aunque el grupo tuviera dos herramientas. El número tiene
 *  que ir donde significa lo que decimos que significa. */
export function mencionaHerramientas(texto, n, lang) {
  const t = normaliza(texto);
  const nombre = HERRAMIENTAS[lang] ?? HERRAMIENTAS.es;
  return [String(n), ...enPalabras(n, lang)].some((f) =>
    new RegExp(`(?<![\\w\\d])${escapa(f)}\\s+(?:${nombre})\\b`).test(t),
  );
}

/** El cuerpo de `clave: { … }`, contando llaves. Los diccionarios son TS, no
 *  JSON: no se pueden parsear, y un regex plano se comería el objeto vecino. */
export function bloqueDe(src, clave) {
  const abre = new RegExp(`(?:^|[\\s{,])${clave}:\\s*\\{`, "m").exec(src);
  if (!abre) return null;
  const i = src.indexOf("{", abre.index + abre[0].length - 1);
  let hondo = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") hondo++;
    else if (src[j] === "}" && --hondo === 0) return src.slice(i + 1, j);
  }
  return null;
}

/** El titular de la tarjeta tiene que nombrar el total REAL de herramientas. */
export function checkTitularTotal(src, file, total, lang) {
  const tarjeta = bloqueDe(src, "tarjeta");
  if (!tarjeta) return [`${file}: no encuentro el bloque «tarjeta»`];
  const m = /\btitulo:\s*"([^"]*)"/.exec(tarjeta);
  if (!m) return [`${file}: la tarjeta no tiene «titulo»`];
  return mencionaHerramientas(m[1], total, lang)
    ? []
    : [`${file}: el titular dice «${m[1]}» y las herramientas son ${total} — el número está a mano, actualízalo`];
}

/** Un grupo con `nota` escrita a mano tiene que nombrar sus herramientas. Los
 *  que no la llevan sacan el número del JSON solos y no se comprueban. */
export function checkNotasDeGrupo(src, file, groups, lang) {
  const tarjeta = bloqueDe(src, "tarjeta");
  const gruposSrc = tarjeta && bloqueDe(tarjeta, "grupos");
  if (!gruposSrc) return [`${file}: no encuentro los grupos de la tarjeta`];
  const errors = [];
  for (const g of groups) {
    const bloque = bloqueDe(gruposSrc, g.id);
    if (!bloque) {
      errors.push(`${file}: el grupo «${g.id}» está en el JSON y no en la tarjeta`);
      continue;
    }
    const nota = /\bnota:\s*"([^"]*)"/.exec(bloque);
    if (!nota) continue;
    const n = g.herramientas.length;
    if (!mencionaHerramientas(nota[1], n, lang))
      errors.push(`${file}: la nota de «${g.id}» dice «${nota[1]}» y el grupo tiene ${n} — está a mano, actualízala`);
  }
  return errors;
}
