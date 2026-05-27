// Shadow-soak harness for the TS → Rust migration.
//
// Runs a TS implementation and a Rust implementation of the same function in
// the same call, compares the outputs structurally, logs divergences as
// single-line JSON, and returns whichever the configured mode chooses.
//
// Modes:
//   - "ts":                 only run TS, return TS (legacy behaviour)
//   - "rust":               only run Rust, return Rust (cutover)
//   - "shadow-prefer-ts":   run both, log divergences, return TS (safe shadow — default)
//   - "shadow-prefer-rust": run both, log divergences, return Rust (aggressive shadow)
//
// Mode resolution per call:
//   1. process.env.OPENLEN_SHADOW_<NAME> if it parses as a ShadowMode
//   2. process.env.OPENLEN_SHADOW_MODE   if it parses as a ShadowMode
//   3. options.fallbackMode (defaults to "shadow-prefer-ts")
//
// `<NAME>` is the call-site name uppercased with non-[A-Z0-9_] replaced by
// `_`. So shadowCompare("sanitize-filled-html", ...) looks at
// `OPENLEN_SHADOW_SANITIZE_FILLED_HTML`.
//
// Divergence detection is structural-deep-equal on the returned values; if
// either side throws, an error-shape mismatch (one threw / other didn't, or
// thrown messages differ) also counts as divergence.

export type ShadowMode =
  | "ts"
  | "rust"
  | "shadow-prefer-ts"
  | "shadow-prefer-rust";

export interface ShadowDivergenceRecord {
  /** Call-site name (e.g. "sanitize-filled-html"). */
  name: string;
  /** Compact human-readable args summary (capped). */
  argsSummary: string;
  /** Stable JSON-ish preview of the TS value or thrown error (capped). */
  tsValuePreview: string;
  /** Stable JSON-ish preview of the Rust value or thrown error (capped). */
  rustValuePreview: string;
  /** byte length of TS result (string.length for strings, JSON length else). */
  tsBytes: number;
  rustBytes: number;
  /** TS wall-clock millis. */
  tsMillis: number;
  /** Rust wall-clock millis. */
  rustMillis: number;
  /** True if one side threw and the other didn't, OR both threw with different messages. */
  errorShapeMismatch: boolean;
}

export interface ShadowLogger {
  onDivergence(record: ShadowDivergenceRecord): void;
}

export interface ShadowCompareOptions {
  fallbackMode?: ShadowMode;
  /** Per-call logger override. When unset, uses the module-level logger. */
  logger?: ShadowLogger;
  /** Custom equality predicate. When set, replaces the default deep-equal. */
  equalityFn?: (tsValue: unknown, rustValue: unknown) => boolean;
}

const DEFAULT_LOGGER: ShadowLogger = {
  onDivergence(record) {
    // Single-line JSON for log aggregator ingestion.
    // eslint-disable-next-line no-console
    console.warn("[shadow-soak] divergence " + JSON.stringify(record));
  },
};

let moduleLogger: ShadowLogger = DEFAULT_LOGGER;

/** Replace the module-level logger. Pass `null` to reset to the default. */
export function setShadowLogger(logger: ShadowLogger | null): void {
  moduleLogger = logger ?? DEFAULT_LOGGER;
}

export function shadowCompare<T>(
  name: string,
  argsSummary: string,
  tsImpl: () => T,
  rustImpl: () => T,
  options: ShadowCompareOptions = {},
): T {
  const mode = resolveMode(name, options.fallbackMode ?? "shadow-prefer-ts");
  if (mode === "ts") return tsImpl();
  if (mode === "rust") return rustImpl();

  // Shadow modes — run both impls.
  const tsStart = nowMillis();
  let tsValue: T;
  let tsError: unknown = undefined;
  try {
    tsValue = tsImpl();
  } catch (err) {
    tsError = err;
    tsValue = undefined as unknown as T;
  }
  const tsMillis = nowMillis() - tsStart;

  const rustStart = nowMillis();
  let rustValue: T;
  let rustError: unknown = undefined;
  try {
    rustValue = rustImpl();
  } catch (err) {
    rustError = err;
    rustValue = undefined as unknown as T;
  }
  const rustMillis = nowMillis() - rustStart;

  const equality = options.equalityFn ?? deepEqual;
  const { diverged, errorShapeMismatch } = compareOutcomes(
    tsValue,
    tsError,
    rustValue,
    rustError,
    equality,
  );

  if (diverged) {
    const logger = options.logger ?? moduleLogger;
    logger.onDivergence({
      name,
      argsSummary: capStr(argsSummary, 200),
      tsValuePreview: capStr(stableStringify(tsError ?? tsValue), 2048),
      rustValuePreview: capStr(stableStringify(rustError ?? rustValue), 2048),
      tsBytes: byteLen(tsValue),
      rustBytes: byteLen(rustValue),
      tsMillis,
      rustMillis,
      errorShapeMismatch,
    });
  }

  if (mode === "shadow-prefer-ts") {
    if (tsError !== undefined) throw tsError;
    return tsValue;
  }
  // shadow-prefer-rust
  if (rustError !== undefined) throw rustError;
  return rustValue;
}

/** Async variant of `shadowCompare`. Same mode-resolution + divergence +
 *  logging semantics; awaits both arms before comparing. Either arm may
 *  return a plain `T` or a `Promise<T>` — the harness awaits transparently.
 *  Used for migrations whose TS impl is async (e.g. postcss/tailwindcss in
 *  `lib/publish/optimize-html.ts`). The tail logic is duplicated from
 *  `shadowCompare` rather than refactored into a shared helper so the
 *  sync surface and its 20 existing tests stay byte-equal. */
export async function asyncShadowCompare<T>(
  name: string,
  argsSummary: string,
  tsImpl: () => Promise<T> | T,
  rustImpl: () => Promise<T> | T,
  options: ShadowCompareOptions = {},
): Promise<T> {
  const mode = resolveMode(name, options.fallbackMode ?? "shadow-prefer-ts");
  if (mode === "ts") return tsImpl();
  if (mode === "rust") return rustImpl();

  const tsStart = nowMillis();
  let tsValue: T;
  let tsError: unknown = undefined;
  try {
    tsValue = await tsImpl();
  } catch (err) {
    tsError = err;
    tsValue = undefined as unknown as T;
  }
  const tsMillis = nowMillis() - tsStart;

  const rustStart = nowMillis();
  let rustValue: T;
  let rustError: unknown = undefined;
  try {
    rustValue = await rustImpl();
  } catch (err) {
    rustError = err;
    rustValue = undefined as unknown as T;
  }
  const rustMillis = nowMillis() - rustStart;

  const equality = options.equalityFn ?? deepEqual;
  const { diverged, errorShapeMismatch } = compareOutcomes(
    tsValue,
    tsError,
    rustValue,
    rustError,
    equality,
  );

  if (diverged) {
    const logger = options.logger ?? moduleLogger;
    logger.onDivergence({
      name,
      argsSummary: capStr(argsSummary, 200),
      tsValuePreview: capStr(stableStringify(tsError ?? tsValue), 2048),
      rustValuePreview: capStr(stableStringify(rustError ?? rustValue), 2048),
      tsBytes: byteLen(tsValue),
      rustBytes: byteLen(rustValue),
      tsMillis,
      rustMillis,
      errorShapeMismatch,
    });
  }

  if (mode === "shadow-prefer-ts") {
    if (tsError !== undefined) throw tsError;
    return tsValue;
  }
  // shadow-prefer-rust
  if (rustError !== undefined) throw rustError;
  return rustValue;
}

function resolveMode(name: string, fallback: ShadowMode): ShadowMode {
  const slug = "OPENLEN_SHADOW_" + name.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const perCall = process.env[slug];
  if (isShadowMode(perCall)) return perCall;
  const global = process.env.OPENLEN_SHADOW_MODE;
  if (isShadowMode(global)) return global;
  return fallback;
}

function isShadowMode(v: string | undefined): v is ShadowMode {
  return (
    v === "ts" ||
    v === "rust" ||
    v === "shadow-prefer-ts" ||
    v === "shadow-prefer-rust"
  );
}

function compareOutcomes<T>(
  tsValue: T,
  tsError: unknown,
  rustValue: T,
  rustError: unknown,
  equality: (a: unknown, b: unknown) => boolean,
): { diverged: boolean; errorShapeMismatch: boolean } {
  const tsThrew = tsError !== undefined;
  const rustThrew = rustError !== undefined;
  if (tsThrew !== rustThrew) {
    return { diverged: true, errorShapeMismatch: true };
  }
  if (tsThrew && rustThrew) {
    const same = errMsg(tsError) === errMsg(rustError);
    return { diverged: !same, errorShapeMismatch: !same };
  }
  return {
    diverged: !equality(tsValue, rustValue),
    errorShapeMismatch: false,
  };
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).sort();
  const bKeys = Object.keys(bObj).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
  }
  for (const k of aKeys) {
    if (!deepEqual(aObj[k], bObj[k])) return false;
  }
  return true;
}

function stableStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => {
      if (val === undefined) return null;
      if (typeof val === "string" && val.length > 200) {
        return val.slice(0, 200) + "…";
      }
      return val;
    });
  } catch {
    return String(v);
  }
}

function capStr(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function byteLen(v: unknown): number {
  if (typeof v === "string") return v.length;
  if (v == null) return 0;
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
}

function nowMillis(): number {
  return performance.now();
}
