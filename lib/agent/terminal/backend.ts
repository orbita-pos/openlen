// What `bash` (herramienta.ts) needs from a terminal: today's (`TerminalDeLen`, an interpreter in a
// worker thread) and the real one (`SandboxTerminal`, a box on E2B; spec local
// 2026-10-21-real-terminal-e2b). Exactly the methods herramienta.ts already used.

import type { SalidaDeUnComando } from "./terminal";

export interface TerminalBackend {
  ejecutar(command: string, o?: { readonly timeoutMs?: number; readonly background?: boolean }): Promise<SalidaDeUnComando>;
  refrescarPerezosos(): Promise<void>;
  poner(ficheros: Readonly<Record<string, string | null>>): Promise<void>;
  cerrar(): Promise<void>;
}
