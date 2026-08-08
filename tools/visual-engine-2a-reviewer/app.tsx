"use client";

import { useState } from "react";
import type { BlindDecisionCommand, BlindReviewDto, BlindSideDecision } from "@/lib/generation/visual-engine-2a-review-session";

export function VisualEngine2AReviewerApp(props: {
  initial: BlindReviewDto;
  submit: (command: BlindDecisionCommand) => Promise<void>;
}) {
  const [tab, setTab] = useState<"normal" | "neutral">("normal");
  const [required, setRequired] = useState<"" | "yes" | "no">("");
  const [forbidden, setForbidden] = useState<"" | "yes" | "no">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const current = props.initial.current;
  const ready = Boolean(current && required && forbidden && note.trim() && note.trim().length <= 200 && !busy);

  async function decide(decision: BlindSideDecision) {
    if (!current || !ready) return;
    setBusy(true); setError(false);
    try {
      await props.submit({
        comparisonId: current.comparisonId,
        decision,
        requiredSignalsPresent: required === "yes",
        forbiddenSignalsPresent: forbidden === "yes",
        note: note.trim(),
      });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!current) return <main><h1>Review complete</h1><p>{props.initial.progress.decided}/{props.initial.progress.total}</p></main>;
  return <main aria-label="Blind visual comparison">
    <header>
      <h1>Visual Engine 2A blind review</h1>
      <p>{props.initial.progress.decided}/{props.initial.progress.total}</p>
      <p>Gate impact: ties are not wins; an accepted forbidden signal fails the gate.</p>
      <button type="button" aria-pressed={tab === "normal"} onClick={() => setTab("normal")}>Normal copy</button>
      <button type="button" aria-pressed={tab === "neutral"} onClick={() => setTab("neutral")}>Copy neutralized</button>
    </header>
    <section aria-label="Comparison pair">
      <figure><figcaption>Left</figcaption><img alt="Left page" src={current.left[tab === "normal" ? "normalUrl" : "neutralUrl"]} /></figure>
      <figure><figcaption>Right</figcaption><img alt="Right page" src={current.right[tab === "normal" ? "normalUrl" : "neutralUrl"]} /></figure>
    </section>
    <fieldset disabled={busy}>
      <legend>Required visual checks</legend>
      <label>Required signals present
        <select value={required} onChange={(event) => setRequired(event.target.value as typeof required)}>
          <option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      </label>
      <label>Forbidden signals present
        <select value={forbidden} onChange={(event) => setForbidden(event.target.value as typeof forbidden)}>
          <option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      </label>
      <label>Short note<textarea maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div>
        {(["left", "right", "tie", "invalid"] as const).map((decision) =>
          <button key={decision} type="button" data-decision={decision} disabled={!ready} onClick={() => void decide(decision)}>{decision}</button>)}
      </div>
    </fieldset>
    {error ? <p role="alert">The decision could not be saved.</p> : null}
  </main>;
}
