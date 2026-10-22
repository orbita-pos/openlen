// lib/stripe/cli/run.ts — THE `stripe` COMMAND IN LEN'S TERMINAL (spec local
// 2026-10-21-stripe-integration, §6.2 and §6.3). OpenLen answers it, as it does
// `git` and `supabase`: the key is the project's STRIPE_SECRET_KEY and never
// reaches Len. Test mode with the draft's key by default; `--live` reads with
// production's and never writes (Len never writes production; publishing copies
// to live mode). What a test-mode create makes is recorded, because publishing
// copies it; a new webhook endpoint's `whsec_` is saved as a draft secret and
// the output shows its name instead. What Stripe answers is printed as the
// Stripe CLI prints it (pkg/requests/base.go): the body, also for a 4xx; only a
// 401 is "Request failed".

import { encodeStripeParams, type StripeEnv, type StripeRequest, type StripeResponse } from "../api";
import type { StripeObjectKind } from "../store";
import { parseStripeArgs, type FormPair } from "./parse";
import { CREDENTIALS_ANSWER, LIVE_WRITE_REFUSAL, listenText, noKeyText } from "./texts";

export interface StripeCliDeps {
  keyFor(env: StripeEnv): Promise<string | null>;
  request(key: string, req: StripeRequest): Promise<StripeResponse>;
  record(obj: { kind: StripeObjectKind; testId: string; testUrl?: string; lookupKey?: string; functionName?: string }): Promise<void>;
  /** Saves a new endpoint's signing secret for the draft; returns the secret's name. */
  saveWebhookSecret(endpoint: { id: string; url: string; secret: string }): Promise<string>;
  mask(text: string): Promise<string>;
  /** "https://<draft ref>.<host>/functions/v1/", or null without a backend. */
  readonly draftFunctionsUrl: string | null;
  trigger(event: string, key: string): Promise<{ stdout: string; exitCode: number }>;
}

export interface StripeCliOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const ABORTED_OUTPUT: StripeCliOutput = { stdout: "", stderr: "", exitCode: 143 };
/** The command was stopped (its time, or `timeout N stripe …`): nothing more is waited for. */
const STOPPED: unique symbol = Symbol("stopped");

/** The collections whose test-mode creates are copied to live when publishing. */
const RECORDED: Readonly<Record<string, StripeObjectKind>> = {
  "/v1/products": "product",
  "/v1/prices": "price",
  "/v1/payment_links": "payment_link",
  "/v1/shipping_rates": "shipping_rate",
  "/v1/billing_portal/configurations": "portal_configuration",
  "/v1/webhook_endpoints": "webhook_endpoint",
};

const encodeForm = (form: readonly FormPair[]) => form.map(([k, v]) => encodeStripeParams({ [k]: v })).join("&");
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function whenAborted(signal: AbortSignal | undefined): Promise<typeof STOPPED> | null {
  if (!signal) return null;
  return new Promise((resolve) => {
    if (signal.aborted) resolve(STOPPED);
    else signal.addEventListener("abort", () => resolve(STOPPED), { once: true });
  });
}

async function race<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof STOPPED> {
  const stop = whenAborted(signal);
  return stop ? Promise.race([work, stop]) : work;
}

function functionOf(url: string, draftFunctionsUrl: string | null): string | undefined {
  if (!draftFunctionsUrl || !url.startsWith(draftFunctionsUrl)) return undefined;
  return url.slice(draftFunctionsUrl.length).split(/[/?#]/)[0] || undefined;
}

export async function runStripeCli(args: readonly string[], deps: StripeCliDeps, o: { readonly signal?: AbortSignal } = {}): Promise<StripeCliOutput> {
  if (o.signal?.aborted) return ABORTED_OUTPUT;
  const out = await run(args, deps, o.signal);
  if (out === STOPPED) return ABORTED_OUTPUT;
  return { stdout: await deps.mask(out.stdout), stderr: await deps.mask(out.stderr), exitCode: out.exitCode };
}

async function run(args: readonly string[], deps: StripeCliDeps, signal: AbortSignal | undefined): Promise<StripeCliOutput | typeof STOPPED> {
  const c = parseStripeArgs(args);
  switch (c.kind) {
    case "help":
      return { stdout: c.text, stderr: "", exitCode: 0 };
    case "usage_error":
      return { stdout: "", stderr: c.message, exitCode: 1 };
    case "credentials":
      return { stdout: "", stderr: CREDENTIALS_ANSWER, exitCode: 1 };
    case "listen": {
      const key = await deps.keyFor("draft");
      if (!key) return { stdout: "", stderr: noKeyText("draft"), exitCode: 1 };
      const r = await race(deps.request(key, { method: "GET", path: "/v1/webhook_endpoints", form: "limit=100" }), signal);
      if (r === STOPPED) return r;
      const data = ((r.json as { data?: unknown } | null)?.data ?? []) as { url?: unknown; enabled_events?: unknown }[];
      const endpoints = (Array.isArray(data) ? data : []).map((e) => ({ url: str(e.url) ?? "", events: Array.isArray(e.enabled_events) ? e.enabled_events.map(String) : [] }));
      return { stdout: listenText(endpoints, deps.draftFunctionsUrl), stderr: "", exitCode: 0 };
    }
    case "trigger": {
      if (c.live) return { stdout: "", stderr: LIVE_WRITE_REFUSAL, exitCode: 1 };
      const key = await deps.keyFor("draft");
      if (!key) return { stdout: "", stderr: noKeyText("draft"), exitCode: 1 };
      const r = await race(deps.trigger(c.event, key), signal);
      if (r === STOPPED) return r;
      return { stdout: r.exitCode === 0 ? r.stdout : "", stderr: r.exitCode === 0 ? "" : r.stdout, exitCode: r.exitCode };
    }
    case "operation":
    case "raw":
      break;
  }

  const method = c.kind === "operation" ? c.op.method : c.method;
  const env: StripeEnv = c.live ? "live" : "draft";
  if (c.live && method !== "GET") return { stdout: "", stderr: LIVE_WRITE_REFUSAL, exitCode: 1 };
  const key = await deps.keyFor(env);
  if (!key) return { stdout: "", stderr: noKeyText(env), exitCode: 1 };
  if (method === "DELETE" && !c.confirm) {
    return {
      stdout: `This command will be executed on the account with the following details:\n> Mode: ${c.live ? "Live" : "Test"}\nAre you sure you want to perform the command: DELETE?\nEnter 'yes' to confirm: \nExiting without execution. User did not confirm the command.\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  const form = encodeForm(c.form);
  const req: StripeRequest = { method, path: c.path, ...(form ? { form } : {}), ...(c.idempotencyKey ? { idempotencyKey: c.idempotencyKey } : {}) };
  const r = await race(deps.request(key, req), signal);
  if (r === STOPPED) return r;
  if (r.status === 401) return { stdout: "", stderr: `Request failed, status=401, body=${r.text}\n`, exitCode: 1 };

  let body = r.text;
  const created = !c.live && method === "POST" && r.status >= 200 && r.status < 300 ? RECORDED[c.path] : undefined;
  if (created) {
    const j = (r.json ?? {}) as Record<string, unknown>;
    const id = str(j.id);
    if (id) {
      const url = str(j.url);
      if (created === "webhook_endpoint") {
        const secret = str(j.secret);
        const fn = url ? functionOf(url, deps.draftFunctionsUrl) : undefined;
        await deps.record({ kind: created, testId: id, ...(url ? { testUrl: url } : {}), ...(fn ? { functionName: fn } : {}) });
        if (secret && url) {
          const name = await deps.saveWebhookSecret({ id, url, secret });
          body = body.split(secret).join(`(saved as ${name} in the draft)`);
        }
      } else {
        const lookupKey = created === "price" ? str(j.lookup_key) : undefined;
        await deps.record({ kind: created, testId: id, ...(created === "payment_link" && url ? { testUrl: url } : {}), ...(lookupKey ? { lookupKey } : {}) });
      }
    }
  }
  return { stdout: `${body}\n`, stderr: "", exitCode: 0 };
}
