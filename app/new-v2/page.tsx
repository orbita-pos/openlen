"use client";

import "./tokens.css";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PublishModal } from "@/components/workspace/publish-modal";
import { EmptyState } from "@/components/workspace-v2/empty-state";
import { LeftSidebar, type SidebarMode } from "@/components/workspace-v2/left-sidebar";
import { PreviewPlaceholder } from "@/components/workspace-v2/preview-placeholder";
import {
  ACTIVITY_LOG,
  INITIAL_DESIGN,
  LAYOUT_PRESETS,
  PALETTES,
  SECTIONS,
  TYPE_SYSTEMS,
  type DesignState,
  type Section,
} from "@/components/workspace-v2/mock-data";
import { PreviewArea } from "@/components/workspace-v2/preview-area";
import { buildPreviewDoc } from "@/components/workspace-v2/preview-doc";
import { StatusBar } from "@/components/workspace-v2/status-bar";
import { TopBar } from "@/components/workspace-v2/top-bar";
import { useDarkMode } from "@/lib/use-dark-mode";

// Outer shell exists so `useSearchParams()` in the inner component has a
// Suspense boundary, matching the /new V1 pattern.
export default function NewV2Page() {
  return (
    <Suspense fallback={null}>
      {/* Fonts for the design panel typography cards. The preview iframe
          loads its own copy via preview-doc.ts. Next hoists these to <head>. */}
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
   *  based structure, so the Content/Design panels and the inline-edit
   *  toggle don't apply (they're designed for the orchestrator's filled-
   *  block model). The sidebar locks those tabs and the topbar hides the
   *  toggle when this is true. */
  isFlat: boolean;
}

type EntryMode = "choosing" | "ai" | "template" | "paste" | "editing";

const ALL_TABS: SidebarMode[] = [
  "chat",
  "content",
  "design",
  "templates",
  "pages",
  "versions",
  "comments",
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
        : entryMode === "ai"
          ? "chat"
          : "design",
  );
  const [inlineEdit, setInlineEdit] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [activityIdx, setActivityIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadedProject, setLoadedProject] = useState<LoadedProject | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);

  const [sections, setSections] = useState<Section[]>(SECTIONS);
  const [expanded, setExpanded] = useState<string | null>("hero");

  const [design, setDesignState] = useState<DesignState>(INITIAL_DESIGN);
  const setDesign = useCallback(
    (patch: Partial<DesignState>) =>
      setDesignState((prev) => ({ ...prev, ...patch })),
    [],
  );

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

  const activePalette = useMemo(
    () => PALETTES.find((p) => p.id === design.paletteId) ?? PALETTES[0],
    [design.paletteId],
  );
  const activeType = useMemo(
    () => TYPE_SYSTEMS.find((t) => t.id === design.typeId) ?? TYPE_SYSTEMS[0],
    [design.typeId],
  );

  // Cycle the bottom-bar activity log so the workspace feels alive.
  useEffect(() => {
    const t = setInterval(
      () => setActivityIdx((i) => (i + 1) % ACTIVITY_LOG.length),
      4500,
    );
    return () => clearInterval(t);
  }, []);

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
  useEffect(() => {
    if (!projectParam) {
      setLoadedProject(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/projects/${projectParam}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.project) return;
        const p = data.project as {
          id: string;
          title: string;
          subdomain: string | null;
          publishedAt: string | null;
          hasUnpublishedChanges: boolean;
          data: { html?: string; filledBlocks?: unknown[] };
        };
        const filledCount = Array.isArray(p.data?.filledBlocks)
          ? p.data.filledBlocks.length
          : 0;
        setLoadedProject({
          id: p.id,
          title: p.title,
          subdomain: p.subdomain,
          publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
          hasUnpublishedChanges: p.hasUnpublishedChanges,
          html: p.data?.html ?? "",
          isFlat: filledCount === 0,
        });
        setProjectName(p.title);
      })
      .catch(() => {
        /* network blip — leave demo state */
      });
    return () => {
      cancelled = true;
    };
  }, [projectParam]);

  // When the user has a non-empty composition, fetch the server-rendered HTML
  // for all sections stacked top-to-bottom and plug it into the preview iframe.
  // An empty array means "show the mock Acme landing" (legacy default).
  //
  // We serialise design.composition into a stable key so the effect doesn't
  // refetch when palette/typography/density swap — only when the section list
  // changes. The CSS variables for design tokens flow in via preview-doc.
  const compositionKey = useMemo(
    () => design.composition.map((s) => `${s.id}:${s.layoutId}`).join("|"),
    [design.composition],
  );
  const [layoutHtml, setLayoutHtml] = useState<string | null>(null);
  useEffect(() => {
    if (design.composition.length === 0) {
      setLayoutHtml(null);
      return;
    }
    const instances = design.composition
      .map((s) => {
        const preset = LAYOUT_PRESETS.find((l) => l.id === s.layoutId);
        if (!preset) return null;
        return { id: s.id, primitive: preset.primitive, variant: preset.variant };
      })
      .filter((x): x is { id: string; primitive: "Hero" | "Stack" | "Split" | "Grid" | "CTA"; variant: string } => x !== null);
    if (instances.length === 0) {
      setLayoutHtml(null);
      return;
    }
    let cancelled = false;
    void fetch("/api/render-layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instances }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data.html === "string") setLayoutHtml(data.html);
      })
      .catch(() => {
        /* keep last preview on transient failure */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositionKey]);

  const previewDoc = useMemo(
    () =>
      buildPreviewDoc({
        sections,
        design,
        palette: activePalette,
        type: activeType,
        inlineEdit,
        layoutHtml,
      }),
    [sections, design, activePalette, activeType, inlineEdit, layoutHtml],
  );

  const published = loadedProject?.subdomain
    ? {
        subdomain: loadedProject.subdomain,
        hasUnpublishedChanges: loadedProject.hasUnpublishedChanges,
      }
    : null;

  const onPublish = loadedProject ? () => setPublishModalOpen(true) : undefined;

  // Compute which sidebar tabs are locked based on the entry mode + the
  // loaded project's shape. In an entry flow, only the relevant tab is
  // interactive. In editing, "flat" projects (template-clone / paste)
  // lock Content + Design because those panels expect slot-based structure
  // the orchestrator produces (filledBlocks); a pure-HTML project has none.
  const lockedTabs = useMemo<SidebarMode[]>(() => {
    if (entryMode === "editing") {
      return loadedProject?.isFlat
        ? (["content", "design"] as SidebarMode[])
        : [];
    }
    if (entryMode === "choosing") return [...ALL_TABS];
    if (entryMode === "ai") return ALL_TABS.filter((t) => t !== "chat");
    if (entryMode === "template")
      return ALL_TABS.filter((t) => t !== "templates");
    if (entryMode === "paste") return ALL_TABS.filter((t) => t !== "content");
    return [];
  }, [entryMode, loadedProject?.isFlat]);

  const lockReason =
    entryMode === "choosing"
      ? "Pick a starting point first"
      : entryMode === "editing" && loadedProject?.isFlat
        ? "Only available on AI-generated projects (your project is template-based HTML)"
        : "Available once your page is created";

  // If the project's "shape" makes the current sidebar tab inert, snap to
  // the first unlocked tab. Without this, a flat project loaded straight
  // into `mode === "design"` would leave the user staring at a panel they
  // can't interact with (the tab button is locked, but the panel content
  // would still render because state outlived the lock decision).
  useEffect(() => {
    if (lockedTabs.includes(mode)) {
      const next = ALL_TABS.find((t) => !lockedTabs.includes(t));
      if (next && next !== mode) setMode(next);
    }
  }, [lockedTabs, mode]);

  // Inline-edit toggle only makes sense on slot-based AI-generated pages
  // (`<EditableText>` wrappers carry `data-slot-path` markers we listen
  // for). Flat HTML projects have none of that — hide the toggle there.
  const inlineEditAvailable =
    entryMode === "editing" && !!loadedProject && !loadedProject.isFlat;

  // ⌘E toggles inline edit, matching the artifact and V1 muscle memory.
  // Disabled when inline edit isn't applicable (no project, flat project).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!inlineEditAvailable) return;
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea/i.test(t.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setInlineEdit((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineEditAvailable]);

  const handlePickAI = () => {
    // V2 deep AI integration (brief form + SSE in the chat panel) is a
    // follow-up — for this session we send the user to /new which already
    // wires the orchestrator end-to-end. Once they generate there and have
    // a project, opening /new-v2?project=<id> drops them into V2 editing.
    window.location.href = "/new";
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
        inlineEdit={inlineEdit}
        setInlineEdit={setInlineEdit}
        inlineEditAvailable={inlineEditAvailable}
        onPublish={onPublish}
        published={published}
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
          design={design}
          setDesign={setDesign}
          onPreviewTemplate={(t) => {
            setPreviewingTemplate(t);
            setTemplateError(null);
          }}
          previewingTemplateId={previewingTemplate?.id ?? null}
          lockedTabs={lockedTabs}
          lockReason={lockReason}
          entryMode={entryMode}
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
                inlineEdit={false}
                previewUrl={previewingTemplate.previewUrl}
                templateName={previewingTemplate.name}
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
        {(entryMode === "ai" || entryMode === "paste") && (
          <PreviewPlaceholder mode={entryMode} />
        )}
        {entryMode === "editing" &&
          (loadedProject?.html ? (
            <PreviewArea doc={loadedProject.html} inlineEdit={inlineEdit} />
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
      <StatusBar activityIdx={activityIdx} saving={saving} />
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
    </div>
  );
}
