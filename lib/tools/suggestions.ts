// WHO GETS THE «CREAR» CARD (spec local 2026-11-04-herramientas-hechas-por-len, §4.10, §4.13, §4.15). DeepSeek ships
// Personalized pages as an experiment that is off until the person turns it on; so here: the switches, subagents on
// (the Creator is one), a paid plan, the person's «Sugerencias de herramientas», and never inside a tool project,
// where Len builds the tool itself.
import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { subagentsEnabled } from "@/lib/agent/subagents/enabled";
import { getUserPlan } from "@/lib/limits";

import { toolsEnabled } from "./enabled";

type Env = Readonly<Record<string, string | undefined>>;

export function toolSuggestionsEnabled(env: Env = process.env): boolean {
  return toolsEnabled(env) && env.OPENLEN_TOOL_SUGGESTIONS !== "0";
}

export function suggestionsOffered(o: { readonly env: Env; readonly plan: string; readonly on: boolean; readonly toolProject: boolean }): boolean {
  return toolSuggestionsEnabled(o.env) && subagentsEnabled(o.env) && o.plan !== "free" && o.on && !o.toolProject;
}

/** The person's switch; off when it can't be read (never offer a card on a guess). */
export async function suggestionsOn(personId: string): Promise<boolean> {
  try {
    const [row] = await db.select({ on: schema.users.toolSuggestions }).from(schema.users).where(eq(schema.users.id, personId)).limit(1);
    return row?.on === true;
  } catch {
    return false;
  }
}

/** For the turn of whoever speaks: reads their plan and switch only when the switches allow it at all. */
export async function suggestionsOfferedTo(personId: string, toolProject: boolean, env: Env = process.env): Promise<boolean> {
  if (!toolSuggestionsEnabled(env) || !subagentsEnabled(env) || toolProject) return false;
  const [plan, on] = await Promise.all([getUserPlan(personId).catch(() => "free"), suggestionsOn(personId)]);
  return suggestionsOffered({ env, plan, on, toolProject });
}

export async function setSuggestionsOn(personId: string, on: boolean): Promise<void> {
  await db.update(schema.users).set({ toolSuggestions: on }).where(eq(schema.users.id, personId));
}
