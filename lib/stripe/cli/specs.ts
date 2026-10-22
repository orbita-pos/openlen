// lib/stripe/cli/specs.ts — THE `stripe` COMMAND'S RESOURCES (spec local
// 2026-10-21-stripe-integration, §6.2), from specs.json, which
// scripts/stripe-cli-specs.mjs derives from the Stripe CLI's generated sources
// (github.com/stripe/stripe-cli, Copyright Stripe, Inc., Apache License 2.0 —
// LICENSES/stripe-cli.Apache-2.0.txt) at one pinned commit.

import table from "./specs.json";

export interface StripeOperationSpec {
  readonly name: string;
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  /** Dotted parameter name (`recurring.interval`) → its type in the CLI (`string`, `integer`, `boolean`, `array`…). */
  readonly params: Readonly<Record<string, string>>;
}

export interface StripeResourceSpec {
  readonly name: string;
  readonly operations: Readonly<Record<string, StripeOperationSpec>>;
}

type Table = { readonly commit: string; readonly resources: Readonly<Record<string, Readonly<Record<string, Omit<StripeOperationSpec, "name">>>>> };
const T = table as unknown as Table;

export const STRIPE_CLI_COMMIT: string = T.commit;
export const STRIPE_CLI_RESOURCES: readonly string[] = Object.keys(T.resources).sort();

function resource(name: string): StripeResourceSpec | null {
  if (!Object.hasOwn(T.resources, name)) return null;
  const ops = T.resources[name]!;
  return { name, operations: Object.fromEntries(Object.entries(ops).map(([op, s]) => [op, { name: op, ...s }])) };
}

/** The resource the first words name (`products`, `checkout sessions`), and how many words it took. */
export function findResource(words: readonly string[]): (StripeResourceSpec & { readonly consumed: number }) | null {
  const [a, b] = words;
  if (a && b) {
    const two = resource(`${a} ${b}`);
    if (two) return { ...two, consumed: 2 };
  }
  const one = a ? resource(a) : null;
  return one ? { ...one, consumed: 1 } : null;
}
