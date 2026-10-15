// A subcommand's options, read the way git's parse-options reads them: --long, --long=value,
// -abc (bundled flags), -mvalue / -m value, -5 for -n 5, and "--" before paths.

export interface OptionSpec {
  /** Options without a value: "--short", "-s". */
  readonly flags?: readonly string[];
  /** Options that take a value: "-m", "--format". */
  readonly values?: readonly string[];
  /** Value options that may repeat (all kept): "-m", "-e". The rest keep their last value. */
  readonly repeated?: readonly string[];
}

export interface Options {
  has(name: string): boolean;
  value(name: string): string | undefined;
  all(name: string): readonly string[];
  readonly positional: readonly string[];
  /** What came after "--"; `null` if there was no "--". */
  readonly afterDashDash: readonly string[] | null;
}

export class UnknownOption extends Error {
  constructor(readonly option: string) {
    super(option);
  }
}

export function parseOptions(args: readonly string[], spec: OptionSpec): Options {
  const flags = new Set(spec.flags ?? []);
  const values = new Set(spec.values ?? []);
  const seen = new Map<string, string[]>();
  const positional: string[] = [];
  let after: string[] | null = null;
  const put = (name: string, value: string) => seen.set(name, [...(seen.get(name) ?? []), value]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (after) {
      after.push(a);
      continue;
    }
    if (a === "--") {
      after = [];
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq < 0 ? a : a.slice(0, eq);
      if (values.has(name)) put(name, eq < 0 ? (args[++i] ?? "") : a.slice(eq + 1));
      else if (flags.has(a)) put(a, "");
      else throw new UnknownOption(a);
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      if (/^-\d+$/.test(a) && values.has("-n")) {
        put("-n", a.slice(1));
        continue;
      }
      for (let k = 1; k < a.length; k++) {
        const name = `-${a[k]}`;
        if (values.has(name)) {
          const rest = a.slice(k + 1);
          put(name, rest !== "" ? rest : (args[++i] ?? ""));
          break;
        }
        if (!flags.has(name)) throw new UnknownOption(name);
        put(name, "");
      }
      continue;
    }
    positional.push(a);
  }
  return {
    has: (name) => seen.has(name),
    value: (name) => seen.get(name)?.at(-1),
    all: (name) => seen.get(name) ?? [],
    positional,
    afterDashDash: after,
  };
}
