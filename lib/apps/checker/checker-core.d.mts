// Los tipos de `checker-core.mjs` (JS plano: lo carga un Worker tal cual).
// `CheckDiagnostic` es asignable a `Diagnostico` (lib/agent/diagnosticos.ts).

export interface CheckDiagnostic {
  readonly ruta: string;
  readonly linea: number;
  readonly columna: number;
  readonly gravedad: "Error" | "Warning";
  readonly mensaje: string;
  readonly codigo: string;
  readonly fuente: "typescript" | "eslint";
}

export interface CheckResult {
  readonly typescript: CheckDiagnostic[];
  readonly eslint: CheckDiagnostic[];
}

export function checkApp(input: {
  readonly files: Readonly<Record<string, string>>;
  readonly typesPack: Readonly<Record<string, string>>;
}): CheckResult;

/** Como `tsc --noEmit` sin TTY: `src/App.tsx(5,17): error TS2322: …`, una línea por error. */
export function formatTsc(diagnostics: readonly CheckDiagnostic[]): string;

/** Como el formateador `stylish` de ESLint. */
export function formatStylish(diagnostics: readonly CheckDiagnostic[]): string;
