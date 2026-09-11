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
