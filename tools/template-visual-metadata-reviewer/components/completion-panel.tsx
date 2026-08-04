import type { SafeReviewSessionDto } from "../api";

interface CompletionPanelProps {
  session: Extract<SafeReviewSessionDto, { phase: "review" }>;
  busy: boolean;
  onExportFinal(): void;
  onExportAudit(): void;
}

export function CompletionPanel({ session, busy, onExportFinal, onExportAudit }: CompletionPanelProps) {
  const progress = session.progress;
  return (
    <section className="completion-panel" aria-labelledby="completion-heading">
      <div>
        <span className="utility-label">Completion gate</span>
        <h2 id="completion-heading">{progress.finalExportEnabled ? "Ready to export" : "Review in progress"}</h2>
      </div>
      <dl>
        <div><dt>Approved</dt><dd>{progress.approved}/{progress.requiredApprovals}</dd></div>
        <div><dt>Rejected</dt><dd>{progress.rejected}</dd></div>
        <div><dt>Failed</dt><dd>{progress.failed}</dd></div>
      </dl>
      <div className="gate-copy" role="status">
        <strong>{progress.remainingApprovals} approvals still needed</strong>
        <span>{progress.pending} decisions still needed</span>
      </div>
      <div className="export-actions">
        <button type="button" data-export-audit onClick={onExportAudit} disabled={busy}>Export audit backup</button>
        <button
          type="button"
          data-export-final
          onClick={onExportFinal}
          disabled={busy || !progress.finalExportEnabled}
        >
          Export reviewed artifact
        </button>
      </div>
    </section>
  );
}
