import type { ReviewState, SafeReviewItemDto } from "../api";

interface ReviewQueueProps {
  open: boolean;
  items: SafeReviewItemDto[];
  currentId: string | null;
  filter?: ReviewState;
  query: string;
  disabled: boolean;
  onToggle(): void;
  onFilter(filter?: ReviewState): void;
  onQuery(query: string): void;
  onNavigate(id: string): void;
}

const FILTERS: { label: string; value?: ReviewState }[] = [
  { label: "All" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Failed", value: "failed" },
];

export function ReviewQueue({
  open,
  items,
  currentId,
  filter,
  query,
  disabled,
  onToggle,
  onFilter,
  onQuery,
  onNavigate,
}: ReviewQueueProps) {
  return (
    <div className="queue-shell">
      <button
        type="button"
        className="queue-toggle"
        aria-expanded={open}
        aria-controls="review-queue"
        onClick={onToggle}
      >
        <span>Review queue</span>
        <kbd>J / K</kbd>
      </button>
      <section id="review-queue" className="review-queue" hidden={!open} aria-label="Review queue">
        <div className="queue-tools">
          <div className="queue-filters" aria-label="Filter review queue">
            {FILTERS.map((candidate) => (
              <button
                type="button"
                key={candidate.label}
                data-filter={candidate.value}
                aria-pressed={filter === candidate.value}
                disabled={disabled}
                onClick={() => onFilter(candidate.value)}
              >
                {candidate.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            disabled={disabled}
            onChange={(event) => onQuery(event.currentTarget.value)}
            placeholder="Search ID, name, or tag"
            aria-label="Search templates by ID, name, or tag"
          />
        </div>
        <ol>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === currentId ? "current" : ""}
                aria-current={item.id === currentId ? "true" : undefined}
                disabled={disabled}
                onClick={() => onNavigate(item.id)}
              >
                <span><strong>{item.name}</strong><code>{item.id}</code></span>
                <span className={`status status-${item.state}`}><span aria-hidden="true">●</span> {item.state}</span>
              </button>
            </li>
          ))}
        </ol>
        {items.length === 0 && <p className="queue-empty">No rows match this filter.</p>}
      </section>
    </div>
  );
}
