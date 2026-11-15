/**
 * THE REASONER AND THE VISION ROLE ON TWO PROVIDERS (2026-11-15), the way Len's turns already were since 17/10.
 *
 * Len's brain picks its provider per turn (`lib/agent/brain.ts`); every OTHER call to the model — translating on
 * publish, the published page's assistant, the classic Chat, the app's AI, the template fillers — went through
 * `createFireworksStreamClient()` with no options, which is Fireworks and nothing else: no fallback, and twice
 * DeepInfra's list price on the output. This client is the same `FireworksStreamClient` shape with the provider
 * chosen by the POLICY: the operation names its role, the role names its providers (`providers` in
 * `lib/generation/model-policy.ts`), `OPENLEN_AGENT_PROVIDERS` says which are on.
 *
 * ONE CALL, NOT A TURN. The brain's fallback lives inside a loop that retries; these calls are one shot, so the
 * rule is the simple half of the brain's:
 *   · the call moves to the next provider only while NOTHING has reached the caller — no text, no reasoning, no
 *     call. After the first word the error passes through: a caller that already shows half a translation cannot
 *     be handed a second one from the start;
 *   · a context overflow never moves (same model, same window), and neither does the caller's own abort;
 *   · a 402 (no balance) cools the provider for everybody (`lib/agent/provider-health.ts`), as in the brain;
 *   · with a provider behind, one that sends no event at all within the first-event deadline is cut and the call
 *     moves — the brain's 60 s.
 *
 * WHO SERVED IT travels on the `usage` event (`provider`, `model`), because the spend ledger prices a row by
 * `provider/model` (`lib/ai/cost-rates.ts`): a DeepInfra call written down as Fireworks would cost OpenLen twice
 * what it did (`servedBy`, `lib/ai/providers.ts`, writes it down). The user's CHARGE does not move — it reads the
 * role's `creditRate`, as for Len.
 */
import { coolDown, isCooling } from "@/lib/agent/provider-health";
import { modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";
import {
  createFireworksStreamClient,
  type FireworksStopReason,
  type FireworksStreamClient,
  type FireworksStreamEvent,
} from "./fireworks-stream-client";
import { resolveRoleProviders, type ProviderId, type ResolvedProvider } from "./providers";

/** The brain's `FIRST_EVENT_TIMEOUT_MS`, for one call. Only armed with a provider behind: alone, nothing cuts a
 *  call that the caller's own deadline does not. */
export const ROLE_FIRST_EVENT_TIMEOUT_MS = 60_000;

export interface RoleStreamClientOptions {
  /** Keys and `OPENLEN_AGENT_PROVIDERS`. Default: `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  /** Narrows the role's providers without reordering them, like the brain's `providers` (the security review
   *  passes `["fireworks"]`). */
  readonly providers?: readonly ProviderId[];
  /** Only for tests. */
  readonly firstEventTimeoutMs?: number;
}

type UsageEvent = Extract<FireworksStreamEvent, { type: "usage" }>;

/** What reached the caller once any of these went out: from then on the call stays where it is. */
const DELIVERED: ReadonlySet<FireworksStreamEvent["type"]> = new Set([
  "text_delta",
  "reasoning_delta",
  "function_call_delta",
  "function_call",
  "function_call_cut",
]);

/** Whether a call that ended this way, before delivering anything, goes to the next provider. */
function movesOn(stop: FireworksStopReason, timedOut: boolean, ownerStopped: boolean): boolean {
  if (ownerStopped) return false;
  if (stop.kind === "error") return stop.code !== "context_window_exceeded";
  return stop.kind === "cancelled" && timedOut;
}

export function createRoleStreamClient(options: RoleStreamClientOptions = {}): FireworksStreamClient {
  const env = options.env ?? process.env;
  const timeoutMs = options.firstEventTimeoutMs ?? ROLE_FIRST_EVENT_TIMEOUT_MS;
  const fetchOption = options.fetchImpl ? { fetchImpl: options.fetchImpl } : {};
  const clients = new Map<ProviderId, FireworksStreamClient>();
  const clientFor = (provider: ResolvedProvider): FireworksStreamClient => {
    const made =
      clients.get(provider.id) ??
      createFireworksStreamClient({
        apiKey: provider.apiKey,
        endpoint: provider.dialect.endpoint,
        modelId: provider.modelId,
        affinityField: provider.dialect.affinityField,
        effortStyle: provider.dialect.effortStyle,
        ...fetchOption,
      });
    clients.set(provider.id, made);
    return made;
  };

  return {
    modelId: modelIdForRole("reasoner"),

    async *stream(request, opts = {}) {
      const resolved = resolveRoleProviders(roleForOperation(request.operation), env, options.providers);
      const now = Date.now();
      const healthy = resolved.filter((p) => !isCooling(p.id, now));
      const order = healthy.length > 0 ? healthy : resolved;
      if (order.length === 0) {
        // No provider with a key: the old client, which says so with `missing_key`.
        yield* createFireworksStreamClient({ env, ...fetchOption }).stream(request, opts);
        return;
      }

      const outer = opts.signal;
      for (const [index, provider] of order.entries()) {
        const next = order[index + 1];
        const attempt = new AbortController();
        const onOuterAbort = () => attempt.abort();
        if (outer?.aborted) attempt.abort();
        else outer?.addEventListener("abort", onOuterAbort, { once: true });
        let sawEvent = false;
        let timedOut = false;
        let delivered = false;
        // The usage comes right before `done`: held until the call's fate is known, so a failed attempt's
        // count never reaches the caller's ledger next to the one that served.
        let usage: UsageEvent | null = null;
        let failure: string | null = null;
        const timer = next
          ? setTimeout(() => {
              if (sawEvent) return;
              timedOut = true;
              attempt.abort();
            }, timeoutMs)
          : undefined;
        try {
          for await (const event of clientFor(provider).stream(request, {
            signal: attempt.signal,
            ...(opts.onWireBody ? { onWireBody: opts.onWireBody } : {}),
          })) {
            sawEvent = true;
            if (event.type === "usage") {
              usage = { ...event, provider: provider.id, model: provider.modelId };
              continue;
            }
            if (event.type === "done") {
              const stop = event.stopReason;
              if (stop.kind === "error" && stop.httpStatus === 402 && coolDown(provider.id, Date.now())) {
                console.error(`[ai] ${provider.id} sin saldo (402): ${next ? `llamadas a ${next.id}` : "sin respaldo"}`);
              }
              if (!delivered && next && movesOn(stop, timedOut, outer?.aborted === true)) {
                failure = stop.kind === "error" ? stop.error : `sin ningún evento en ${timeoutMs / 1000} s`;
                break;
              }
              if (usage) yield usage;
              yield event;
              return;
            }
            if (DELIVERED.has(event.type)) delivered = true;
            yield event;
          }
        } catch (error) {
          // The client yields its failures as `done`; a throw is a defect of ours — still a failure of this
          // attempt, and with nothing delivered the next provider can have the call.
          const message = error instanceof Error ? error.message : String(error);
          if (delivered || !next || outer?.aborted) {
            yield {
              type: "done",
              stopReason: outer?.aborted ? { kind: "cancelled" } : { kind: "error", error: message, code: "transport" },
            };
            return;
          }
          failure = message;
        } finally {
          clearTimeout(timer);
          outer?.removeEventListener("abort", onOuterAbort);
        }
        if (failure === null) {
          // The stream ended without `done`, which the client never does: say it rather than end in silence.
          yield { type: "done", stopReason: { kind: "error", error: "el proveedor cerró sin terminar", code: "transport" } };
          return;
        }
        console.warn(`[ai] ${provider.id} falló (${failure.slice(0, 120)}): ${request.operation} sigue en ${next!.id}`);
      }
    },
  };
}
