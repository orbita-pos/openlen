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
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { PublishModal } from "@/components/workspace/publish-modal";
import { useCuration } from "@/lib/use-curation";
import { useGeneration } from "@/lib/use-generation";
import { setGenerationBusy } from "@/lib/generation-busy";
import { useAIModel } from "@/components/workspace-v2/model-picker";
import type {
  FormConfig,
  ProjectSettings,
  StoredChatTurn,
} from "@/lib/projects/types";
import { AutofillModal } from "@/components/workspace-v2/autofill-modal";
import { BusinessProfileModal } from "@/components/workspace-v2/business-profile-modal";
import type { BusinessProfile } from "@/lib/business-profiles/types";
import { CustomDomainModal } from "@/components/workspace-v2/custom-domain-modal";
import { DeployIntegrationModal } from "@/components/workspace-v2/deploy-integration-modal";
import { EmptyState } from "@/components/workspace-v2/empty-state";
import { BusinessSection } from "../business/business-section";
import {
  LeftSidebar,
  type SidebarMode,
  type SectionView,
} from "@/components/workspace-v2/left-sidebar";
import { Check, Undo, X } from "@/components/workspace-v2/icons";
import { SectionPreviewModal } from "@/components/workspace-v2/section-preview-modal";
import type { SectionSpec } from "@/components/workspace-v2/sections-data";
import { PreviewPlaceholder } from "@/components/workspace-v2/preview-placeholder";
import { SECTIONS, type Section } from "@/components/workspace-v2/mock-data";
import { PreviewArea } from "@/components/workspace-v2/preview-area";
import {
  PropertiesPanel,
  type InspectSelection,
  type PageMeta,
} from "@/components/workspace-v2/panels/properties-panel";
import { lookFromAccent } from "@/lib/palette-gen";
import { PageAssembling } from "@/components/workspace-v2/page-assembling";
import {
  ReplaceAssetModal,
  type ReplaceKind,
  type ReplacePayload,
} from "@/components/workspace-v2/replace-asset-modal";
import { StatusBar } from "@/components/workspace-v2/status-bar";
import { TopBar } from "@/components/workspace-v2/top-bar";
import { stripEditorInstrumentation } from "@/components/workspace-v2/strip-editor-instrumentation";
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
  /** Per-project favicon / brand mark URL. Null when not set; consumers
   *  (TopBar, list cards, favicon injection) fall back to the coral default. */
  logoUrl: string | null;
  /** The rendered HTML stored at project.data.html — what we feed the
   *  preview iframe AND what `publishProject` writes to disk on Deploy.
   *  Empty string for projects whose orchestrator never set it (legacy
   *  rows pre-Session-12). */
  html: string;
  /** True when this project was created from a template or pasted HTML —
   *  i.e. `data.filledBlocks` is empty. Flat projects don't have slot-
   *  based structure, so customization splits into two surfaces:
   *  - **Chat tab** redesigns the page end-to-end via Gemini streaming.
   *  - **Content tab** activates contentEditable in the iframe so the
   *    user can click any text and edit it directly (autosaved). */
  isFlat: boolean;
  /** Persistent AI context from the Brief sidebar tab — auto-prepended
   *  to every Chat tab prompt by `/api/templates/ai-design`. */
  userBrief: string;
  /** Persisted Chat-tab transcript — seeds the chat panel so a reload or
   *  sidebar tab switch restores the conversation. Kept fresh in this
   *  state by the chat's `onChatChange` so a panel remount re-seeds it. */
  chatHistory: StoredChatTurn[];
  /** Non-HTML project settings (Phase 2 form config). Loaded with the
   *  project; updated in place when the inspector edits a form. */
  settings: ProjectSettings | undefined;
}

// stripEditorInstrumentation moved to
// @/components/workspace-v2/strip-editor-instrumentation (so it can be unit
// tested + reused). It is the single funnel every openlen:html-changed passes
// through, and it now also strips Editor V5's marker set (overlay, run-wrap,
// editable/edit-hidden/edit-noedit).

type EntryMode = "choosing" | "ai" | "template" | "paste" | "editing";

const ALL_TABS: SidebarMode[] = [
  "chat",
  "templates",
  "library",
  "pages",
  "leads",
  "versions",
  "brief",
];

// Build the "Original" theme baseline from a page-meta payload — the resolved
// --ol-* token values + mode the page loaded with. Empty string for a token
// the page doesn't define (so the reset removes that override rather than
// pinning a blank). Mirrors the token set the inspector's Looks presets drive.
function readThemeBaseline(m: Record<string, unknown>): {
  tokens: Record<string, string>;
  mode: "light" | "dark";
} {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? String(v) : "");
  return {
    tokens: {
      "--ol-bg": str(m.bg),
      "--ol-surface": str(m.surface),
      "--ol-fg": str(m.fg),
      "--ol-border": str(m.border),
      "--ol-accent": str(m.accent),
      "--ol-font-display": str(m.displayFont),
      "--ol-r-scale": num(m.radiusScale),
      "--ol-text-scale": num(m.typeScale),
      "--ol-space-scale": num(m.spaceScale),
    },
    mode: m.mode === "dark" ? "dark" : "light",
  };
}

function NewV2Inner() {
  const t = useTranslations("wsPage");
  const tSections = useTranslations("panelsA");
  const tNav = useTranslations("projects");
  const [dark, toggleDark] = useDarkMode();
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectParam = searchParams.get("project");
  const modeParam = searchParams.get("mode");
  const profileParam = searchParams.get("profile");

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

  const [projectName, setProjectName] = useState(t("defaultProjectName"));
  const [mode, setMode] = useState<SidebarMode>(
    entryMode === "template" ? "templates" : "chat",
  );
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // Which account section the workspace CENTER renders — "page" = the page
  // canvas (default; the editor behaves exactly as before). The rail's global
  // icons switch this; nothing navigates away.
  const [centerView, setCenterView] = useState<SectionView>("page");
  const [saving, setSaving] = useState(false);
  const [loadedProject, setLoadedProject] = useState<LoadedProject | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [autofillModalOpen, setAutofillModalOpen] = useState(false);
  const [customDomainOpen, setCustomDomainOpen] = useState(false);
  const [vercelOpen, setVercelOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [deployErrorKey, setDeployErrorKey] = useState<string | null>(null);

  // OAuth round-trip return — the integration callback redirects back here with
  // ?connected=<provider> (success) or ?connect_error=<key>&provider=<provider>.
  // Open the matching deploy modal, surface any error, then strip the params so
  // a refresh doesn't re-open it.
  useEffect(() => {
    const connected = searchParams.get("connected");
    const connectError = searchParams.get("connect_error");
    const errProvider = searchParams.get("provider");
    const provider = connected ?? (connectError ? errProvider : null);
    if (provider !== "vercel" && provider !== "github") return;
    setDeployErrorKey(connectError);
    if (provider === "vercel") setVercelOpen(true);
    else setGithubOpen(true);
    router.replace(projectParam ? `/new?project=${projectParam}` : "/new");
  }, [searchParams, projectParam, router]);

  // Section-select coordination — iframe ↔ chat composer. The Chat panel
  // toggles `sectionSelectMode`; PreviewArea injects the selection script
  // into the iframe and listens for the resulting postMessage at this level
  // (so the captured payload can flow back into the chat composer's chip).
  const [sectionSelectMode, setSectionSelectMode] = useState(false);
  const [scopedSelection, setScopedSelection] = useState<{
    hint: string;
    path: string;
  } | null>(null);
  // Inspector (Phase 1 properties panel) — right-side drawer. inspectMode
  // gates the iframe's element-inspect script; selection + pageMeta mirror
  // what that script reports back over postMessage.
  const [inspectMode, setInspectMode] = useState(false);
  const [inspectSelection, setInspectSelection] =
    useState<InspectSelection | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [assetModal, setAssetModal] = useState<{
    kind: ReplaceKind;
    path: string;
    currentSvg: string | null;
    currentSrc: string | null;
  } | null>(null);
  const [pendingChatDraft, setPendingChatDraft] = useState<string | null>(null);
  // The page's theme tokens as first observed this project load — drives the
  // inspector's "Original" reset (re-applies these resolved values).
  const [originalTheme, setOriginalTheme] = useState<{
    tokens: Record<string, string>;
    mode: "light" | "dark";
  } | null>(null);
  // The light-mode token bundle of the currently-applied Look (a preset or a
  // generated palette), or null when on Original. Lets the dark toggle re-apply
  // the right mode's colors for the active look.
  const [activeLook, setActiveLook] = useState<Record<string, string> | null>(
    null,
  );
  const [chatRedesigning, setChatRedesigning] = useState(false);
  const iframeElRef = useRef<HTMLIFrameElement | null>(null);
  // Optimistic-concurrency base — the project's updatedAt this tab last
  // wrote. Sent with every HTML save; the server snapshots the current state
  // before overwriting when it no longer matches (another tab wrote since).
  // Starts 0 (resets on project switch) — the first save's mismatch is
  // harmless, it just dedups against the project's existing version.
  const projectUpdatedAtRef = useRef(0);

  // Section library — clicking a card opens a PREVIEW dialog (the section
  // alone). Its "Use on my page" action MATCHES the section to the host palette
  // server-side (/api/sections/prepare) and drops the already-themed fragment
  // into the live iframe via insertRequest. A section never lands raw (the user
  // rejected the unmatched add). The insert + save rides the html-changed path.
  const [previewSection, setPreviewSection] = useState<SectionSpec | null>(null);
  const [usingSection, setUsingSection] = useState(false);
  const [useError, setUseError] = useState<string | null>(null);
  const [insertRequest, setInsertRequest] = useState<{
    html: string;
    nonce: number;
    sectionType: string;
  } | null>(null);
  const insertNonceRef = useRef(0);
  // Undo-of-insert request — bumping the nonce tells PreviewArea to post
  // `openlen:section-remove`, which pulls the just-added section back out via
  // the same html-changed save funnel (no reload, single PATCH).
  const [removeRequest, setRemoveRequest] = useState<{ nonce: number } | null>(
    null,
  );
  const removeNonceRef = useRef(0);
  // Always-current loaded project id, for async guards: prepare is a multi-second
  // Gemini round-trip, and the user can navigate to another project (back/forward)
  // mid-flight — we must not drop a fragment themed for the OLD project into the new.
  const loadedIdRef = useRef<string | null>(null);
  // The section just added (drives the Undo pill). Cleared on undo or dismiss.
  const [lastInserted, setLastInserted] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const handlePreviewSection = (spec: SectionSpec) => {
    setUseError(null);
    setPreviewSection(spec);
  };

  // "Use on my page": match the section to the page palette, then insert the
  // already-themed fragment. One Gemini call (a credit) — a section never lands
  // unmatched. On error the dialog stays open and surfaces the reason.
  const handleUseSection = async (spec: SectionSpec) => {
    if (!loadedProject || usingSection) return;
    const proj = loadedProject;
    setUsingSection(true);
    setUseError(null);
    try {
      const res = await fetch("/api/sections/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: proj.id, slug: spec.id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { html?: string; error?: string }
        | null;
      // Navigated to another project while prepare was in flight? The fragment is
      // themed for `proj`, so dropping it into the now-current project would inject
      // the wrong palette. Abort silently (the credit for the call still applies).
      if (loadedIdRef.current !== proj.id) return;
      if (!res.ok || !data?.html) {
        setUseError(
          data?.error === "no_credits"
            ? tSections("sections.errNoCredits")
            : tSections("sections.errGeneric"),
        );
        return;
      }
      insertNonceRef.current += 1;
      setInsertRequest({
        html: data.html,
        nonce: insertNonceRef.current,
        sectionType: spec.type,
      });
      setLastInserted({ id: spec.id, name: spec.name });
      setPreviewSection(null);
    } catch {
      setUseError(tSections("sections.errGeneric"));
    } finally {
      setUsingSection(false);
    }
  };

  // Undo the most recent insert. PreviewArea posts `openlen:section-remove`,
  // which pulls the just-added nodes out of the live DOM (and restores any
  // replaced navbar/footer) and re-serializes through the html-changed funnel —
  // scheduling a save with the section gone, replacing any pending insert
  // autosave (so no double PATCH).
  const handleUndoInsert = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    removeNonceRef.current += 1;
    setRemoveRequest({ nonce: removeNonceRef.current });
    setLastInserted(null);
  };

  // AI generation flow — owned here so the brief survives panel switches
  // inside the same /new?mode=ai session. On completion, we redirect
  // to ?project=<id> which drops the user into editing mode.
  // AI entry: "quick" = curation (free, /api/curate), "scratch" = bespoke
  // from-scratch (Pro, /api/generate). Both hooks run; the toggle picks which
  // drives the UI. Same GenerationState shape, so the render + ?project redirect
  // below are reused for both. Bespoke is gated server-side (free → 403 upsell).
  const [aiMode, setAiMode] = useState<"quick" | "scratch">("quick");
  const curation = useCuration();
  const bespoke = useGeneration();
  const aiGenState = aiMode === "scratch" ? bespoke.state : curation.state;
  // Saved business profiles ("Mi negocio") — seed the curation flow. Fetched on
  // mount; the default profile auto-selects (the user can switch or pick none).
  const [profiles, setProfiles] = useState<BusinessProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const refreshProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/profiles");
      if (!res.ok) return;
      const json = (await res.json()) as { profiles?: BusinessProfile[] };
      const list = json.profiles ?? [];
      setProfiles(list);
      setSelectedProfileId((cur) => {
        if (cur) return cur;
        // Honor ?profile=<id> (deep link from /business "Nueva página") when it
        // resolves to a real business; otherwise the default.
        if (profileParam && list.some((p) => p.id === profileParam))
          return profileParam;
        return list.find((p) => p.isDefault)?.id ?? null;
      });
    } catch {
      /* network — leave the picker empty */
    }
  }, [profileParam]);
  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);
  // Brief can be pre-filled from a deep link (homepage hero CTA, projects
  // example cards, etc.) via ?brief=<urlencoded>.
  const briefParam = searchParams.get("brief");
  const autostartParam = searchParams.get("autostart");
  const [aiPrompt, setAiPrompt] = useState(() => briefParam?.trim() ?? "");
  const aiBriefFormState = useMemo(
    () => ({ prompt: aiPrompt, setPrompt: setAiPrompt }),
    [aiPrompt],
  );
  const aiGenerating = aiGenState.kind === "generating";
  const [genSlow, setGenSlow] = useState(false);
  const [genModel] = useAIModel();
  const handleAiGenerate = useCallback(() => {
    if (aiGenerating) return;
    const brief = aiPrompt.trim();
    if (brief.length < 10) return;
    if (aiMode === "scratch") void bespoke.generate(brief, genModel);
    else void curation.curate(brief, selectedProfileId);
  }, [
    aiGenerating,
    aiPrompt,
    aiMode,
    bespoke,
    curation,
    genModel,
    selectedProfileId,
  ]);
  // A deep link with `?autostart=1` (the homepage hero) kicks generation
  // off on arrival. The param is stripped right after so a manual reload of
  // this URL doesn't re-fire — and re-bill — the generation.
  const autostartedRef = useRef(false);
  useEffect(() => {
    if (autostartedRef.current || autostartParam !== "1") return;
    autostartedRef.current = true;
    handleAiGenerate();
    router.replace(
      briefParam
        ? `/new?mode=ai&brief=${encodeURIComponent(briefParam)}`
        : "/new?mode=ai",
    );
  }, [autostartParam, briefParam, handleAiGenerate, router]);
  // After ~8s of a silent generation (no reasoning, no HTML yet) surface a
  // "server saturated" note so the long wait doesn't read as a freeze.
  useEffect(() => {
    if (
      aiGenState.kind !== "generating" ||
      aiGenState.reasoning ||
      aiGenState.html ||
      aiGenState.notice
    ) {
      // `notice` is set only during the critic / regen phases — a known
      // progress step, not a silent freeze. Suppress the "server saturated"
      // note there so it can't override the abstract "Improving the design…"
      // text (the initial silent-wait note stays html-gated as before).
      setGenSlow(false);
      return;
    }
    const t = setTimeout(() => setGenSlow(true), 8000);
    return () => clearTimeout(t);
  }, [aiGenState]);
  // Keep the last painted preview so the "done" beat can hold the finished
  // page on screen (✓ ready) instead of cutting straight to a white flash.
  const lastPreviewHtmlRef = useRef("");
  useEffect(() => {
    if (aiGenState.kind === "generating" && aiGenState.html) {
      lastPreviewHtmlRef.current = aiGenState.html;
    }
  }, [aiGenState]);
  // When generation completes and the project has been persisted, hold the
  // finished page for a beat (✓ ready), then drop the user into editing.
  useEffect(() => {
    if (aiGenState.kind !== "done") return;
    // Only redirect while still IN the AI entry flow. A generation that
    // finishes in the background after the user soft-navigated elsewhere (e.g.
    // back to a project they were editing) must not hard-redirect them away —
    // if entryMode left "ai", this effect re-runs and the cleanup cancels the
    // pending hop.
    if (entryMode !== "ai") return;
    const projectId = aiGenState.projectId;
    const timer = setTimeout(() => {
      window.location.href = `/new?project=${projectId}`;
    }, 1100);
    return () => clearTimeout(timer);
  }, [aiGenState, entryMode]);
  // Publish the in-flight generation state so the header's locale switcher can
  // disable itself — switching locale navigates + remounts /new, which would
  // drop the page being built. Cleared on unmount.
  useEffect(() => {
    setGenerationBusy(aiGenerating);
    return () => setGenerationBusy(false);
  }, [aiGenerating]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      // Only trust messages from the live preview iframe — a stray window (other
      // tab / embed) can't drive the editor. (In-iframe scripts still share the
      // iframe's contentWindow; their containment is the corpus/ingestion layer.)
      if (iframeElRef.current && e.source !== iframeElRef.current.contentWindow)
        return;
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
            ? t("chatDraft.iconChanged")
            : t("chatDraft.imageChanged"),
        );
      } else if (data.type === "openlen:element-selected") {
        if (typeof data.path === "string" && typeof data.tag === "string") {
          setInspectSelection({
            path: data.path,
            tag: data.tag,
            hint: typeof data.hint === "string" ? data.hint : data.tag,
            props:
              data.props && typeof data.props === "object" ? data.props : {},
            formIndex:
              typeof data.formIndex === "number" ? data.formIndex : null,
            style:
              data.style && typeof data.style === "object"
                ? data.style
                : undefined,
          });
        }
      } else if (data.type === "openlen:element-deselected") {
        setInspectSelection(null);
      } else if (data.type === "openlen:page-meta") {
        const m = data.meta;
        if (m && typeof m === "object") {
          setPageMeta({
            title: typeof m.title === "string" ? m.title : "",
            description: typeof m.description === "string" ? m.description : "",
            ogImage: typeof m.ogImage === "string" ? m.ogImage : "",
            favicon: typeof m.favicon === "string" ? m.favicon : "",
            mode: m.mode === "dark" ? "dark" : "light",
            hasDark: !!m.hasDark,
          });
          // Snapshot the page's original theme tokens from the FIRST meta of
          // this project load — the "Original" reset re-applies these resolved
          // values (never blank-clears, which would break the canonize force-
          // CSS on legacy pages where --ol-bg/--ol-fg are pinned inline only).
          setOriginalTheme((prev) => prev ?? readThemeBaseline(m));
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [t]);
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

  // Load real project metadata when /new?project=<id> opens. The mock
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
              logoUrl?: string | null;
              tags?: string[];
              userBrief?: string | null;
              chatHistory?: StoredChatTurn[];
              data: {
                html?: string;
                filledBlocks?: unknown[];
                settings?: ProjectSettings;
              };
            };
          }
        | null;
      const p = data?.project;
      if (!p) return;
      const filledCount = Array.isArray(p.data?.filledBlocks)
        ? p.data.filledBlocks.length
        : 0;
      // Sanitize on load too — a project edited before this fix shipped may
      // already have leaked editor scripts baked into data.html.
      const html = stripEditorInstrumentation(p.data?.html ?? "");
      setLoadedProject({
        id: p.id,
        title: p.title,
        subdomain: p.subdomain,
        publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
        hasUnpublishedChanges: p.hasUnpublishedChanges,
        logoUrl: p.logoUrl ?? null,
        html,
        isFlat: filledCount === 0,
        userBrief: p.userBrief ?? "",
        chatHistory: p.chatHistory ?? [],
        settings: p.data?.settings,
      });
      setProjectName(p.title);
    },
    [],
  );

  useEffect(() => {
    // New project context — reset the concurrency base.
    projectUpdatedAtRef.current = 0;
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

  // ── Cross-tab / cross-device convergence ────────────────────────────────
  // Same browser: a BroadcastChannel — a save in one tab nudges the others to
  // refetch. Cross-device: a refetch when the tab regains focus. Both just
  // re-pull the project; the append-only chat log + projectVersions make the
  // refetched state the merged truth, never a clobber.
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const id = loadedProject?.id;
    if (!id) return;
    const onFocus = () => void refetchProject(id);
    window.addEventListener("focus", onFocus);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("openlen-project-sync");
      syncChannelRef.current = channel;
      channel.onmessage = (e: MessageEvent) => {
        if (e.data?.projectId === id) void refetchProject(id);
      };
    }
    return () => {
      window.removeEventListener("focus", onFocus);
      channel?.close();
      syncChannelRef.current = null;
    };
  }, [loadedProject?.id, refetchProject]);

  // Memoized so the TopBar's release-list effect (which deps on `published`)
  // doesn't re-fire GET /releases + flicker on every parent re-render (e.g. the
  // saving→saved→idle autosave ticks while the Deploy dropdown is open).
  const published = useMemo(
    () =>
      loadedProject?.subdomain
        ? {
            subdomain: loadedProject.subdomain,
            hasUnpublishedChanges: loadedProject.hasUnpublishedChanges,
          }
        : null,
    [loadedProject?.subdomain, loadedProject?.hasUnpublishedChanges],
  );

  const onPublish = loadedProject ? () => setPublishModalOpen(true) : undefined;
  // Editing surface = the right-side Edit toggle (was: the old left "Content"
  // tab; consolidated into the inspector on the right). When on, gates ALL
  // iframe affordances at once: drag handles, image/icon replace, inline
  // text edit, AND element-inspect outlines. Off → iframe renders clean.
  const editingActive =
    inspectMode &&
    entryMode === "editing" &&
    !!loadedProject &&
    // Suppress the editor (inline-edit + element-inspect) while the Chat tab's
    // "pick an element" gesture is active — otherwise a single iframe click both
    // scope-selects for chat AND pops the inline-edit overlay (the two modes
    // shared the same edit-mode body attr).
    !sectionSelectMode;
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
    if (entryMode === "paste") return [...ALL_TABS];
    return [];
  }, [entryMode]);

  const lockReason =
    entryMode === "choosing"
      ? t("lockReason.choosing")
      : t("lockReason.created");

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

  // Inline editing rides on the same right-side Edit toggle as the rest of
  // the iframe affordances. Same contentEditable + Reorder + Replace surface
  // works for every project, AI-generated or not.
  const editableInjection = editingActive;

  // Save state surfaced to TopBar (chrome polish session renders the pill;
  // we just track it here so the contract is wired end-to-end).
  const [savingStatus, setSavingStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const saveTimerRef = useRef<number | null>(null);
  const savedFlashRef = useRef<number | null>(null);

  // Listen for the iframe's `openlen:html-changed` messages. Kept mounted for
  // the whole life of a loaded project (NOT gated on editingActive): when the
  // user toggles Edit OFF mid-edit, inline-edit commits + flushes a final
  // html-changed as part of that transition — if the listener were torn down
  // synchronously with the toggle, that flush would be dropped and the edit
  // lost. The editor scripts only POST while in edit mode, so an always-mounted
  // listener never receives spurious saves. Inline-edit, Reorder, Replace,
  // Insert and inspect-mode property edits all emit via this same contract.
  useEffect(() => {
    if (!loadedProject) return;
    const projectId = loadedProject.id;

    const onMessage = (e: MessageEvent) => {
      if (!e.data || e.data.type !== "openlen:html-changed") return;
      // Only the live preview iframe may PATCH the project's HTML.
      if (iframeElRef.current && e.source !== iframeElRef.current.contentWindow)
        return;
      const rawHtml =
        typeof e.data.outerHtml === "string" ? e.data.outerHtml : "";
      if (!rawHtml) return;
      // Each injected editor script only cleans its own markers; co-injected
      // scripts leak through. This is the one funnel every edit passes — strip
      // here so the stored + PATCHed HTML is the clean visitor document.
      const html = stripEditorInstrumentation(rawHtml);
      const source =
        e.data.source === "reorder"
          ? "reorder"
          : e.data.source === "replace"
            ? "replace"
            : e.data.source === "props"
              ? "props"
              : e.data.source === "section-insert"
                ? "section-insert"
                : "inline-edit";
      setLoadedProject((prev) =>
        prev && prev.id === projectId ? { ...prev, html } : prev,
      );
      // A structural change (reorder / section insert) shifts sibling indices,
      // so the inspector's positional :nth-of-type path is now stale — drop the
      // selection so the next property edit can't land on the wrong element
      // (the user re-clicks to re-select).
      if (source === "reorder" || source === "section-insert") {
        setInspectSelection(null);
      }
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        setSavingStatus("saving");
        void fetch(`/api/projects/${projectId}/html`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            html,
            source,
            baseUpdatedAt: projectUpdatedAtRef.current,
          }),
        })
          .then(async (r) => {
            setSavingStatus(r.ok ? "saved" : "idle");
            if (r.ok) {
              // Nudge other tabs of this project to refetch the new HTML.
              syncChannelRef.current?.postMessage({ projectId });
              // Advance the concurrency base to the version the server just
              // wrote — so this tab's own next save isn't read as a clobber.
              const saved = (await r.json().catch(() => null)) as
                | { updatedAt?: string }
                | null;
              if (saved?.updatedAt) {
                projectUpdatedAtRef.current = new Date(
                  saved.updatedAt,
                ).getTime();
              }
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
    // Intentionally NOT depending on loadedProject.subdomain: it flips null→value
    // on first publish, and re-binding here would tear down the listener and
    // CANCEL a pending autosave debounce — dropping the last pre-publish edit.
    // The save reads the fresh subdomain via functional setState, so it stays
    // correct without the dep.
  }, [loadedProject?.id]);

  // Reset transient interaction modes whenever the loaded project changes
  // (cross-project switches inside /new). Without this, the iframe
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
      setInspectMode(false);
      setInspectSelection(null);
      setPageMeta(null);
      setOriginalTheme(null);
      setActiveLook(null);
      // Section library transient UI is project-scoped — a stale preview/Undo
      // pill (or a still-pending insert request themed for the old project) must
      // not carry across a project switch.
      setPreviewSection(null);
      setUseError(null);
      setLastInserted(null);
      setInsertRequest(null);
    }
    prevLoadedIdRef.current = newId;
    loadedIdRef.current = newId;
  }, [loadedProject?.id]);

  // ⌘E toggles the right-side Edit panel; Esc backs out of section-select.
  // The iframe-injected scripts have their own Esc handlers, but those only
  // fire when the iframe itself has focus — this covers the common case
  // where the user activated a mode from the parent doc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (entryMode !== "editing" || !loadedProject) return;
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea/i.test(t.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setInspectMode((m) => !m);
        return;
      }
      if (e.key === "Escape") {
        if (publishModalOpen || autofillModalOpen || assetModal) return;
        if (sectionSelectMode) {
          e.preventDefault();
          setSectionSelectMode(false);
          return;
        }
        if (inspectMode) {
          e.preventDefault();
          setInspectMode(false);
          setInspectSelection(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    entryMode,
    loadedProject,
    inspectMode,
    sectionSelectMode,
    publishModalOpen,
    autofillModalOpen,
    assetModal,
  ]);

  // Inspector — post a property edit into the preview iframe; the inspect
  // script mutates the live DOM and persists via openlen:html-changed.
  const applyElementProp = useCallback(
    (path: string, name: string, value: string | null) => {
      iframeElRef.current?.contentWindow?.postMessage(
        { type: "openlen:apply-prop", scope: "element", path, name, value },
        "*",
      );
    },
    [],
  );
  const applyPageMeta = useCallback((field: keyof PageMeta, value: string) => {
    iframeElRef.current?.contentWindow?.postMessage(
      { type: "openlen:apply-prop", scope: "page", field, value },
      "*",
    );
  }, []);
  // Selection-scoped style — set one inline-style property on the element.
  const applyStyle = useCallback(
    (path: string, prop: string, value: string) => {
      iframeElRef.current?.contentWindow?.postMessage(
        { type: "openlen:apply-prop", scope: "style", path, prop, value },
        "*",
      );
    },
    [],
  );
  // Smart background — a solid color that replaces any gradient/image, or an
  // image fill (background-image) on any element, or clearing the fill.
  const applyBg = useCallback(
    (path: string, kind: "color" | "image" | "clear", value: string) => {
      iframeElRef.current?.contentWindow?.postMessage(
        { type: "openlen:apply-prop", scope: "style-bg", path, kind, value },
        "*",
      );
    },
    [],
  );
  // Hide / show an element — reversible (tags data-ol-hidden; the element stays
  // selectable + dimmed in the editor, hidden in preview + published).
  const applyHide = useCallback((path: string, on: boolean) => {
    iframeElRef.current?.contentWindow?.postMessage(
      { type: "openlen:apply-prop", scope: "hide", path, on },
      "*",
    );
  }, []);
  // Theme preset ("5 bolas") — apply a whole {token: value} bundle to <html>
  // at once. The iframe sets them inline (and re-derives --ol-accent-r) in a
  // single reclean, then persists via openlen:html-changed. Deterministic +
  // reversible: re-applying a different preset, or resetting, just recomputes.
  const applyThemeBundle = useCallback((tokens: Record<string, string>) => {
    iframeElRef.current?.contentWindow?.postMessage(
      { type: "openlen:apply-prop", scope: "theme-bundle", tokens },
      "*",
    );
  }, []);
  // Light/dark flip — toggles the data-ol-mode attr on <html>. Empty value
  // removes the attr (→ light default); "dark" sets it.
  const applyThemeMode = useCallback((nextMode: "light" | "dark") => {
    iframeElRef.current?.contentWindow?.postMessage(
      {
        type: "openlen:apply-prop",
        scope: "theme",
        prop: "data-ol-mode",
        value: nextMode === "dark" ? "dark" : "",
      },
      "*",
    );
  }, []);
  // "Custom look" bola — route to the Chat surface and auto-fire a curated
  // restyle prompt (the ai-design endpoint snapshots a version itself, so the
  // look is reachable again for free via the chat Undo / Versions tab).
  // Apply a Look for a target mode: the LIGHT bundle lands as-is in light; in
  // dark, its 5 base colors are swapped for a contrast-guaranteed dark set
  // derived from the accent (font/radius/scale tokens stay). A null bundle =
  // Original (the page's captured baseline). Always sets the mode attr too.
  const modeRef = useRef<"light" | "dark">("light");
  modeRef.current = pageMeta?.mode ?? "light";
  const applyLookForMode = useCallback(
    (lightBundle: Record<string, string> | null, mode: "light" | "dark") => {
      const base = lightBundle ?? originalTheme?.tokens ?? null;
      if (base) {
        if (mode === "dark") {
          const accent = base["--ol-accent"];
          const dark = accent ? lookFromAccent(accent).dark : {};
          applyThemeBundle({ ...base, ...dark });
        } else {
          applyThemeBundle(base);
        }
      }
      applyThemeMode(mode);
    },
    [originalTheme, applyThemeBundle, applyThemeMode],
  );
  // Apply a Look (preset or generated) in the current mode, and remember it so
  // a later dark/light toggle re-derives the right colors.
  const applyLook = useCallback(
    (lightBundle: Record<string, string>) => {
      setActiveLook(lightBundle);
      applyLookForMode(lightBundle, modeRef.current);
    },
    [applyLookForMode],
  );
  // Dark/light toggle — re-applies the active Look's colors for the new mode.
  const toggleThemeMode = useCallback(
    (mode: "light" | "dark") => {
      applyLookForMode(activeLook, mode);
    },
    [applyLookForMode, activeLook],
  );
  // "Original" reset — drop the active Look and re-apply the page's captured
  // baseline (re-applies resolved values rather than blank-clearing, which
  // would break canonize's force-CSS on legacy pages).
  const resetTheme = useCallback(() => {
    setActiveLook(null);
    applyLookForMode(null, modeRef.current);
  }, [applyLookForMode]);
  // Form config is not HTML — it persists straight to ProjectData.settings
  // (so the notify email never reaches the published page source).
  const applyFormConfig = useCallback(
    (formIndex: number, patch: Partial<FormConfig>) => {
      const projectId = loadedProject?.id;
      if (!projectId) return;
      void fetch(`/api/projects/${projectId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ formIndex, patch }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          if (!res) return;
          // Mirror the server's merged form config into local state.
          setLoadedProject((prev) => {
            if (!prev) return prev;
            const forms = { ...(prev.settings?.forms ?? {}) };
            if (res.config) forms[String(formIndex)] = res.config;
            else delete forms[String(formIndex)];
            return { ...prev, settings: { ...prev.settings, forms } };
          });
        })
        .catch(() => {});
    },
    [loadedProject?.id],
  );
  // Send a test lead notification email to whichever address would receive
  // the real one for this form. The button in the inspector's Form section
  // calls this; we return the result so the button can render inline
  // feedback. No optimistic update — the email is one-shot.
  const sendTestFormEmail = useCallback(
    async (
      formIndex: number,
    ): Promise<{ ok: boolean; sentTo?: string; message?: string }> => {
      const projectId = loadedProject?.id;
      if (!projectId) return { ok: false, message: t("formEmail.noProject") };
      try {
        const res = await fetch(
          `/api/projects/${projectId}/forms/test-email`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ formIndex }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          sentTo?: string;
          message?: string;
          reason?: string;
        };
        if (!res.ok || !data.ok) {
          return {
            ok: false,
            message:
              data.message ??
              (data.reason === "no_destination"
                ? t("formEmail.noDestination")
                : t("formEmail.sendFailed", { status: res.status })),
          };
        }
        return { ok: true, sentTo: data.sentTo };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : t("formEmail.networkError"),
        };
      }
    },
    [loadedProject?.id, t],
  );
  // Analytics opt-out — sister of applyFormConfig; same /settings endpoint,
  // different body shape. Optimistically updates loadedProject.settings so
  // the Toggle reflects the change immediately; the server is the source of
  // truth on the next publish.
  // Persist a new logoUrl (or null to clear) to the project row. Optimistic
  // — reflects in the TopBar / inspector preview immediately; rolls back on
  // a server error so the UI never diverges from the DB.
  const applyLogoUrl = useCallback(
    (next: string | null) => {
      const projectId = loadedProject?.id;
      if (!projectId) return;
      const prevLogoUrl = loadedProject?.logoUrl ?? null;
      setLoadedProject((prev) =>
        prev ? { ...prev, logoUrl: next } : prev,
      );
      void fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logoUrl: next }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`PATCH failed (${r.status})`);
        })
        .catch(() => {
          setLoadedProject((p) =>
            p ? { ...p, logoUrl: prevLogoUrl } : p,
          );
        });
    },
    [loadedProject?.id, loadedProject?.logoUrl],
  );

  const persistRename = useCallback(
    (next: string) => {
      const projectId = loadedProject?.id;
      const prevName = projectName;
      setProjectName(next);
      if (!projectId) return;
      void fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: next }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`PATCH failed (${r.status})`);
        })
        .catch(() => {
          setProjectName(prevName);
        });
    },
    [loadedProject?.id, projectName],
  );

  const applyAnalyticsDisabled = useCallback(
    (disabled: boolean) => {
      const projectId = loadedProject?.id;
      if (!projectId) return;
      setLoadedProject((prev) =>
        prev
          ? {
              ...prev,
              settings: { ...prev.settings, analyticsDisabled: disabled },
            }
          : prev,
      );
      void fetch(`/api/projects/${projectId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ analyticsDisabled: disabled }),
      }).catch(() => {
        // On failure roll the toggle back so UI matches server state.
        setLoadedProject((prev) =>
          prev
            ? {
                ...prev,
                settings: { ...prev.settings, analyticsDisabled: !disabled },
              }
            : prev,
        );
      });
    },
    [loadedProject?.id],
  );
  const toggleInspect = useCallback(() => {
    setInspectMode((m) => !m);
    setInspectSelection(null);
  }, []);

  const handlePickAI = () => {
    router.push("/new?mode=ai");
  };
  const handlePickTemplate = () => {
    router.push("/new?mode=template");
    setMode("templates");
  };
  const handlePickPaste = () => {
    router.push("/new?mode=paste");
    setMode("chat");
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
      window.location.href = `/new?project=${data.projectId}`;
    } catch (err) {
      setTemplateError(
        err instanceof Error ? err.message : t("template.networkError"),
      );
      setCommittingTemplate(false);
    }
  };

  return (
    <div className="workspace-v2 h-full flex flex-col">
      <TopBar
        projectName={projectName}
        onRename={persistRename}
        projectLogoUrl={loadedProject?.logoUrl ?? null}
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
        onCustomDomain={
          loadedProject ? () => setCustomDomainOpen(true) : undefined
        }
        onDeployVercel={
          loadedProject
            ? () => {
                setDeployErrorKey(null);
                setVercelOpen(true);
              }
            : undefined
        }
        onDeployGitHub={
          loadedProject
            ? () => {
                setDeployErrorKey(null);
                setGithubOpen(true);
              }
            : undefined
        }
        dark={dark}
        onToggleDark={toggleDark}
      />
      <div className="flex-1 min-h-0 flex relative">
        <LeftSidebar
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((c) => !c)}
          activeSection={centerView}
          onSelectSection={setCenterView}
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
          onPreviewSection={handlePreviewSection}
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
          flatProjectChat={loadedProject?.chatHistory}
          onChatChange={() => {
            const id = loadedProject?.id;
            if (id) {
              void refetchProject(id);
              syncChannelRef.current?.postMessage({ projectId: id });
            }
          }}
          onRedesigningChange={setChatRedesigning}
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
          onToggleSectionSelect={(active) => setSectionSelectMode(active)}
          scopedSelection={scopedSelection}
          onClearScope={() => setScopedSelection(null)}
          onAutofill={onAutofill}
          pendingDraft={pendingChatDraft}
          onPendingDraftConsumed={() => setPendingChatDraft(null)}
          aiBriefState={aiBriefFormState}
          aiOnGenerate={handleAiGenerate}
          aiGenerating={aiGenerating}
          aiMode={aiMode}
          aiOnModeChange={setAiMode}
          aiProfiles={profiles}
          aiSelectedProfileId={selectedProfileId}
          aiOnSelectProfile={setSelectedProfileId}
          aiOnManageProfiles={() => setProfileModalOpen(true)}
        />
        {/* One <main> landmark for the workspace center. `contents` keeps the
            flex layout byte-identical (generates no box) while giving the a11y
            tree exactly one main region (fixes landmark-one-main + region). The
            sr-only h1 gives every entry state a top-level heading. */}
        <main className="contents">
        <h1 className="sr-only">{t("a11y.workspaceHeading")}</h1>
        {centerView === "business" ? (
          <BusinessSection embedded />
        ) : centerView !== "page" ? (
          <section className="flex-1 min-w-0 min-h-0 flex items-center justify-center bg-preview-a">
            <div className="text-center px-6">
              <div className="text-[15px] font-semibold fg">
                {tNav(
                  centerView === "projects"
                    ? "nav.myPages"
                    : centerView === "analytics"
                      ? "nav.analytics"
                      : centerView === "messages"
                        ? "nav.messages"
                        : "nav.myBusiness",
                )}
              </div>
              <div className="mt-1 text-[12.5px] fg-faint">
                {tNav("sections.comingSoon")}
              </div>
            </div>
          </section>
        ) : (
          <>
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
          aiGenState.kind === "generating" || aiGenState.kind === "done" ? (
            <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-preview-a">
              <PageAssembling
                html={
                  aiGenState.kind === "generating"
                    ? aiGenState.html || lastPreviewHtmlRef.current
                    : lastPreviewHtmlRef.current
                }
                streaming={aiMode === "scratch" && aiGenState.kind === "generating"}
                done={aiGenState.kind === "done"}
                slow={genSlow}
                caption={
                  aiGenState.kind === "generating"
                    ? aiGenState.notice
                      ? aiGenState.notice
                      : aiGenState.html
                        ? t("aiStatus.designing")
                        : t("aiStatus.thinking")
                    : undefined
                }
              />
            </section>
          ) : aiGenState.kind === "error" ? (
            <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-preview-a">
              <div className="flex-1 min-h-0 flex items-center justify-center px-6">
                <div className="text-center max-w-md">
                  <div className="text-[13px] text-red-600 dark:text-red-400 mb-1">
                    {t("aiError.title")}
                  </div>
                  <div className="text-[12px] fg-muted">
                    {aiGenState.message}
                  </div>
                  <div className="mt-3 text-[11px] fg-faint">
                    {t("aiError.tweak")}
                  </div>
                  <button
                    type="button"
                    onClick={handleAiGenerate}
                    className="mt-4 inline-flex items-center justify-center h-8 px-4 rounded-md bg-[var(--accent-strong)] text-white text-[12px] font-medium shadow-coral hover:brightness-105 transition"
                  >
                    {t("aiError.retry")}
                  </button>
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
            <>
              <PreviewArea
                doc={loadedProject.html}
                docKey={loadedProject.id}
                redesigning={chatRedesigning}
                editableInjection={editableInjection}
                sectionSelectMode={sectionSelectMode}
                editingActive={editingActive}
                inspectMode={inspectMode}
                onToggleInspect={toggleInspect}
                insertRequest={insertRequest}
                removeRequest={removeRequest}
                onIframeRef={(el) => {
                  iframeElRef.current = el;
                }}
                openInNewTabUrl={
                  loadedProject.subdomain
                    ? `https://${loadedProject.subdomain}.openlen.com`
                    : `/api/projects/${loadedProject.id}/raw`
                }
              />
              {lastInserted && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 pl-3.5 pr-1.5 py-1.5 rounded-full bg-elev border bd shadow-card fade-in">
                  <span className="inline-flex items-center gap-1.5 text-[12px] fg-muted whitespace-nowrap">
                    <Check size={13} className="text-emerald-500" />
                    {t.rich("inserted.label", {
                      name: lastInserted.name,
                      b: (chunks) => <b className="fg">{chunks}</b>,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={handleUndoInsert}
                    className="ml-1 inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11.5px] font-medium fg-muted hover:fg hover:bg-hover transition"
                  >
                    <Undo size={12} />
                    {t("inserted.undo")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLastInserted(null)}
                    aria-label={t("inserted.dismiss")}
                    title={t("inserted.dismiss")}
                    className="inline-flex items-center justify-center h-7 w-7 rounded-full fg-faint hover:fg hover:bg-hover transition"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              {inspectMode && (
                // Floating drawer (overlay, not push). PreviewArea keeps its
                // full width so the iframe's Fit-scale and content layout stay
                // constant between editing-on and editing-off — the user sees
                // the same render regardless of whether the inspector is open.
                // Pattern parallels Figma/Webflow/Framer's right rail.
                <div className="absolute right-0 top-0 bottom-0 z-20 shadow-2xl">
                  <PropertiesPanel
                    selection={inspectSelection}
                    pageMeta={pageMeta}
                    html={loadedProject?.html}
                    analyticsDisabled={
                      loadedProject?.settings?.analyticsDisabled ?? false
                    }
                    projectId={loadedProject?.id}
                    projectTitle={loadedProject?.title}
                    logoUrl={loadedProject?.logoUrl ?? null}
                    formConfig={
                      typeof inspectSelection?.formIndex === "number"
                        ? loadedProject?.settings?.forms?.[
                            String(inspectSelection.formIndex)
                          ] ?? null
                        : null
                    }
                    onApplyElementProp={applyElementProp}
                    onApplyPageMeta={applyPageMeta}
                    onApplyFormConfig={applyFormConfig}
                    onApplyStyle={applyStyle}
                    onApplyBg={applyBg}
                    onApplyHide={applyHide}
                    onToggleAnalytics={applyAnalyticsDisabled}
                    onApplyLogoUrl={loadedProject ? applyLogoUrl : undefined}
                    onApplyLook={loadedProject ? applyLook : undefined}
                    onApplyThemeMode={loadedProject ? toggleThemeMode : undefined}
                    onResetTheme={
                      loadedProject && originalTheme ? resetTheme : undefined
                    }
                    originalAccent={originalTheme?.tokens["--ol-accent"] || undefined}
                    onSendTestFormEmail={sendTestFormEmail}
                    onClearSelection={() => setInspectSelection(null)}
                    onClose={() => {
                      setInspectMode(false);
                      setInspectSelection(null);
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-preview-a">
              <div className="text-[12px] fg-faint">
                {loadedProject
                  ? t("editing.noHtml")
                  : t("editing.loading")}
              </div>
            </div>
          ))}
          </>
        )}
        </main>
      </div>
      <StatusBar saving={saving} published={published} />
      {loadedProject && (
        <CustomDomainModal
          key={loadedProject.id}
          open={customDomainOpen}
          onClose={() => setCustomDomainOpen(false)}
          projectId={loadedProject.id}
          projectSubdomain={loadedProject.subdomain}
          projectTitle={loadedProject.title}
          onAutoPublished={(sub) => {
            // Reflect the silent first-publish in the workspace state so
            // the TopBar Live pill + Deploy dropdown stop saying "not
            // published yet" without forcing a full page reload.
            setLoadedProject((prev) =>
              prev
                ? {
                    ...prev,
                    subdomain: sub,
                    publishedAt: new Date(),
                    hasUnpublishedChanges: false,
                  }
                : prev,
            );
          }}
        />
      )}
      {loadedProject && (
        <DeployIntegrationModal
          open={vercelOpen}
          onClose={() => setVercelOpen(false)}
          provider="vercel"
          projectId={loadedProject.id}
          initialErrorKey={deployErrorKey}
        />
      )}
      {loadedProject && (
        <DeployIntegrationModal
          open={githubOpen}
          onClose={() => setGithubOpen(false)}
          provider="github"
          projectId={loadedProject.id}
          initialErrorKey={deployErrorKey}
        />
      )}
      {loadedProject && (
        <PublishModal
          open={publishModalOpen}
          onClose={() => setPublishModalOpen(false)}
          onOpenCustomDomain={() => setCustomDomainOpen(true)}
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
      <BusinessProfileModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onSaved={(p) => {
          void refreshProfiles();
          setSelectedProfileId(p.id);
        }}
      />
      <ReplaceAssetModal
        open={!!assetModal}
        kind={assetModal?.kind ?? null}
        currentSvg={assetModal?.currentSvg ?? null}
        currentSrc={assetModal?.currentSrc ?? null}
        projectId={loadedProject?.id ?? null}
        activeProfile={(() => {
          const p =
            profiles.find((x) => x.id === selectedProfileId) ??
            profiles.find((x) => x.isDefault) ??
            null;
          return p
            ? {
                name: p.name,
                logoUrl: p.data.brand?.logoUrl ?? null,
                photos: p.data.photos ?? [],
              }
            : null;
        })()}
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
      {previewSection && (
        <SectionPreviewModal
          section={previewSection}
          using={usingSection}
          error={useError}
          onUse={handleUseSection}
          onClose={() => {
            if (!usingSection) {
              setPreviewSection(null);
              setUseError(null);
            }
          }}
        />
      )}
    </div>
  );
}

