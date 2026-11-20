"use client";

// THE FIVE JOBS UNDER THE HOME'S BOX (spec local 2026-11-19-agentes-para-todos, §6.3; Jesús, 19/11: «profesor de
// inglés, entrenador, finanzas, legal y cocina»). Shown only with Agente chosen. A tap FILLS the box with that job's
// sentence, as a link to the home does (`homeArrival`): the person reads it, changes it if they like, and sends. Anything
// else they write is fine too — Len writes what that job needs.

import { useTranslations } from "next-intl";
import { ChefHat, Dumbbell, Languages, PiggyBank, Scale, type LucideIcon } from "lucide-react";

export const AGENT_JOBS = ["language", "fitness", "finance", "legal", "cooking"] as const;
export type AgentJob = (typeof AGENT_JOBS)[number];

const ICON: Record<AgentJob, LucideIcon> = { language: Languages, fitness: Dumbbell, finance: PiggyBank, legal: Scale, cooking: ChefHat };

export function AgentJobChips({ onPick }: { onPick: (text: string) => void }) {
  const t = useTranslations("wsChrome");
  return (
    <div data-agent-jobs="" className="mt-3 flex flex-wrap justify-center gap-2">
      {AGENT_JOBS.map((job) => {
        const Icon = ICON[job];
        return (
          <button
            key={job}
            type="button"
            data-agent-job={job}
            onClick={() => onPick(t(`start.kind.agentJobs.${job}Prompt`))}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 bg-white/80 px-3 text-[12.5px] font-medium text-zinc-700 transition hover:border-coral-500/40 hover:text-coral-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300 dark:hover:text-coral-400"
          >
            <Icon size={14} aria-hidden />
            {t(`start.kind.agentJobs.${job}`)}
          </button>
        );
      })}
    </div>
  );
}
