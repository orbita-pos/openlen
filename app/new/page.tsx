"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BriefForm, SAMPLE_BRIEF } from "@/components/workspace/brief-form";
import { EditPromptModal } from "@/components/workspace/edit-prompt-modal";
import { Header } from "@/components/workspace/header";
import { PreviewPanel } from "@/components/workspace/preview-panel";
import { PublishModal } from "@/components/workspace/publish-modal";
import { SlotEditor } from "@/components/workspace/slot-editor";
import { useDarkMode } from "@/lib/use-dark-mode";
import { useGeneration } from "@/lib/use-generation";
import { cn } from "@/lib/cn";
import type { FilledBlock } from "@/lib/orchestrator/types";

// Outer shell exists only so useSearchParams() inside NewPageInner gets a
// Suspense boundary — required by Next.js for client-side route params.
export default function NewPage() {
  return (
    <Suspense fallback={null}>
      <NewPageInner />
    </Suspense>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot-editor cache. Keyed by generationId so an edit on page A doesn't bleed
// into page B even if the same browser session generated both. Each entry is
// the in-progress filledBlocks JSON. Auth/DB persistence is out of scope for
// Session 8 — localStorage is a "draft" surface that survives reloads.
// ─────────────────────────────────────────────────────────────────────────────
const EDIT_CACHE_PREFIX = "inari-edit/";
const REASSEMBLE_DEBOUNCE_MS = 300;

function cacheKey(generationId: string): string {
  return `${EDIT_CACHE_PREFIX}${generationId}`;
}

function readEditCache(generationId: string): FilledBlock[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(generationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FilledBlock[];
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEditCache(generationId: string, blocks: FilledBlock[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(cacheKey(generationId), JSON.stringify(blocks));
  } catch {
    // localStorage may be full or disabled — silently drop. The in-memory
    // state still works for the session.
  }
}

function clearEditCache(generationId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(cacheKey(generationId));
  } catch {
    // ignore
  }
}

function NewPageInner() {
  const [dark, toggleDark] = useDarkMode();
  const {
    state,
    generate,
    regenerateSection,
    loadProject,
    applyLiveEdit,
    resetToOriginal,
  } = useGeneration();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");
  const briefParam = searchParams.get("brief");
  const publishParam = searchParams.get("publish");
  const [editTarget, setEditTarget] = useState<{
    sectionId: string;
    sectionName: string;
  } | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);

  // Session 11 — publish state. Fetched from /api/projects/[id] alongside
  // the data the workspace already pulls; not threaded through useGeneration
  // because WorkspaceState only carries page-render data. Tracking it
  // separately keeps the change surface small.
  const [publishState, setPublishState] = useState<{
    subdomain: string | null;
    publishedAt: Date | null;
    hasUnpublishedChanges: boolean;
  }>({ subdomain: null, publishedAt: null, hasUnpublishedChanges: false });
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const publishAutoOpenedRef = useRef(false);

  const refreshPublishState = useCallback(
    async (projectId: string) => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          project: {
            subdomain: string | null;
            publishedAt: string | null;
            hasUnpublishedChanges: boolean;
          };
        };
        setPublishState({
          subdomain: data.project.subdomain,
          publishedAt: data.project.publishedAt
            ? new Date(data.project.publishedAt)
            : null,
          hasUnpublishedChanges: data.project.hasUnpublishedChanges,
        });
      } catch {
        // Network blip — leave state as-is.
      }
    },
    [],
  );

  const [prompt, setPrompt] = useState(() => briefParam?.trim() || SAMPLE_BRIEF);
  const [projectName, setProjectName] = useState("Untitled");
  const [savedLabel, setSavedLabel] = useState("Saved 2 min ago");
  const [panelOpen, setPanelOpen] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editorSavedLabel, setEditorSavedLabel] = useState<string | null>(null);
  // Default ON so first-time users see the full visual experience. Off means
  // FLUX/Wan are skipped and the page renders text-only.
  const [includeImages, setIncludeImages] = useState(true);

  const generating = state.kind === "generating";
  const generated = state.kind === "generated";

  const handleGenerate = useCallback(() => {
    if (generating) return;
    const brief = prompt.trim();
    if (brief.length < 10) return;
    setSavedLabel("Saving…");
    void generate({ brief, images: includeImages });
  }, [generating, prompt, includeImages, generate]);

  useEffect(() => {
    if (state.kind === "generated") setSavedLabel("Saved just now");
  }, [state.kind]);

  // Load a saved project when /new?project=<id> opens. Guard with a ref so
  // a re-render with the same param doesn't re-fetch (which would clobber
  // any in-flight regen).
  const loadedProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectParam) return;
    if (loadedProjectRef.current === projectParam) return;
    loadedProjectRef.current = projectParam;
    void loadProject(projectParam);
  }, [projectParam, loadProject]);

  // Keep the header project name in sync with whichever project is open.
  useEffect(() => {
    if (state.kind === "generated" && state.title) {
      setProjectName(state.title);
    }
  }, [state]);

  // Refresh publish state whenever we land on a project (either via
  // ?project= or via the project_saved SSE event after a fresh generation).
  useEffect(() => {
    if (state.kind !== "generated") return;
    const pid = state.projectId;
    if (!pid) return;
    void refreshPublishState(pid);
  }, [state, refreshPublishState]);

  // Auto-open the publish modal when /new?project=<id>&publish=1 is hit —
  // only once per page load and only after the project finished loading.
  useEffect(() => {
    if (publishParam !== "1") return;
    if (publishAutoOpenedRef.current) return;
    if (state.kind !== "generated") return;
    if (!state.projectId) return;
    publishAutoOpenedRef.current = true;
    setPublishModalOpen(true);
  }, [publishParam, state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleGenerate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleGenerate]);

  const handleDownloadZip = useCallback(async () => {
    if (state.kind !== "generated" || downloadingZip) return;
    setDownloadingZip(true);
    try {
      const response = await fetch("/api/export/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.result),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        // eslint-disable-next-line no-alert
        alert(`Couldn't build the zip: ${text}`);
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "landing-page.zip";
      triggerBlobDownload(blob, filename);
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Couldn't build the zip: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloadingZip(false);
    }
  }, [state, downloadingZip]);

  // ──────────────────────────────────────────────────────────────────────────
  // Slot editing: debounced /api/reassemble + localStorage persistence.
  // The page component owns the debounce timer + an abort controller so a
  // burst of keystrokes coalesces into one round-trip.
  //
  // Regen-vs-reassemble race: a reassemble started just before a regen click
  // could land its (stale, pre-regen) html AFTER the regen result, overwriting
  // the freshly regenerated block. We guard with two mechanisms:
  //   1. `regenEpochRef` — bumped each time a regen completes. The reassemble
  //      callback compares the captured epoch to the current one and drops
  //      the result if it changed mid-flight.
  //   2. An effect that watches `state.regen` and aborts the pending timer +
  //      fetch the moment a regen starts.
  // ──────────────────────────────────────────────────────────────────────────
  const reassembleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reassembleAbortRef = useRef<AbortController | null>(null);
  const regenEpochRef = useRef(0);
  const wasRegenInFlightRef = useRef(false);

  // Hydrate from localStorage when a fresh generation result lands. If the
  // user previously edited THIS page (same generationId), restore their work
  // and request a fresh reassemble so the iframe matches. The hydration ref
  // makes sure we only run this once per generationId — without it, our own
  // applyLiveEdit calls would loop us back here.
  const hydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.kind !== "generated") return;
    const id = state.result.meta.generationId;
    if (hydratedRef.current === id) return;
    const cached = readEditCache(id);
    hydratedRef.current = id;
    if (!cached) return;
    // Apply optimistic blocks, then ask the server for fresh html so the
    // preview iframe is in sync. If the request fails we silently keep the
    // blocks — the user can edit again to force another reassemble.
    applyLiveEdit(cached);
    void reassembleNow(state.result.plan, cached, state.result.images, state.result.meta.intent)
      .then((html) => {
        if (html) applyLiveEdit(cached, html);
      })
      .catch(() => {
        // ignore — see comment above
      });
  }, [state, applyLiveEdit]);

  // Sync localStorage with the live filledBlocks every time the result
  // changes. Without this, a regenerate-section after manual edits leaves
  // localStorage stale: a reload would override the freshly-regenerated
  // block with the prior manual edit. Writing on every change keeps the
  // cache canonical at the cost of one extra serialize-and-write per regen.
  useEffect(() => {
    if (state.kind !== "generated") return;
    const id = state.result.meta.generationId;
    // Skip until hydration has decided whether to keep or overwrite the
    // cached payload. Otherwise we'd race: the sync writes the AI baseline
    // before the hydration reads, then the cache contents are lost.
    if (hydratedRef.current !== id) return;
    const dirty = !slotsArrayEqual(
      state.result.filledBlocks,
      state.originalFilledBlocks,
    );
    if (dirty) {
      writeEditCache(id, state.result.filledBlocks);
    } else {
      clearEditCache(id);
    }
  }, [state]);

  // Watch state.regen. When a regen starts, cancel any in-flight reassemble
  // so its stale result doesn't land on top of the regenerated block. When a
  // regen completes, bump the epoch — any *captured* epoch on a fetch that's
  // still in flight will no longer match, so its .then() callback will drop.
  useEffect(() => {
    const inFlight = state.kind === "generated" && state.regen !== undefined;
    if (inFlight && !wasRegenInFlightRef.current) {
      if (reassembleTimerRef.current) {
        clearTimeout(reassembleTimerRef.current);
        reassembleTimerRef.current = null;
      }
      reassembleAbortRef.current?.abort();
    }
    if (!inFlight && wasRegenInFlightRef.current) {
      regenEpochRef.current += 1;
    }
    wasRegenInFlightRef.current = inFlight;
  }, [state]);

  const handleSlotsChange = useCallback(
    (newFilledBlocks: FilledBlock[]) => {
      if (state.kind !== "generated") return;
      // Optimistic local update — iframe shows stale html until reassemble
      // resolves, but the accordion reflects the edit immediately. The sync
      // effect above pushes the new blocks to localStorage on the next render.
      applyLiveEdit(newFilledBlocks);

      // While a regen is in flight, skip the round-trip entirely. The regen
      // will ship its own fresh html in ~10s, and reassembling against the
      // pre-regen filledBlocks would either (a) lose the regen, or (b) be
      // dropped by the epoch check anyway. Either way it's wasted work.
      if (state.regen) {
        setEditorSavedLabel("Regenerating — edits resume after");
        return;
      }
      setEditorSavedLabel("Saving…");

      // Debounce server round-trip.
      if (reassembleTimerRef.current) {
        clearTimeout(reassembleTimerRef.current);
      }
      reassembleAbortRef.current?.abort();
      const epochAtStart = regenEpochRef.current;
      reassembleTimerRef.current = setTimeout(() => {
        const controller = new AbortController();
        reassembleAbortRef.current = controller;
        void reassembleNow(
          state.result.plan,
          newFilledBlocks,
          state.result.images,
          state.result.meta.intent,
          controller.signal,
        )
          .then((html) => {
            if (!html) return;
            // Drop stale html if a regen completed (or started) while we were
            // fetching. The regen's filledBlocks are authoritative.
            if (regenEpochRef.current !== epochAtStart) return;
            applyLiveEdit(newFilledBlocks, html);
            setEditorSavedLabel("Saved locally");
          })
          .catch((err) => {
            if (controller.signal.aborted) return;
            // eslint-disable-next-line no-console
            console.error("reassemble failed:", err);
            setEditorSavedLabel("Couldn't save — retry?");
          });
      }, REASSEMBLE_DEBOUNCE_MS);
    },
    [state, applyLiveEdit],
  );

  // Cleanup any pending reassemble when the page unmounts so we don't leak
  // a timer or a fetch into the next route.
  useEffect(() => {
    return () => {
      if (reassembleTimerRef.current) clearTimeout(reassembleTimerRef.current);
      reassembleAbortRef.current?.abort();
    };
  }, []);

  const handleResetAllEdits = useCallback(() => {
    if (state.kind !== "generated") return;
    clearEditCache(state.result.meta.generationId);
    resetToOriginal();
    setEditorSavedLabel("Reset to AI version");
    // Reassemble immediately — the optimistic UI already shows the original
    // blocks, but the html still reflects edits until we re-render.
    void reassembleNow(
      state.result.plan,
      state.originalFilledBlocks,
      state.result.images,
      state.result.meta.intent,
    ).then((html) => {
      if (html) applyLiveEdit(state.originalFilledBlocks, html);
    });
  }, [state, resetToOriginal, applyLiveEdit]);

  const cost = state.kind === "generated" ? state.result.cost : undefined;
  const formState = useMemo(
    () => ({ prompt, setPrompt }),
    [prompt],
  );

  const sidebarOpen = panelOpen || editMode;

  return (
    <div className="md:h-screen flex flex-col min-h-screen md:min-h-0">
      <Header
        saved={!generating}
        savedLabel={generating ? "Saving…" : savedLabel}
        dark={dark}
        onToggleDark={toggleDark}
        projectName={projectName}
        onRename={setProjectName}
        generated={generated}
        totalCost={cost?.total}
        onDownloadZip={generated ? handleDownloadZip : undefined}
        downloadingZip={downloadingZip}
        published={
          publishState.subdomain
            ? {
                subdomain: publishState.subdomain,
                hasUnpublishedChanges: publishState.hasUnpublishedChanges,
              }
            : null
        }
        onPublishClick={
          generated && state.kind === "generated" && state.projectId
            ? () => setPublishModalOpen(true)
            : undefined
        }
      />
      <div
        className={cn(
          "flex-1 min-h-0 grid grid-cols-1 transition-[grid-template-columns] duration-300 ease-out",
          sidebarOpen
            ? "md:grid-cols-[minmax(360px,40%)_minmax(0,1fr)]"
            : "md:grid-cols-[0_minmax(0,1fr)]",
        )}
      >
        <div
          className={cn(
            "min-w-0 min-h-0 overflow-hidden transition-opacity duration-200",
            !sidebarOpen && "md:opacity-0 md:pointer-events-none",
          )}
        >
          {editMode && state.kind === "generated" ? (
            <SlotEditorWithReset
              filledBlocks={state.result.filledBlocks}
              originalBlocks={state.originalFilledBlocks}
              onSlotsChange={handleSlotsChange}
              onClose={() => setEditMode(false)}
              savedLabel={editorSavedLabel ?? "Changes preview live"}
              onResetAll={handleResetAllEdits}
              generationId={state.result.meta.generationId}
            />
          ) : (
            <BriefForm
              state={formState}
              onGenerate={handleGenerate}
              generating={generating}
              onCollapse={() => setPanelOpen(false)}
              includeImages={includeImages}
              onToggleIncludeImages={setIncludeImages}
            />
          )}
        </div>
        <div className="flex flex-col min-w-0 min-h-0 overflow-hidden">
          <PreviewPanel
            state={state}
            panelOpen={sidebarOpen}
            onOpenPanel={() => {
              if (editMode) setEditMode(false);
              setPanelOpen(true);
            }}
            onRegenSection={(sectionId, sectionName) =>
              void regenerateSection({ sectionId, sectionName, mode: "regen" })
            }
            onEditSection={(sectionId, sectionName) =>
              setEditTarget({ sectionId, sectionName })
            }
            editMode={editMode}
            onToggleEdit={
              generated
                ? () => {
                    if (!editMode) setPanelOpen(false);
                    setEditMode((v) => !v);
                  }
                : undefined
            }
          />
        </div>
      </div>
      {editTarget && (
        <EditPromptModal
          sectionName={editTarget.sectionName}
          onCancel={() => setEditTarget(null)}
          onApply={(instruction) => {
            const { sectionId, sectionName } = editTarget;
            setEditTarget(null);
            void regenerateSection({
              sectionId,
              sectionName,
              additionalInstruction: instruction,
              mode: "edit",
            });
          }}
        />
      )}

      {state.kind === "generated" && state.projectId && (
        <PublishModal
          open={publishModalOpen}
          onClose={() => setPublishModalOpen(false)}
          project={{
            id: state.projectId,
            subdomain: publishState.subdomain,
            publishedAt: publishState.publishedAt,
            hasUnpublishedChanges: publishState.hasUnpublishedChanges,
          }}
          onSuccess={(newSubdomain) => {
            // Optimistic update so the header pill flips immediately; a
            // background refresh follows to pick up publishedAt + drift.
            setPublishState((prev) => ({
              ...prev,
              subdomain: newSubdomain,
              publishedAt: newSubdomain ? new Date() : null,
              hasUnpublishedChanges: false,
            }));
            if (state.projectId) void refreshPublishState(state.projectId);
          }}
        />
      )}
    </div>
  );
}

// Thin wrapper to surface a top-of-sidebar "Reset all edits" affordance
// without bloating the SlotEditor's prop surface. Keeps SlotEditor reusable
// for future surfaces that don't have a destructive top-level reset.
function SlotEditorWithReset({
  filledBlocks,
  originalBlocks,
  onSlotsChange,
  onClose,
  savedLabel,
  onResetAll,
  generationId,
}: {
  filledBlocks: FilledBlock[];
  originalBlocks: FilledBlock[];
  onSlotsChange: (b: FilledBlock[]) => void;
  onClose: () => void;
  savedLabel: string;
  onResetAll: () => void;
  generationId: string;
}) {
  const dirty =
    JSON.stringify(filledBlocks.map((b) => b.slots)) !==
    JSON.stringify(originalBlocks.map((b) => b.slots));

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <SlotEditor
          filledBlocks={filledBlocks}
          originalBlocks={originalBlocks}
          onSlotsChange={onSlotsChange}
          onClose={onClose}
          savedLabel={savedLabel}
          generationId={generationId}
        />
      </div>
      {dirty && (
        <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0a0a0a] px-4 py-2.5">
          <button
            type="button"
            onClick={onResetAll}
            className="text-[11px] text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400 transition"
          >
            Reset entire page to AI version
          </button>
        </div>
      )}
    </div>
  );
}

function slotsArrayEqual(a: FilledBlock[], b: FilledBlock[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  // Slot payloads come from the same Zod schema so key order is stable
  // enough that JSON.stringify matches for unchanged content. False
  // positives (different orders, same content) at worst light up the dirty
  // dot — they don't corrupt state.
  try {
    return (
      JSON.stringify(a.map((block) => block.slots)) ===
      JSON.stringify(b.map((block) => block.slots))
    );
  } catch {
    return false;
  }
}

async function reassembleNow(
  plan: import("@/lib/orchestrator/types").Plan,
  filledBlocks: FilledBlock[],
  images: import("@/lib/orchestrator/types").GeneratedImage[],
  intent: import("@/lib/orchestrator/types").Intent,
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await fetch("/api/reassemble", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, filledBlocks, images, intent }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `reassemble HTTP ${res.status}`);
  }
  const data = (await res.json()) as { html?: string };
  return data.html ?? null;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
