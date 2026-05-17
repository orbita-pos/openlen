"use client";

import "./tokens.css";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { PublishModal } from "@/components/workspace/publish-modal";
import { LeftSidebar, type SidebarMode } from "@/components/workspace-v2/left-sidebar";
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
}

function NewV2Inner() {
  const [dark, toggleDark] = useDarkMode();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  const [projectName, setProjectName] = useState("Pricing Page");
  const [mode, setMode] = useState<SidebarMode>("design");
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
        };
        setLoadedProject({
          id: p.id,
          title: p.title,
          subdomain: p.subdomain,
          publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
          hasUnpublishedChanges: p.hasUnpublishedChanges,
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

  // When a layout primitive is selected (one of the 17 from LAYOUT_PRESETS),
  // fetch the server-rendered HTML for it and plug it into the preview iframe.
  // Null means "show the mock Acme landing" (the default).
  const [layoutHtml, setLayoutHtml] = useState<string | null>(null);
  useEffect(() => {
    if (!design.layoutId) {
      setLayoutHtml(null);
      return;
    }
    const preset = LAYOUT_PRESETS.find((l) => l.id === design.layoutId);
    if (!preset) {
      setLayoutHtml(null);
      return;
    }
    let cancelled = false;
    void fetch("/api/render-layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ primitive: preset.primitive, variant: preset.variant }),
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
  }, [design.layoutId]);

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

  // ⌘E toggles inline edit, matching the artifact and V1 muscle memory.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea/i.test(t.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setInlineEdit((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const publishedUrl = loadedProject?.subdomain
    ? `https://${loadedProject.subdomain}.openlen.com`
    : null;

  const onPublish = loadedProject ? () => setPublishModalOpen(true) : undefined;

  return (
    <div className="workspace-v2 h-full flex flex-col">
      <TopBar
        projectName={projectName}
        onRename={setProjectName}
        inlineEdit={inlineEdit}
        setInlineEdit={setInlineEdit}
        onPublish={onPublish}
        publishedUrl={publishedUrl}
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
        />
        <PreviewArea doc={previewDoc} inlineEdit={inlineEdit} />
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
