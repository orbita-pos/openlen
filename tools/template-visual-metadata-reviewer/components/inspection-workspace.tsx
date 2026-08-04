import type { SafeReviewItemDto, SafeReviewSessionDto } from "../api";

interface InspectionWorkspaceProps {
  item: SafeReviewItemDto | null;
  session: Extract<SafeReviewSessionDto, { phase: "review" }>;
  screenshotState: "idle" | "loading" | "loaded" | "error";
  screenshotAttempt: number;
  zoom: number;
  onLoad(itemId: string, attempt: number): void;
  onError(itemId: string, attempt: number): void;
  onRetry(): void;
  onZoom(zoom: number): void;
}

export function InspectionWorkspace({
  item,
  session,
  screenshotState,
  screenshotAttempt,
  zoom,
  onLoad,
  onError,
  onRetry,
  onZoom,
}: InspectionWorkspaceProps) {
  const decided = session.progress.approved + session.progress.rejected;
  return (
    <section className="review-stage" aria-label="Screenshot inspection stage">
      <header className="stage-header">
        <div>
          <span className="utility-label">Evidence</span>
          <h1>{item?.name ?? "No review item"}</h1>
          {item && <code>{item.id}</code>}
        </div>
        <div className="stage-progress" aria-label={`${decided} of ${session.progress.suggested} decisions`}>
          <strong>{session.reviewerName}</strong>
          <span>{decided}/{session.progress.suggested} decisions</span>
          <small>
            {session.progress.approved}/{session.progress.requiredApprovals} approvals · {session.progress.rejected} rejected · {session.progress.failed} failed
          </small>
          <small>{session.progress.remainingApprovals} approvals still needed</small>
        </div>
      </header>

      <div className="screenshot-toolbar" aria-label="Screenshot controls">
        <button type="button" onClick={() => onZoom(Math.max(0.5, zoom - 0.1))} aria-label="Zoom out">−</button>
        <output aria-label="Screenshot zoom">{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => onZoom(Math.min(2, zoom + 0.1))} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => onZoom(1)}>Fit</button>
      </div>

      <div className="screenshot-viewport">
        {item?.screenshotEndpoint ? (
          <>
            {screenshotState === "loading" && <p className="stage-message" role="status">Loading screenshot…</p>}
            {screenshotState === "error" && (
              <div className="stage-message" role="alert">
                <p>Screenshot unavailable. Approval remains disabled.</p>
                <button type="button" onClick={onRetry}>Retry screenshot</button>
              </div>
            )}
            <img
              key={`${item.id}-${screenshotAttempt}`}
              src={item.screenshotEndpoint}
              alt={`Full-page screenshot of ${item.name}`}
              onLoad={() => onLoad(item.id, screenshotAttempt)}
              onError={() => onError(item.id, screenshotAttempt)}
              style={{ width: `${zoom * 100}%` }}
              hidden={screenshotState === "error"}
            />
          </>
        ) : (
          <div className="stage-message" role="status">
            <p>No screenshot is available for this failed row.</p>
            {item?.failureKind && <code>{item.failureKind}</code>}
          </div>
        )}
      </div>

      <footer className="stage-identity">
        <span className="source-proof">
          {session.source.artifactVersion} · <code>{session.source.abbreviatedSha256}</code>
        </span>
      </footer>
    </section>
  );
}
