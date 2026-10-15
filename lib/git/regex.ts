// git's pattern flavours as JavaScript RegExps: basic (git's default for grep and --grep),
// extended (-E), fixed (-F) and perl (-P, which JS mostly is).

const POSIX_CLASSES: Readonly<Record<string, string>> = {
  alpha: "a-zA-Z", digit: "0-9", alnum: "a-zA-Z0-9", upper: "A-Z", lower: "a-z",
  space: " \\t\\n\\r\\f\\v", blank: " \\t", punct: "!-\\/:-@\\[-`{-~", xdigit: "0-9A-Fa-f",
};

function posixClasses(source: string): string {
  return source.replace(/\[:([a-z]+):\]/g, (m, name: string) => POSIX_CLASSES[name] ?? m);
}

/** POSIX basic: ( ) { } | + ? are literal; \( \) \{ \} \| \+ \? are the operators (GNU). */
export function basicToJs(bre: string): string {
  let out = "";
  for (let i = 0; i < bre.length; i++) {
    const c = bre[i]!;
    if (c === "\\" && i + 1 < bre.length) {
      const next = bre[++i]!;
      if ("(){}|+?".includes(next)) out += next;
      else if (next === "<") out += "\\b(?=\\w)";
      else if (next === ">") out += "\\b(?<=\\w)";
      else out += `\\${next}`;
      continue;
    }
    out += "(){}|+?".includes(c) ? `\\${c}` : c;
  }
  return posixClasses(out);
}

export function extendedToJs(ere: string): string {
  return posixClasses(ere);
}

export interface PatternOptions {
  readonly fixed?: boolean;
  readonly extended?: boolean;
  readonly perl?: boolean;
  readonly ignoreCase?: boolean;
  readonly word?: boolean;
}

export function grepRegExp(patterns: readonly string[], o: PatternOptions): RegExp {
  const one = (p: string) => (o.fixed ? p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : o.extended || o.perl ? extendedToJs(p) : basicToJs(p));
  let source = patterns.map((p) => `(?:${one(p)})`).join("|");
  if (o.word) source = `(?<![A-Za-z0-9_])(?:${source})(?![A-Za-z0-9_])`;
  return new RegExp(source, o.ignoreCase ? "i" : "");
}
