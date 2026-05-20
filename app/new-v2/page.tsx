"use client";

import "./tokens.css";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PublishModal } from "@/components/workspace/publish-modal";
import { useGeneration } from "@/lib/use-generation";
import { AutofillModal } from "@/components/workspace-v2/autofill-modal";
import { EmptyState } from "@/components/workspace-v2/empty-state";
import { LeftSidebar, type SidebarMode } from "@/components/workspace-v2/left-sidebar";
import { PreviewPlaceholder } from "@/components/workspace-v2/preview-placeholder";
import { SECTIONS, type Section } from "@/components/workspace-v2/mock-data";
import { PreviewArea } from "@/components/workspace-v2/preview-area";
import {
  ReplaceAssetModal,
  type ReplaceKind,
  type ReplacePayload,
} from "@/components/workspace-v2/replace-asset-modal";
import { StatusBar } from "@/components/workspace-v2/status-bar";
import { TopBar } from "@/components/workspace-v2/top-bar";
import { useDarkMode } from "@/lib/use-dark-mode";

// Outer shell exists so `useSearchParams()` in the inner component has a
// Suspense boundary, matching the /new V1 pattern.
export default function NewV2Page() {
  return (
    <Suspense fallback={null}>
      {/* Fonts the workspace chrome + iframe-injected previews use. Next
          hoists these to <head>. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Instrument+Serif:ital@0;1&family=Inter+Tight:ital,wght@0,400..700;1,400..700&family=Inter:ital,wght@0,400..700;1,400..700&family=JetBrains+Mono:ital,wght@0,400..600;1,400..600&family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Crimson+Pro:ital,wght@0,400..700;1,400..700&display=swap"
      />
      <NewV2Inner />
    </Suspense>
  );
}

interface LoadedProject {
  id: string;
  title: string;
  subdomain: string | null;
  publishedAt: Date | null;
  hasUnpublishedChanges: boolean;
  /** The rendered HTML stored at project.data.html — what we feed the
   *  preview iframe AND what `publishProject` writes to disk on Deploy.
   *  Empty string for projects whose orchestrator never set it (legacy
   *  rows pre-Session-12). */
  html: string;
  /** True when this project was created from a template or pasted HTML —
   *  i.e. `data.filledBlocks` is empty. Flat projects don't have slot-
   *  based structure, so customization splits into two surfaces:
   *  - **Chat tab** redesigns the page end-to-end via Kimi K2.6 streaming.
   *  - **Content tab** activates contentEditable in the iframe so the
   *    user can click any text and edit it directly (autosaved). */
  isFlat: boolean;
  /** Persistent AI context from the Brief sidebar tab — auto-prepended
   *  to every Chat tab prompt by `/api/templates/ai-design`. */
  userBrief: string;
}

type EntryMode = "choosing" | "ai" | "template" | "paste" | "editing";

const ALL_TABS: SidebarMode[] = [
  "chat",
  "content",
  "templates",
  "pages",
  "versions",
  "brief",
];

function NewV2Inner() {
  const [dark, toggleDark] = useDarkMode();
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectParam = searchParams.get("project");
  const modeParam = searchParams.get("mode");

  // Derive the entry mode from URL state. With ?project=<id> we go straight
  // to editing; with ?mode=<ai|template|paste> we enter that guided flow;
  // otherwise we show the chooser. Keeping it in the URL means refreshes and
  // shared links land users in the same spot.
  const entryMode: EntryMode = projectParam
    ? "editing"
    : modeParam === "ai" ||
        modeParam === "template" ||
        modeParam === "paste"
      ? modeParam
      : "choosing";

  const [projectName, setProjectName] = useState("Pricing Page");
  const [mode, setMode] = useState<SidebarMode>(
    entryMode === "template"
      ? "templates"
      : entryMode === "paste"
        ? "content"
        : "chat",
  );
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedProject, setLoadedProject] = useState<LoadedProject | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [autofillModalOpen, setAutofillModalOpen] = useState(false);

  // Section-select coordination — iframe ↔ chat composer. The Chat panel
  // toggles `sectionSelectMode`; PreviewArea injects the selection script
  // into the iframe and listens for the resulting postMessage at this level
  // (so the captured payload can flow back into the chat composer's chip).
  const [sectionSelectMode, setSectionSelectMode] = useState(false);
  const [scopedSelection, setScopedSelection] = useState<{
    hint: string;
    path: string;
  } | null>(null);
  const [assetModal, setAssetModal] = useState<{
    kind: ReplaceKind;
    path: string;
    currentSvg: string | null;
    currentSrc: string | null;
  } | null>(null);
  const [pendingChatDraft, setPendingChatDraft] = useState<string | null>(null);
  const iframeElRef = useRef<HTMLIFrameElement | null>(null);

  // AI generation flow — owned here so the brief survives panel switches
  // inside the same /new-v2?mode=ai session. On completion, we redirect
  // to ?project=<id> which drops the user into editing mode.
  const {
    state: aiGenState,
    generate: aiGenerate,
  } = useGeneration();
  // Brief can be pre-filled from a deep link (homepage hero CTA, projects
  // example cards, etc.) via ?brief=<urlencoded>.
  const briefParam = searchParams.get("brief");
  const [aiPrompt, setAiPrompt] = useState(() => briefParam?.trim() ?? "");
  const aiBriefFormState = useMemo(
    () => ({ prompt: aiPrompt, setPrompt: setAiPrompt }),
    [aiPrompt],
  );
  const aiGenerating = aiGenState.kind === "generating";
  const handleAiGenerate = useCallback(() => {
    if (aiGenerating) return;
    const brief = aiPrompt.trim();
    if (brief.length < 10) return;
    void aiGenerate(brief);
  }, [aiGenerating, aiPrompt, aiGenerate]);
  // When generation completes and the project has been persisted, drop
  // the user into the editing surface for that project.
  useEffect(() => {
    if (aiGenState.kind !== "done") return;
    window.location.href = `/new-v2?project=${aiGenState.projectId}`;
  }, [aiGenState]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "openlen:section-selected") {
        if (
          typeof data.hint === "string" &&
          typeof data.path === "string"
        ) {
          setScopedSelection({ hint: data.hint, path: data.path });
        }
        setSectionSelectMode(false);
      } else if (data.type === "openlen:section-select-cancelled") {
        setSectionSelectMode(false);
      } else if (data.type === "openlen:reorder-cancelled") {
        // Legacy event — kept for back-compat with iframe scripts that
        // still post it. With always-on editing there's no mode to flip.
      } else if (data.type === "openlen:replace-cancelled") {
        // Same — legacy. Close any open asset modal as a courtesy.
        setAssetModal(null);
      } else if (data.type === "openlen:asset-clicked") {
        const kind = data.kind === "icon" || data.kind === "image"
          ? (data.kind as ReplaceKind)
          : null;
        if (!kind || typeof data.path !== "string") return;
        setAssetModal({
          kind,
          path: data.path,
          currentSvg:
            typeof data.currentSvg === "string" ? data.currentSvg : null,
          currentSrc:
            typeof data.currentSrc === "string" ? data.currentSrc : null,
        });
      } else if (data.type === "openlen:asset-copy-chip-clicked") {
        const kind =
          data.kind === "icon" || data.kind === "image"
            ? (data.kind as ReplaceKind)
            : null;
        if (
          !kind ||
          typeof data.path !== "string" ||
          typeof data.hint !== "string"
        ) {
          return;
        }
        // Exit replace mode so the chat surface gets full attention,
        // scope the next chat to the swapped element (hard-pin via path),
        // switch to the Chat tab, and push a context-aware draft into the
        // composer. The user can hit Send as-is or edit first.
        setAssetModal(null);
        setScopedSelection({ hint: data.hint, path: data.path });
        setMode("chat");
        setPendingChatDraft(
          kind === "icon"
            ? "I just changed the icon here. Update the surrounding title and description so the meaning matches the new icon."
            : "I just changed the image here. Update the surrounding copy so it matches what the image shows.",
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  // Leaving the Chat tab drops the in-progress selection mode (selection
  // chip persists so the user comes back to it).
  useEffect(() => {
    if (mode !== "chat" && sectionSelectMode) setSectionSelectMode(false);
  }, [mode, sectionSelectMode]);

  const [sections, setSections] = useState<Section[]>(SECTIONS);
  const [expanded, setExpanded] = useState<string | null>("hero");

  // Selected template the user is previewing in the main area. Clicking
  // a card sets this; clicking "Use this template →" in the preview banner
  // commits (creates a project + redirects). Click "Clear" resets to null.
  const [previewingTemplate, setPreviewingTemplate] = useState<{
    id: string;
    name: string;
    previewUrl: string;
  } | null>(null);
  const [committingTemplate, setCommittingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // Light-up "Saving…" pill for 700ms whenever a section field mutates.
  const updateSection = useCallback(
    (id: string, fields: Section["fields"]) => {
      setSaving(true);
      setSections((prev) =>
        prev.map((s) => (s.id === id ? { ...s, fields } : s)),
      );
      window.setTimeout(() => setSaving(false), 700);
    },
    [],
  );

  // Load real project metadata when /new-v2?project=<id> opens. The mock
  // preview iframe stays in charge of visual content for this session —
  // wiring V3 primitives into the preview is deferred to a follow-up.
  const refetchProject = useCallback(
    async (id: string): Promise<void> => {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as
        | {
            project?: {
              id: string;
              title: string;
              subdomain: string | null;
              publishedAt: string | null;
              hasUnpublishedChanges: boolean;
              tags?: string[];
              userBrief?: string | null;
              data: { html?: string; filledBlocks?: unknown[] };
            };
          }
        | null;
      const p = data?.project;
      if (!p) return;
      const filledCount = Array.isArray(p.data?.filledBlocks)
        ? p.data.filledBlocks.length
        : 0;
      const html = p.data?.html ?? "";
      setLoadedProject({
        id: p.id,
        title: p.title,
        subdomain: p.subdomain,
        publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
        hasUnpublishedChanges: p.hasUnpublishedChanges,
        html,
        isFlat: filledCount === 0,
        userBrief: p.userBrief ?? "",
      });
      setProjectName(p.title);
    },
    [],
  );

  useEffect(() => {
    if (!projectParam) {
      setLoadedProject(null);
      return;
    }
    let cancelled = false;
    void refetchProject(projectParam).catch(() => {
      if (cancelled) return;
      /* network blip — leave demo state */
    });
    return () => {
      cancelled = true;
    };
  }, [projectParam, refetchProject]);

  const published = loadedProject?.subdomain
    ? {
        subdomain: loadedProject.subdomain,
        hasUnpublishedChanges: loadedProject.hasUnpublishedChanges,
      }
    : null;

  const onPublish = loadedProject ? () => setPublishModalOpen(true) : undefined;
  // Editing mode = Content (pencil) tab is active on a loaded project.
  // Gates ALL iframe affordances: drag handles, image/icon replace,
  // and (for flat projects) inline-edit. Other tabs render the iframe
  // clean — no hover outlines, no drag, no replace buttons.
  const editingActive =
    mode === "content" &&
    entryMode === "editing" &&
    !!loadedProject;
  // Autofill is a flat-project feature (you fill a template's generic copy
  // with your business data). It doesn't apply to slot-based AI projects
  // which already have AI-generated content for each slot.
  const onAutofill =
    loadedProject?.isFlat ? () => setAutofillModalOpen(true) : undefined;

  // Compute which sidebar tabs are locked based on the entry mode + the
  // loaded project's shape. In an entry flow, only the relevant tab is
  // interactive. In editing mode every tab opens — flat projects show a
  // hint-only Content panel (no slot form) and the iframe enters inline
  // edit when that tab is active.
  const lockedTabs = useMemo<SidebarMode[]>(() => {
    if (entryMode === "editing") return [];
    if (entryMode === "choosing") return [...ALL_TABS];
    if (entryMode === "ai") return ALL_TABS.filter((t) => t !== "chat");
    if (entryMode === "template")
      return ALL_TABS.filter((t) => t !== "templates");
    if (entryMode === "paste") return ALL_TABS.filter((t) => t !== "content");
    return [];
  }, [entryMode]);

  const lockReason =
    entryMode === "choosing"
      ? "Pick a starting point first"
      : "Available once your page is created";

  // If the project's "shape" makes the current sidebar tab inert, snap to
  // the first unlocked tab. Without this, a flat project loaded straight
  // into a locked mode would leave the user staring at a panel they can't
  // interact with (the tab button is locked, but the panel content would
  // still render because state outlived the lock decision).
  useEffect(() => {
    if (lockedTabs.includes(mode)) {
      const next = ALL_TABS.find((t) => !lockedTabs.includes(t));
      if (next && next !== mode) setMode(next);
    }
  }, [lockedTabs, mode]);

  // When the workspace transitions into "editing" (e.g. a template-clone or
  // paste flow commits and we land on ?project=<id>), drop the user on the
  // Chat tab — that's the design surface for flat projects and the most
  // useful starting point for rich projects too. Without this hook the user
  // would stay on "templates" (the entry-flow default) after a commit.
  const prevEntryModeRef = useRef(entryMode);
  useEffect(() => {
    if (
      entryMode === "editing" &&
      prevEntryModeRef.current !== "editing"
    ) {
      setMode("chat");
    }
    prevEntryModeRef.current = entryMode;
  }, [entryMode]);

  // Inline editing is activated implicitly by the Content sidebar tab.
  // Used to be gated on `isFlat` (flat = template-clone / paste) but the
  // distinction is gone now — the same contentEditable + Reorder +
  // Replace surface works for every project, AI-generated or not. The
  // PATCH path (/api/projects/<id>/html) doesn't care about isFlat.
  const editableInjection =
    mode === "content" && entryMode === "editing" && !!loadedProject;

  // Save state surfaced to TopBar (chrome polish session renders the pill;
  // we just track it here so the contract is wired end-to-end).
  const [savingStatus, setSavingStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const saveTimerRef = useRef<number | null>(null);
  const savedFlashRef = useRef<number | null>(null);

  // Listen for the iframe's `openlen:html-changed` messages whenever the
  // user is in Content tab editing mode. Inline-edit, Reorder, and
  // Replace all emit via this same contract; the scripts only inject
  // when editingActive is true, so we only accept messages then.
  const acceptsHtmlChanged = editingActive;
  useEffect(() => {
    if (!acceptsHtmlChanged || !loadedProject) return;
    const projectId = loadedProject.id;

    const onMessage = (e: MessageEvent) => {
      if (!e.data || e.data.type !== "openlen:html-changed") return;
      const html = typeof e.data.outerHtml === "string" ? e.data.outerHtml : "";
      if (!html) return;
      const source =
        e.data.source === "reorder"
          ? "reorder"
          : e.data.source === "replace"
            ? "replace"
            : "inline-edit";
      setLoadedProject((prev) =>
        prev && prev.id === projectId ? { ...prev, html } : prev,
      );
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        setSavingStatus("saving");
        void fetch(`/api/projects/${projectId}/html`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ html, source }),
        })
          .then((r) => {
            setSavingStatus(r.ok ? "saved" : "idle");
            if (r.ok) {
              setLoadedProject((prev) =>
                prev && prev.id === projectId
                  ? { ...prev, hasUnpublishedChanges: !!prev.subdomain }
                  : prev,
              );
              if (savedFlashRef.current !== null)
                window.clearTimeout(savedFlashRef.current);
              savedFlashRef.current = window.setTimeout(
                () => setSavingStatus("idle"),
                1600,
              );
            }
          })
          .catch(() => setSavingStatus("idle"));
      }, 500);
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (savedFlashRef.current !== null) {
        window.clearTimeout(savedFlashRef.current);
        savedFlashRef.current = null;
      }
    };
  }, [acceptsHtmlChanged, loadedProject?.id, loadedProject?.subdomain]);

  // Reset transient interaction modes whenever the loaded project changes
  // (cross-project switches inside /new-v2). Without this, the iframe
  // derive effect would refuse to refresh srcDoc while reorder or inline-
  // edit is active, leaving the user staring at the OLD project's HTML.
  const prevLoadedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const newId = loadedProject?.id ?? null;
    if (newId !== prevLoadedIdRef.current) {
      setSectionSelectMode(false);
      setScopedSelection(null);
      setAssetModal(null);
      setPendingChatDraft(null);
    }
    prevLoadedIdRef.current = newId;
  }, [loadedProject?.id]);

  // ⌘E toggles to/from the Content tab; Esc backs out of the active mode.
  // The iframe-injected scripts have their own Esc handlers, but those only
  // fire when the iframe itself has focus — this covers the common case
  // where the user activated a mode from the sidebar, so keyboard focus is
  // on the parent document and the iframe never sees the keypress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (entryMode !== "editing" || !loadedProject) return;
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea/i.test(t.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setMode((prev) => (prev === "content" ? "chat" : "content"));
        return;
      }
      if (e.key === "Escape") {
        // A modal owns Escape while it's open.
        if (publishModalOpen || autofillModalOpen || assetModal) return;
        if (sectionSelectMode) {
          e.preventDefault();
          setSectionSelectMode(false);
          return;
        }
        if (mode === "content") {
          e.preventDefault();
          setMode("chat");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    entryMode,
    loadedProject,
    mode,
    sectionSelectMode,
    publishModalOpen,
    autofillModalOpen,
    assetModal,
  ]);

  const handlePickAI = () => {
    router.push("/new-v2?mode=ai");
  };
  const handlePickTemplate = () => {
    router.push("/new-v2?mode=template");
    setMode("templates");
  };
  const handlePickPaste = () => {
    router.push("/new-v2?mode=paste");
    setMode("content");
  };

  const handleUseTemplate = async () => {
    if (!previewingTemplate || committingTemplate) return;
    setCommittingTemplate(true);
    setTemplateError(null);
    try {
      const res = await fetch("/api/projects/from-template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: previewingTemplate.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        setTemplateError(
          data.message ?? data.error ?? `HTTP ${res.status}`,
        );
        setCommittingTemplate(false);
        return;
      }
      const data = (await res.json()) as { projectId: string };
      // Hard nav so the page re-mounts with the new project loaded.
      window.location.href = `/new-v2?project=${data.projectId}`;
    } catch (err) {
      setTemplateError(
        err instanceof Error ? err.message : "Network error — try again.",
      );
      setCommittingTemplate(false);
    }
  };

  return (
    <div className="workspace-v2 h-full flex flex-col">
      <TopBar
        projectName={projectName}
        onRename={setProjectName}
        projectLoading={!!projectParam && !loadedProject}
        savingStatus={savingStatus}
        onPublish={onPublish}
        published={published}
        projectId={loadedProject?.id}
        onRolledBack={() => {
          if (loadedProject?.id) {
            void refetchProject(loadedProject.id);
          }
        }}
        dark={dark}
        onToggleDark={toggleDark}
      />
      <div className="flex-1 min-h-0 flex">
        <LeftSidebar
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((c) => !c)}
          mode={mode}
          setMode={setMode}
          sections={sections}
          expanded={expanded}
          setExpanded={setExpanded}
          onUpdateSection={updateSection}
          onPreviewTemplate={(t) => {
            setPreviewingTemplate(t);
            setTemplateError(null);
          }}
          previewingTemplateId={previewingTemplate?.id ?? null}
          lockedTabs={lockedTabs}
          lockReason={lockReason}
          entryMode={entryMode}
          flatProjectHtml={loadedProject?.html}
          flatProjectId={loadedProject?.id}
          onFlatHtmlUpdate={(newHtml) =>
            setLoadedProject((prev) =>
              prev ? { ...prev, html: newHtml } : prev,
            )
          }
          projectLoading={!!projectParam && !loadedProject}
          savingStatus={savingStatus}
          currentProjectId={loadedProject?.id ?? null}
          onRestoreApplied={(newHtml) =>
            setLoadedProject((prev) =>
              prev ? { ...prev, html: newHtml } : prev,
            )
          }
          initialBrief={loadedProject?.userBrief ?? ""}
          onBriefSaved={(newBrief) =>
            setLoadedProject((prev) =>
              prev ? { ...prev, userBrief: newBrief } : prev,
            )
          }
          sectionSelectMode={sectionSelectMode}
          onToggleSectionSelect={(active) => {
            setSectionSelectMode(active);
            if (!active) {
              /* nothing else — user can cancel and re-engage */
            }
          }}
          scopedSelection={scopedSelection}
          onClearScope={() => setScopedSelection(null)}
          onAutofill={onAutofill}
          pendingDraft={pendingChatDraft}
          onPendingDraftConsumed={() => setPendingChatDraft(null)}
          aiBriefState={aiBriefFormState}
          aiOnGenerate={handleAiGenerate}
          aiGenerating={aiGenerating}
        />
        {entryMode === "choosing" && (
          <EmptyState
            onPickAI={handlePickAI}
            onPickTemplate={handlePickTemplate}
            onPickPaste={handlePickPaste}
          />
        )}
        {entryMode === "template" &&
          (previewingTemplate ? (
            <div className="flex-1 min-w-0 flex flex-col">
              {templateError && (
                <div className="h-7 shrink-0 flex items-center justify-center gap-2 text-[11.5px] bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-b bd">
                  {templateError}
                </div>
              )}
              <PreviewArea
                doc=""
                previewUrl={previewingTemplate.previewUrl}
                templateName={previewingTemplate.name}
                openInNewTabUrl={previewingTemplate.previewUrl}
                onUseTemplate={() => {
                  void handleUseTemplate();
                }}
                useTemplateLoading={committingTemplate}
                onClearTemplate={() => {
                  setPreviewingTemplate(null);
                  setTemplateError(null);
                }}
              />
            </div>
          ) : (
            <PreviewPlaceholder mode="template" />
          ))}
        {entryMode === "ai" && (
          aiGenState.kind === "generating" ? (
            <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-preview-a">
              <div className="h-9 shrink-0 flex items-center gap-2 px-4 border-b bd text-[11.5px] fg-muted">
                <span className="h-3 w-3 rounded-full border-2 border-coral-500 border-t-transparent animate-spin" />
                {aiGenState.html
                  ? "Designing your page…"
                  : "Thinking through the design…"}
              </div>
              {aiGenState.html ? (
                <iframe
                  title="Generating preview"
                  srcDoc={aiGenState.html}
                  className="flex-1 min-h-0 w-full border-0 bg-white"
                  sandbox="allow-scripts"
                />
              ) : (
                <div className="flex-1 min-h-0 flex items-center justify-center px-6">
                  <div className="max-w-md text-center text-[12.5px] fg-muted leading-relaxed">
                    {aiGenState.reasoning || "Reading your brief…"}
                  </div>
                </div>
              )}
            </section>
          ) : aiGenState.kind === "error" ? (
            <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-preview-a">
              <div className="flex-1 min-h-0 flex items-center justify-center px-6">
                <div className="text-center max-w-md">
                  <div className="text-[13px] text-red-600 dark:text-red-400 mb-1">
                    Generation failed
                  </div>
                  <div className="text-[12px] fg-muted">
                    {aiGenState.message}
                  </div>
                  <div className="mt-3 text-[11px] fg-faint">
                    Tweak your brief in the sidebar and try again.
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <PreviewPlaceholder mode="ai" />
          )
        )}
        {entryMode === "paste" && (
          <PreviewPlaceholder mode={entryMode} />
        )}
        {entryMode === "editing" &&
          (loadedProject?.html ? (
            <PreviewArea
              doc={loadedProject.html}
              editableInjection={editableInjection}
              sectionSelectMode={sectionSelectMode}
              editingActive={editingActive}
              onIframeRef={(el) => {
                iframeElRef.current = el;
              }}
              openInNewTabUrl={
                loadedProject.subdomain
                  ? `https://${loadedProject.subdomain}.openlen.com`
                  : `/api/projects/${loadedProject.id}/raw`
              }
            />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-preview-a">
              <div className="text-[12px] fg-faint">
                {loadedProject
                  ? "This project has no HTML content yet."
                  : "Loading project…"}
              </div>
            </div>
          ))}
      </div>
      <StatusBar saving={saving} published={published} />
      {loadedProject && (
        <PublishModal
          open={publishModalOpen}
          onClose={() => setPublishModalOpen(false)}
          project={{
            id: loadedProject.id,
            subdomain: loadedProject.subdomain,
            publishedAt: loadedProject.publishedAt,
            hasUnpublishedChanges: loadedProject.hasUnpublishedChanges,
          }}
          onSuccess={(newSubdomain) => {
            setLoadedProject((prev) =>
              prev
                ? {
                    ...prev,
                    subdomain: newSubdomain,
                    publishedAt: newSubdomain ? new Date() : null,
                    hasUnpublishedChanges: false,
                  }
                : prev,
            );
          }}
        />
      )}
      {loadedProject?.isFlat && (
        <AutofillModal
          open={autofillModalOpen}
          projectId={loadedProject.id}
          onClose={() => setAutofillModalOpen(false)}
          onApplied={(newHtml) =>
            setLoadedProject((prev) =>
              prev ? { ...prev, html: newHtml, hasUnpublishedChanges: true } : prev,
            )
          }
        />
      )}
      <ReplaceAssetModal
        open={!!assetModal}
        kind={assetModal?.kind ?? null}
        currentSvg={assetModal?.currentSvg ?? null}
        currentSrc={assetModal?.currentSrc ?? null}
        projectId={loadedProject?.id ?? null}
        onClose={() => setAssetModal(null)}
        onPick={(payload: ReplacePayload) => {
          if (!assetModal) return;
          const iframe = iframeElRef.current;
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage(
              {
                type: "openlen:swap-asset",
                kind: assetModal.kind,
                path: assetModal.path,
                payload,
              },
              "*",
            );
          }
          setAssetModal(null);
        }}
      />
    </div>
  );
}
