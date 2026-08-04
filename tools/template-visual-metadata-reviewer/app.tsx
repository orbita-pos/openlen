import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { TemplateVisualMetadataSchema } from "../../lib/templates/visual-metadata";
import {
  createReviewerApi,
  type ReviewState,
  type ReviewerApi,
  type SafeReviewItemDto,
  type SafeReviewSessionDto,
} from "./api";
import { CompletionPanel } from "./components/completion-panel";
import { InspectionWorkspace } from "./components/inspection-workspace";
import { MetadataInspector } from "./components/metadata-inspector";
import { ReviewQueue } from "./components/review-queue";
import "./styles.css";

function tabbable(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )).filter((element) => !element.hidden);
}

function Modal({
  title,
  children,
  onClose,
  initialFocus,
  dismissDisabled = false,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  initialFocus?: string;
  dismissDisabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const requested = initialFocus ? dialog?.querySelector<HTMLElement>(initialFocus) : null;
    (requested ?? (dialog ? tabbable(dialog)[0] : null) ?? dialog)?.focus();
    return () => previousFocus.current?.focus();
  }, [initialFocus]);
  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const controls = dialogRef.current ? tabbable(dialogRef.current) : [];
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && onClose && !dismissDisabled) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <div className="dialog-heading">
          <h2 id="dialog-title">{title}</h2>
          {onClose && (
            <button type="button" aria-label="Close dialog" onClick={onClose} disabled={dismissDisabled}>×</button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function IdentityForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  onSubmit(identity: { name: string; email: string }): Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [validation, setValidation] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = { name: name.trim(), email: email.trim() };
    if (!normalized.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
      setValidation("Enter a reviewer name and valid email.");
      return;
    }
    setValidation("");
    await onSubmit(normalized);
  };
  return (
    <Modal title="Identify this review session" initialFocus="input[name='name']">
      <p className="dialog-intro">Identity is required before any artifact row is requested.</p>
      <form className="identity-form" onSubmit={submit}>
        <label>Name<input name="name" value={name} onChange={(event) => setName(event.currentTarget.value)} autoComplete="name" /></label>
        <label>Email<input name="email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} autoComplete="email" /></label>
        {(validation || error) && <p className="form-error" role="alert">{validation || error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Opening session…" : "Open review session"}</button>
      </form>
    </Modal>
  );
}

function RejectionDialog({
  busy,
  error: operationError,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  error: string;
  onClose(): void;
  onConfirm(reason: string): Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState("");
  const confirm = async () => {
    const normalized = reason.trim();
    if (!normalized) {
      setValidationError("Enter a rejection reason.");
      return;
    }
    if (Array.from(normalized).length > 500) {
      setValidationError("Keep the rejection reason to 500 characters.");
      return;
    }
    setValidationError("");
    await onConfirm(normalized);
  };
  return (
    <Modal
      title="Reject this proposal"
      onClose={onClose}
      initialFocus="textarea"
      dismissDisabled={busy}
    >
      <p className="dialog-intro">Record what the screenshot does not support.</p>
      <label className="reason-field">
        Rejection reason
        <textarea
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          aria-invalid={Boolean(validationError || operationError)}
          rows={5}
        />
      </label>
      {(validationError || operationError) && (
        <p className="form-error" role="alert">{validationError || operationError}</p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="reject-button" data-confirm-reject onClick={() => void confirm()} disabled={busy}>
          {busy ? "Rejecting…" : "Reject proposal"}
        </button>
      </div>
    </Modal>
  );
}

function safeErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "screenshot_required") return "Load the screenshot before approving.";
    if (code === "export_gate_closed") return "Complete every decision and approval requirement before final export.";
    if (code === "identity_invalid") return "Enter a valid reviewer name and email.";
  }
  return "The operation failed. Retry it or exit without making another change.";
}

function isTerminalMutationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.code === "request_rejected"
    || candidate.code === "server_closing"
    || typeof candidate.status === "number" && candidate.status >= 500;
}

export function ReviewerApp({ api }: { api: ReviewerApi }) {
  const [session, setSession] = useState<SafeReviewSessionDto | null>(null);
  const [items, setItems] = useState<SafeReviewItemDto[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewState | undefined>();
  const [query, setQuery] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [screenshotState, setScreenshotState] = useState<"idle" | "loading" | "loaded" | "error">("loading");
  const [screenshotAttempt, setScreenshotAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [rejectionOpen, setRejectionOpen] = useState(false);
  const itemRequest = useRef(0);
  const navigationRequest = useRef(0);
  const currentIdRef = useRef<string | null>(null);
  const screenshotAttemptRef = useRef(0);
  const loadedScreenshotRef = useRef<{ itemId: string; attempt: number } | null>(null);
  const filterRef = useRef<ReviewState | undefined>(undefined);
  const queryRef = useRef("");
  const handleMutationError = useCallback((cause: unknown) => {
    setError(safeErrorMessage(cause));
    if (isTerminalMutationError(cause)) {
      loadedScreenshotRef.current = null;
      setPaused(true);
      setRejectionOpen(false);
    }
  }, []);

  const activateItem = useCallback((
    id: string | null,
    availableItems: SafeReviewItemDto[],
    force = false,
  ) => {
    const candidate = availableItems.find((item) => item.id === id) ?? null;
    if (!force && currentIdRef.current === id) {
      setCurrentId(id);
      return;
    }
    currentIdRef.current = id;
    loadedScreenshotRef.current = null;
    const attempt = ++screenshotAttemptRef.current;
    setScreenshotAttempt(attempt);
    setScreenshotState(candidate?.screenshotEndpoint ? "loading" : "idle");
    setZoom(1);
    setCurrentId(id);
  }, []);

  const fetchItems = useCallback(async (
    nextFilter: ReviewState | undefined,
    nextQuery: string,
    preferredId?: string | null,
  ) => {
    const requestId = ++itemRequest.current;
    const nextItems = await api.getItems({ status: nextFilter, q: nextQuery || undefined });
    if (requestId !== itemRequest.current) return;
    setItems(nextItems);
    const wanted = preferredId === undefined ? currentIdRef.current : preferredId;
    const selected = nextItems.some((item) => item.id === wanted) ? wanted! : nextItems[0]?.id ?? null;
    activateItem(selected, nextItems);
  }, [activateItem, api]);

  const fetchItemsSafely = useCallback(async (
    nextFilter: ReviewState | undefined,
    nextQuery: string,
    preferredId?: string | null,
  ) => {
    const expectedRequest = itemRequest.current + 1;
    try {
      await fetchItems(nextFilter, nextQuery, preferredId);
      if (itemRequest.current === expectedRequest) setError("");
    } catch (cause) {
      if (itemRequest.current === expectedRequest) setError(safeErrorMessage(cause));
    }
  }, [fetchItems]);

  useEffect(() => {
    let active = true;
    void api.getSession().then(async (nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (nextSession.phase === "review") {
        await fetchItems(undefined, "", nextSession.currentTemplateId);
      }
    }).catch((cause) => {
      if (active) setError(safeErrorMessage(cause));
    });
    return () => {
      active = false;
      itemRequest.current += 1;
    };
  }, [api, fetchItems]);

  const reviewSession = session?.phase === "review" ? session : null;
  const currentItem = useMemo(
    () => items.find((candidate) => candidate.id === currentId) ?? items[0] ?? null,
    [currentId, items],
  );

  const navigate = useCallback(async (id: string) => {
    if (busy || paused || id === currentId) return;
    const requestId = ++navigationRequest.current;
    setError("");
    try {
      await api.navigate(id);
      if (requestId !== navigationRequest.current) return;
      activateItem(id, items);
    } catch (cause) {
      if (requestId !== navigationRequest.current) return;
      handleMutationError(cause);
    }
  }, [activateItem, api, busy, currentId, handleMutationError, items, paused]);

  const adjacent = useCallback((direction: 1 | -1): SafeReviewItemDto | null => {
    if (!currentItem || items.length === 0) return null;
    const index = items.findIndex((candidate) => candidate.id === currentItem.id);
    const nextIndex = Math.min(items.length - 1, Math.max(0, index + direction));
    return items[nextIndex] ?? null;
  }, [currentItem, items]);

  const decide = useCallback(async (
    decision: { action: "approved" } | { action: "rejected"; reason: string },
  ) => {
    if (!currentItem || busy || paused) return;
    if (currentItem.state !== "pending" || currentIdRef.current !== currentItem.id) return;
    if (decision.action === "approved") {
      const loaded = loadedScreenshotRef.current;
      if (!loaded || loaded.itemId !== currentItem.id || loaded.attempt !== screenshotAttemptRef.current) return;
    }
    setBusy(true);
    setError("");
    let succeeded = false;
    try {
      const nextSession = await api.decide(currentItem.id, decision);
      setSession(nextSession);
      const next = adjacent(1);
      if (next && next.id !== currentItem.id) {
        await api.navigate(next.id);
        activateItem(next.id, items);
      }
      await fetchItems(filterRef.current, queryRef.current, next?.id ?? currentItem.id);
      succeeded = true;
    } catch (cause) {
      handleMutationError(cause);
    } finally {
      setBusy(false);
      if (succeeded) setRejectionOpen(false);
    }
  }, [activateItem, adjacent, api, busy, currentItem, fetchItems, handleMutationError, items, paused]);

  const approvalEnabled = Boolean(
    currentItem?.metadata
    && currentItem.state === "pending"
    && loadedScreenshotRef.current?.itemId === currentItem.id
    && loadedScreenshotRef.current?.attempt === screenshotAttempt
    && TemplateVisualMetadataSchema.safeParse(currentItem.metadata).success,
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editing = target?.closest("input, textarea, select, [contenteditable]") !== null;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || paused) return;
      const openDialog = document.querySelector("[role='dialog'][aria-modal='true']");
      if (openDialog) {
        if (event.key === "Escape" && rejectionOpen && !busy) {
          event.preventDefault();
          setRejectionOpen(false);
        }
        return;
      }
      if (editing) return;
      const shortcut = event.key.toLocaleLowerCase();
      if (!["a", "r", "j", "k", "e"].includes(shortcut)) return;
      event.preventDefault();
      if (shortcut === "a" && approvalEnabled && !busy) void decide({ action: "approved" });
      if (shortcut === "r" && currentItem?.metadata && currentItem.state === "pending" && !busy) setRejectionOpen(true);
      if (shortcut === "j") {
        const next = adjacent(1);
        if (next) void navigate(next.id);
      }
      if (shortcut === "k") {
        const previous = adjacent(-1);
        if (previous) void navigate(previous.id);
      }
      if (shortcut === "e") {
        const inspector = document.querySelector<HTMLElement>(".metadata-inspector");
        inspector?.focus();
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [adjacent, approvalEnabled, busy, currentItem?.metadata, decide, navigate, paused, rejectionOpen]);

  const submitIdentity = async (identity: { name: string; email: string }) => {
    setBusy(true);
    setError("");
    try {
      const nextSession = await api.submitIdentity(identity);
      setSession(nextSession);
      if (nextSession.phase === "review") {
        await fetchItems(undefined, "", nextSession.currentTemplateId);
      }
    } catch (cause) {
      setError(safeErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (session === null) {
    return <main className="review-loading" aria-live="polite">{error || "Opening local review desk…"}</main>;
  }
  if (session.phase === "identity_required") {
    return <IdentityForm busy={busy} error={error} onSubmit={submitIdentity} />;
  }

  const commitMetadata = async (field: string, value: unknown) => {
    if (!currentItem?.metadata || busy || paused) return false;
    setBusy(true);
    setError("");
    try {
      const candidate = { ...currentItem.metadata, [field]: value };
      const parsed = TemplateVisualMetadataSchema.safeParse(candidate);
      if (!parsed.success) throw new Error("metadata_invalid");
      const nextSession = await api.updateMetadata(currentItem.id, field, value);
      setSession(nextSession);
      setItems((existing) => existing.map((item) => item.id === currentItem.id ? { ...item, metadata: parsed.data } : item));
      await fetchItems(filterRef.current, queryRef.current, currentItem.id);
      setItems((existing) => existing.map((item) => item.id === currentItem.id ? { ...item, metadata: parsed.data } : item));
      return true;
    } catch (cause) {
      handleMutationError(cause);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!currentItem || busy || paused) return;
    setBusy(true);
    setError("");
    try {
      const nextSession = await api.reopen(currentItem.id);
      setSession(nextSession);
      await fetchItems(filterRef.current, queryRef.current, currentItem.id);
    } catch (cause) {
      handleMutationError(cause);
    } finally {
      setBusy(false);
    }
  };

  const runExport = async (kind: "final" | "audit") => {
    if (paused) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "final") await api.exportFinal();
      else await api.exportAudit();
    } catch (cause) {
      handleMutationError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="review-desk">
      <div className="workspace">
        <InspectionWorkspace
          item={currentItem}
          session={reviewSession!}
          screenshotState={screenshotState}
          screenshotAttempt={screenshotAttempt}
          zoom={zoom}
          onLoad={(itemId, attempt) => {
            if (currentIdRef.current !== itemId || screenshotAttemptRef.current !== attempt) return;
            loadedScreenshotRef.current = { itemId, attempt };
            setScreenshotState("loaded");
          }}
          onError={(itemId, attempt) => {
            if (currentIdRef.current !== itemId || screenshotAttemptRef.current !== attempt) return;
            loadedScreenshotRef.current = null;
            setScreenshotState("error");
          }}
          onRetry={() => {
            if (!currentItem) return;
            loadedScreenshotRef.current = null;
            const attempt = ++screenshotAttemptRef.current;
            setScreenshotAttempt(attempt);
            setScreenshotState("loading");
          }}
          onZoom={setZoom}
        />
        <div className="inspector-column">
          {paused && (
            <div className="paused-review" data-review-paused role="alert">
              <strong>Review paused</strong>
              <span>Session persistence could not be confirmed. Do not make another decision.</span>
              <span>Reload this local reviewer to resume safely. If it cannot resume, exit and restart the local review command.</span>
              <button type="button" onClick={() => window.location.reload()}>Reload local reviewer</button>
            </div>
          )}
          {error && <div className="operation-error" role="alert">{error}</div>}
          <MetadataInspector
            item={currentItem}
            approvalEnabled={approvalEnabled}
            busy={busy || paused}
            onCommit={commitMetadata}
            onApprove={() => void decide({ action: "approved" })}
            onReject={() => {
              if (!paused) setRejectionOpen(true);
            }}
            onReopen={() => void reopen()}
          />
        </div>
      </div>
      <ReviewQueue
        open={queueOpen}
        items={items}
        currentId={currentItem?.id ?? null}
        filter={filter}
        query={query}
        disabled={busy || paused}
        onToggle={() => setQueueOpen((open) => !open)}
        onFilter={(nextFilter) => {
          filterRef.current = nextFilter;
          setFilter(nextFilter);
          void fetchItemsSafely(nextFilter, queryRef.current);
        }}
        onQuery={(nextQuery) => {
          queryRef.current = nextQuery;
          setQuery(nextQuery);
          void fetchItemsSafely(filterRef.current, nextQuery);
        }}
        onNavigate={(id) => void navigate(id)}
      />
      <CompletionPanel
        session={reviewSession!}
        busy={busy || paused}
        onExportFinal={() => void runExport("final")}
        onExportAudit={() => void runExport("audit")}
      />
      {rejectionOpen && (
        <RejectionDialog
          busy={busy}
          error={error}
          onClose={() => setRejectionOpen(false)}
          onConfirm={(reason) => decide({ action: "rejected", reason })}
        />
      )}
    </main>
  );
}

const mount = typeof document === "undefined" ? null : document.getElementById("app");
if (mount) createRoot(mount).render(<ReviewerApp api={createReviewerApi()} />);
