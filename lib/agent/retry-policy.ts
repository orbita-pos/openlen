// LA POLÍTICA DE REINTENTO DEL BUCLE, la del arnés de DeepSeek en su modo normal
// (`packages/llm/llm-retry` + `packages/llm/llm/src/retry-policy.ts`, MIT):
// cinco reintentos para límite de peticiones, servidor, transporte y respuesta
// vacía; espera exponencial de 500 ms a 10 s con un 10 % de azar simétrico.
// Ellos también reintentan en el BUCLE y no en el cliente: «un stream crudo no
// puede separar lo ya emitido».
import type { ProviderErrorCode } from "@/lib/ai/provider-error-code";

export const MAX_PROVIDER_RETRIES = 5;
const INITIAL_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;
const JITTER_RATIO = 0.1;

const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set(["rate_limit", "server", "transport", "empty_response"]);

export function isRetryable(code: ProviderErrorCode | undefined): boolean {
  return code !== undefined && RETRYABLE.has(code);
}

/** `retry` empieza en 1. La fórmula es la de `localDelay` de DeepSeek. */
export function retryDelayMs(retry: number, random: () => number = Math.random): number {
  const exponential = Math.min(INITIAL_DELAY_MS * 2 ** Math.min(retry - 1, 1024), MAX_DELAY_MS);
  const jitter = 1 - JITTER_RATIO + 2 * JITTER_RATIO * random();
  return Math.round(Math.min(exponential * jitter, MAX_DELAY_MS));
}

/** Espera que el ■ corta: al abortar, resuelve enseguida (quien llama mira la señal). */
export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
