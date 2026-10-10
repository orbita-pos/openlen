// Los tipos de `format.mjs`.
import type { CheckDiagnostic } from "./checker-core.mjs";

/** Como `tsc --noEmit` sin TTY: `src/App.tsx(5,17): error TS2322: …`, una línea por error. */
export function formatTsc(diagnostics: readonly CheckDiagnostic[]): string;

/** Como el formateador `stylish` de ESLint. */
export function formatStylish(diagnostics: readonly CheckDiagnostic[]): string;
