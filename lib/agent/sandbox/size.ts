// The real terminal's box: its fixed size and E2B's list price (spec local
// 2026-10-21-real-terminal-e2b, §4 and §8). No imports, so the price table
// (lib/ai/cost-rates.ts) and the billing (./billing.ts) can both read it
// without a cycle.

/** Fixed: neither the model nor the user can change it. */
export const SANDBOX_VCPU = 2;
export const SANDBOX_MEMORY_GIB = 4;

/** e2b.dev/pricing, read 2026-10-21: billed per second while the box runs; a paused box pays no compute. */
export const E2B_USD_PER_VCPU_SECOND = 0.000014;
export const E2B_USD_PER_GIB_SECOND = 0.0000045;

/** $0.000046/s for 2 vCPU and 4 GiB: $0.166 an hour, 0.28 credits a minute. */
export const SANDBOX_USD_PER_SECOND = SANDBOX_VCPU * E2B_USD_PER_VCPU_SECOND + SANDBOX_MEMORY_GIB * E2B_USD_PER_GIB_SECOND;

/** The ledger's `model` for a box (`provider` is "e2b"). */
export const SANDBOX_MODEL = "openlen-terminal";
