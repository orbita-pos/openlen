"use client";

// THE REVIEW CARD OF THE PERSON'S SKILLS (spec local 2026-11-19-agentes-para-todos, §6.6), Claude Code's «review card where
// they can save it»: what Len's `propose_skills` left under his answer, on reload too. The turn's action carries only the
// proposals' ids; the card asks the server for them (`GET /api/me/skills/proposals`), which gives each person only their
// own — on a shared project a member's proposal never shows to the owner, nor the owner's to a member (final review I1).
// Each proposal shows its name, whether it is new or improves one of theirs, its description and the whole SKILL.md;
// «Guardar» sends its id (`POST /api/me/skills`) and the server saves what it keeps, never over a skill that changed since.
// Everything Len wrote is drawn as text.
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { skillProposalIdsOf, type ProposalView } from "@/lib/agent/skills/proposal-card";

import type { AgentAction } from "../agent-action-card";

const PROPOSE_SKILLS_TOOL = "propose_skills";

/** The server's 409s (`saveProposedSkill`), each with its own line: none of them is fixed by trying again. */
const REFUSALS = ["changed", "limit", "reserved"] as const;
type Refusal = (typeof REFUSALS)[number];
type State = "idle" | "saving" | "saved" | Refusal | "failed";

/** The turn's proposals' ids, in order, once each. */
function idsOf(actions: readonly AgentAction[] | undefined): string[] {
  const ids = (actions ?? []).filter((a) => a.tool === PROPOSE_SKILLS_TOOL && a.status === "done").flatMap((a) => skillProposalIdsOf(a));
  return [...new Set(ids)];
}

export function SkillProposalsCard({ actions }: { actions: readonly AgentAction[] | undefined }) {
  const ids = useMemo(() => idsOf(actions), [actions]);
  const key = ids.join(",");
  const [proposals, setProposals] = useState<readonly ProposalView[]>([]);

  useEffect(() => {
    if (!key) return;
    let live = true;
    fetch(`/api/me/skills/proposals?ids=${key}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ proposals?: ProposalView[] }>) : null))
      .then((b) => {
        if (live && Array.isArray(b?.proposals)) setProposals(b.proposals);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);

  if (proposals.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2" data-skill-proposals="">
      {proposals.map((p) => (
        <Proposal key={p.id} proposal={p} />
      ))}
    </div>
  );
}

function Proposal({ proposal }: { proposal: ProposalView }) {
  const t = useTranslations("panelsChat");
  const [state, setState] = useState<State>(proposal.saved ? "saved" : "idle");

  async function save() {
    setState("saving");
    const r = await fetch("/api/me/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proposalId: proposal.id }),
    }).catch(() => null);
    if (r?.ok) return setState("saved");
    const body = (await r?.json().catch(() => null)) as { error?: string } | null;
    setState((r?.status === 409 && REFUSALS.find((e) => e === body?.error)) || "failed");
  }
  const why = { changed: t("skillProposal.changed"), limit: t("skillProposal.limit"), reserved: t("skillProposal.reserved"), failed: t("skillProposal.failed") };
  const refused = state === "idle" || state === "saving" || state === "saved" ? null : why[state];

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
      {refused && (
        <p role="alert" className="mt-1 text-[12px] nc-bad">
          {refused}
        </p>
      )}
    </div>
  );
}
