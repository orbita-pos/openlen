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
import { tomarReferenciaEnTransito } from "@/lib/referencia-en-transito";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PublishModal } from "@/components/workspace/publish-modal";
import { useGeneration } from "@/lib/use-generation";
import {
  isGenerationBriefLengthValid,
  prepareGenerationBriefInput,
  shouldSyncGenerationBriefParam,
  trimGenerationBrief,
} from "@/lib/generation/brief-contract";
import { setGenerationBusy } from "@/lib/generation-busy";
import { scanController } from "@/lib/workspace-v2/scan-controller";
import { classifyAiError } from "@/components/workspace-v2/ai-error-message";
import { creditRefillLabel } from "@/lib/credits-client";
import { buildModuleSection } from "@/lib/publish/module-sections";
import {
  modulePlacements,
  pageHasModule,
  PLACED_MODULE_MARKERS,
} from "@/lib/projects/module-placements";
import type {
  ChatSettings,
  CollectionsSettings,
  FormConfig,
  Degradation,
  ProjectSettings,
  StoredChatTurn,
} from "@/lib/projects/types";
import { BusinessProfileModal } from "@/components/workspace-v2/business-profile-modal";
import type { BusinessProfile } from "@/lib/business-profiles/types";
import { isProfileFilled } from "@/lib/business-profiles/overlay";
import { ALL_BUSINESSES } from "@/components/workspace-v2/business-switcher";
import { CustomDomainModal } from "@/components/workspace-v2/custom-domain-modal";
import { DeployIntegrationModal } from "@/components/workspace-v2/deploy-integration-modal";
import { InboxHub } from "@/components/inbox/inbox-hub";
import { ExploreView } from "@/components/community/explore-view";
import { BusinessSection } from "../business/business-section";
import { ProjectsSection } from "../projects/projects-section";
import { AnalyticsSection } from "../analytics/analytics-section";
import { ModulesView } from "@/components/workspace-v2/modules-view";
import { MarketingView } from "@/components/workspace-v2/marketing-view";
import { ResultadosView } from "@/components/workspace-v2/resultados-view";
import {
  LeftSidebar,
  type SidebarMode,
  type SectionView,
} from "@/components/workspace-v2/left-sidebar";
import { AlertTriangle, Check, Sparkles, Undo, X } from "@/components/workspace-v2/icons";
import { PreviewPlaceholder } from "@/components/workspace-v2/preview-placeholder";
import { StartLanding } from "@/components/workspace-v2/start-landing";
import type { StyleDirection } from "@/lib/style-match/direction-types";
import type { PageEffort } from "@/components/workspace-v2/panels/ai-brief-panel";
import { SECTIONS, type Section } from "@/components/workspace-v2/mock-data";
import { PreviewArea } from "@/components/workspace-v2/preview-area";
import type { ItemRow } from "@/lib/collections/store";
import {
  PropertiesPanel,
  type InspectSelection,
  type PageMeta,
} from "@/components/workspace-v2/panels/properties-panel";
import { lookFromAccent } from "@/lib/palette-gen";
import {
  readTematicaBackdrop,
  readTematicaId,
  tematicaCss,
  type TematicaPreset,
} from "@/lib/tematicas/presets";
import {
  deriveWorldFromFile,
  deriveWorldFromUrl,
  type DerivedWorld,
} from "@/lib/tematicas/derive-from-image";
import {
  buildImageSectionHtml,
  buildMotionHeroHtml,
  fileNameToAlt,
  parseDropAsset,
  sectionBgPlan,
  DROP_ASSET_MIME,
  type DropAsset,
  type MotionAsset,
} from "@/components/workspace-v2/drop-place-core";
import type { DropIntent } from "@/components/workspace-v2/use-drop-place";
import { imageFetchUrl } from "@/lib/image-fetch-url";
import { gradientBgPlan, parseSimpleGradient } from "@/lib/gradients";
import { PageAssembling } from "@/components/workspace-v2/page-assembling";
import { paginaEnPantalla, yaEsPagina } from "@/components/workspace-v2/pagina-en-pantalla";
import { stripEditorInstrumentationFragment } from "@/components/workspace-v2/strip-editor-instrumentation";
import {
  claveDeEdicion,
  leerEdicion,
} from "@/components/workspace-v2/leer-edicion";
import type { Edicion } from "@/lib/page-engine/aplicar-ediciones";
import {
  ReplaceAssetModal,
  type ReplaceKind,
  type ReplacePayload,
} from "@/components/workspace-v2/replace-asset-modal";
import { OriginalRestoreModal } from "@/components/workspace-v2/original-restore-modal";
import { StatusBar } from "@/components/workspace-v2/status-bar";
import { TopBar } from "@/components/workspace-v2/top-bar";
import { useToast } from "@/components/workspace-v2/toast";
import { stripEditorInstrumentation } from "@/components/workspace-v2/strip-editor-instrumentation";
import { useDarkMode } from "@/lib/use-dark-mode";
import { useEditorSound } from "@/lib/use-editor-sound";
import { useIsMobile } from "@/components/workspace-v2/use-is-mobile";
import { formConfigKey, listSitePages } from "@/lib/projects/site-pages";
import type { SitePage } from "@/lib/projects/types";
import { PUBLISHED_BASE_HOST } from "@/lib/publish/base-host";
import { AddressBar } from "@/components/workspace-v2/address-bar";

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
  /** Multi-page: extra site pages keyed by slug (data.pages). The home
   *  document stays at `html`; the canvas shows whichever the ?page=
   *  param selects. */
  pages: Record<string, SitePage>;
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
  /** What the page lost on the way in (paste / template clone). Drives the
   *  one-time notice — the user is TOLD, rather than discovering a dead
   *  control on the published page. */
  degradations: Degradation[] | undefined;
  degradationsDismissed: boolean | undefined;
  /** The business this page is linked to (FK → businessProfiles), same field
   *  GET /api/projects/[id] already returns on `project`. Null = no explicit
   *  link, resolve to the user's default business (mirrors
   *  projectBusinessProfile's linked-first-else-default). Drives the
   *  platforms band preview in the canvas. */
  profileId: string | null;
}

/** Las frases concretas de un código de degradación, sin repetir.
 *
 *  Una clonación multi-página registra la misma pérdida por página, así que el
 *  mismo detalle puede venir N veces; decirlo N veces sería el ruido que este
 *  aviso existe para no ser. */
function degradationDetail(
  degradations: Degradation[] | undefined,
  code: string,
): string[] {
  const vistos = new Set<string>();
  for (const d of degradations ?? []) {
    if (d.code !== code) continue;
    for (const linea of d.detail ?? []) vistos.add(linea);
  }
  return [...vistos].slice(0, 3);
}

// stripEditorInstrumentation moved to
// @/components/workspace-v2/strip-editor-instrumentation (so it can be unit
// tested + reused). It is the single funnel every openlen:html-changed passes
// through, and it now also strips Editor V5's marker set (overlay, run-wrap,
// editable/edit-hidden/edit-noedit).

type EntryMode = "ai" | "template" | "paste" | "editing";

// What a drop/placement commit carries: an OS file (uploaded on commit) or a
// panel asset whose URL is already hosted. The promises start at gesture time
// so they resolve while the user aims.
type DropSrc = {
  file?: File;
  asset?: DropAsset;
  uploadPromise?: Promise<{ url: string } | null>;
  worldPromise?: Promise<DerivedWorld | null>;
};

// Los paneles que el rail puede abrir. `site` salió el 2026-08-27: las
// páginas se navegan desde la barra de dirección, no desde un icono.
const ALL_TABS: SidebarMode[] = [
  "chat",
  "images",
  "versions",
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
  // Read the page's AUTHORED theme, not its live tokens. A Look applies + saves
  // inline --ol-* overrides on <html>, so after a reload the live tokens ARE
  // the Look — `m.authored` (the :root-declared values, which a Look never
  // rewrites) keeps "Original" pointing at the page's true starting colors.
  // Falls back to the flat meta for older iframes that don't report it.
  const a = (
    m.authored && typeof m.authored === "object"
      ? (m.authored as Record<string, unknown>)
      : m
  );
  return {
    tokens: {
      "--ol-bg": str(a.bg),
      "--ol-surface": str(a.surface),
      "--ol-fg": str(a.fg),
      "--ol-border": str(a.border),
      "--ol-accent": str(a.accent),
      "--ol-font-display": str(a.displayFont),
      "--ol-r-scale": num(a.radiusScale),
      "--ol-text-scale": num(a.typeScale),
      "--ol-space-scale": num(a.spaceScale),
    },
    mode: m.mode === "dark" ? "dark" : "light",
  };
}

function NewV2Inner() {
  const t = useTranslations("wsPage");
  const tSections = useTranslations("panelsA");
  const tCollections = useTranslations("collections");
  const tAsset = useTranslations("modalsAsset");
  const tws = useTranslations("wsChrome");
  const tVersions = useTranslations("panelsB");
  const tProps = useTranslations("panelsProps");
  const locale = useLocale();
  const [dark, toggleDark] = useDarkMode();
  const toast = useToast();
  // Editor sound (creamy click on rail switching) + the mute/volume control,
  // which lives in TopBar's avatar menu — it governs the app-wide click sound
  // and publish chime, not page music, so it must stay reachable regardless
  // of whether a project (or its music) is loaded.
  const {
    volume: soundVolume,
    setVolume: setSoundVolume,
    toggleMute: toggleSoundMute,
    playClick,
    playReward,
  } = useEditorSound();

  // The creamy click on EVERY button/link in the workspace (not just the rail),
  // via one delegated listener. Excludes [data-no-sound] + disabled controls;
  // the published-page preview is a separate document so it stays silent.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // primary press only
      const el = (e.target as Element | null)?.closest?.(
        "button, [role='button'], a[href]",
      );
      if (!el || el.closest("[data-no-sound]")) return;
      if (el instanceof HTMLButtonElement && el.disabled) return;
      playClick();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [playClick]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectParam = searchParams.get("project");
  const modeParam = searchParams.get("mode");
  const profileParam = searchParams.get("profile");
  // Read inside refetchProject's async continuation — a fetch started for the
  // project that was open when the request fired can resolve AFTER a redirect
  // (e.g. the global-surfaces bounce-out) has already moved the URL past it;
  // without this the stale response would repopulate loadedProject.
  const projectParamRef = useRef(projectParam);
  projectParamRef.current = projectParam;

  // Derive the entry mode from URL state. ?project=<id> → editing;
  // ?mode=template|paste → that guided flow; everything else (?mode=ai or no
  // params) lands directly in the AI brief — the default starting point. The
  // Template/Paste flows are reached from the sidebar tabs, so there's no
  // separate chooser screen. Keeping it in the URL means refreshes/shared links
  // land in the same spot.
  const entryMode: EntryMode = projectParam
    ? "editing"
    : modeParam === "template" || modeParam === "paste"
      ? modeParam
      : "ai";

  const [projectName, setProjectName] = useState(t("defaultProjectName"));
  // One-shot deep-links (consumed by the child once applied — nonce refs
  // misfire when the target mounts AFTER the click: took two clicks).
  const [hubInitialSub, setHubInitialSub] = useState<"collections" | null>(null);
  const [mode, setMode] = useState<SidebarMode>(
    entryMode === "template" || entryMode === "ai" ? "templates" : "chat",
  );
  // Keep the sidebar panel synced to the URL-derived entry mode. Rail clicks set
  // `mode` directly, but browser back/forward only change the URL (entryMode) —
  // without this, navigating back to ?mode=template keeps the previous panel
  // (e.g. Chat) shown. Editing tab-switches don't change entryMode, so this
  // never clobbers them.
  useEffect(() => {
    setMode(entryMode === "template" || entryMode === "ai" ? "templates" : "chat");
  }, [entryMode]);
  const [leftCollapsed, setLeftCollapsed] = useState(entryMode === "ai");
  const isMobile = useIsMobile();
  // Collapse the sidebar to the rail when the center carries the whole surface,
  // re-applied once per entry-mode transition (a synced ref so a manual toggle
  // persists). DESKTOP: the AI landing (bare /new, no page) collapses — its
  // composer + template mosaic live in the center (StartLanding), so the sidebar
  // AI brief would just be a duplicate; the sidebar AI/chat belongs to editing a
  // page. Template/Paste stay open (the panel IS the entry). MOBILE: the panel
  // overlays the canvas, so editing + the AI landing both enter closed.
  const entrySynced = useRef<string | null>(null);
  useEffect(() => {
    const key = `${isMobile ? "m" : "d"}:${entryMode}`;
    if (entrySynced.current === key) return;
    entrySynced.current = key;
    setLeftCollapsed(
      isMobile
        ? entryMode === "editing" || entryMode === "ai"
        : entryMode === "ai",
    );
  }, [isMobile, entryMode]);
  // Multi-page: ?page=<slug> selects which site page the canvas shows.
  // Resolved against the loaded project — an unknown slug acts as home
  // (and gets stripped from the URL once the project arrives).
  const pageParam = searchParams.get("page");
  // Which account section the workspace CENTER renders is kept IN THE URL
  // (?view=business|projects|analytics|messages; absent = the page canvas) so a
  // refresh or shared link lands on the same section. Opening a page navigates
  // to ?project=<id> with no ?view, which naturally falls back to the canvas.
  const viewParam = searchParams.get("view");
  const centerView: SectionView =
    viewParam === "projects" ||
    viewParam === "analytics" ||
    viewParam === "resultados" ||
    viewParam === "modulos" ||
    viewParam === "marketing" ||
    viewParam === "templates" ||
    viewParam === "business" ||
    viewParam === "messages" ||
    viewParam === "explore"
      ? viewParam
      : "page";
  // "analytics" is the pre-rail-unification URL alias for "resultados" —
  // ?view=analytics keeps working, but the render below only ever branches
  // on the normalized value.
  const normalizedCenterView: SectionView =
    centerView === "analytics" ? "resultados" : centerView;
  // The start page (no project loaded) tabs between three surfaces, driven by
  // the same ?view= param the in-editor sections used to read.
  const startSurface: "crear" | "mispaginas" | "comunidad" =
    !searchParams.get("project") && viewParam === "projects"
      ? "mispaginas"
      : !searchParams.get("project") && viewParam === "explore"
        ? "comunidad"
        : "crear";
  // Global surfaces live on the start page — a project-loaded URL pointing at
  // them leaves the editor (drops ?project) instead of rendering them inside.
  useEffect(() => {
    const pid = searchParams.get("project");
    if (!pid) return;
    if (centerView === "projects" || centerView === "explore" || centerView === "templates") {
      router.replace(centerView === "templates" ? "/new" : `/new?view=${centerView}`);
    }
  }, [centerView, searchParams, router]);
  const setCenterView = useCallback(
    (v: SectionView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (v === "page") params.delete("view");
      else params.set("view", v);
      const qs = params.toString();
      router.replace(qs ? `/new?${qs}` : "/new");
    },
    [searchParams, router],
  );
  const [saving, setSaving] = useState(false);
  const [loadedProject, setLoadedProject] = useState<LoadedProject | null>(null);
  // Saved business profiles ("Mi negocio") — hoisted above modulesPreview
  // (below), which resolves the canvas's platforms-band preview from this
  // list + loadedProject.profileId. Fetched on mount via refreshProfiles,
  // declared further down alongside the rest of the profiles UI state.
  const [profiles, setProfiles] = useState<BusinessProfile[]>([]);
  // The active site page (null = home) and the document the canvas edits.
  // Everything that used to read loadedProject.html for DISPLAY reads
  // activeDoc; saves route into the matching slot via activeSitePageRef.
  const activeSitePage =
    pageParam && loadedProject?.pages?.[pageParam] ? pageParam : null;
  const activeSitePageRef = useRef<string | null>(null);
  activeSitePageRef.current = activeSitePage;
  const activeDoc = activeSitePage
    ? loadedProject?.pages?.[activeSitePage]?.html ?? ""
    : loadedProject?.html ?? "";
  const sitePages = useMemo(
    () => listSitePages({ html: "", pages: loadedProject?.pages }),
    [loadedProject?.pages],
  );
  // Canvas module preview (WhatsApp FAB + catalog grid). Items come from the
  // collections API once per project/toggle; the memo below is keyed on the
  // module-relevant settings SLICES (stringified), so keystroke saves that
  // churn object identities never re-derive the iframe.
  const collectionsPreviewOn =
    loadedProject?.settings?.collections?.enabled === true;
  const [previewCollections, setPreviewCollections] = useState<{
    items: ItemRow[];
    layout: "grid" | "list";
  } | null>(null);
  useEffect(() => {
    if (!loadedProject?.id || !collectionsPreviewOn) {
      setPreviewCollections(null);
      return;
    }
    // Refetch on every return to the canvas (centerView dep): products added
    // in the Colecciones panel must show up in the grid without a full
    // project reload. The identity guard keeps an unchanged list from
    // re-deriving (and flashing) the iframe.
    if (centerView !== "page") return;
    let alive = true;
    fetch(`/api/projects/${loadedProject.id}/collections/items`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        const items = ((j.items ?? []) as ItemRow[]).filter(
          (it) => it.status === "published",
        );
        const next = {
          items,
          layout: (j.collection?.layout === "list" ? "list" : "grid") as "grid" | "list",
        };
        setPreviewCollections((cur) =>
          JSON.stringify(cur) === JSON.stringify(next) ? cur : next,
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [loadedProject?.id, collectionsPreviewOn, centerView]);
  // Linked profile first, else the user's default — same resolution as
  // projectBusinessProfile (lib/business-profiles/whatsapp-default.ts), done
  // here from data the workspace already has loaded: the project's profileId
  // (GET /api/projects/[id]) and the profile list (GET /api/profiles,
  // `profiles` state) — no extra fetch. Feeds BOTH the canvas preview and the
  // "Mis plataformas" insert affordance (that module has no settings.enabled;
  // these links ARE its on/off state).
  // ⚰️ Aquí se filtraban los enlaces del perfil que SÍ arman un href, para
  // saber si la banda de plataformas nacería pelada. Se va con la banda.
  // ⚰️ AQUÍ VIVÍA la vista previa de módulos EN EL LIENZO: el widget de
  // Colecciones y la banda de Plataformas, pintados sobre el documento para que
  // encender un módulo enseñara algo sin publicar.
  //
  // Muere el 2026-08-29 con los dos módulos que la justificaban. Y no quedaba
  // nada detrás: su primera línea era `if (!colPayload && !platforms) return
  // null`, así que sin ellos el FAB del asistente y el del chat tampoco se
  // calculaban nunca. Un subsistema entero cuya puerta de entrada eran las dos
  // cosas que se han ido.
  // Strip a stale ?page= once the project has loaded without that slug
  // (deleted page, mistyped share link).
  useEffect(() => {
    if (!pageParam || !loadedProject) return;
    if (!loadedProject.pages[pageParam]) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");
      const qs = params.toString();
      router.replace(qs ? `/new?${qs}` : "/new");
    }
  }, [pageParam, loadedProject, searchParams, router]);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
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
  // «Volver al original» — the resolved baseline version to preview/restore,
  // and whether the restore POST is currently in flight.
  const [originalModal, setOriginalModal] = useState<{
    versionId: string;
  } | null>(null);
  const [originalRestoring, setOriginalRestoring] = useState(false);
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
  // True mientras el chat dripea HTML crudo del modelo (ai-design Modo B, aún
  // sin sanitizar). Ver buildUntrustedSrcDoc en preview-prelude.ts.
  const [chatUntrustedDoc, setChatUntrustedDoc] = useState(false);
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
  const [usingSection, setUsingSection] = useState(false);
  const [useError, setUseError] = useState<string | null>(null);
  const [insertRequest, setInsertRequest] = useState<{
    html: string;
    nonce: number;
    sectionType: string;
    anchorPath?: string;
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
  // Doble-click guard for openRestoreOriginal — the baseline lookup is an
  // async fetch; a second click before it resolves must not race a second
  // in-flight lookup (and, worse, pop the confirm modal twice).
  const openingOriginalRef = useRef(false);
  // The section just added (drives the Undo pill). Cleared on undo or dismiss.
  const [lastInserted, setLastInserted] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // Staged until the band actually LANDS (the html-changed the insert posts
  // back): offering Undo before that would point at a page the insert hasn't
  // touched yet — the curated flow defers the drop past the scan reveal — and
  // the snapshot the Undo falls back to is only stashed by that same message.
  const pendingInsertRef = useRef<{ id: string; name: string } | null>(null);



  // Undo the most recent insert. Two paths, because the iframe script's node
  // refs die with the document it inserted into (any srcDoc re-derive — the
  // autosave round-trip, a module toggle — reloads it), and a pill that quietly
  // stops working is worse than no pill:
  //  • band still live (its data-openlen-just-inserted marker is in the iframe
  //    DOM) → `openlen:section-remove` pulls exactly those nodes out and
  //    restores any replaced navbar/footer, with no reload;
  //  • otherwise → the one-step snapshot doUndo restores (the html as it was
  //    BEFORE the insert), which the pill's own html-changed stashed. Safe
  //    because the pill retires the moment anything else edits the document.
  const handleUndoInsert = () => {
    setLastInserted(null);
    const live = iframeElRef.current?.contentDocument?.querySelector(
      "[data-openlen-just-inserted]",
    );
    if (!live) {
      doUndoRef.current();
      return;
    }
    // La inserción sigue en el montón de pendientes: quitarla es la edición de
    // borrado que manda el inyector, y las dos se aplican en orden.
    removeNonceRef.current += 1;
    setRemoveRequest({ nonce: removeNonceRef.current });
  };

  // Insert a curated animated hero (Images → Motion source). Rides the exact
  // section-insert + Undo path the image-drop "new-section" action uses — the
  // loop lands as a full-bleed <video> hero (sectionType "motion" → top).
  const handleInsertMotion = (a: MotionAsset) => {
    insertNonceRef.current += 1;
    setInsertRequest({
      html: buildMotionHeroHtml(a),
      nonce: insertNonceRef.current,
      sectionType: "motion",
    });
    pendingInsertRef.current = { id: "motion", name: t("drop.sectionName") };
  };

  // AI generation flow — owned here so the brief survives panel switches
  // inside the same /new?mode=ai session. On completion, we redirect
  // to ?project=<id> which drops the user into editing mode.
  // La ruta libre (/api/generate) vuelve a ser la puerta: una llamada escribe
  // el documento entero. Medido sobre los mismos cuatro briefs y el mismo
  // modelo, escribir de una pasada dio cero defectos deterministas donde
  // parchear una baseline dejó texto ilegible y una página sin padding, a la
  // quinta parte del costo. El parcheo escribía el color en un turno y el
  // fondo en otro, sin ver nunca los dos juntos.
  //
  // El dial de esfuerzo queda aparcado: en esta ruta no compra nada todavía, y
  // un selector que no compra nada es exactamente la mentira que se arregló en
  // `lib/document/page-effort.ts`. Su maquinaria sigue intacta.
  const [effort, setEffort] = useState<PageEffort>("low");
  const generation = useGeneration();
  const aiGenState = generation.state;
  // Saved business profiles ("Mi negocio") — seed the curation flow. Fetched on
  // mount; the default profile auto-selects (the user can switch or pick none).
  // (state declaration hoisted above loadedProject — see the comment there.)
  // False until the first /api/profiles fetch settles — the rail shows a
  // business-avatar skeleton while it's true so the switcher doesn't pop in.
  const [profilesLoaded, setProfilesLoaded] = useState(false);
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
    } finally {
      setProfilesLoaded(true);
    }
  }, [profileParam]);
  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);
  // Does the user have ANY real business saved? Drives the brief screen's
  // cold-start CTA (no info → lead with import; has info → show the picker).
  const hasBusinessInfo = useMemo(
    () => profiles.some((p) => isProfileFilled(p.data)),
    [profiles],
  );
  // Active-business context (the rail switcher). Derived from ?business; default
  // = the default profile; "all" = no scoping. It scopes the Páginas/Analytics/
  // Mensajes sections + is the business a new page attaches to.
  const defaultBusinessId = useMemo(
    () => profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? "",
    [profiles],
  );
  const businessParam = searchParams.get("business");
  const activeBusinessId = useMemo(() => {
    if (businessParam === ALL_BUSINESSES) return ALL_BUSINESSES;
    if (businessParam && profiles.some((p) => p.id === businessParam))
      return businessParam;
    return defaultBusinessId;
  }, [businessParam, profiles, defaultBusinessId]);
  const setActiveBusiness = useCallback(
    (v: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!v || v === defaultBusinessId) params.delete("business");
      else params.set("business", v);
      const qs = params.toString();
      router.replace(qs ? `/new?${qs}` : "/new");
    },
    [searchParams, router, defaultBusinessId],
  );
  // The business a NEW page attaches to (never "all" → fall back to default).
  const creationProfileId =
    activeBusinessId === ALL_BUSINESSES ? defaultBusinessId : activeBusinessId;
  // New pages + the AI seed follow the active business. Switching updates the
  // brief picker (the user can still override to "none" per page afterwards).
  useEffect(() => {
    if (activeBusinessId && activeBusinessId !== ALL_BUSINESSES) {
      setSelectedProfileId(activeBusinessId);
    }
  }, [activeBusinessId]);
  // "Hazla tuya" — a dismissible nudge shown on a page born without business
  // info. Dismissals persist per-project in localStorage so it's never naggy.
  const [makeYoursDismissed, setMakeYoursDismissed] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    try {
      const raw = localStorage.getItem("openlen.makeYoursDismissed");
      if (raw) setMakeYoursDismissed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);
  const dismissMakeYours = useCallback((id: string) => {
    setMakeYoursDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(
          "openlen.makeYoursDismissed",
          JSON.stringify([...next]),
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  // Re-apply the (now-saved) business to the open page — adds the contact widget
  // + logo, keeps the design. Set when the banner CTA opened the import modal.
  const pendingReseedRef = useRef(false);
  const reseedCurrentPage = useCallback(async () => {
    const id = loadedProject?.id;
    if (!id) return;
    // Seed the document on the canvas — and write the response back into
    // that same slot, even if the user switched pages while the seed ran.
    const page = activeSitePageRef.current;
    try {
      const res = await fetch(`/api/projects/${id}/seed-profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(page ? { page } : {}),
      });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as {
        html?: string;
        page?: string | null;
      } | null;
      const html = data?.html;
      const seededPage = data?.page ?? null;
      if (html) {
        setLoadedProject((prev) => {
          if (!prev || prev.id !== id) return prev;
          if (seededPage) {
            if (!prev.pages[seededPage]) return prev;
            return {
              ...prev,
              pages: {
                ...prev.pages,
                [seededPage]: { ...prev.pages[seededPage], html },
              },
            };
          }
          return { ...prev, html };
        });
      }
    } catch {
      /* ignore */
    }
  }, [loadedProject?.id]);
  const onMakeYours = useCallback(() => {
    pendingReseedRef.current = true;
    setProfileModalOpen(true);
  }, []);
  // Ingestion-degradation notice. Server-persisted (not localStorage like
  // makeYours): the person who pasted HTML may come back tomorrow, on another
  // device, and the point is that they were told once — not once per browser.
  const showDegradedNotice =
    entryMode === "editing" &&
    (loadedProject?.degradations?.length ?? 0) > 0 &&
    !loadedProject?.degradationsDismissed;
  const onDismissDegradations = useCallback(() => {
    const id = loadedProject?.id;
    if (!id) return;
    setLoadedProject((p) => (p ? { ...p, degradationsDismissed: true } : p));
    void fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ degradationsDismissed: true }),
    }).catch(() => {
      // Losing the dismissal is a re-show, not a data loss — the optimistic
      // update already got it out of the user's way for this session.
    });
  }, [loadedProject?.id]);
  // Brief can be pre-filled from a deep link (homepage hero CTA, projects
  // example cards, etc.) via ?brief=<urlencoded>.
  const briefParam = searchParams.get("brief");
  const autostartParam = searchParams.get("autostart");
  const preparedBriefParam = useMemo(
    () => prepareGenerationBriefInput(briefParam),
    [briefParam],
  );
  const [aiPrompt, setAiPrompt] = useState(() => preparedBriefParam.value);
  const [truncatedPrompt, setTruncatedPrompt] = useState<string | null>(() =>
    preparedBriefParam.truncated ? preparedBriefParam.value : null,
  );
  const [truncationAnnouncementToken, setTruncationAnnouncementToken] =
    useState<string | null>(() =>
      preparedBriefParam.truncated ? "deep-link-1" : null,
    );
  const truncationAnnouncementSequenceRef = useRef(
    preparedBriefParam.truncated ? 2 : 1,
  );
  const processedBriefParamRef = useRef(briefParam);
  const normalizedBriefParamRef = useRef<{ value: string | null } | null>(null);
  useEffect(() => {
    const previousBriefParam = processedBriefParamRef.current;
    if (previousBriefParam === briefParam) return;
    processedBriefParamRef.current = briefParam;
    const ownNormalization = normalizedBriefParamRef.current;
    normalizedBriefParamRef.current = null;
    if (
      !shouldSyncGenerationBriefParam(
        previousBriefParam,
        briefParam,
        ownNormalization?.value,
      )
    ) {
      return;
    }

    setAiPrompt(preparedBriefParam.value);
    setTruncatedPrompt(
      preparedBriefParam.truncated ? preparedBriefParam.value : null,
    );
    setTruncationAnnouncementToken(
      preparedBriefParam.truncated
        ? `deep-link-${truncationAnnouncementSequenceRef.current++}`
        : null,
    );
  }, [briefParam, preparedBriefParam]);
  // La referencia visual de "hazme una como esta". Vive junto al brief y no
  // dentro del compositor porque quien llama a /api/generate es esta página.
  const [aiReference, setAiReference] = useState<StyleDirection | null>(null);
  // La foto adjunta al brief, por lo mismo. Se limpia al generar: es de ESE
  // brief, y dejarla puesta haria que la siguiente pagina naciera mirando una
  // referencia que el usuario ya no tiene delante.
  const [aiFoto, setAiFoto] = useState<{ dataUrl: string; nombre: string } | null>(null);
  const aiBriefFormState = useMemo(
    () => ({
      prompt: aiPrompt,
      setPrompt: setAiPrompt,
      truncatedPrompt,
      setTruncatedPrompt,
      truncationAnnouncementToken,
      setTruncationAnnouncementToken,
      reference: aiReference,
      setReference: setAiReference,
      foto: aiFoto,
      setFoto: setAiFoto,
    }),
    [
      aiPrompt,
      truncatedPrompt,
      truncationAnnouncementToken,
      aiReference,
      aiFoto,
    ],
  );
  const aiGenerating = aiGenState.kind === "generating";
  // Mobile: the brief panel covers the canvas, so close it the moment the
  // stream starts — the user should watch their page assemble, not the form.
  useEffect(() => {
    if (isMobile && aiGenState.kind === "generating") setLeftCollapsed(true);
  }, [isMobile, aiGenState.kind]);
  const [genSlow, setGenSlow] = useState(false);
  const startAiGeneration = useCallback(
    (prompt: string) => {
      if (aiGenerating) return;
      const brief = trimGenerationBrief(prompt);
      if (!isGenerationBriefLengthValid(brief)) return;
      // DOS ORIGENES, UNA FOTO. La del heroe cruza por `sessionStorage` —no
      // cabe en la URL— y se LEE Y SE BORRA aqui: es un pase de un solo uso.
      // La adjuntada en este mismo compositor ya esta en el estado.
      //
      // Manda la del compositor: si el usuario adjunto una AQUI, es la que
      // tiene delante, y una foto invisible del heroe ganandole seria el peor
      // tipo de sorpresa. Aun asi se consume la del transito para que no quede
      // esperando a la siguiente generacion.
      const delTransito = tomarReferenciaEnTransito();
      const foto = aiFoto ?? delTransito;
      void generation.generate(brief, selectedProfileId, aiReference, foto?.dataUrl ?? null);
      setAiFoto(null);
    },
    [aiGenerating, generation, selectedProfileId, aiReference, aiFoto],
  );
  const handleAiGenerate = useCallback(() => {
    startAiGeneration(aiPrompt);
  }, [aiPrompt, startAiGeneration]);
  // A deep link with `?autostart=1` (the homepage hero) kicks generation
  // off on arrival. The param is stripped right after so a manual reload of
  // this URL doesn't re-fire — and re-bill — the generation.
  const autostartedRef = useRef(false);
  useEffect(() => {
    if (autostartParam !== "1") {
      autostartedRef.current = false;
      return;
    }
    if (autostartedRef.current) return;
    autostartedRef.current = true;
    if (preparedBriefParam.autostartAllowed) {
      startAiGeneration(preparedBriefParam.value);
    }
    const normalizedBriefParam = preparedBriefParam.value || null;
    normalizedBriefParamRef.current =
      normalizedBriefParam === briefParam
        ? null
        : { value: normalizedBriefParam };
    router.replace(
      preparedBriefParam.value
        ? `/new?mode=ai&brief=${encodeURIComponent(preparedBriefParam.value)}`
        : "/new?mode=ai",
    );
  }, [
    autostartParam,
    briefParam,
    preparedBriefParam,
    router,
    startAiGeneration,
  ]);
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
    // Sólo se recuerda lo que YA es una página. Un documento a medio abrir
    // —el preámbulo de una reescritura— pisaría el recuerdo con un stub y la
    // pantalla se quedaría igual de vacía que antes.
    if (aiGenState.kind === "generating" && yaEsPagina(aiGenState.html)) {
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
      window.location.href = `/${locale}/new?project=${projectId}`;
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
        const kind = data.kind === "icon" || data.kind === "image" || data.kind === "video"
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
            wasProps: Array.isArray(data.wasProps)
              ? (data.wasProps as string[]).filter((p) => typeof p === "string")
              : [],
            ancestors: Array.isArray(data.ancestors)
              ? (data.ancestors as unknown[]).filter(
                  (a): a is { path: string; tag: string; hint: string } =>
                    !!a &&
                    typeof a === "object" &&
                    typeof (a as Record<string, unknown>).path === "string" &&
                    typeof (a as Record<string, unknown>).tag === "string" &&
                    typeof (a as Record<string, unknown>).hint === "string",
                )
              : [],
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
            typeScale: typeof m.typeScale === "number" ? m.typeScale : null,
            spaceScale: typeof m.spaceScale === "number" ? m.spaceScale : null,
            radiusScale: typeof m.radiusScale === "number" ? m.radiusScale : null,
            displayFont: typeof m.displayFont === "string" ? m.displayFont : null,
            hasFontPair: !!m.hasFontPair,
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
  // Clear a stale template preview when navigating away from the Plantillas tab,
  // so returning later shows the grid + tabs, not a tab-less full-screen preview.
  useEffect(() => {
    if (centerView !== "templates" && entryMode !== "template") {
      setPreviewingTemplate(null);
      setTemplateError(null);
    }
  }, [centerView, entryMode]);
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
      // A refetch must never clobber local edits the server hasn't seen yet.
      // Con el «Aplicar» explícito esto pesa MÁS, no menos: el montón de
      // pendientes puede quedarse ahí todo el rato que el usuario quiera, y un
      // documento traído del servidor pisaría el lienzo donde vive su trabajo.
      // Mientras haya algo pendiente, o acabe de haberlo, no se converge.
      const editingLocally = () =>
        pendientesRef.current.length > 0 ||
        enviandoRef.current ||
        Date.now() - lastLocalEditAtRef.current < 2500;
      if (editingLocally()) return;
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) return;
      // Re-check AFTER the await: a slow response (dev compiles, cold DB) can
      // arrive seconds later carrying a long-stale document — applying it
      // then would time-travel the canvas past edits made mid-flight.
      if (editingLocally()) return;
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
              profileId?: string | null;
              /** El JavaScript del modelo ya autorizado — la decisión la toma
               *  el servidor con la misma función que publica. */
              data: {
                html?: string;
                filledBlocks?: unknown[];
                settings?: ProjectSettings;
                pages?: Record<string, SitePage>;
                degradations?: Degradation[];
                degradationsDismissed?: boolean;
              };
            };
          }
        | null;
      const p = data?.project;
      if (!p) return;
      // Superseded: the URL moved on (e.g. redirected out to a global surface)
      // while this request was in flight — applying it now would resurrect a
      // project the user already left.
      if (projectParamRef.current !== id) return;
      const filledCount = Array.isArray(p.data?.filledBlocks)
        ? p.data.filledBlocks.length
        : 0;
      // Sanitize on load too — a project edited before this fix shipped may
      // already have leaked editor scripts baked into data.html.
      const html = stripEditorInstrumentation(p.data?.html ?? "");
      const pages: Record<string, SitePage> = {};
      for (const [slug, page] of Object.entries(p.data?.pages ?? {})) {
        if (page && typeof page.html === "string") {
          pages[slug] = { ...page, html: stripEditorInstrumentation(page.html) };
        }
      }
      setLoadedProject({
        id: p.id,
        title: p.title,
        subdomain: p.subdomain,
        publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
        hasUnpublishedChanges: p.hasUnpublishedChanges,
        logoUrl: p.logoUrl ?? null,
        html,
        pages,
        isFlat: filledCount === 0,
        userBrief: p.userBrief ?? "",
        chatHistory: p.chatHistory ?? [],
        settings: p.data?.settings,
        degradations: p.data?.degradations,
        degradationsDismissed: p.data?.degradationsDismissed,
        profileId: p.profileId ?? null,
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

  // PUBLICAR APLICA PRIMERO. El modal no manda el documento: publica lo que hay
  // en la base de datos. Con cambios sin aplicar eso sacaría a producción una
  // página SIN ellos — el usuario ve sus cambios en el lienzo, pulsa Publicar, y
  // su web sale como estaba.
  //
  // Se lanza al ABRIR para ganar tiempo (el modal pide un subdominio antes de
  // nada) y el modal lo ESPERA al confirmar (`onAntesDePublicar`). Lo segundo
  // es lo que cierra la carrera; lo primero sólo hace que casi nunca se note.
  const onPublish = loadedProject
    ? () => {
        void aplicarPendientesRef.current?.();
        setPublishModalOpen(true);
      }
    : undefined;
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

  // Drop engine — armed whenever a project is open, deliberately NOT tied to
  // the Edit toggle: dragging a file over the page (or pasting an image) is
  // unambiguous intent, and the iframe script is visually silent when idle.
  const dropEnabled =
    entryMode === "editing" && !!loadedProject && !sectionSelectMode;

  // Compute which sidebar tabs are locked based on the entry mode + the
  // loaded project's shape. In an entry flow, only the relevant tab is
  // interactive. In editing mode every tab opens — flat projects show a
  // hint-only Content panel (no slot form) and the iframe enters inline
  // edit when that tab is active.
  const lockedTabs = useMemo<SidebarMode[]>(() => {
    if (entryMode === "editing") return [];
    // Entry flows: on the AI landing the brief lives in the center
    // (StartLanding), so the sidebar Chat tab is locked there too — only
    // Template/Paste entries still expose Chat as a "switch to AI start"
    // shortcut. Everything else (including Sitio — the pages tree needs a
    // loaded project) unlocks once a project exists. Templates browsing lives
    // on the start page now; the editing-mode Templates panel is currently
    // unreachable pending a product decision, so it isn't part of this lock
    // set either.
    const locked = ALL_TABS.filter((t) => t !== "chat");
    return entryMode === "ai" ? [...locked, "chat"] : locked;
  }, [entryMode]);

  const lockReason = t("lockReason.created");

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

  // ---- Drop engine — parent orchestration ---------------------------------
  // The iframe script (use-drop-place.ts) detects targets + posts intents;
  // this side uploads the file and routes the result through the EXISTING
  // apply contracts (swap-asset / apply-prop style-bg / section-insert), so
  // every commit rides the normal html-changed save + version pipeline.
  const [dropNotice, setDropNotice] = useState<
    | { kind: "hint" }
    | { kind: "uploading" }
    | { kind: "error"; text: string }
    | { kind: "done"; text: string }
    | null
  >(null);
  // One-step undo for direct-manipulation commits (drops, trash, toolbar).
  // The html-changed listener stashes the PREVIOUS document before applying
  // any edit; "Deshacer" restores it, persists, and remounts the iframe via
  // the docKey epoch (a state push alone is skipped while editing).
  const loadedProjectRef = useRef(loadedProject);
  loadedProjectRef.current = loadedProject;
  const undoRef = useRef<{ html: string; page: string | null } | null>(null);
  const pendingPillRef = useRef<string | null>(null);
  // Timestamp of the last local edit/undo — refetchProject's anti-clobber
  // guard reads it (see its comment).
  const lastLocalEditAtRef = useRef(0);
  const [undoEpoch, setUndoEpoch] = useState(0);
  // Bridge: the drop message listener mounts before doUndo is declared.
  const doUndoRef = useRef<() => void>(() => {});
  const dropNoticeTimerRef = useRef<number | null>(null);
  const placementRef = useRef<({ token: number } & DropSrc) | null>(null);
  const placeTokenRef = useRef(0);
  const dropBusyRef = useRef(false);
  // Bumped before a swap-asset / style-bg commit: the apply lands in the LIVE
  // iframe DOM, so the doc-change that follows must not reload the srcDoc
  // (a white flash when the Edit toggle is off). Same skip the insert flow uses.
  const [suppressReload, setSuppressReload] = useState(0);

  const flashDropError = useCallback((text: string) => {
    setDropNotice({ kind: "error", text });
    if (dropNoticeTimerRef.current !== null)
      window.clearTimeout(dropNoticeTimerRef.current);
    dropNoticeTimerRef.current = window.setTimeout(
      () => setDropNotice(null),
      4000,
    );
  }, []);
  useEffect(
    () => () => {
      if (dropNoticeTimerRef.current !== null)
        window.clearTimeout(dropNoticeTimerRef.current);
    },
    [],
  );

  // Same constraints the assets route enforces — fail fast with the modal's
  // own translated strings instead of waiting on a 4xx.
  const validateDropFile = useCallback(
    (file: File): string | null => {
      if (!file.type.startsWith("image/")) return tAsset("upload.notImage");
      if (file.size > 8 * 1024 * 1024)
        return tAsset("upload.tooLarge", { max: 8 });
      return null;
    },
    [tAsset],
  );

  const uploadDropFile = useCallback(
    async (projectId: string, file: File): Promise<{ url: string } | null> => {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/projects/${projectId}/assets`, {
          method: "POST",
          body: form,
        });
        const data = (await res.json().catch(() => null)) as {
          url?: string;
        } | null;
        if (!res.ok || !data?.url) return null;
        return { url: data.url };
      } catch {
        return null;
      }
    },
    [],
  );

  const cancelPlacement = useCallback(() => {
    placementRef.current = null;
    setDropNotice(null);
    iframeElRef.current?.contentWindow?.postMessage(
      { type: "openlen:place-cancel" },
      "*",
    );
  }, []);

  // Paste → placement mode. Upload + luminance-derive start immediately (in
  // parallel) so they resolve while the user aims. A new paste supersedes the
  // pending one.
  const startPlacement = useCallback(
    (file: File) => {
      const projectId = loadedIdRef.current;
      if (!projectId) return;
      const err = validateDropFile(file);
      if (err) {
        flashDropError(err);
        return;
      }
      placeTokenRef.current += 1;
      const token = placeTokenRef.current;
      placementRef.current = {
        token,
        file,
        uploadPromise: uploadDropFile(projectId, file),
        worldPromise: deriveWorldFromFile(file).catch(() => null),
      };
      iframeElRef.current?.contentWindow?.postMessage(
        { type: "openlen:place-start", token },
        "*",
      );
      setDropNotice({ kind: "hint" });
    },
    [validateDropFile, flashDropError, uploadDropFile],
  );

  // Click-to-place from the Images panel (also the mobile path): same
  // placement mode as paste, minus validation/upload — the URL is already
  // hosted. Luminance derives through the proxy while the user aims.
  const startPlacementAsset = useCallback((asset: DropAsset) => {
    const projectId = loadedIdRef.current;
    if (!projectId) return;
    placeTokenRef.current += 1;
    const token = placeTokenRef.current;
    placementRef.current = {
      token,
      asset,
      worldPromise: deriveWorldFromUrl(
        imageFetchUrl(asset.url, projectId),
      ).catch(() => null),
    };
    iframeElRef.current?.contentWindow?.postMessage(
      { type: "openlen:place-start", token },
      "*",
    );
    setDropNotice({ kind: "hint" });
  }, []);

  const commitDrop = useCallback(
    async (projectId: string, intent: DropIntent, src: DropSrc) => {
      if (dropBusyRef.current) return;
      if (src.file) {
        const err = validateDropFile(src.file);
        if (err) {
          flashDropError(err);
          return;
        }
      } else if (!src.asset) {
        return;
      }
      dropBusyRef.current = true;
      // Panel assets are already hosted — no upload, no "uploading" flash.
      if (!src.asset) setDropNotice({ kind: "uploading" });
      try {
        const url = src.asset
          ? src.asset.url
          : ((await (src.uploadPromise ?? uploadDropFile(projectId, src.file!)))
              ?.url ?? null);
        // Navigated to another project mid-upload — don't apply to the wrong doc.
        if (loadedIdRef.current !== projectId) return;
        if (!url) {
          flashDropError(tAsset("upload.networkError"));
          return;
        }
        const win = iframeElRef.current?.contentWindow;
        if (!win) return;
        const alt =
          src.asset?.alt ||
          fileNameToAlt(
            src.file
              ? src.file.name
              : decodeURIComponent(
                  new URL(url, window.location.origin).pathname
                    .split("/")
                    .pop() ?? "",
                ),
          );
        if (intent.action !== "new-section") {
          setSuppressReload((n) => n + 1);
          pendingPillRef.current = t(
            intent.action === "replace-image"
              ? "undoPill.replaced"
              : intent.action === "section-bg"
                ? "undoPill.background"
                : "undoPill.split",
          );
        }
        if (intent.action === "replace-image") {
          win.postMessage(
            {
              type: "openlen:swap-asset",
              kind: "image",
              path: intent.path,
              payload: {
                url,
                alt,
                ...(src.asset?.credit ? { credit: src.asset.credit } : {}),
              },
            },
            "*",
          );
        } else if (intent.action === "section-bg") {
          const world = await (src.worldPromise ??
            (src.file
              ? deriveWorldFromFile(src.file)
              : deriveWorldFromUrl(imageFetchUrl(url, projectId))
            ).catch(() => null));
          win.postMessage(
            {
              type: "openlen:apply-prop",
              scope: "style-bg",
              path: intent.path,
              kind: "image",
              value: url,
              legibility: sectionBgPlan(world ? world.lum : 0.5),
            },
            "*",
          );
        } else if (intent.action === "media-split") {
          win.postMessage(
            {
              type: "openlen:apply-prop",
              scope: "split",
              path: intent.path,
              side: intent.side,
              url,
              alt,
            },
            "*",
          );
        } else if (intent.action === "new-section") {
          insertNonceRef.current += 1;
          setInsertRequest({
            html: buildImageSectionHtml(url, alt),
            nonce: insertNonceRef.current,
            sectionType: "image",
            anchorPath: intent.anchorPath ?? undefined,
          });
          // Rides the section-insert flash so the Undo pill works for free.
          pendingInsertRef.current = {
            id: "drop-image",
            name: t("drop.sectionName"),
          };
        }
        // Unsplash compliance: ping download_location when the photo is USED.
        if (src.asset?.downloadLocation) {
          void fetch("/api/unsplash/track-download", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              downloadLocation: src.asset.downloadLocation,
            }),
          }).catch(() => {});
        }
        setDropNotice(null);
      } finally {
        dropBusyRef.current = false;
      }
    },
    [validateDropFile, flashDropError, uploadDropFile, tAsset, t],
  );

  // File-drag navigation guard — a drop that misses the iframe (sidebar, top
  // bar) must never navigate the workspace away. preventDefault only: modal
  // dropzones (Replace → Upload) handle their drops at target phase first.
  useEffect(() => {
    if (!(entryMode === "editing" && loadedProject)) return;
    const guard = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      if (!types) return;
      for (let i = 0; i < types.length; i++) {
        if (types[i] === "Files" || types[i] === DROP_ASSET_MIME) {
          e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, [entryMode, loadedProject?.id]);

  // Clipboard paste (parent focus side) → placement mode. Skips real inputs +
  // open dialogs; when focus sits in the canvas the iframe's own paste
  // listener forwards the file here as openlen:paste-file.
  useEffect(() => {
    if (!dropEnabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      const file = e.clipboardData?.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      e.preventDefault();
      startPlacement(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [dropEnabled, startPlacement]);

  // Esc on the parent side cancels a pending placement (the iframe handles
  // Esc when focus sits in the canvas).
  useEffect(() => {
    if (!dropNotice || dropNotice.kind !== "hint") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelPlacement();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dropNotice, cancelPlacement]);

  // Ctrl/Cmd+Z (parent focus side) — one-step undo of the last change. The
  // iframe forwards its own combo as openlen:undo-request when the canvas
  // has focus; real inputs and the chat keep their native undo.
  useEffect(() => {
    if (!dropEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "z" && e.key !== "Z") || (!e.ctrlKey && !e.metaKey)) return;
      if (e.shiftKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      doUndoRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dropEnabled]);

  // Drop/place intents from the iframe script.
  useEffect(() => {
    if (!loadedProject) return;
    const projectId = loadedProject.id;
    const onMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      if (iframeElRef.current && e.source !== iframeElRef.current.contentWindow)
        return;
      const d = e.data as {
        type?: string;
        intent?: DropIntent;
        file?: File;
        asset?: unknown;
        token?: number;
        path?: unknown;
      };
      if (d.type === "openlen:paste-file" && d.file instanceof File) {
        startPlacement(d.file);
      } else if (d.type === "openlen:undo-request") {
        doUndoRef.current();
      } else if (d.type === "openlen:drop-intent" && d.intent) {
        if (d.intent.action === "swap-images") {
          // No upload, no asset — just route the exchange to the inspect
          // script's apply (src+alt travel; sizes stay with their slots).
          const { fromPath, toPath } = d.intent;
          if (
            typeof fromPath === "string" &&
            typeof toPath === "string" &&
            fromPath.length < 400 &&
            toPath.length < 400 &&
            fromPath !== toPath
          ) {
            setSuppressReload((n) => n + 1);
            pendingPillRef.current = t("undoPill.swapped");
            iframeElRef.current?.contentWindow?.postMessage(
              { type: "openlen:apply-prop", scope: "swap-images", fromPath, toPath },
              "*",
            );
          }
        } else if (d.file instanceof File) {
          void commitDrop(projectId, d.intent, { file: d.file });
        } else if (d.asset) {
          // Re-validate parent-side through the same shape-checker the iframe
          // ran — single source of truth for what an asset may carry.
          const asset = parseDropAsset(JSON.stringify(d.asset));
          if (asset) void commitDrop(projectId, d.intent, { asset });
        }
      } else if (d.type === "openlen:asset-remove") {
        // The hover pill's trash button — the inspect script knows how to
        // undo each drop kind (un-split / clear bg / remove img + empty section).
        if (typeof d.path === "string" && d.path.length < 400) {
          setSuppressReload((n) => n + 1);
          pendingPillRef.current = t("undoPill.removed");
          iframeElRef.current?.contentWindow?.postMessage(
            { type: "openlen:apply-prop", scope: "remove-image", path: d.path },
            "*",
          );
        }
      } else if (d.type === "openlen:place-commit" && d.intent) {
        const pending = placementRef.current;
        if (!pending || pending.token !== d.token) return;
        placementRef.current = null;
        void commitDrop(projectId, d.intent, pending);
      } else if (d.type === "openlen:place-cancelled") {
        if (placementRef.current && placementRef.current.token === d.token) {
          placementRef.current = null;
          setDropNotice(null);
        }
      } else if (d.type === "openlen:iframe-ready" && placementRef.current) {
        // srcDoc rebuilt mid-placement — the iframe's place-mode state is gone.
        placementRef.current = null;
        setDropNotice(null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadedProject?.id, startPlacement, commitDrop]);

  // Save state surfaced to TopBar (chrome polish session renders the pill;
  // we just track it here so the contract is wired end-to-end).
  const [savingStatus, setSavingStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const savedFlashRef = useRef<number | null>(null);

  // Listen for the iframe's `openlen:html-changed` messages. Kept mounted for
  // the whole life of a loaded project (NOT gated on editingActive): when the
  // user toggles Edit OFF mid-edit, inline-edit commits + flushes a final
  // html-changed as part of that transition — if the listener were torn down
  // synchronously with the toggle, that flush would be dropped and the edit
  // lost. The editor scripts only POST while in edit mode, so an always-mounted
  // listener never receives spurious saves. Inline-edit, Reorder, Replace,
  // Insert and inspect-mode property edits all emit via this same contract.
  // ── LAS EDICIONES PENDIENTES ──────────────────────────────────────────────
  //
  // El taller deja de mandar fotos del DOM y manda QUÉ CAMBIÓ. Las ediciones se
  // acumulan aquí y se aplican contra el documento GUARDADO, que es lo que
  // permite que el JavaScript del modelo corra mientras se edita: su trabajo
  // vive en la pantalla y la pantalla ya no es la fuente de la verdad.
  //
  // Se envían en LOTE y en ORDEN. El servidor re-estampa el documento entre
  // ediciones, así que la segunda se resuelve contra lo que dejó la primera —
  // que es lo que el usuario tenía delante cuando la hizo. Mandarlas de una en
  // una y en paralelo rompería justo eso.
  //
  // EL LOTE NO SE VACÍA SOLO. Jesús eligió el «Aplicar» explícito de v0
  // (2026-08-26): los cambios se quedan pendientes y VISIBLES hasta que él los
  // aplica, y se pueden descartar enteros sin haber tocado el documento
  // guardado ni una vez.
  //
  // Explícito no quiere decir frágil: nada que pueda PERDER el montón ocurre
  // sin vaciarlo antes. Cambiar de página, cambiar de proyecto, publicar,
  // guardar una versión y cerrar la pestaña pasan todos por `flushPendingSave`,
  // que es la lista de sitios donde el trabajo no se puede quedar atrás. Sólo
  // «Descartar» tira ediciones, y porque se lo han pedido.
  const pendientesRef = useRef<Edicion[]>([]);
  const enviandoRef = useRef(false);
  /** Cuántas hay, para pintarlas. `pendientesRef` sigue siendo la verdad — el
   *  estado es su reflejo, porque un ref no re-renderiza. */
  const [pendientes, setPendientes] = useState(0);
  /** Sube cuando se descarta: obliga al lienzo a recargar el documento
   *  guardado, que es la única forma de deshacer lo que ya se ve en pantalla. */
  const [descarteEpoch, setDescarteEpoch] = useState(0);
  /** Hay un lote viajando. `enviandoRef` es el que decide —un ref no
   *  re-renderiza— y esto es lo que se pinta. */
  const [aplicandoLote, setAplicandoLote] = useState(false);
  /** El vaciado, por ref: se define más abajo y el temporizador lo necesita
   *  desde arriba. Mismo patrón que `doUndoRef` unas líneas más allá. */
  const aplicarPendientesRef = useRef<(() => Promise<void>) | null>(null);
  /** Cambiar de página, por ref: el manejador de mensajes del iframe se monta
   *  ANTES de que `switchSitePage` exista. Mismo patrón. */
  const switchSitePageRef = useRef<((slug: string | null) => void) | null>(null);
  /** La sección a la que bajar en cuanto la página destino cargue. Viene de un
   *  enlace como `/#artistas`: cambiar de página REMONTA el iframe, así que el
   *  desplazamiento no lo puede hacer quien pulsó — lo pide el padre cuando el
   *  documento nuevo ya está listo. El nonce distingue «pulsó otra vez el mismo
   *  enlace» de «este componente re-renderizó». */
  const [anclaPendiente, setAnclaPendiente] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const anclaNonceRef = useRef(0);
  const pedirAncla = useCallback((id: string) => {
    if (!id) return;
    anclaNonceRef.current += 1;
    setAnclaPendiente({ id, nonce: anclaNonceRef.current });
  }, []);

  const persistDoc = useCallback(
    (p: {
      projectId: string;
      /** El camino viejo: el documento entero. */
      html?: string;
      /** El camino nuevo: qué cambió. Excluyente con `html`. */
      edits?: readonly Edicion[];
      source: string;
      page: string | null;
    }): Promise<void> => {
      setSavingStatus("saving");
      return fetch(`/api/projects/${p.projectId}/html`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(p.edits ? { edits: p.edits } : { html: p.html }),
          source: p.source,
          baseUpdatedAt: projectUpdatedAtRef.current,
          ...(p.page ? { page: p.page } : {}),
        }),
      })
        .then(async (r) => {
          setSavingStatus(r.ok ? "saved" : "idle");
          if (r.ok) {
            // Nudge other tabs of this project to refetch the new HTML.
            syncChannelRef.current?.postMessage({ projectId: p.projectId });
            // Advance the concurrency base to the version the server just
            // wrote — so this tab's own next save isn't read as a clobber.
            const saved = (await r.json().catch(() => null)) as
              | { updatedAt?: string; html?: string }
              | null;
            if (saved?.updatedAt) {
              projectUpdatedAtRef.current = new Date(saved.updatedAt).getTime();
            }
            // Guardando por ediciones, el cliente NO tiene el documento nuevo —
            // él sólo mandó qué cambió. Llega en la respuesta, y sin meterlo
            // aquí la pestaña de código, el Chat y publicar seguirían viendo la
            // versión anterior mientras el lienzo enseña la nueva.
            const htmlNuevo = typeof saved?.html === "string" ? saved.html : null;
            // Y SIN RECARGAR EL LIENZO. El documento que vuelve es el resultado
            // de las ediciones que el usuario acaba de hacer AHÍ: la pantalla ya
            // lo enseña. Re-derivar sería tirar el iframe abajo para volver a
            // pintar lo mismo — un parpadeo en blanco por cada «Aplicar».
            // Va en el MISMO commit que el documento nuevo, que es lo que hace
            // que la supresión llegue a tiempo de taparlo.
            if (htmlNuevo && p.edits) setSuppressReload((n) => n + 1);
            setLoadedProject((prev) => {
              if (!prev || prev.id !== p.projectId) return prev;
              const conBandera = { ...prev, hasUnpublishedChanges: !!prev.subdomain };
              if (!htmlNuevo) return conBandera;
              return p.page && conBandera.pages[p.page]
                ? {
                    ...conBandera,
                    pages: {
                      ...conBandera.pages,
                      [p.page]: { ...conBandera.pages[p.page], html: htmlNuevo },
                    },
                  }
                : { ...conBandera, html: htmlNuevo };
            });
            if (savedFlashRef.current !== null)
              window.clearTimeout(savedFlashRef.current);
            savedFlashRef.current = window.setTimeout(
              () => setSavingStatus("idle"),
              1600,
            );
          }
        })
        .catch(() => setSavingStatus("idle"));
    },
    [],
  );
  /**
   * Manda el montón de ediciones y lo vacía.
   *
   * EN LOTE Y EN ORDEN, y nunca dos a la vez: el servidor re-estampa el
   * documento entre ediciones, así que la segunda se resuelve contra lo que
   * dejó la primera. Dos peticiones en vuelo resolverían las dos contra el
   * mismo documento y la segunda caería donde ya no estaba su elemento.
   */
  const aplicarPendientes = useCallback(async (): Promise<void> => {
    if (enviandoRef.current) return;
    const projectId = loadedProjectRef.current?.id;
    if (!projectId) return;
    const lote = pendientesRef.current;
    if (lote.length === 0) return;
    pendientesRef.current = [];
    setPendientes(0);
    enviandoRef.current = true;
    setAplicandoLote(true);
    try {
      await persistDoc({
        projectId,
        edits: lote,
        source: "inline-edit",
        page: activeSitePageRef.current,
      });
    } finally {
      enviandoRef.current = false;
      setAplicandoLote(false);
    }
    // Si llegaron más mientras ésta viajaba, se van detrás — nunca a la vez.
    if (pendientesRef.current.length > 0) await aplicarPendientes();
  }, [persistDoc]);
  aplicarPendientesRef.current = aplicarPendientes;

  /**
   * CERRAR LA PESTAÑA CON CAMBIOS SIN APLICAR.
   *
   * Es el único sitio donde el trabajo se puede perder de verdad y no hay
   * `flushPendingSave` que valga: el navegador no espera a una petición. Así
   * que se avisa — el diálogo es del navegador y no admite texto propio, pero
   * la pregunta llega.
   *
   * Sólo mientras haya algo pendiente: un `beforeunload` permanente convierte
   * cerrar la pestaña en un trámite para todo el mundo.
   */
  useEffect(() => {
    if (pendientes === 0) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [pendientes]);

  /**
   * DESCARTAR: tirar el montón y volver a lo guardado.
   *
   * Vaciar la lista no basta — los cambios ya están EN LA PANTALLA, que es
   * donde el usuario los hizo. Hay que recargar el lienzo desde el documento
   * guardado, que es el que nunca se tocó. De ahí el epoch.
   */
  const descartarPendientes = useCallback(() => {
    if (pendientesRef.current.length === 0) return;
    pendientesRef.current = [];
    setPendientes(0);
    undoRef.current = null;
    setDropNotice(null);
    setDescarteEpoch((n) => n + 1);
  }, []);

  /**
   * Vacía el montón y se resuelve cuando el guardado terminó.
   *
   * ES LA LISTA DE SITIOS DONDE EL TRABAJO NO SE PUEDE QUEDAR ATRÁS, y por eso
   * conserva el nombre: sus llamadores —cambiar de página, cambiar de proyecto,
   * guardar una versión, publicar, navegar— ya estaban todos escritos. Antes
   * vaciaba un autosave pendiente; ahora vacía las ediciones pendientes, que es
   * exactamente el mismo trabajo por delante.
   */
  const flushPendingSave = useCallback((): Promise<void> => {
    return aplicarPendientesRef.current?.() ?? Promise.resolve();
  }, []);

  // "Deshacer" — restore the pre-edit snapshot the html-changed listener
  // stashed, persist it, and remount the iframe (docKey epoch) so the canvas
  // reflects it even mid-editing (a doc push alone is skipped while editing).
  const doUndo = useCallback(() => {
    const u = undoRef.current;
    const projectId = loadedIdRef.current;
    if (!u || !projectId) return;
    undoRef.current = null;
    lastLocalEditAtRef.current = Date.now();
    setDropNotice(null);
    // Deshacer se lleva por delante lo que aún no se ha aplicado: restaura el
    // documento de ANTES, así que las ediciones pendientes ya no describen nada
    // que exista.
    pendientesRef.current = [];
    setPendientes(0);
    setLoadedProject((prev) => {
      if (!prev || prev.id !== projectId) return prev;
      if (u.page && prev.pages[u.page]) {
        return {
          ...prev,
          pages: {
            ...prev.pages,
            [u.page]: { ...prev.pages[u.page], html: u.html },
          },
        };
      }
      if (u.page) return prev;
      return { ...prev, html: u.html };
    });
    setUndoEpoch((n) => n + 1);
    void persistDoc({
      projectId,
      html: u.html,
      source: "props",
      page: u.page,
    });
  }, [persistDoc]);
  doUndoRef.current = doUndo;
  useEffect(() => {
    if (!loadedProject) return;
    const projectId = loadedProject.id;

    const onMessage = (e: MessageEvent) => {
      if (!e.data) return;
      // Only the live preview iframe may PATCH the project's HTML.
      if (iframeElRef.current && e.source !== iframeElRef.current.contentWindow)
        return;

      // ── UN ENLACE DEL SITIO ────────────────────────────────────────────────
      //
      // El lienzo es un `srcdoc`, que no tiene URL propia: un href="/menu" se
      // resolvía contra la app de OpenLen y el iframe se iba a
      // localhost:3000/menu. La única forma de comprobar que tu navegación
      // funciona era publicar. El clic ya viene interceptado desde dentro
      // (use-page-links.ts); aquí sólo se decide a dónde lleva.
      // Un destino de FUERA. Lo abre el padre porque el lienzo corre con
      // sandbox="allow-scripts" y sin allow-popups: un window.open desde dentro
      // lo bloquea el navegador y el enlace no haría nada, sin un solo error.
      if (e.data.type === "openlen:abrir-fuera") {
        const url = typeof e.data.url === "string" ? e.data.url : "";
        // Sólo http(s). El href sale del documento, y `javascript:` abierto
        // desde AQUÍ correría con el origen de OpenLen, no con el del lienzo.
        if (/^https?:\/\//i.test(url)) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }

      // UN ANCLA QUE NO LLEVA A NINGUNA PARTE. Publicada tampoco haría nada,
      // pero ahí el silencio es del navegador; aquí se puede decir, que es
      // donde todavía se arregla.
      if (e.data.type === "openlen:ancla-perdida") {
        const id = typeof e.data.id === "string" ? e.data.id : "";
        if (id) toast.error(t("toast.anclaSinDestino", { id }));
        return;
      }

      if (e.data.type === "openlen:ir-a-pagina") {
        const slug = typeof e.data.slug === "string" ? e.data.slug : null;
        const ancla = typeof e.data.ancla === "string" ? e.data.ancla : "";
        const paginaActual = activeSitePageRef.current ?? "";
        // "" es la Home — así la nombra `switchSitePage`, con null.
        if (slug === "" || (slug && loadedProjectRef.current?.pages[slug])) {
          // YA ESTAMOS AHÍ: sólo se baja, no se remonta. Remontar por un enlace
          // a la propia página tiraría lo que el usuario tuviera abierto para
          // volver a cargar el mismo documento y acabar en el mismo sitio.
          if ((slug ?? "") === paginaActual) {
            if (ancla) {
              iframeElRef.current?.contentWindow?.postMessage(
                { type: "openlen:ir-a-ancla", id: ancla },
                "*",
              );
            }
            return;
          }
          if (ancla) pedirAncla(ancla);
          switchSitePageRef.current?.(slug === "" ? null : slug);
          return;
        }
        // ESA PÁGINA NO EXISTE, y ése es el fallo que hoy es MUDO: publicada,
        // una ruta desconocida devuelve la portada con un 200 y el enlace
        // parece funcionar. Aquí se dice, que es donde todavía se puede
        // arreglar.
        const destino = typeof e.data.href === "string" ? e.data.href : "";
        toast.error(t("toast.enlaceSinPagina", { destino }));
        return;
      }

      // ── UNA EDICIÓN ────────────────────────────────────────────────────────
      //
      // Dice QUÉ cambió, no cómo quedó la pantalla. Se apila y se aplica contra
      // el documento guardado; el JavaScript del modelo puede hacer lo que
      // quiera en el lienzo porque el lienzo ya no se lee.
      if (e.data.type === "openlen:edit") {
        const edicion = leerEdicion(e.data);
        if (!edicion) return;
        const rawSource =
          typeof e.data.source === "string" ? e.data.source : "inline-edit";
        const estructural =
          rawSource === "reorder" ||
          rawSource === "section-toolbar" ||
          rawSource === "block-move" ||
          rawSource === "section-insert";

        // DESHACER: el documento como estaba ANTES de esta tanda.
        //
        // Lo guardaba el receptor de `openlen:html-changed`, que se quedó sin
        // emisores cuando los cinco inyectores pasaron a mandar ediciones — y
        // con él se fueron en silencio la píldora «Deshacer», la de insertar y
        // el soltar la selección tras un cambio estructural. Un punto de
        // deshacer por TANDA, no por gesto: los gestos que caen dentro de la
        // misma ventana de 400 ms se guardan juntos, así que también se
        // deshacen juntos.
        if (pendientesRef.current.length === 0) {
          const pagina = activeSitePageRef.current;
          const antes = pagina
            ? loadedProjectRef.current?.pages[pagina]?.html
            : loadedProjectRef.current?.html;
          if (typeof antes === "string" && antes) {
            undoRef.current = { html: antes, page: pagina ?? null };
          }
        }
        // Escribir el mismo titular tres veces es UNA edición, no tres: la
        // última gana. Sólo para las que son idempotentes por naturaleza —
        // dos inserciones sobre el mismo ancla son dos cosas distintas.
        const previas = pendientesRef.current;
        const clave = claveDeEdicion(edicion);
        const i = clave ? previas.findIndex((x) => claveDeEdicion(x) === clave) : -1;
        if (i >= 0) previas[i] = edicion;
        else previas.push(edicion);
        setPendientes(previas.length);
        lastLocalEditAtRef.current = Date.now();

        // Un cambio estructural desplaza los índices de los hermanos, así que
        // la ruta `:nth-of-type` que el inspector tiene guardada ya no nombra
        // lo mismo. Se suelta la selección para que la siguiente propiedad no
        // aterrice en el elemento de al lado; el usuario vuelve a hacer clic.
        if (estructural) setInspectSelection(null);

        // La píldora de insertar es un deshacer de UN paso de la última banda:
        // aparece cuando aterriza y se retira en cuanto cualquier otra cosa
        // edita el documento — que es lo que mantiene seguro su respaldo.
        if (rawSource === "section-insert") {
          setLastInserted(pendingInsertRef.current);
          pendingInsertRef.current = null;
          // Consumida: el fragmento ya está en el documento. PreviewArea
          // re-manda cualquier petición pendiente desde su handler de
          // iframe-listo, así que una que se quede aquí de pie planta una
          // SEGUNDA copia de la banda cada vez que el usuario vuelve al lienzo.
          setInsertRequest(null);
        } else {
          setLastInserted(null);
        }

        // La píldora «Deshacer» — el pipeline de soltar pre-escribe su
        // etiqueta; la barra de sección trae su acción en el mensaje.
        const pillText =
          pendingPillRef.current ??
          (rawSource === "section-toolbar"
            ? t(
                e.data.action === "duplicate"
                  ? "undoPill.duplicated"
                  : e.data.action === "delete"
                    ? "undoPill.deleted"
                    : "undoPill.moved",
              )
            : rawSource === "block-move"
              ? t("undoPill.blockMoved")
              : rawSource === "resize"
                ? t("undoPill.resized")
                : null);
        pendingPillRef.current = null;
        if (pillText && undoRef.current) {
          setDropNotice({ kind: "done", text: pillText });
          if (dropNoticeTimerRef.current !== null)
            window.clearTimeout(dropNoticeTimerRef.current);
          dropNoticeTimerRef.current = window.setTimeout(
            () => setDropNotice((n) => (n && n.kind === "done" ? null : n)),
            6000,
          );
        }

        return;
      }
      // Y NADA MAS. Aqui vivia el receptor de `openlen:html-changed`, que
      // recibia el documento VIVO entero y lo guardaba como la pagina del
      // usuario. Se quedo sin emisores cuando los cinco inyectores pasaron a
      // mandar ediciones, y se va con ellos: dejarlo de pie seria dejar la
      // puerta puesta para que alguien vuelva a colgar un emisor y tumbe en
      // silencio la unica propiedad que sostiene todo esto — que el lienzo no
      // se lee. La prueba `guardar-sin-leer-el-lienzo` vigila que no vuelva.
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (savedFlashRef.current !== null) {
        window.clearTimeout(savedFlashRef.current);
        savedFlashRef.current = null;
      }
      // Undo snapshots don't survive a project switch.
      undoRef.current = null;
      pendingPillRef.current = null;
    };
    // Intentionally NOT depending on loadedProject.subdomain: it flips null→value
    // on first publish, and re-binding here would tear down the listener —
    // dropping the last pre-publish edit. The save reads the fresh subdomain
    // via functional setState, so it stays correct without the dep.
  }, [loadedProject?.id, t]);

  // Multi-page: switch the canvas to another site page. Flushes any pending
  // autosave FIRST so the debounced write can't land in the wrong slot, and
  // clears the positional inspector selection (paths are per-document).
  const switchSitePage = useCallback(
    (slug: string | null) => {
      // Force-commit an in-progress inline edit FIRST — while the active page is
      // still the OLD one — so typed-but-not-blurred text is captured into the
      // pending save for the page being left, not lost or mis-routed onto the
      // page we're switching to when the iframe remounts.
      const win = iframeElRef.current?.contentWindow;
      win?.postMessage({ type: "openlen:commit-edits" }, "*");
      const go = () => {
        void flushPendingSave();
        setInspectSelection(null);
        const params = new URLSearchParams(searchParams.toString());
        if (slug) params.set("page", slug);
        else params.delete("page");
        const qs = params.toString();
        router.push(qs ? `/new?${qs}` : "/new");
        if (isMobile) setLeftCollapsed(true);
      };
      // Que la edición del commit llegue al montón ANTES de vaciarlo y navegar.
      if (win) setTimeout(go, 60);
      else go();
    },
    [flushPendingSave, searchParams, router, isMobile],
  );
  switchSitePageRef.current = switchSitePage;

  const createSitePage = useCallback(
    async (slug: string): Promise<string | null> => {
      const id = loadedProject?.id;
      if (!id) return "errInvalid";
      // Se ESPERA: lo que sigue escribe en el servidor sobre este mismo
      // proyecto, y un lote que llegara despues resolveria sus rutas contra
      // un documento que ya cambio.
      await flushPendingSave();
      const res = await fetch(`/api/projects/${id}/pages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      }).catch(() => null);
      if (!res) return "errInvalid";
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === "exists") return "errExists";
        if (body?.error === "reserved") return "errReserved";
        if (body?.error === "limit_reached") return "errLimit";
        return "errInvalid";
      }
      await refetchProject(id);
      switchSitePage(slug);
      return null;
    },
    [loadedProject?.id, refetchProject, switchSitePage, flushPendingSave],
  );

  const deleteSitePage = useCallback(
    async (slug: string): Promise<boolean> => {
      const id = loadedProject?.id;
      if (!id) return false;
      // Se ESPERA: lo que sigue escribe en el servidor sobre este mismo
      // proyecto, y un lote que llegara despues resolveria sus rutas contra
      // un documento que ya cambio.
      await flushPendingSave();
      const res = await fetch(`/api/projects/${id}/pages/${slug}`, {
        method: "DELETE",
      }).catch(() => null);
      if (!res?.ok) return false;
      if (activeSitePageRef.current === slug) switchSitePage(null);
      await refetchProject(id);
      return true;
    },
    [loadedProject?.id, refetchProject, switchSitePage, flushPendingSave],
  );

  // Land a restored document into the workspace — shared by the Versions
  // panel's own restore flow (any version) and «Volver al original» (the
  // baseline). Same mechanism either way: advance the concurrency base,
  // patch the right document slot, and land the canvas on it.
  const applyRestoredVersion = useCallback(
    (html: string, page: string | null, updatedAtMs?: number) => {
      if (typeof updatedAtMs === "number" && Number.isFinite(updatedAtMs)) {
        projectUpdatedAtRef.current = updatedAtMs;
      }
      if (page) {
        if (!loadedProject) return;
        if (loadedProject.pages[page]) {
          setLoadedProject((prev) =>
            prev && prev.pages[page]
              ? {
                  ...prev,
                  pages: {
                    ...prev.pages,
                    [page]: { ...prev.pages[page], html },
                  },
                }
              : prev,
          );
          // Land the canvas on the restored page so the effect is visible.
          if (activeSitePageRef.current !== page) switchSitePage(page);
        } else {
          // The restore recreated a since-deleted page — refetch the
          // authoritative pages map, then land the canvas on it.
          void refetchProject(loadedProject.id).then(() =>
            switchSitePage(page),
          );
        }
        return;
      }
      // Home snapshot — land the canvas there before applying it.
      if (activeSitePageRef.current) switchSitePage(null);
      setLoadedProject((prev) => (prev ? { ...prev, html } : prev));
    },
    [loadedProject, refetchProject, switchSitePage],
  );

  // «Volver al original» — look up the newest baseline snapshot scoped to
  // the document on the canvas (server-side, via ?baseline=1 — avoids
  // filtering the capped /versions list, which can miss the baseline on
  // many-page projects) and open the confirm modal with its preview. No
  // baseline for this page → toast instead of a silent no-op.
  const openRestoreOriginal = useCallback(async () => {
    if (openingOriginalRef.current) return;
    openingOriginalRef.current = true;
    try {
      const pid = loadedIdRef.current;
      if (!pid) return;
      const page = activeSitePageRef.current ?? null;
      const qs = page
        ? `?baseline=1&page=${encodeURIComponent(page)}`
        : "?baseline=1";
      const res = await fetch(`/api/projects/${pid}/versions${qs}`);
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as
        | { baseline?: { id: string } | null }
        | null;
      if (data?.baseline) {
        setOriginalModal({ versionId: data.baseline.id });
      } else {
        toast.info(tProps("original.none"));
      }
    } catch {
      // Network failure — silent no-op, same as before this endpoint existed.
    } finally {
      openingOriginalRef.current = false;
    }
  }, [toast, tProps]);

  // Confirm restore: POST the existing (non-destructive) restore endpoint,
  // then run the exact same post-restore sequence versions-panel.tsx runs
  // after its own restore fetch — apply the html + toast — and close.
  const confirmRestoreOriginal = useCallback(async () => {
    const pid = loadedIdRef.current;
    if (!pid || !originalModal) return;
    setOriginalRestoring(true);
    try {
      const res = await fetch(
        `/api/projects/${pid}/versions/${originalModal.versionId}/restore`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        html: string;
        label: string;
        page: string | null;
        updatedAt?: string;
      };
      // The loaded project may have changed while the restore fetch was in
      // flight — landing the old project's baseline into another project's
      // state would autosave into the wrong DB row.
      if (loadedIdRef.current !== pid) return;
      const updatedAtMs = data.updatedAt
        ? new Date(data.updatedAt).getTime()
        : undefined;
      applyRestoredVersion(data.html, data.page ?? null, updatedAtMs);
      const label = data.label?.trim();
      toast.success(
        label
          ? tVersions("toast.restored", { label })
          : tVersions("toast.restoredNoLabel"),
      );
      setOriginalModal(null);
    } catch {
      toast.error(tVersions("toast.restoreError"));
    } finally {
      setOriginalRestoring(false);
    }
  }, [originalModal, applyRestoredVersion, toast, tVersions]);

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
      setOriginalModal(null);
      setOriginalRestoring(false);
      setPendingChatDraft(null);
      setInspectMode(false);
      setInspectSelection(null);
      setPageMeta(null);
      setOriginalTheme(null);
      setActiveLook(null);
      // Section library transient UI is project-scoped — a stale preview/Undo
      // pill (or a still-pending insert request themed for the old project) must
      // not carry across a project switch.
      setUseError(null);
      setLastInserted(null);
      pendingInsertRef.current = null;
      setInsertRequest(null);
    }
    prevLoadedIdRef.current = newId;
    loadedIdRef.current = newId;
  }, [loadedProject?.id]);

  // Per-PAGE transient reset: switching the active site page (same project, via
  // ?page=) must drop state that belongs to the page you're LEAVING —
  //  • the captured theme baseline + active Look, so "Original"/Dark re-derive
  //    from the page you're now on (not home);
  //  • pageMeta, so the inspector reflects the new page's <head> not the old;
  //  • the undo/insert pills, so clicking them can't invisibly revert a page
  //    you're no longer viewing.
  // First run is skipped (prev === undefined) so a normal load doesn't reset.
  const prevActivePageRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (
      prevActivePageRef.current !== undefined &&
      prevActivePageRef.current !== activeSitePage
    ) {
      setOriginalTheme(null);
      setActiveLook(null);
      setPageMeta(null);
      setOriginalModal(null);
      setOriginalRestoring(false);
      setLastInserted(null);
      pendingInsertRef.current = null;
      setDropNotice(null);
      undoRef.current = null;
      pendingPillRef.current = null;
    }
    prevActivePageRef.current = activeSitePage;
  }, [activeSitePage]);

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
        if (publishModalOpen || assetModal || originalModal) return;
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
    assetModal,
    originalModal,
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
  // Un <button> con destino se convierte en el <a> que debió ser. Va por su
  // propio canal y no por `applyElementProp` porque no es poner un atributo:
  // es reemplazar el elemento, y la ruta del inspector cambia con él.
  const linkifyButton = useCallback((path: string, href: string) => {
    iframeElRef.current?.contentWindow?.postMessage(
      { type: "openlen:apply-prop", scope: "linkify-button", path, href },
      "*",
    );
  }, []);
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
  // Reset por control/faceta/elemento — restaura desde el stash data-ol-was.
  const applyResetProps = useCallback((path: string, props: string[]) => {
    iframeElRef.current?.contentWindow?.postMessage(
      { type: "openlen:apply-prop", scope: "reset", path, props },
      "*",
    );
  }, []);
  // Breadcrumb — re-selecciona un ancestro (escapar del hijo al contenedor).
  const selectPath = useCallback((path: string) => {
    iframeElRef.current?.contentWindow?.postMessage(
      { type: "openlen:apply-prop", scope: "select", path },
      "*",
    );
  }, []);
  // Smart background — a solid color that replaces any gradient/image, an
  // image fill (background-image), a CSS gradient string, or clearing the
  // fill. Gradients ship a legibility plan (avg stop luminance → ink) so the
  // scoped re-ink keeps the section's text readable, same as image drops.
  const applyBg = useCallback(
    (
      path: string,
      kind: "color" | "image" | "clear" | "gradient",
      value: string,
    ) => {
      const g = kind === "gradient" ? parseSimpleGradient(value) : null;
      iframeElRef.current?.contentWindow?.postMessage(
        {
          type: "openlen:apply-prop",
          scope: "style-bg",
          path,
          kind,
          value,
          ...(g ? { legibility: gradientBgPlan(g.stops) } : {}),
        },
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
  // Dial global — un token de tema individual (inline var en <html>).
  const applyThemeToken = useCallback((prop: string, value: string) => {
    iframeElRef.current?.contentWindow?.postMessage(
      { type: "openlen:apply-prop", scope: "theme", prop, value },
      "*",
    );
  }, []);
  // Par de fuentes curado — el <link> persiste en el documento (data-ol-fonts)
  // y las familias display/body aterrizan como inline vars en <html>. null =
  // quitar el par (vuelve la fuente autorada).
  const applyFontPair = useCallback(
    (pair: { displayCss: string; bodyCss: string; href: string } | null) => {
      iframeElRef.current?.contentWindow?.postMessage(
        {
          type: "openlen:apply-prop",
          scope: "fonts",
          displayCss: pair?.displayCss ?? "",
          bodyCss: pair?.bodyCss ?? "",
          href: pair?.href ?? "",
        },
        "*",
      );
    },
    [],
  );
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
  // a later dark/light toggle re-derives the right colors. setActiveLook is
  // bookkeeping only; the pulse wraps just the in-iframe dispatch.
  const applyLook = useCallback(
    (lightBundle: Record<string, string>) => {
      setActiveLook(lightBundle);
      scanController.pulse(() => applyLookForMode(lightBundle, modeRef.current));
    },
    [applyLookForMode],
  );
  // Dark/light toggle — re-applies the active Look's colors for the new mode.
  const toggleThemeMode = useCallback(
    (mode: "light" | "dark") => {
      scanController.pulse(() => applyLookForMode(activeLook, mode));
    },
    [applyLookForMode, activeLook],
  );
  // "Original" reset — drop the active Look and re-apply the page's captured
  // baseline (re-applies resolved values rather than blank-clearing, which
  // would break canonize's force-CSS on legacy pages).
  const resetTheme = useCallback(() => {
    setActiveLook(null);
    scanController.pulse(() => applyLookForMode(null, modeRef.current));
  }, [applyLookForMode]);
  // "De tu logo" — apply a Look in an EXPLICIT ink direction (the logo's),
  // remembering the light bundle so the existing Dark toggle keeps working.
  const applyLookWithMode = useCallback(
    (lightBundle: Record<string, string>, mode: "light" | "dark") => {
      setActiveLook(lightBundle);
      scanController.pulse(() => applyLookForMode(lightBundle, mode));
    },
    [applyLookForMode],
  );
  // Temática — install/remove a full-page world. The kit's stylesheet + font
  // link persist IN the document (the iframe stamps them, then saves through
  // the normal funnel — thumbnails/exports/published all carry the world);
  // its token bundle rides the existing theme-bundle channel so the accent,
  // fonts and radius re-derive exactly like a Look. Off re-applies the page's
  // captured baseline.
  const applyTematica = useCallback(
    (kit: TematicaPreset | null, backdropId?: string) => {
      const win = iframeElRef.current?.contentWindow;
      if (!win) return;
      if (kit) {
        setActiveLook(kit.tokens);
        // Single pulse over the full visual dispatch — the world CSS/font,
        // then the derived theme bundle, land together as one pass.
        scanController.pulse(() => {
          win.postMessage(
            {
              type: "openlen:apply-prop",
              scope: "tematica",
              id: kit.id,
              css: tematicaCss(kit, backdropId),
              fontHref: kit.fontHref ?? "",
              bg: backdropId ?? "",
              // The kit grounds, for the contrast re-ink pass (the iframe
              // measures old text colors against the NEW world).
              tokens: kit.tokens,
            },
            "*",
          );
          applyThemeBundle(kit.tokens);
          applyThemeMode(kit.mode);
        });
      } else {
        // resetTheme() pulses internally too; nested while this one's fn is
        // already mid-flight is safe (pulse degrades to a direct call once
        // phase isn't idle — see scan-controller.ts) and keeps the world-off
        // postMessage and the baseline restore in the same visual pass.
        scanController.pulse(() => {
          win.postMessage(
            { type: "openlen:apply-prop", scope: "tematica", id: "", css: "", fontHref: "", bg: "" },
            "*",
          );
          resetTheme();
        });
      }
    },
    [applyThemeBundle, applyThemeMode, resetTheme],
  );
  // The active kit + backdrop variant, read off the live document so the
  // picker stays true after reloads, restores and chat redesigns.
  const activeTematica = useMemo(
    () => readTematicaId(activeDoc),
    [activeDoc],
  );
  const activeTematicaBg = useMemo(
    () => readTematicaBackdrop(activeDoc),
    [activeDoc],
  );
  // Form config is not HTML — it persists straight to ProjectData.settings
  // (so the notify email never reaches the published page source).
  const applyFormConfig = useCallback(
    (formIndex: number, formId: string | null, patch: Partial<FormConfig>) => {
      const projectId = loadedProject?.id;
      if (!projectId) return;
      // La IDENTIDAD del formulario manda sobre su posición: atada al elemento,
      // sobrevive a que una edición posterior lo mueva de sitio. Sin ella
      // —página anterior al estampado— se cae a la clave por índice, que es lo
      // que había. El servidor aplica el MISMO criterio (settings-patch.ts), y
      // la respuesta trae la clave real bajo la que guardó.
      const page = activeSitePageRef.current;
      const key = formId ?? formConfigKey(page, formIndex);
      void fetch(`/api/projects/${projectId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          formIndex,
          ...(formId ? { formId } : {}),
          patch,
          ...(page ? { page } : {}),
        }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`PATCH failed (${r.status})`);
          return r.json();
        })
        .then((res) => {
          if (!res) return;
          // Mirror the server's merged form config into local state.
          setLoadedProject((prev) => {
            if (!prev) return prev;
            const forms = { ...(prev.settings?.forms ?? {}) };
            // `res.formKey` es la clave bajo la que el servidor guardó de
            // verdad. Cuando migró de índice a identidad, la vieja desaparece.
            const real = typeof res.formKey === "string" ? res.formKey : key;
            if (real !== key) delete forms[key];
            if (res.config) forms[real] = res.config;
            else delete forms[real];
            return { ...prev, settings: { ...prev.settings, forms } };
          });
          toast.success(t("toast.formSaved"));
        })
        .catch(() => {
          toast.error(t("toast.formError"));
        });
    },
    [loadedProject?.id, toast, t],
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
        const page = activeSitePageRef.current;
        const res = await fetch(
          `/api/projects/${projectId}/forms/test-email`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ formIndex, ...(page ? { page } : {}) }),
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
          toast.success(t("toast.logoUpdated"));
        })
        .catch(() => {
          setLoadedProject((p) =>
            p ? { ...p, logoUrl: prevLogoUrl } : p,
          );
          toast.error(t("toast.logoError"));
        });
    },
    [loadedProject?.id, loadedProject?.logoUrl, toast, t],
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
          toast.error(t("toast.renameError"));
        });
    },
    [loadedProject?.id, projectName, toast, t],
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
      })
        .then((r) => {
          if (!r.ok) throw new Error(`PATCH failed (${r.status})`);
          toast.success(
            t(disabled ? "toast.analyticsDisabled" : "toast.analyticsEnabled"),
          );
        })
        .catch(() => {
          // On failure roll the toggle back so UI matches server state.
          setLoadedProject((prev) =>
            prev
              ? {
                  ...prev,
                  settings: { ...prev.settings, analyticsDisabled: !disabled },
                }
              : prev,
          );
          toast.error(t("toast.saveError"));
        });
    },
    [loadedProject?.id, toast, t],
  );
  const createModulePage = useCallback(
    async (module: "bookings" | "collections"): Promise<void> => {
      const id = loadedProject?.id;
      if (!id) return;
      // Se ESPERA: lo que sigue escribe en el servidor sobre este mismo
      // proyecto, y un lote que llegara despues resolveria sus rutas contra
      // un documento que ya cambio.
      await flushPendingSave();
      const res = await fetch(`/api/projects/${id}/pages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ module }),
      }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as
        | { ok?: boolean; error?: string; slug?: string; page?: { slug?: string } }
        | null;
      if (res?.ok && body?.page?.slug) {
        await refetchProject(id);
        switchSitePage(body.page.slug);
        toast.success(t("toast.modulePageCreated"));
        return;
      }
      if (body?.error === "exists" && body.slug) {
        await refetchProject(id);
        switchSitePage(body.slug);
        toast.info(t("toast.modulePageExists"));
        return;
      }
      toast.error(t("toast.moduleError"));
    },
    [loadedProject?.id, refetchProject, switchSitePage, flushPendingSave, toast, t],
  );
  const updateCollectionsSettings = useCallback(
    async (patch: CollectionsSettings): Promise<boolean> => {
      const projectId = loadedProject?.id;
      if (!projectId) return false;
      try {
        const r = await fetch(`/api/projects/${projectId}/settings`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ collections: patch }),
        });
        if (!r.ok) {
          toast.error(t("toast.moduleError"));
          return false;
        }
        setLoadedProject((p) =>
          p
            ? {
                ...p,
                settings: {
                  ...p.settings,
                  collections: { ...p.settings?.collections, ...patch },
                },
              }
            : p,
        );
        if (typeof patch.enabled === "boolean") {
          const moduleName = t("toast.moduleCollections");
          toast.success(
            t(patch.enabled ? "toast.moduleEnabled" : "toast.moduleDisabled", {
              module: moduleName,
            }),
          );
        }
        return true;
      } catch {
        toast.error(t("toast.moduleError"));
        return false;
      }
    },
    [loadedProject?.id, toast, t],
  );
  const updateMarketingSettings = useCallback(
    (patch: { register?: string; match?: boolean }) => {
      const projectId = loadedProject?.id;
      if (!projectId) return;
      // Optimistic apply, revert on failure: the prop transition (old → new →
      // old) is what lets MarketingView's resync effects roll a control back.
      const previous = loadedProject?.settings?.marketing;
      const apply = (value: typeof previous) =>
        setLoadedProject((p) =>
          p ? { ...p, settings: { ...p.settings, marketing: value } } : p,
        );
      apply({ ...previous, ...patch });
      void (async () => {
        try {
          const r = await fetch(`/api/projects/${projectId}/settings`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ marketing: patch }),
          });
          if (!r.ok) {
            toast.error(t("toast.moduleError"));
            apply(previous);
          }
        } catch {
          toast.error(t("toast.moduleError"));
          apply(previous);
        }
      })();
    },
    [loadedProject?.id, loadedProject?.settings?.marketing, toast, t],
  );
  const updateChatSettings = useCallback(
    async (patch: ChatSettings): Promise<boolean> => {
      const projectId = loadedProject?.id;
      if (!projectId) return false;
      try {
        const r = await fetch(`/api/projects/${projectId}/settings`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat: patch }),
        });
        if (!r.ok) {
          toast.error(t("toast.moduleError"));
          return false;
        }
        setLoadedProject((p) =>
          p
            ? {
                ...p,
                settings: {
                  ...p.settings,
                  chat: { ...p.settings?.chat, ...patch },
                },
              }
            : p,
        );
        if (typeof patch.enabled === "boolean") {
          toast.success(
            t(patch.enabled ? "toast.moduleEnabled" : "toast.moduleDisabled", {
              module: "Chat",
            }),
          );
        }
        return true;
      } catch {
        toast.error(t("toast.moduleError"));
        return false;
      }
    },
    [loadedProject?.id, toast, t],
  );
  // Both insert the DESIGNED band (same buildModuleSection surface the pages
  // API uses) — the old dashed caption boxes read as broken ("¿qué es esto?");
  // the canvas preview then fills the band with the real grid / a skeleton.
  // ⚰️ AQUÍ VIVÍA «añadir módulo desde la biblioteca»: un asistente que
  // encendía el módulo, insertaba su sección o le creaba una página. Muere el
  // 2026-08-29 porque `ContentModule` era exactamente "collections" |
  // "platforms" — los dos únicos que tenía— y los dos se fueron: uno lo hace
  // mejor un almacén declarado, y el otro era un TECHO sobre lo que el modelo
  // podía proponer para unas redes sociales.
  //
  // Un asistente para añadir módulos, sin módulos que añadir, es andamio con
  // menú.
  const toggleInspect = useCallback(() => {
    setInspectMode((m) => !m);
    setInspectSelection(null);
  }, []);

  // Entry-flow tab switch: pre-project, clicking the Chat tab enters the AI
  // brief and the Templates tab enters the gallery (both via the URL, since the
  // panel + canvas are entryMode-gated). In editing every tab just switches the
  // panel. Paste has no tab — it's reachable via ?mode=paste.
  const handleTabSelect = (m: SidebarMode) => {
    if (entryMode !== "editing" && m === "chat") {
      router.push("/new?mode=ai");
      setMode("chat");
      return;
    }
    setMode(m);
  };

  const handleUseTemplate = async () => {
    if (!previewingTemplate || committingTemplate) return;
    setCommittingTemplate(true);
    setTemplateError(null);
    try {
      const res = await fetch("/api/projects/from-template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId: previewingTemplate.id,
          profileId: creationProfileId || undefined,
        }),
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
      window.location.href = `/${locale}/new?project=${data.projectId}`;
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
        soundVolume={soundVolume}
        onSoundVolume={setSoundVolume}
        onToggleSoundMute={toggleSoundMute}
      />
      <div className="flex-1 min-h-0 flex relative">
        <LeftSidebar
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((c) => !c)}
          activeSection={normalizedCenterView}
          onSelectSection={setCenterView}
          mode={mode}
          setMode={handleTabSelect}
          sections={sections}
          expanded={expanded}
          setExpanded={setExpanded}
          onUpdateSection={updateSection}
          onPreviewTemplate={(t) => {
            setPreviewingTemplate(t);
            setTemplateError(null);
            // Mobile: the gallery overlays the canvas — close it so the
            // tapped template's preview is actually visible.
            if (isMobile) setLeftCollapsed(true);
          }}
          previewingTemplateId={previewingTemplate?.id ?? null}
          onInsertMotion={loadedProject ? handleInsertMotion : undefined}
          lockedTabs={lockedTabs}
          lockReason={lockReason}
          entryMode={entryMode}
          flatProjectHtml={loadedProject ? activeDoc : undefined}
          flatProjectPage={activeSitePage}
          flatProjectId={loadedProject?.id}
          onFlatHtmlUpdate={(newHtml, pageOverride, untrusted) => {
            // Va en el MISMO handler que el html para que no puedan
            // desincronizarse: un drip crudo del chat marca el documento como
            // no confiable, y el `done` ya sanitizado lo devuelve a normal.
            setChatUntrustedDoc(untrusted === true);
            // Chat pins its turn's page so mid-stream page switches (or a
            // cross-page Undo) can't write the wrong slot; single-arg
            // callers keep targeting whatever page is active.
            const page =
              pageOverride === undefined
                ? activeSitePageRef.current
                : pageOverride;
            setLoadedProject((prev) => {
              if (!prev) return prev;
              if (page) {
                // Page deleted since the write was pinned — drop rather
                // than let a subpage document fall through onto home.
                if (!prev.pages[page]) return prev;
                return {
                  ...prev,
                  pages: {
                    ...prev.pages,
                    [page]: { ...prev.pages[page], html: newHtml },
                  },
                };
              }
              return { ...prev, html: newHtml };
            });
          }}
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
          onRestoreApplied={applyRestoredVersion}
          onPrepareSnapshot={flushPendingSave}
          sectionSelectMode={sectionSelectMode}
          onToggleSectionSelect={(active) => setSectionSelectMode(active)}
          scopedSelection={scopedSelection}
          onClearScope={() => setScopedSelection(null)}
          pendingDraft={pendingChatDraft}
          onPendingDraftConsumed={() => setPendingChatDraft(null)}
          businesses={profiles}
          businessesLoading={!profilesLoaded}
          activeBusinessId={activeBusinessId}
          onPickBusiness={setActiveBusiness}
          onAddBusiness={() => setProfileModalOpen(true)}
          onPickImage={startPlacementAsset}
          sitePages={sitePages}
          activeSitePage={activeSitePage}
          onSwitchSitePage={switchSitePage}
          activePageLabel={activeSitePage ? `/${activeSitePage}` : t("modulesHub.home")}
          homePageLabel={t("modulesHub.home")}
          siteName={loadedProject?.title ?? null}
        />
        {/* One <main> landmark for the workspace center. `contents` keeps the
            flex layout byte-identical (generates no box) while giving the a11y
            tree exactly one main region (fixes landmark-one-main + region). The
            sr-only h1 gives every entry state a top-level heading. */}
        <main className="contents">
        <h1 className="sr-only">{t("a11y.workspaceHeading")}</h1>
        {normalizedCenterView === "messages" ? (
          <InboxHub />
        ) : normalizedCenterView === "business" ? (
          <BusinessSection
            embedded
            onChanged={() => {
              void refreshProfiles();
              // Auto-reaplicar: re-seed the open page so contact-bar changes
              // (show/hide, side) show up immediately instead of only on new
              // pages. No-op when no project is open. recolor:false keeps design.
              void reseedCurrentPage();
            }}
          />
        ) : normalizedCenterView === "resultados" ? (
          <ResultadosView
            currentProjectId={loadedProject?.id ?? null}
            onApplyTip={(instruction) => {
              // Page Coach → reuse the Chat: load the instruction into the
              // composer and switch to the Chat tab (same flow as the
              // post-swap chip). The user reviews and hits Send → ai-design
              // applies it.
              setCenterView("page");
              setPendingChatDraft(instruction);
              setMode("chat");
            }}
            siteSlot={<AnalyticsSection activeBusinessId={activeBusinessId} />}
          />
        ) : normalizedCenterView === "modulos" ? (
          <ModulesView
            currentProjectId={loadedProject?.id ?? null}
            chatSettings={loadedProject?.settings?.chat}
            onUpdateChatSettings={updateChatSettings}
            onOpenBusinessProfile={() => setCenterView("business")}
            onShowLeads={() => {
              const pid = searchParams.get("project");
              router.push(
                pid ? `/inbox?tab=forms&from=${encodeURIComponent(pid)}` : "/inbox?tab=forms",
              );
            }}
            onShowAnalytics={() => setCenterView("resultados")}
            onReturnToCanvas={() => setCenterView("page")}
            placements={
              loadedProject
                ? modulePlacements({ html: loadedProject.html, pages: loadedProject.pages })
                : undefined
            }
            sitePages={sitePages}
            activeSitePage={activeSitePage}
            onSwitchPage={switchSitePage}
            homePageLabel={t("modulesHub.home")}
            projectTitle={loadedProject?.title ?? null}
            projectSubdomain={loadedProject?.subdomain ?? null}
          />
        ) : normalizedCenterView === "marketing" ? (
          <MarketingView
            projectId={loadedProject?.id ?? null}
            initialRegister={loadedProject?.settings?.marketing?.register}
            initialMatch={loadedProject?.settings?.marketing?.match ?? true}
            onSaveRegister={(r) => updateMarketingSettings({ register: r })}
            onSaveMatch={(m) => updateMarketingSettings({ match: m })}
          />
        ) : (
          <>
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
                    ? paginaEnPantalla(aiGenState.html, lastPreviewHtmlRef.current)
                    : lastPreviewHtmlRef.current
                }
                streaming={false}
                done={aiGenState.kind === "done"}
                slow={genSlow}
                medido={
                  aiGenState.kind === "generating" ? aiGenState.medido : undefined
                }
                caption={
                  aiGenState.kind === "generating"
                    ? aiGenState.notice
                      ? t("aiStatus.improving")
                      : aiGenState.html
                        ? t("aiStatus.designing")
                        : t("aiStatus.thinking")
                    : undefined
                }
              />
            </section>
          ) : aiGenState.kind === "error" && aiGenState.noCredits ? (
            // Quedarse sin créditos NO es una generación fallida: reintentar
            // no puede funcionar. Panel propio, con la fecha de vuelta y la
            // única acción que sí sirve.
            <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-preview-a">
              <div className="flex-1 min-h-0 flex items-center justify-center px-6">
                <div className="text-center max-w-md">
                  <div className="text-[13px] text-amber-700 dark:text-amber-300 mb-1">
                    {t("aiError.noCredits.title")}
                  </div>
                  <div className="text-[12px] fg-muted">
                    {t("aiError.noCredits.reason")}
                  </div>
                  <div className="mt-3 text-[11px] fg-faint">
                    {(() => {
                      const day = creditRefillLabel(
                        aiGenState.noCredits.refillsAt,
                        locale,
                      );
                      return day
                        ? t("aiError.noCredits.refillAt", { date: day })
                        : t("aiError.noCredits.refill");
                    })()}
                  </div>
                  <a
                    href={`/api/billing/checkout?locale=${locale}`}
                    className="mt-4 inline-flex items-center justify-center h-8 px-4 rounded-md bg-[var(--accent-strong)] text-white text-[12px] font-medium shadow-coral hover:brightness-105 transition"
                  >
                    {t("aiError.noCredits.cta")}
                  </a>
                </div>
              </div>
            </section>
          ) : aiGenState.kind === "error" ? (
            <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-preview-a">
              <div className="flex-1 min-h-0 flex items-center justify-center px-6">
                <div className="text-center max-w-md">
                  <div className="text-[13px] text-red-600 dark:text-red-400 mb-1">
                    {t("aiError.title")}
                  </div>
                  {/* El detalle técnico no se pierde: queda en el title para
                      depurar sin asustar a quien no programa. */}
                  <div className="text-[12px] fg-muted" title={aiGenState.message}>
                    {t(`aiError.reason.${classifyAiError(aiGenState.message)}`)}
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
          ) : previewingTemplate ? (
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
            <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-app">
              <div className="shrink-0 flex items-center justify-center gap-1 pt-3">
                {(["crear", "mispaginas", "comunidad"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      router.replace(
                        s === "crear" ? "/new" : `/new?view=${s === "mispaginas" ? "projects" : "explore"}`,
                      )
                    }
                    aria-current={startSurface === s ? "page" : undefined}
                    className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium transition ${
                      startSurface === s ? "bg-elev fg shadow-card border bd" : "fg-muted hover:fg hover:bg-hover"
                    }`}
                  >
                    {tws(`startTabs.${s}`)}
                  </button>
                ))}
              </div>
              {startSurface === "mispaginas" ? (
                <ProjectsSection
                  activeBusinessId={activeBusinessId}
                  onOpenExplore={() => router.replace("/new?view=explore")}
                />
              ) : startSurface === "comunidad" ? (
                <ExploreView />
              ) : (
                <StartLanding
                  aiState={aiBriefFormState}
                  onGenerate={handleAiGenerate}
                  generating={aiGenerating}
                  effort={effort}
                  onEffortChange={setEffort}
                  onPreviewTemplate={(tpl) => {
                    setPreviewingTemplate(tpl);
                    setTemplateError(null);
                  }}
                  onPaste={() => router.push("/new?mode=paste")}
                />
              )}
            </div>
          )
        )}
        {entryMode === "paste" && (
          <PreviewPlaceholder mode={entryMode} />
        )}
        {entryMode === "editing" && !previewingTemplate &&
          (loadedProject && activeDoc ? (
            <>
              <PreviewArea
                doc={activeDoc}
                projectId={loadedProject.id}
                docKey={`${loadedProject.id}:${activeSitePage ?? ""}:u${undoEpoch}`}
                addressBar={
                  <AddressBar
                    subdomain={loadedProject.subdomain}
                    baseHost={PUBLISHED_BASE_HOST}
                    pages={sitePages}
                    activePage={activeSitePage}
                    onSwitch={switchSitePage}
                    onCreate={createSitePage}
                    onDelete={deleteSitePage}
                  />
                }
                pendientes={pendientes}
                anclaPendiente={anclaPendiente}
                descarteEpoch={descarteEpoch}
                aplicando={aplicandoLote}
                onAplicar={() => void aplicarPendientesRef.current?.()}
                onDescartar={descartarPendientes}
                redesigning={chatRedesigning}
                untrustedDoc={chatUntrustedDoc}
                editableInjection={editableInjection}
                sectionSelectMode={sectionSelectMode}
                editingActive={editingActive}
                inspectMode={inspectMode}
                onToggleInspect={toggleInspect}
                insertRequest={insertRequest}
                removeRequest={removeRequest}
                dropEnabled={dropEnabled}
                suppressReloadNonce={suppressReload}
                onIframeRef={(el) => {
                  iframeElRef.current = el;
                }}
                openInNewTabUrl={
                  loadedProject.subdomain
                    ? `https://${loadedProject.subdomain}.openlen.com${
                        activeSitePage ? `/${activeSitePage}` : ""
                      }`
                    : `/api/projects/${loadedProject.id}/raw?bake=1${
                        activeSitePage ? `&page=${activeSitePage}` : ""
                      }`
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
              {!lastInserted && dropNotice && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 pl-3.5 pr-1.5 py-1.5 rounded-full bg-elev border bd shadow-card fade-in">
                  <span className="inline-flex items-center gap-1.5 text-[12px] fg-muted whitespace-nowrap">
                    {dropNotice.kind === "uploading" && (
                      <span
                        className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin"
                        aria-hidden
                      />
                    )}
                    {dropNotice.kind === "done" && (
                      <Check size={13} className="text-emerald-500" />
                    )}
                    {dropNotice.kind === "error" ? (
                      <span className="text-red-500">{dropNotice.text}</span>
                    ) : dropNotice.kind === "uploading" ? (
                      t("drop.uploading")
                    ) : dropNotice.kind === "done" ? (
                      dropNotice.text
                    ) : (
                      t("drop.placeHint")
                    )}
                  </span>
                  {dropNotice.kind === "done" && (
                    <button
                      type="button"
                      onClick={doUndo}
                      className="ml-1 inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11.5px] font-medium fg-muted hover:fg hover:bg-hover transition"
                    >
                      <Undo size={12} />
                      {t("inserted.undo")}
                    </button>
                  )}
                  {(dropNotice.kind === "hint" || dropNotice.kind === "done") && (
                    <button
                      type="button"
                      onClick={
                        dropNotice.kind === "hint"
                          ? cancelPlacement
                          : () => setDropNotice(null)
                      }
                      aria-label={t("inserted.dismiss")}
                      title={t("inserted.dismiss")}
                      className="inline-flex items-center justify-center h-7 w-7 rounded-full fg-faint hover:fg hover:bg-hover transition"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              )}
              {!hasBusinessInfo &&
                loadedProject &&
                !showDegradedNotice &&
                !makeYoursDismissed.has(loadedProject.id) && (
                  <div className="absolute top-12 lg:top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 pl-3.5 pr-1.5 py-1.5 rounded-full bg-elev border bd shadow-card fade-in max-w-[calc(100%-2rem)]">
                    <span className="inline-flex items-center gap-1.5 text-[12px] fg whitespace-nowrap min-w-0">
                      <Sparkles size={13} className="text-accent shrink-0" />
                      <b className="fg">{t("makeYours.title")}</b>
                      <span className="fg-muted hidden sm:inline truncate">
                        {t("makeYours.body")}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={onMakeYours}
                      className="inline-flex items-center h-7 px-3 rounded-full text-[11.5px] font-semibold bg-[var(--accent-strong)] text-white shadow-coral hover:brightness-105 transition whitespace-nowrap"
                    >
                      {t("makeYours.cta")}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissMakeYours(loadedProject.id)}
                      aria-label={t("makeYours.dismiss")}
                      title={t("makeYours.dismiss")}
                      className="inline-flex items-center justify-center h-7 w-7 rounded-full fg-faint hover:fg hover:bg-hover transition"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
              {/* What the page lost on the way in. Shown once, then dismissed
                  for good — a warning that reappears on every load is noise,
                  and noise is how a silent failure comes back through another
                  door. It occupies the same slot as the makeYours pill, which
                  is gated above rather than stacked. */}
              {showDegradedNotice && loadedProject && (
                <div className="absolute top-12 lg:top-3 left-1/2 -translate-x-1/2 z-30 w-[min(30rem,calc(100%-2rem))] rounded-2xl bg-elev border bd shadow-card fade-in overflow-hidden">
                  <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2.5">
                    <AlertTriangle size={14} className="text-accent shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <b className="block text-[12.5px] fg mb-1">{t("degraded.title")}</b>
                      <ul className="flex flex-col gap-1">
                        {/* One sentence per distinct code. A multi-page clone
                            records the same loss per page, and the copy names
                            no counts — repeating it four times is noise, and
                            noise is how the silence comes back. The row keeps
                            every entry for diagnosis. */}
                        {[...new Set((loadedProject.degradations ?? []).map((d) => d.code))].map(
                          (code) => (
                            <li key={code} className="text-[12px] fg-muted leading-snug">
                              {t(`degraded.${code}`)}
                              {/* Lo que se rompió EN CONCRETO. El sistema
                                  siempre lo supo —el atributo, la fórmula
                                  literal, qué nombre falta— y hasta ahora lo
                                  tiraba al guardar, dejando al creador con
                                  "algunos controles" y ninguna pista de qué
                                  tocar. */}
                              {degradationDetail(loadedProject.degradations, code).length > 0 && (
                                <ul className="mt-1 flex flex-col gap-0.5 pl-3 border-l bd">
                                  {degradationDetail(loadedProject.degradations, code).map((d) => (
                                    <li key={d} className="text-[11px] fg-faint leading-snug">
                                      {d}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={onDismissDegradations}
                      aria-label={t("degraded.dismiss")}
                      title={t("degraded.dismiss")}
                      className="inline-flex items-center justify-center h-7 w-7 rounded-full fg-faint hover:fg hover:bg-hover transition shrink-0"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="flex justify-end gap-2 px-3.5 pb-2.5">
                    {/* "Arreglar esto" — no envía solo: deja el diagnóstico
                        escrito en el compositor del Chat y lleva ahí al
                        creador. Cada edición cuesta créditos, así que mandar
                        una petición sin que la vea sería gastarle dinero por
                        él. Usa la MISMA vía que el chip post-swap
                        (pendingChatDraft), no un camino nuevo. */}
                    {degradationDetail(loadedProject.degradations, "broken_controls").length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const lineas = degradationDetail(
                            loadedProject.degradations,
                            "broken_controls",
                          );
                          setPendingChatDraft(
                            [t("chatDraft.fixControls"), ...lineas.map((l) => `- ${l}`)].join("\n"),
                          );
                          setMode("chat");
                          onDismissDegradations();
                        }}
                        className="inline-flex items-center h-7 px-3 rounded-full text-[11.5px] font-semibold border bd fg hover:bg-hover transition"
                      >
                        {t("degraded.fix")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onDismissDegradations}
                      className="inline-flex items-center h-7 px-3 rounded-full text-[11.5px] font-semibold bg-[var(--accent-strong)] text-white shadow-coral hover:brightness-105 transition"
                    >
                      {t("degraded.dismiss")}
                    </button>
                  </div>
                </div>
              )}
              {inspectMode && (
                // Floating drawer (overlay, not push). PreviewArea keeps its
                // full width so the iframe's Fit-scale and content layout stay
                // constant between editing-on and editing-off — the user sees
                // the same render regardless of whether the inspector is open.
                // Pattern parallels Figma/Webflow/Framer's right rail.
                <div className="absolute right-0 top-0 bottom-0 z-30 shadow-2xl max-md:left-12">
                  <PropertiesPanel
                    selection={inspectSelection}
                    pageMeta={pageMeta}
                    html={activeDoc}
                    analyticsDisabled={
                      loadedProject?.settings?.analyticsDisabled ?? false
                    }
                    projectId={loadedProject?.id}
                    projectTitle={loadedProject?.title}
                    logoUrl={loadedProject?.logoUrl ?? null}
                    formConfig={
                      typeof inspectSelection?.formIndex === "number"
                        ? // Scoped key first; a site-page form without its own
                          // config shows the legacy shared one — exactly what
                          // publish wiring resolves for it.
                          loadedProject?.settings?.forms?.[
                            formConfigKey(
                              activeSitePage,
                              inspectSelection.formIndex,
                            )
                          ] ??
                          (activeSitePage
                            ? loadedProject?.settings?.forms?.[
                                String(inspectSelection.formIndex)
                              ]
                            : undefined) ??
                          null
                        : null
                    }
                    onApplyElementProp={applyElementProp}
                    onLinkifyButton={linkifyButton}
                    onApplyPageMeta={applyPageMeta}
                    onApplyFormConfig={applyFormConfig}
                    onApplyStyle={applyStyle}
                    onResetProps={applyResetProps}
                    onSelectPath={selectPath}
                    onApplyBg={applyBg}
                    onApplyHide={applyHide}
                    onToggleAnalytics={applyAnalyticsDisabled}
                    onApplyLogoUrl={loadedProject ? applyLogoUrl : undefined}
                    onApplyLook={loadedProject ? applyLook : undefined}
                    onApplyLookForMode={loadedProject ? applyLookWithMode : undefined}
                    onApplyThemeMode={loadedProject ? toggleThemeMode : undefined}
                    onResetTheme={
                      loadedProject && originalTheme ? resetTheme : undefined
                    }
                    onRestoreOriginal={
                      loadedProject ? openRestoreOriginal : undefined
                    }
                    originalAccent={originalTheme?.tokens["--ol-accent"] || undefined}
                    onApplyThemeToken={
                      loadedProject ? applyThemeToken : undefined
                    }
                    authoredScales={
                      originalTheme
                        ? {
                            typeScale: originalTheme.tokens["--ol-text-scale"],
                            spaceScale: originalTheme.tokens["--ol-space-scale"],
                            radiusScale: originalTheme.tokens["--ol-r-scale"],
                            displayFont: originalTheme.tokens["--ol-font-display"],
                          }
                        : undefined
                    }
                    onApplyFontPair={loadedProject ? applyFontPair : undefined}
                    tematica={activeTematica}
                    tematicaBg={activeTematicaBg}
                    onApplyTematica={loadedProject ? applyTematica : undefined}
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
          onAntesDePublicar={flushPendingSave}
          project={{
            id: loadedProject.id,
            subdomain: loadedProject.subdomain,
            publishedAt: loadedProject.publishedAt,
            hasUnpublishedChanges: loadedProject.hasUnpublishedChanges,
            languages: loadedProject.settings?.languages,
            // Bandas presentes con su módulo APAGADO: el publish las recorta
            // en silencio — este es el único aviso antes de perder la sección.
            // Plataformas se pierde por lo mismo pero por otra causa (se quedó
            // sin enlaces armables, no hay toggle), así que avisa aparte: el
            // arreglo está en Mi negocio, no en la pestaña Módulos.
            ...(() => {
              const p = modulePlacements({
                html: loadedProject.html,
                pages: loadedProject.pages,
              });
              const s = loadedProject.settings;
              return {
                bandsWithModuleOff: (
                  [
                    ["collections", s?.collections?.enabled],
                  ] as const
                )
                  .filter(([mod, on]) => p[mod].length > 0 && on !== true)
                  .map(([mod]) => mod),
              };
            })(),
          }}
          onSuccess={(newSubdomain) => {
            if (newSubdomain) {
              playReward(); // celebrate a real publish (not unpublish)
              toast.success(t("toast.publishedTitle"), {
                description: t("toast.publishedBody", { subdomain: newSubdomain, host: PUBLISHED_BASE_HOST }),
                action: {
                  label: t("toast.openSite"),
                  href: `https://${newSubdomain}.openlen.com`,
                },
              });
            } else {
              toast.info(t("toast.unpublishedTitle"), {
                description: t("toast.unpublishedBody"),
              });
            }
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
      {loadedProject && originalModal && (
        <OriginalRestoreModal
          open
          projectId={loadedProject.id}
          versionId={originalModal.versionId}
          restoring={originalRestoring}
          onCancel={() => {
            if (!originalRestoring) setOriginalModal(null);
          }}
          onConfirm={() => void confirmRestoreOriginal()}
        />
      )}
      <BusinessProfileModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onSaved={(p) => {
          void refreshProfiles();
          setSelectedProfileId(p.id);
          // Opened from the "Hazla tuya" banner → re-seed the open page now.
          if (pendingReseedRef.current) {
            pendingReseedRef.current = false;
            void reseedCurrentPage();
          }
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
    </div>
  );
}

