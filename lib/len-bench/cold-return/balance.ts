// THE SERVER'S LOCK ON THE CAP. The route stops a turn the moment its owner's balance does not cover the
// next call, and charges every turn at least what it costs at the provider's list price (the billing rate
// is above it). So the bench's owner starts each paid command with a balance of exactly what the command
// may spend, and from then on that balance ONLY GOES DOWN: by what the route charges on its own, and by
// the runner lowering it when its own count says less is left.
//
// It is never raised again — that is the point. The runner's count comes from the calls the route records;
// if that count were stuck (no rows, another provider's rows), a balance reset to «what is left» before
// every turn would be reset to the whole cap for ever. Lowered only, the two locks do not depend on each
// other: the balance runs out by itself.
import { CENTICREDITOS_POR_CREDITO, USD_PER_CREDIT } from "@/lib/credits-client";
import type { Sql } from "./snapshot";

/** A sum of money as the balance holds it: hundredths of a credit, rounded DOWN, never below zero. */
export function centicreditsOf(usd: number): number {
  return Math.max(0, Math.floor((usd / USD_PER_CREDIT) * CENTICREDITOS_POR_CREDITO + 1e-6));
}

/** Once, when a paid command starts: the balance is what the command may spend. The stamp keeps the plan's
 *  monthly refill from firing in the middle. */
export async function openBalance(sql: Sql, ownerId: string, usd: number): Promise<void> {
  await sql.query(`update "users" set "credits" = $1, "creditsRefreshedAt" = now() where "id" = $2`, [centicreditsOf(usd), ownerId]);
}

/** Before every turn, and at the end with zero: the balance is at most this. Never raises it. */
export async function lowerBalance(sql: Sql, ownerId: string, usd: number): Promise<void> {
  await sql.query(`update "users" set "credits" = least("credits", $1::integer), "creditsRefreshedAt" = now() where "id" = $2`, [centicreditsOf(usd), ownerId]);
}

export async function balanceUsd(sql: Sql, ownerId: string): Promise<number> {
  const [row] = await sql.query<{ credits: number }>(`select "credits" from "users" where "id" = $1`, [ownerId]);
  return ((row?.credits ?? 0) / CENTICREDITOS_POR_CREDITO) * USD_PER_CREDIT;
}
