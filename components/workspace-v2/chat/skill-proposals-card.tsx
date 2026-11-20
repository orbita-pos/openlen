"use client";

// THE REVIEW CARD OF THE PERSON'S SKILLS (spec local 2026-11-19-agentes-para-todos, §6.6), Claude Code's «review card where
// they can save it»: what Len's `propose_skills` left under his answer, on reload too (it comes from the turn's actions).
// Each proposal shows its name, whether it is new or improves one of theirs, its description and the whole SKILL.md;
// «Guardar» saves it as the signed-in person's skill (`POST /api/me/skills`). A skill that changed since Len proposed it is
// never overwritten: the card says it changed. On mount it asks whether each one is already saved, so a reload shows it.
// Everything Len wrote is drawn as text.
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { skillProposalsOf, type ResolvedProposal } from "@/lib/agent/skills/proposal-card";

import type { AgentAction } from "../agent-action-card";

const PROPOSE_SKILLS_TOOL = "propose_skills";

type State = "idle" | "saving" | "saved" | "changed" | "failed";

/** The turn's proposals, one per name: a name proposed again in the same turn shows its last version. */
function proposalsOf(actions: readonly AgentAction[] | undefined): ResolvedProposal[] {
  const byName = new Map<string, ResolvedProposal>();
  for (const a of actions ?? []) {
    if (a.tool !== PROPOSE_SKILLS_TOOL || a.status !== "done") continue;
    for (const p of skillProposalsOf(a)) {
      byName.delete(p.name);
      byName.set(p.name, p);
    }
  }
  return [...byName.values()];
}

export function SkillProposalsCard({ actions }: { actions: readonly AgentAction[] | undefined }) {
  const proposals = useMemo(() => proposalsOf(actions), [actions]);
  if (proposals.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2" data-skill-proposals="">
      {proposals.map((p) => (
        <Proposal key={`${p.name}:${p.fingerprint}`} proposal={p} />
      ))}
    </div>
  );
}

function Proposal({ proposal }: { proposal: ResolvedProposal }) {
  const t = useTranslations("panelsChat");
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    let live = true;
    fetch(`/api/me/skills/${encodeURIComponent(proposal.name)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ fingerprint?: string | null }>) : null))
      .then((b) => {
        if (live && b?.fingerprint === proposal.fingerprint) setState("saved");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [proposal.name, proposal.fingerprint]);

  async function save() {
    setState("saving");
    const r = await fetch("/api/me/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: proposal.name, skillMd: proposal.skillMd, base: proposal.base }),
    }).catch(() => null);
    if (r?.ok) return setState("saved");
    const body = (await r?.json().catch(() => null)) as { error?: string } | null;
    setState(r?.status === 409 && body?.error === "changed" ? "changed" : "failed");
  }

  return (
    <div className="rounded-xl border bd bg-elev p-3" data-skill-proposal={proposal.name}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-medium fg">
          <span className="font-mono">{proposal.name}</span>
          <span className="ml-2 rounded-full border bd px-2 py-0.5 text-[11px] font-normal fg-muted">
            {proposal.kind === "new" ? t("skillProposal.new") : t("skillProposal.improvement", { target: proposal.target ?? proposal.name })}
          </span>
        </p>
        {state === "saved" ? (
          <span className="text-[12px] font-medium fg" data-skill-saved="">
            {t("skillProposal.saved")}
          </span>
        ) : (
          <button
            type="button"
            data-skill-save=""
            disabled={state === "saving"}
            onClick={() => void save()}
            className="rounded-full bg-[var(--nc-accent-text)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {state === "saving" ? t("skillProposal.saving") : t("skillProposal.save")}
          </button>
        )}
      </div>
      <p className="mt-1 text-[12px] leading-snug fg-muted">{proposal.description}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-[12px] fg-faint">{t("skillProposal.show")}</summary>
        <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-app p-2 text-[11.5px] leading-snug fg">{proposal.skillMd}</pre>
      </details>
      {state === "changed" && (
        <p role="alert" className="mt-1 text-[12px] nc-bad">
          {t("skillProposal.changed")}
        </p>
      )}
      {state === "failed" && (
        <p role="alert" className="mt-1 text-[12px] nc-bad">
          {t("skillProposal.failed")}
        </p>
      )}
    </div>
  );
}
