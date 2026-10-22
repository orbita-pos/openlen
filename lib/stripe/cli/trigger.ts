// lib/stripe/cli/trigger.ts — `stripe trigger <event>` (spec local
// 2026-10-21-stripe-integration, §6.2). The Stripe CLI's own fixtures
// (fixtures/*.json, copied verbatim from github.com/stripe/stripe-cli at
// STRIPE_CLI_COMMIT; Copyright Stripe, Inc., Apache License 2.0,
// LICENSES/stripe-cli.Apache-2.0.txt), run the way pkg/fixtures/fixtures.go runs
// them: each step in order, `${name:path}` filled from earlier answers, the
// params form-encoded as pkg/parsers does, and the same lines printed. In test
// mode they create real objects, and Stripe sends the events to the draft's
// registered endpoints.

import { encodeStripeParams, type StripeRequest, type StripeResponse } from "../api";
import chargeRefunded from "./fixtures/charge.refunded.json";
import checkoutSessionCompleted from "./fixtures/checkout.session.completed.json";
import checkoutSessionExpired from "./fixtures/checkout.session.expired.json";
import subscriptionCreated from "./fixtures/customer.subscription.created.json";
import subscriptionDeleted from "./fixtures/customer.subscription.deleted.json";
import subscriptionUpdated from "./fixtures/customer.subscription.updated.json";
import invoicePaid from "./fixtures/invoice.paid.json";
import invoicePaymentFailed from "./fixtures/invoice.payment_failed.json";
import paymentIntentPaymentFailed from "./fixtures/payment_intent.payment_failed.json";
import paymentIntentSucceeded from "./fixtures/payment_intent.succeeded.json";

interface FixtureStep {
  readonly name: string;
  readonly path: string;
  readonly method: string;
  readonly params?: unknown;
  readonly expected_error_type?: string;
}

const FIXTURES: Readonly<Record<string, { readonly fixtures: readonly FixtureStep[] }>> = {
  "checkout.session.completed": checkoutSessionCompleted,
  "checkout.session.expired": checkoutSessionExpired,
  "payment_intent.succeeded": paymentIntentSucceeded,
  "payment_intent.payment_failed": paymentIntentPaymentFailed,
  "charge.refunded": chargeRefunded,
  "customer.subscription.created": subscriptionCreated,
  "customer.subscription.updated": subscriptionUpdated,
  "customer.subscription.deleted": subscriptionDeleted,
  "invoice.paid": invoicePaid,
  "invoice.payment_failed": invoicePaymentFailed,
};

export const TRIGGER_EVENTS: readonly string[] = Object.keys(FIXTURES);

type Responses = Readonly<Record<string, unknown>>;

const QUERY = /\$\{([^|}:]+):([^|}]+)\}/g;

function lookup(responses: Responses, name: string, path: string): string {
  let v: unknown = responses[name];
  for (const part of path.split(".")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[part] : undefined;
  return v === undefined || v === null ? "" : String(v);
}

const fill = (s: string, responses: Responses) => s.replace(QUERY, (_m, name: string, path: string) => lookup(responses, name, path));

function scalar(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

/** pkg/parsers ParseToFormData: maps nest as `a[b]`, a string array as `a[]`, an object array as `a[i][k]`. */
export function fixtureForm(params: unknown, responses: Responses, parent = ""): [string, string][] {
  const out: [string, string][] = [];
  if (!params || typeof params !== "object" || Array.isArray(params)) return out;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    const name = parent ? `${parent}[${key}]` : key;
    if (typeof value === "string") out.push([name, fill(value, responses)]);
    else if (scalar(value) !== null) out.push([name, scalar(value)!]);
    else if (Array.isArray(value)) {
      let index = 0;
      for (const item of value) {
        if (typeof item === "string") out.push([`${name}[]`, fill(item, responses)]);
        else if (scalar(item) !== null) out.push([`${name}[]`, scalar(item)!]);
        else if (item && typeof item === "object") out.push(...fixtureForm(item, responses, `${name}[${index++}]`));
      }
    } else if (value && typeof value === "object") out.push(...fixtureForm(value, responses, name));
  }
  return out;
}

const errorType = (r: StripeResponse): string | null => {
  const t = (r.json as { error?: { type?: unknown } } | null)?.error?.type;
  return typeof t === "string" ? t : null;
};

export async function runTrigger(
  event: string,
  key: string,
  request: (key: string, req: StripeRequest) => Promise<StripeResponse>,
): Promise<{ stdout: string; exitCode: number }> {
  const fixture = Object.hasOwn(FIXTURES, event) ? FIXTURES[event]! : null;
  if (!fixture) {
    return { stdout: `The event "${event}" is not supported here. Supported events:\n${TRIGGER_EVENTS.map((e) => `  ${e}`).join("\n")}\n`, exitCode: 1 };
  }
  const responses: Record<string, unknown> = {};
  let out = "";
  for (const step of fixture.fixtures) {
    out += `Setting up fixture for: ${step.name}\nRunning fixture for: ${step.name}\n`;
    const method = step.method.toUpperCase() as StripeRequest["method"];
    const path = fill(step.path, responses);
    const form = fixtureForm(step.params, responses)
      .map(([k, v]) => encodeStripeParams({ [k]: v }))
      .join("&");
    const r = await request(key, { method, path, ...(form ? { form } : {}) });
    if (r.status >= 300 || r.status === 401) {
      if (step.expected_error_type && errorType(r) === step.expected_error_type) {
        responses[step.name] = {};
        continue;
      }
      return { stdout: `${out}Error: Request failed, status=${r.status}, body=${r.text}\n`, exitCode: 1 };
    }
    responses[step.name] = r.json ?? {};
  }
  return { stdout: `${out}Trigger succeeded! Check dashboard for event details.\n`, exitCode: 0 };
}
