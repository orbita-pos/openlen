/**
 * EL RELOJ DE SILENCIO del turno de Len (H1, 2026-09-25).
 *
 * Sustituye al reloj de PARED (`STREAM_TIMEOUT_MS = 360_000` en la ruta), que
 * cortaba un turno por durar, trabajara o no. Claude Code no pone plazo a un
 * turno: lo que detecta un cuelgue es el SILENCIO. Aquí igual: el reloj se
 * rearma con cada señal de vida —un evento del modelo, algo que se le manda al
 * dueño— y sólo dispara si pasa `ms` sin ninguna. Los latidos SSE del canal no
 * cuentan: son relleno para Caddy, no trabajo.
 */
export function relojDeSilencio(ms: number, alCallar: () => void): { vivo(): void; parar(): void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  let parado = false;
  const vivo = () => {
    if (parado) return;
    clearTimeout(t);
    t = setTimeout(alCallar, ms);
    (t as { unref?: () => void }).unref?.();
  };
  vivo();
  return {
    vivo,
    parar() {
      parado = true;
      clearTimeout(t);
    },
  };
}

/** Deja pasar cada evento tal cual y avisa de que hay vida. */
export async function* conSenales<T>(eventos: AsyncIterable<T>, vivo: () => void): AsyncIterable<T> {
  for await (const e of eventos) {
    vivo();
    yield e;
  }
}
