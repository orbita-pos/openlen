// EL `.env` DE UNA APP, como lo lee dotenv (y por tanto Vite): `NOMBRE=valor`
// por línea, `#` para comentarios, `export ` delante, comillas simples, dobles
// (con `\n`) o backticks. Lo que dotenv ignora o corta EN SILENCIO —una línea
// sin `=`, unas comillas sin cerrar, un `#` pegado al valor— aquí es un error
// con su línea: un `.env` que no hace lo que parece es una trampa. Sin
// `${VAR}`. Sin dependencias: lo importan la carpeta, el compilador, la ruta y
// el diálogo.
import { describeSecretForModel, detectSecret } from "./secret-patterns";
import {
  ENV_NAME_RE,
  MAX_DOTENV_BYTES,
  MAX_ENV_NAME_LENGTH,
  MAX_ENV_NAMES,
  MAX_ENV_VALUE_BYTES,
  isPlatformEnvName,
  utf8Bytes,
} from "./rules";

export interface DotEnvEntry {
  readonly name: string;
  readonly value: string;
  readonly line: number;
}

export interface DotEnvError {
  readonly line: number;
  readonly message: string;
}

export interface DotEnvParse {
  /** En orden. Si un nombre se repite, `vars` se queda con el último, como dotenv. */
  readonly entries: readonly DotEnvEntry[];
  readonly vars: Readonly<Record<string, string>>;
  readonly errors: readonly DotEnvError[];
}

const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;

export function parseDotEnv(text: string): DotEnvParse {
  const entries: DotEnvEntry[] = [];
  const errors: DotEnvError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const m = LINE.exec(trimmed);
    if (!m) {
      errors.push({ line, message: `line ${line} is not NAME=value` });
      return;
    }
    const name = m[1]!;
    const rawRest = m[2]!;
    const rest = rawRest.trimStart();
    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      const end = rest.indexOf(quote, 1);
      if (end === -1) {
        errors.push({ line, message: `line ${line}: the ${quote} quote is not closed on the same line` });
        return;
      }
      const after = rest.slice(end + 1).trim();
      if (after !== "" && !after.startsWith("#")) {
        errors.push({ line, message: `line ${line}: there is text after the closing ${quote} quote` });
        return;
      }
      const inner = rest.slice(1, end);
      entries.push({ name, value: quote === '"' ? inner.replace(/\\n/g, "\n") : inner, line });
      return;
    }
    // Sin comillas, `#` empieza un comentario, como en dotenv. Pegado al valor
    // (`#fff`, `https://x.com/#/a`) dotenv lo cortaría en silencio: aquí se dice.
    const hash = rawRest.indexOf("#");
    if (hash !== -1 && (hash === 0 || !/\s/.test(rawRest[hash - 1]!))) {
      errors.push({ line, message: `line ${line}: # starts a comment here, so the value would be cut; quote it: ${name}="${rawRest.trim()}"` });
      return;
    }
    entries.push({ name, value: (hash === -1 ? rawRest : rawRest.slice(0, hash)).trim(), line });
  });
  const vars: Record<string, string> = {};
  for (const e of entries) vars[e.name] = e.value;
  return { entries, vars, errors };
}

/** Lo que de un `/.env` llega a `import.meta.env`: sólo los `VITE_*` (el `envPrefix` de Vite). */
export function dotEnvPublicVars(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parseDotEnv(text).vars)) if (ENV_NAME_RE.test(name)) out[name] = value;
  return out;
}

/** Por qué `/.env` no se guarda, o `null` si vale. Lo lee Len, en inglés, detrás
 *  de «Cannot save /.env: »: por eso no lleva la ruta delante. */
export function dotEnvSaveProblem(content: string): string | null {
  if (utf8Bytes(content) > MAX_DOTENV_BYTES) return `it is larger than ${MAX_DOTENV_BYTES / 1024} KB.`;
  const { entries, errors } = parseDotEnv(content);
  const first = errors[0];
  if (first) return `${first.message}.`;
  const names = new Set<string>();
  for (const e of entries) {
    names.add(e.name);
    const at = `line ${e.line}: ${e.name}`;
    if (!ENV_NAME_RE.test(e.name)) {
      return `${at} would never reach the app — only VITE_ variables reach import.meta.env, as in Vite, and there is no server here that would read the others.`;
    }
    if (e.name.length > MAX_ENV_NAME_LENGTH) return `${at} is longer than ${MAX_ENV_NAME_LENGTH} characters.`;
    if (isPlatformEnvName(e.name)) return `${at} is set by OpenLen (the project's backend) and can't be changed.`;
    if (utf8Bytes(e.value) > MAX_ENV_VALUE_BYTES) return `${at}: its value is larger than ${MAX_ENV_VALUE_BYTES / 1024} KB.`;
    const kind = detectSecret(e.name, e.value);
    if (kind) {
      return `${at} ${describeSecretForModel(kind)}. Everything in /.env ends up in the JavaScript any visitor can read, so a secret never goes there: it needs code that runs on a server, and Edge Functions don't exist here yet.`;
    }
  }
  if (names.size > MAX_ENV_NAMES) return `it has more than ${MAX_ENV_NAMES} variables.`;
  return null;
}
