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
import { tomarReferenciasEnTransito } from "@/lib/referencia-en-transito";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PublishModal } from "@/components/workspace/publish-modal";
import {
  isGenerationBriefLengthValid,
  prepareGenerationBriefInput,
  shouldSyncGenerationBriefParam,
  trimGenerationBrief,
} from "@/lib/generation/brief-contract";
import { scanController } from "@/lib/workspace-v2/scan-controller";
import type {
  FormConfig,
  Degradation,
  ProjectSettings,
  StoredChatTurn,
} from "@/lib/projects/types";
import { CustomDomainModal } from "@/components/workspace-v2/custom-domain-modal";
import { DeployIntegrationModal } from "@/components/workspace-v2/deploy-integration-modal";
import { InboxHub } from "@/components/inbox/inbox-hub";
import { FranjaDeEstado, type OnAjustesGuardados } from "@/components/inbox/franja-de-estado";
import { ExploreView } from "@/components/community/explore-view";
import { ProjectsSection } from "../projects/projects-section";
import { AnalyticsSection } from "../analytics/analytics-section";
import { MarketingView } from "@/components/workspace-v2/marketing-view";
import { DatabaseView } from "@/components/workspace-v2/database-view";
import { ResultadosView } from "@/components/workspace-v2/resultados-view";
import {
  LeftSidebar,
  type SidebarMode,
  type SectionView,
} from "@/components/workspace-v2/left-sidebar";
import { AlertTriangle, Check, Sparkles, Undo, X } from "@/components/workspace-v2/icons";
import { PreviewPlaceholder } from "@/components/workspace-v2/preview-placeholder";
import { PastePanel } from "@/components/workspace-v2/panels/paste-panel";
import { StartLanding } from "@/components/workspace-v2/start-landing";
import type { NaceComo } from "@/components/workspace-v2/tarjetas-nace-como";
import type { StyleDirection } from "@/lib/style-match/direction-types";
import type { PageEffort } from "@/components/workspace-v2/panels/ai-brief-panel";
import { ejecutarUndo } from "@/components/workspace-v2/panels/undo-turn";
import { planDeDeshacerDelTaller } from "@/components/workspace-v2/deshacer-del-taller";
import { SECTIONS, type Section } from "@/components/workspace-v2/mock-data";
import { PreviewArea, type Lente } from "@/components/workspace-v2/preview-area";
import {
  PropertiesPanel,
  type InspectSelection,
  type PageMeta,
  type TemaDePagina,
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
import { TopBar } from "@/components/workspace-v2/top-bar";
import { useToast } from "@/components/workspace-v2/toast";
import { stripEditorInstrumentation } from "@/components/workspace-v2/strip-editor-instrumentation";
import { useDarkMode } from "@/lib/use-dark-mode";
import { useEditorSound } from "@/lib/use-editor-sound";
import { useIsMobile } from "@/components/workspace-v2/use-is-mobile";
import { formConfigKey, listSitePages } from "@/lib/projects/site-pages";
import { esperarAQueSeCalme } from "@/lib/workspace-v2/esperar-a-que-se-calme";
import {
  projectLoadFailureFromStatus,
  type ProjectLoadFailure,
} from "@/lib/workspace-v2/project-load-failure";
import { ProjectUnavailable } from "@/components/workspace-v2/project-unavailable";
import { isBlankProject } from "@/lib/projects/blank";
import { UNTITLED_PROJECT_TITLE } from "@/lib/projects/titulo-del-html";
import { uploadPhotos } from "@/lib/workspace-v2/upload-photos";
import type { PendingAttachments } from "@/components/workspace-v2/chat/use-agent-chat";
import { cambiosEnVivo } from "@/lib/workspace-v2/cambios-en-vivo";
import { abrirEnElCodigo } from "@/lib/workspace-v2/abrir-fichero";
import type { AppDeProyecto, SitePage } from "@/lib/projects/types";
import { PUBLISHED_BASE_HOST } from "@/lib/publish/base-host";
import { AddressBar } from "@/components/workspace-v2/address-bar";
import { abrirDesdeElTaller } from "@/components/workspace-v2/abrir-fuera";

// ⚰️ Aquí vivía `LLAVE_ARREGLO`, el traspaso del «Arréglalo» de la medida de
// Crear a su primer turno de chat por `sessionStorage`. Crear es Len desde el
// 2026-10-06 (plans/crear-es-len): ya no hay dos pantallas entre las que saltar,
// y lo que Len mide lo mide él (`view_page`).

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
  /** UNA APP WEB (`data.app`, spec local 2026-10-07-apps): el lienzo la enseña
   *  corriendo y sin edición visual. Ausente = una página. Cambia con un turno
   *  (una app que nace, una página que se convierte) y con su Deshacer: lo trae
   *  el refetch de `onChatChange`. */
  app: AppDeProyecto | null;
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
// `images` salió el 2026-08-29: era la tercera copia de las mismas
// bibliotecas que el diálogo de sustituir ya tenía.
const ALL_TABS: SidebarMode[] = [
  "chat",
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

// Lo que la página deja cambiar desde el panel, tal como lo midió el iframe
// (`descubrirTema`). Un iframe viejo no lo manda: undefined, y el panel enseña
// todo como antes.
function leerTemaDePagina(v: unknown): TemaDePagina | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  return {
    colores: o.colores === true,
    fuentes: o.fuentes === true,
    radio: o.radio === true,
    letra: o.letra === true,
    densidad: o.densidad === true,
  };
}

function NewV2Inner() {
  const t = useTranslations("wsPage");
  const tProjects = useTranslations("projects");
  const tSections = useTranslations("panelsA");
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
  // (?view=projects|analytics|messages; absent = the page canvas) so a
  // refresh or shared link lands on the same section. Opening a page navigates
  // to ?project=<id> with no ?view, which naturally falls back to the canvas.
  //
  // ⚰️ `business` era una de estas vistas —la sección «Mi negocio»— y se fue con
  // el perfil el 2026-08-31. Un `?view=business` guardado en un marcador ya no
  // casa con ninguna rama y cae al lienzo, que es la degradación correcta: la
  // página que el usuario tenía abierta.
  const viewParam = searchParams.get("view");
  const centerView: SectionView =
    viewParam === "projects" ||
    viewParam === "analytics" ||
    viewParam === "resultados" ||
    viewParam === "marketing" ||
    viewParam === "templates" ||
    viewParam === "messages" ||
    viewParam === "explore" ||
    viewParam === "database"
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
  // ¿Hay una página abierta? Es lo que separa las DOS pantallas del taller: con
  // página, rail a la izquierda y barra del proyecto arriba; sin ella, ni rail
  // ni proyecto — la barra pasa a ser la navegación global. Se mira el
  // parámetro y no `loadedProject` a propósito: mientras carga ya estás en el
  // editor, y hacer aparecer el rail medio segundo después es un salto.
  const enElEditor = !!searchParams.get("project");
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
  /**
   * QUÉ LENTE SE MIRA — la página, su código, su terminal o sus cambios.
   *
   * Vive AQUÍ y no dentro de `PreviewArea` porque el taller monta TRES lienzos
   * —dos vistas previas de plantilla y el de edición— y la lente es una sola
   * para el usuario. Con el estado dentro, cada uno tendría el suyo.
   */
  const [lente, setLente] = useState<Lente>("pagina");
  const [loadedProject, setLoadedProject] = useState<LoadedProject | null>(null);
  // ¿Tiene base de datos la página? Decide si el rail enseña su icono
  // (`visibleOperar`). Sólo «ready» cuenta: el registro se crea solo en cuanto
  // Len mira el estado, y una base sin crear todavía no guarda nada.
  const [hasDatabase, setHasDatabase] = useState(false);
  const loadedProjectId = loadedProject?.id ?? null;
  useEffect(() => {
    setHasDatabase(false);
    if (!loadedProjectId) return;
    let live = true;
    fetch(`/api/projects/${loadedProjectId}/backend?status`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { status?: string } | null) => {
        if (live) setHasDatabase(b?.status === "ready");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [loadedProjectId]);
  // Por qué no se abrió el proyecto de la URL (N31). Sin esto, un 404 se quedaba
  // en «Cargando proyecto…» para siempre.
  const [projectLoadFailure, setProjectLoadFailure] = useState<ProjectLoadFailure | null>(null);
  // The active site page (null = home) and the document the canvas edits.
  // Everything that used to read loadedProject.html for DISPLAY reads
  // activeDoc; saves route into the matching slot via activeSitePageRef.
  const activeSitePage =
    pageParam && loadedProject?.pages?.[pageParam] ? pageParam : null;
  const activeSitePageRef = useRef<string | null>(null);
  activeSitePageRef.current = activeSitePage;
  // Un aviso de «sólo publicada» por cosa y documento: una página que llama a
  // /api/f en cada pintado no puede llenar la pantalla de toasts.
  //
  // ⚠️ Vive AQUÍ y no junto a `useToast()`, que es donde lo pedía el plan:
  // depende de `loadedProject` y `activeSitePage`, y las dos se declaran más
  // abajo, así que allí el array de dependencias se leería antes de que
  // existieran (zona muerta temporal) y el render reventaría.
  const avisosSoloPublicadaRef = useRef(new Set<string>());
  useEffect(() => {
    avisosSoloPublicadaRef.current.clear();
  }, [loadedProject?.id, activeSitePage]);
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
  // ⚰️ Aquí se cargaban los items del catálogo desde
  // /api/projects/[id]/collections/items para previsualizar la rejilla en el
  // lienzo. La ruta y el módulo se fueron el 2026-08-29.
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
  // ¿El borrador se manda solo? Sólo lo pone el envío desde el estado vacío de
  // un proyecto en blanco (`handleHeroSend`): el usuario YA pulsó enviar allí,
  // y hacerle pulsar otra vez en el chat sería preguntar dos veces lo mismo. Los
  // demás borradores —la propuesta de copia tras un cambio— esperan al usuario.
  const [pendingChatAutoSend, setPendingChatAutoSend] = useState(false);
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

  // El brief del estado vacío vive aquí para que sobreviva a los cambios de
  // panel; enviarlo es el primer mensaje a Len (ver «EL PROYECTO EN BLANCO»).
  // ⚰️ Aquí se contaba por qué `/api/generate` escribía la página de una
  // pasada; la ruta se fue con Crear el 2026-10-06 (plans/crear-es-len).
  //
  // El dial de esfuerzo queda aparcado: en esta ruta no compra nada todavía, y
  // un selector que no compra nada es exactamente la mentira que se arregló en
  // `lib/document/page-effort.ts`. Su maquinaria sigue intacta.
  const [effort, setEffort] = useState<PageEffort>("low");
  // ⚰️ Aquí vivía `useGeneration` —el cliente de `/api/generate`— con su estado
  // `generating`. Crear es el primer mensaje a Len desde el 2026-10-06
  // (plans/crear-es-len): ver «EL PROYECTO EN BLANCO» más abajo.
  // ⚰️ AQUÍ VIVÍA TODO EL PERFIL DE NEGOCIO EN EL TALLER, retirado el
  // 2026-08-31: la lista de perfiles, el que estaba activo, el conmutador del
  // rail, el modal de alta, el enlace profundo `?profile=<id>` y el aviso
  // «Hazla tuya» con su re-sembrado (`/api/projects/[id]/seed-profile`).
  //
  // El motivo, medido y en el orden en que dolió: el botón flotante de contacto
  // NO SE PODÍA QUITAR. `seedBrandIntoHtml` lo repintaba en cada guardado, así
  // que el usuario pedía «quítamelo», el Agente lo borraba, decía «listo», y
  // volvía al siguiente guardado. Dos veces seguidas, con el mismo usuario.
  //
  // Y debajo de eso, la razón de fondo: guardar el WhatsApp en un formulario
  // era un TECHO. Ni Claude ni v0 ni Lovable te piden rellenar una ficha antes
  // de mirar tu código — leen lo que hay. El Agente lee la página, y si el dato
  // no está, lo pregunta o pone un ejemplo que el dueño corrige. Un proyecto
  // nuevo no hereda nada de otro, que es lo que el usuario quería.
  //
  // Lo que NO se fue: `users.agentMemory` (la memoria de USUARIO, que sí es
  // continuidad legítima) y la tabla `businessProfiles`, que sigue en la base
  // sin escritor hasta que se decida retirarla.
  // Ingestion-degradation notice. Server-persisted, no en localStorage: la
  // persona que pegó el HTML puede volver mañana, desde otro aparato, y lo que
  // importa es que se le dijo UNA vez — no una por navegador.
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
  // dentro del compositor porque quien manda el primer mensaje a Len es esta
  // página.
  const [aiReference, setAiReference] = useState<StyleDirection | null>(null);
  // Las fotos adjuntas al brief, por lo mismo. Se limpian al generar: son de
  // ESE brief, y dejarlas puestas haria que la siguiente pagina naciera mirando
  // referencias que el usuario ya no tiene delante.
  const [aiFotos, setAiFotos] = useState<readonly { dataUrl: string; nombre: string }[]>([]);
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
      fotos: aiFotos,
      setFotos: setAiFotos,
    }),
    [
      aiPrompt,
      truncatedPrompt,
      truncationAnnouncementToken,
      aiReference,
      aiFotos,
    ],
  );
  // Mobile, otra vez: el Chat tapa el lienzo, así que cuando pide abrir una
  // lente —una fila de la tarjeta de cambios, una ruta (la #9 de
  // plans/len-agente-2026)— el panel se aparta. Si no, la lente se abría DETRÁS.
  //
  // Y AL CERRAR ESA LENTE SE VUELVE AL CHAT (la #16), como DeepSeek: en el móvil
  // su panel se abre a pantalla completa y al salir se ve otra vez la
  // conversación (`2026-09-07-sidebar-responsive-tab-info.md`). Sin esto, cerrar
  // el diff dejaba en la página y había que volver a abrir el Chat a mano.
  const proyectoAbierto = loadedProject?.id ?? null;
  const volverAlChat = useRef(false);
  useEffect(() => {
    if (!isMobile || !proyectoAbierto) return;
    let cambios = cambiosEnVivo.peticion(proyectoAbierto)?.n ?? 0;
    let codigo = abrirEnElCodigo.peticion(proyectoAbierto)?.n ?? 0;
    const apartar = () => {
      setLeftCollapsed(true);
      volverAlChat.current = true;
    };
    const fuera = [
      cambiosEnVivo.subscribe(() => {
        const n = cambiosEnVivo.peticion(proyectoAbierto)?.n ?? 0;
        if (n > cambios) apartar();
        cambios = n;
      }),
      abrirEnElCodigo.subscribe(() => {
        const n = abrirEnElCodigo.peticion(proyectoAbierto)?.n ?? 0;
        if (n > codigo) apartar();
        codigo = n;
      }),
    ];
    return () => fuera.forEach((f) => f());
  }, [isMobile, proyectoAbierto]);
  useEffect(() => {
    if (lente !== "pagina" || !volverAlChat.current) return;
    volverAlChat.current = false;
    if (isMobile) setLeftCollapsed(false);
  }, [lente, isMobile]);
  // Abierto a mano entretanto, ya no hay a dónde volver.
  useEffect(() => {
    if (!leftCollapsed) volverAlChat.current = false;
  }, [leftCollapsed]);
  // ─── EL PROYECTO EN BLANCO (plans/crear-es-len, 2026-10-06) ───────────────
  //
  // Crear es el PRIMER MENSAJE A LEN en un proyecto en blanco, como la «New
  // Session» de DeepSeek (`packages/client/ui-workspace/README.md`): `/new` sin
  // proyecto toma el blanco que ya hubiera (o crea uno) y lo abre; con él
  // abierto, el centro es el estado vacío del chat, y enviar es un mensaje
  // normal a `/api/agent`. NADA SE MANDA SOLO: un brief en la URL (la portada,
  // un enlace viejo con `autostart=1`) sólo RELLENA el compositor.
  const [blankFailure, setBlankFailure] = useState<ProjectLoadFailure | null>(null);
  const [blankAttempt, setBlankAttempt] = useState(0);
  const resolvingBlank = entryMode === "ai" && startSurface === "crear";
  useEffect(() => {
    if (!resolvingBlank) return;
    let vivo = true;
    setBlankFailure(null);
    void fetch("/api/projects", { method: "POST" })
      .then(async (r) => {
        if (!r.ok) throw r.status;
        const d = (await r.json().catch(() => null)) as { id?: unknown } | null;
        if (typeof d?.id !== "string" || !d.id) throw 0;
        // El brief que trajera la URL ya está en `aiPrompt` (nace de él), y el
        // componente no se vuelve a montar al cambiar la URL: no hace falta
        // llevarlo. `mode` y `autostart` se quedan atrás.
        if (vivo) router.replace(`/new?project=${encodeURIComponent(d.id)}`);
      })
      .catch((status: unknown) => {
        if (!vivo) return;
        setBlankFailure(typeof status === "number" && status > 0 ? projectLoadFailureFromStatus(status) : "failed");
      });
    return () => {
      vivo = false;
    };
  }, [resolvingBlank, blankAttempt, router]);
  // Con el proyecto ya abierto, un `brief` (o `autostart`, o `mode`) en la URL
  // sobra: el texto ya está escrito en el compositor. Se quita para que
  // recargar no lo vuelva a escribir encima de lo que el usuario cambió.
  useEffect(() => {
    if (!projectParam) return;
    if (briefParam === null && modeParam === null && searchParams.get("autostart") === null) return;
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete("brief");
    qs.delete("mode");
    qs.delete("autostart");
    router.replace(`/new?${qs.toString()}`);
  }, [projectParam, briefParam, modeParam, searchParams, router]);
  // ¿Ya se mandó el primer mensaje desde el estado vacío? Desde ese momento el
  // proyecto ya no está en blanco —tiene conversación— aunque la fila tarde en
  // volver con la convergencia: la vista se transforma YA, sin recargar.
  const [heroSent, setHeroSent] = useState(false);
  const [heroSending, setHeroSending] = useState(false);
  // PÁGINA O APP (las dos tarjetas del estado vacío). Página por defecto, y
  // vuelve a serlo al cambiar de proyecto: es una elección de ESTE proyecto.
  const [naceComo, setNaceComo] = useState<NaceComo>("pagina");
  const [pendingChatAttachments, setPendingChatAttachments] = useState<PendingAttachments | null>(null);
  useEffect(() => {
    setHeroSent(false);
    setNaceComo("pagina");
  }, [projectParam]);
  // EL ESTADO VACÍO DEL CHAT DE LEN: un proyecto en blanco no tiene lienzo que
  // enseñar todavía. Como el «Session Intent hero» de DeepSeek, el centro es el
  // compositor, y enviar es el primer mensaje.
  const proyectoEnBlanco =
    entryMode === "editing" &&
    !!loadedProject &&
    !heroSent &&
    isBlankProject({
      html: loadedProject.html,
      pages: loadedProject.pages,
      chatTurns: loadedProject.chatHistory.length,
    });
  // Con el estado vacío en el centro, la barra lateral va plegada, como iba la
  // entrada de Crear: el chat todavía no tiene nada que enseñar. Una vez por
  // proyecto, para que abrirla a mano no se deshaga sola.
  const blankCollapsedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!proyectoEnBlanco || !loadedProjectId) return;
    if (blankCollapsedFor.current === loadedProjectId) return;
    blankCollapsedFor.current = loadedProjectId;
    setLeftCollapsed(true);
  }, [proyectoEnBlanco, loadedProjectId]);
  // ENVIAR DESDE LA ENTRADA. El usuario ya pulsó enviar: el borrador que se
  // manda solo aquí es SU envío, no uno automático. Las fotos se suben antes
  // (Len las recibe por su dirección) y la referencia viaja con el mensaje.
  const handleHeroSend = useCallback(async () => {
    if (!loadedProjectId || heroSending) return;
    const brief = trimGenerationBrief(aiPrompt);
    if (!isGenerationBriefLengthValid(brief)) return;
    setHeroSending(true);
    try {
      // DOS ORIGENES, UN LOTE, como hacía Crear. Las del heroe cruzan por
      // `sessionStorage` —no caben en la URL— y se LEEN Y SE BORRAN aqui. Manda
      // el compositor, Y NO SE MEZCLAN: si el usuario adjunto algo AQUI, es lo
      // que tiene delante; aun asi se consume el transito.
      const delTransito = tomarReferenciasEnTransito();
      const fotos = aiFotos.length > 0 ? aiFotos : delTransito;
      const subidas = fotos.length > 0 ? await uploadPhotos(fotos, loadedProjectId) : { images: [], failed: 0 };
      if (subidas.failed > 0) toast.error(t("toast.photosNotUploaded", { count: subidas.failed }));
      // Con App elegida, el primer mensaje lleva `naceComo` y el idioma de la
      // interfaz: el servidor le pone el esqueleto antes del turno, con ese
      // `lang` en el cascarón (`lib/projects/nacer-como-app.ts`).
      setPendingChatAttachments({
        images: subidas.images,
        styleDirection: aiReference,
        ...(naceComo === "app" ? { naceComo: "app" as const, idioma: locale } : {}),
      });
      setPendingChatDraft(brief);
      setPendingChatAutoSend(true);
      setHeroSent(true);
      setMode("chat");
      setLeftCollapsed(false);
      setAiFotos([]);
      setAiReference(null);
      setAiPrompt("");
    } finally {
      setHeroSending(false);
    }
  }, [loadedProjectId, heroSending, aiPrompt, aiFotos, aiReference, naceComo, locale, toast, t]);
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
            tema: leerTemaDePagina(m.tema),
          });
          // Snapshot the page's original theme tokens from the FIRST meta of
          // this project load — the "Original" reset re-applies these resolved
          // values (never blank-clears: a page saved before 2026-08-26 can
          // carry --ol-bg/--ol-fg only inline, read by its own persisted
          // data-ol-force sheet).
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
  // ⚰️ Esto encendía la píldora «Saving…» del pie durante 700ms. El pie se
  // fue el 2026-08-31 y con él su único lector: `saving` se quedó de SÓLO
  // ESCRITURA —se ponía a true y a false y nadie lo miraba—, que es código
  // muerto que aún gasta un temporizador por tecla.
  //
  // Lo que informa de verdad de que hay cambios sin guardar es el aviso de
  // «pendientes» sobre el lienzo, y ese sigue.
  const updateSection = useCallback(
    (id: string, fields: Section["fields"]) => {
      setSections((prev) =>
        prev.map((s) => (s.id === id ? { ...s, fields } : s)),
      );
    },
    [],
  );

  // Load real project metadata when /new?project=<id> opens. The mock
  // preview iframe stays in charge of visual content for this session —
  // wiring V3 primitives into the preview is deferred to a follow-up.
  const refetchProject = useCallback(
    async (id: string, opts?: { deliberado?: boolean; initial?: boolean }): Promise<boolean> => {
      // A refetch must never clobber local edits the server hasn't seen yet.
      // Con el «Aplicar» explícito esto pesa MÁS, no menos: el montón de
      // pendientes puede quedarse ahí todo el rato que el usuario quiera, y un
      // documento traído del servidor pisaría el lienzo donde vive su trabajo.
      // Mientras haya algo pendiente, o acabe de haberlo, no se converge.
      const editingLocally = () =>
        pendientesRef.current.length > 0 ||
        enviandoRef.current ||
        Date.now() - lastLocalEditAtRef.current < 2500;
      // DOS LLAMADORES DISTINTOS, Y LA GUARDA ERA DE UNO SOLO.
      //
      // La CONVERGENCIA (foco, otra pestana) puede rendirse sin mas: si ahora
      // no toca, ya convergira luego. El DELIBERADO no: va detras de una
      // escritura estructural -crear o borrar una pagina- y el que llama ya
      // vacio lo pendiente. Si se salta, navega a un slug que su propio estado
      // no conoce y `activeSitePage` lo deja caer a la Home EN SILENCIO. Era el
      // fallo de "creo /tienda y me lleva a la principal": la fila tampoco
      // aparecia, y lo unico que lo arreglaba era el refetch del `focus`, que
      // es de donde salian "unos minutos".
      //
      // No se FUERZA -una escritura de verdad en vuelo si merece respeto-: se
      // ESPERA a que la guarda se apague, con presupuesto, y se dice si llego.
      if (opts?.deliberado) {
        if (!(await esperarAQueSeCalme(editingLocally, { topeMs: 5000, pasoMs: 150 })))
          return false;
      } else if (editingLocally()) return false;
      const res = await fetch(`/api/projects/${id}`);
      // LA PRIMERA CARGA dice por qué falló (N31); la convergencia (foco, otra
      // pestaña) sigue rindiéndose en silencio, porque ya hay un proyecto a la
      // vista y un fallo suyo no es motivo para quitárselo a nadie. Se vacía
      // `loadedProject`: al pasar de A a un B que no se abre, seguir pintando A
      // con la URL de B sería otra mentira.
      const failInitial = (failure: ProjectLoadFailure) => {
        if (!opts?.initial || projectParamRef.current !== id) return;
        setLoadedProject(null);
        setProjectLoadFailure(failure);
      };
      if (!res.ok) {
        failInitial(projectLoadFailureFromStatus(res.status));
        return false;
      }
      // Re-check AFTER the await: a slow response (dev compiles, cold DB) can
      // arrive seconds later carrying a long-stale document — applying it
      // then would time-travel the canvas past edits made mid-flight.
      // El deliberado ya espero arriba; volver a rendirse aqui seria la misma
      // averia con la ventana mas corta.
      if (!opts?.deliberado && editingLocally()) return false;
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
              /** El JavaScript del modelo ya autorizado — la decisión la toma
               *  el servidor con la misma función que publica. */
              data: {
                html?: string;
                filledBlocks?: unknown[];
                settings?: ProjectSettings;
                pages?: Record<string, SitePage>;
                degradations?: Degradation[];
                degradationsDismissed?: boolean;
                app?: AppDeProyecto;
              };
            };
          }
        | null;
      const p = data?.project;
      if (!p) {
        failInitial("failed");
        return false;
      }
      // Superseded: the URL moved on (e.g. redirected out to a global surface)
      // while this request was in flight — applying it now would resurrect a
      // project the user already left.
      if (projectParamRef.current !== id) return false;
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
        app: p.data?.app ?? null,
      });
      setProjectName(p.title);
      setProjectLoadFailure(null);
      return true;
    },
    [],
  );

  // Abrir el proyecto de la URL. Lo usan la primera carga y el «Reintentar».
  // Una excepción del `fetch` es la red: se dice como fallo pasajero, nunca
  // como «no existe».
  const openProjectFromUrl = useCallback(
    (id: string) => {
      setProjectLoadFailure(null);
      return refetchProject(id, { initial: true }).catch(() => {
        if (projectParamRef.current !== id) return;
        setLoadedProject(null);
        setProjectLoadFailure("failed");
      });
    },
    [refetchProject],
  );

  useEffect(() => {
    // New project context — reset the concurrency base.
    projectUpdatedAtRef.current = 0;
    if (!projectParam) {
      setLoadedProject(null);
      setProjectLoadFailure(null);
      return;
    }
    void openProjectFromUrl(projectParam);
  }, [projectParam, openProjectFromUrl]);
  // Ni cargando ni abierto: el proyecto de la URL no se pudo abrir.
  const projectUnavailable = Boolean(projectParam && !loadedProject && projectLoadFailure);
  const projectLoadingFromUrl = Boolean(projectParam && !loadedProject && !projectLoadFailure);

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
  // UNA APP NO SE EDITA EN EL LIENZO: su texto vive en el JSX, y el lienzo la
  // enseña corriendo desde el host del lienzo. Ni lápiz, ni soltar ficheros,
  // ni elegir un elemento para el chat; se cambia hablando con Len o en la
  // lente Código.
  const esApp = !!loadedProject?.app;
  const editingActive =
    inspectMode &&
    !esApp &&
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
    entryMode === "editing" && !!loadedProject && !sectionSelectMode && !esApp;
  // Si el proyecto PASA a ser una app con el lápiz encendido (nace o se
  // convierte en este mismo turno), se apaga: el inspector no tiene nada que
  // inspeccionar en una app.
  useEffect(() => {
    if (!esApp) return;
    setInspectMode(false);
    setSectionSelectMode(false);
  }, [esApp]);

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
  // DESHACER UN PASO en el taller, como `/rewind` en Claude Code: se restaura
  // una copia que el SERVIDOR hizo antes de aplicar el cambio, nunca un
  // documento que mande el navegador.
  //
  // Antes se guardaba aquí el documento de antes y Deshacer lo mandaba entero
  // por `PATCH /html`. Esa ruta tenía que sanearlo —viene del navegador—, así
  // que cada Deshacer le quitaba a la página TODOS sus `onclick` y los iframes
  // fuera de lista (medido el 2026-09-29: 2 → 0).
  //
  // Ahora el punto de deshacer es un LOTE de ediciones. Si aún no salió,
  // deshacer es tirarlo; si ya salió, el servidor contestó con el id de la
  // copia de antes (`versionPrevia`) y se restaura ésa.
  const loadedProjectRef = useRef(loadedProject);
  loadedProjectRef.current = loadedProject;
  const undoRef = useRef<{ page: string | null; lote: number } | null>(null);
  /** El lote que se está llenando: sube cada vez que uno SALE hacia el servidor. */
  const loteRef = useRef(0);
  /** Lote enviado → id de la copia de antes que guardó el servidor (o null). */
  const copiasRef = useRef(new Map<number, string | null>());
  /** El envío en curso, para que Deshacer espere a su respuesta. */
  const envioRef = useRef<Promise<unknown> | null>(null);
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

  // `startPlacementAsset` se fue con el panel de Imágenes (2026-08-29): era su
  // ruta de clic-para-colocar, y nadie más la llamaba. El modo colocación NO
  // desapareció — `startPlacementFile`, justo arriba, lo sigue usando para lo
  // que pegas y lo que sueltas desde el escritorio.

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

  /**
   * Manda un lote de ediciones. Resuelve con si se guardó y, si se guardó, el
   * id de la copia de ANTES que el servidor hizo (lo que restaura Deshacer).
   *
   * 🔴 UN RECHAZO SE DICE. Hasta el 2026-09-29 un 409 dejaba el estado en
   * reposo y nada más: el lienzo seguía enseñando un cambio que no estaba
   * guardado, y al recargar desaparecía. Así se perdían en silencio poner una
   * imagen junto al texto o convertir un botón en enlace. Ahora se avisa y el
   * lienzo vuelve a lo guardado — lo que hace un `Edit` que falla en Claude
   * Code: devuelve su error, nunca «hecho».
   */
  const persistDoc = useCallback(
    (p: {
      projectId: string;
      /** Qué cambió. El documento entero ya no viaja (ver la ruta). */
      edits: readonly Edicion[];
      source: string;
      page: string | null;
    }): Promise<{ ok: true; versionPrevia: string | null } | { ok: false }> => {
      setSavingStatus("saving");
      const noSeGuardo = () => {
        setSavingStatus("idle");
        flashDropError(t("toast.editsRejected"));
        setDescarteEpoch((n) => n + 1);
        return { ok: false as const };
      };
      return fetch(`/api/projects/${p.projectId}/html`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          edits: p.edits,
          source: p.source,
          baseUpdatedAt: projectUpdatedAtRef.current,
          ...(p.page ? { page: p.page } : {}),
        }),
      })
        .then(async (r) => {
          if (!r.ok) return noSeGuardo();
          setSavingStatus("saved");
          // Nudge other tabs of this project to refetch the new HTML.
          syncChannelRef.current?.postMessage({ projectId: p.projectId });
          // Advance the concurrency base to the version the server just
          // wrote — so this tab's own next save isn't read as a clobber.
          const saved = (await r.json().catch(() => null)) as
            | { updatedAt?: string; html?: string; versionPrevia?: string | null }
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
          if (htmlNuevo) setSuppressReload((n) => n + 1);
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
          return {
            ok: true as const,
            versionPrevia: typeof saved?.versionPrevia === "string" ? saved.versionPrevia : null,
          };
        })
        // Sin respuesta tampoco se guardó: se dice igual.
        .catch(noSeGuardo);
    },
    [flashDropError, t],
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
    // Este lote sale; lo que llegue desde ahora es del siguiente.
    const idLote = loteRef.current;
    loteRef.current += 1;
    pendientesRef.current = [];
    setPendientes(0);
    enviandoRef.current = true;
    setAplicandoLote(true);
    const envio = persistDoc({
      projectId,
      edits: lote,
      source: "inline-edit",
      page: activeSitePageRef.current,
    });
    envioRef.current = envio;
    try {
      const r = await envio;
      // La copia de antes de ESTE lote, por si se deshace. Sólo hace falta la
      // del último: Deshacer es de un paso.
      copiasRef.current.clear();
      copiasRef.current.set(idLote, r.ok ? r.versionPrevia : null);
      if (!r.ok && undoRef.current?.lote === idLote) undoRef.current = null;
    } finally {
      enviandoRef.current = false;
      envioRef.current = null;
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

  // DESHACER UN PASO — la última tanda de ediciones.
  //
  // Si la tanda aún no salió, deshacer es tirarla y volver a lo guardado: el
  // servidor no la ha visto. Si ya salió, el servidor guardó una copia de ANTES
  // de aplicarla y se restaura ésa, con la misma ruta que el Deshacer del Chat
  // (`ejecutarUndo`): lo que se pinta es lo que devuelve el servidor, y sólo
  // cuando lo ha confirmado. El documento no viaja: si viajara habría que
  // sanearlo, y eso le quitaba a la página sus `onclick` (ver `undoRef`).
  const doUndo = useCallback(async () => {
    const u = undoRef.current;
    const projectId = loadedIdRef.current;
    if (!u || !projectId) return;
    undoRef.current = null;
    lastLocalEditAtRef.current = Date.now();
    setDropNotice(null);
    // Lo que aún no se ha aplicado se va en los dos casos: o es la propia
    // tanda que se deshace, o son cambios hechos DESPUÉS sobre un documento
    // que va a dejar de existir.
    pendientesRef.current = [];
    setPendientes(0);
    // Si su lote está en vuelo, se espera a que el servidor diga qué copia hizo.
    if (u.lote !== loteRef.current && envioRef.current) {
      await envioRef.current.catch(() => undefined);
    }
    const plan = planDeDeshacerDelTaller(u, loteRef.current, copiasRef.current);
    if (plan.kind === "descartar") {
      setDescarteEpoch((n) => n + 1);
      return;
    }
    if (plan.kind === "sin-copia") {
      flashDropError(t("toast.undoFailed"));
      return;
    }
    await ejecutarUndo(
      { kind: "restaurar", page: plan.page, versionId: plan.versionId },
      {
        projectId,
        fetchImpl: fetch,
        pintar: (html, page) => {
          setLoadedProject((prev) => {
            if (!prev || prev.id !== projectId) return prev;
            if (page) {
              return prev.pages[page]
                ? { ...prev, pages: { ...prev.pages, [page]: { ...prev.pages[page], html } } }
                : prev;
            }
            return { ...prev, html };
          });
          setUndoEpoch((n) => n + 1);
        },
        marcarRevertido: () => {},
        marcarFallo: () => flashDropError(t("toast.undoFailed")),
      },
    );
  }, [flashDropError, t]);
  doUndoRef.current = doUndo;
  useEffect(() => {
    if (!loadedProject) return;
    const projectId = loadedProject.id;
    // El mapa no se reasigna nunca: se guarda aquí para vaciarlo al salir.
    const copias = copiasRef.current;

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
      // LO QUE SÓLO FUNCIONA PUBLICADO (solo-publicada.ts). Se dice aquí, que
      // es donde todavía se entiende; publicada funcionaría.
      if (e.data.type === "openlen:solo-publicada") {
        const d = e.data as { tipo?: unknown; ruta?: unknown; destino?: unknown };
        const clave = `${String(d.tipo)}:${String(d.ruta ?? d.destino ?? "")}`;
        if (avisosSoloPublicadaRef.current.has(clave)) return;
        avisosSoloPublicadaRef.current.add(clave);
        if (d.tipo === "llamada" && typeof d.ruta === "string") {
          toast.info(t("toast.soloPublicada.llamada", { ruta: d.ruta.slice(0, 80) }));
        } else if (d.tipo === "formulario") {
          toast.info(t("toast.soloPublicada.formulario"));
        } else if (d.tipo === "navegacion" && typeof d.destino === "string") {
          toast.info(t("toast.soloPublicada.navegacion", { destino: d.destino.slice(0, 80) }));
        }
        return;
      }
      // Un destino de FUERA. Lo abre el padre porque el lienzo corre con
      // sandbox="allow-scripts" y sin allow-popups: un window.open desde dentro
      // lo bloquea el navegador y el enlace no haría nada, sin un solo error.
      if (e.data.type === "openlen:abrir-fuera") {
        const url = typeof e.data.url === "string" ? e.data.url : "";
        // QUÉ SE PUEDE ABRIR Y CÓMO, EN UN SOLO SITIO: `abrir-fuera.ts`. Aquí
        // vivía un `/^https?:\/\//` suelto que dejaba fuera correo, teléfono y
        // WhatsApp — y esos clics morían mudos dentro del sandbox del lienzo.
        // El módulo tiene además la lista de esquemas que NO se abren jamás:
        // `javascript:` desde AQUÍ correría con el origen de OpenLen, no con el
        // del lienzo, que es la frontera entera.
        if (abrirDesdeElTaller(url) === "sin-gesto") {
          toast.error(t("toast.enlaceBloqueado"));
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
        //
        // Ya no se guarda aquí el documento: el punto de deshacer es el LOTE en
        // el que cae esta edición, y la copia de antes la hace el servidor al
        // aplicarlo (ver `undoRef`).
        if (pendientesRef.current.length === 0) {
          undoRef.current = {
            page: activeSitePageRef.current ?? null,
            lote: loteRef.current,
          };
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
      copias.clear();
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
      // DELIBERADO: espera a que se calme en vez de rendirse. Y solo se
      // navega si el estado local YA conoce la pagina -- navegar antes es
      // aterrizar en la Home, que era el fallo.
      const llego = await refetchProject(id, { deliberado: true });
      if (llego) switchSitePage(slug);
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
      await refetchProject(id, { deliberado: true });
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
          //
          // DELIBERADO, y por lo mismo que crear: un refetch que se rinde en
          // silencio deja `loadedProject.pages` sin el slug, y entonces
          // `switchSitePage(page)` aterriza en la Home. Aqui la guarda esta
          // ARMADA casi seguro -- restaurar es una escritura estructural.
          void refetchProject(loadedProject.id, { deliberado: true }).then(
            (llego) => {
              if (llego) switchSitePage(page);
            },
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
      copiasRef.current.clear();
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
  // baseline (re-applies resolved values rather than blank-clearing — see the
  // snapshot in the page-meta handler).
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
  // ⚰️ Aquí vivían `createModulePage` —creaba una página dedicada para un
  // módulo— y `updateCollectionsSettings`. Las dos se van el 2026-08-29: el
  // último módulo que las usaba era `collections`, y quien las llamaba (el hub)
  // se fue con él.
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
  // La franja de la Bandeja ya guardó el ajuste (PATCH .../settings) antes de
  // llamar aquí — este manejador sólo funde el resultado en `loadedProject`
  // para que la franja, que lee sus props de aquí, diga lo que acaba de
  // cambiar. `hasUnpublishedChanges` se enciende igual que lo cuenta
  // `hashHomeDoc` en el servidor: el ajuste se hornea al PUBLICAR, así que
  // guardarlo sobre una página ya publicada es, para el servidor, un cambio
  // sin publicar — aunque el html no se mueva un byte.
  //
  // Desde la Tarea 7 el parche trae CUALQUIER campo del detalle (hechos, tono,
  // bienvenida, respuestas rápidas…). La fusión es de un nivel: un array como
  // `quickReplies` llega entero y REEMPLAZA al anterior, igual que en el
  // servidor (`settings-patch.ts`).
  const onAjustesGuardados = useCallback<OnAjustesGuardados>(
    (patch) => {
      const paraProyecto = loadedProject?.id;
      setLoadedProject((p) => {
        // Una respuesta que llega tarde, después de que el dueño ya abrió
        // OTRO proyecto, no debe escribir en él — `p` puede haber cambiado
        // entre el clic y esta respuesta.
        if (!p || p.id !== paraProyecto) return p;
        return {
          ...p,
          settings: {
            ...p.settings,
            ...(patch.assistant
              ? { assistant: { ...p.settings?.assistant, ...patch.assistant } }
              : {}),
            ...(patch.chat ? { chat: { ...p.settings?.chat, ...patch.chat } } : {}),
          },
          hasUnpublishedChanges: p.subdomain ? true : p.hasUnpublishedChanges,
        };
      });
    },
    [loadedProject?.id],
  );
  // ⚰️ Hablaba de insertar la BANDA diseñada por `buildModuleSection`. Ese
  // emisor se retiró el 2026-09-05 sin sustituto: no hay banda que insertar.
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
        // Mientras el título sea el de relleno, el proyecto se llama «Proyecto
        // nuevo» en el idioma del dueño: lo deja en cuanto Len guarda una
        // portada con `<title>` (`adoptPlaceholderTitle`). No sólo el blanco:
        // un primer turno que no llegó a escribir la portada (una pregunta, un
        // ■) dejaba «Untitled page» crudo en la barra (ensayo de caja, 07/10).
        projectName={projectName === UNTITLED_PROJECT_TITLE ? tProjects("newProject") : projectName}
        onRename={persistRename}
        projectLogoUrl={loadedProject?.logoUrl ?? null}
        projectLoading={projectLoadingFromUrl}
        projectUnavailable={projectUnavailable}
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
        // SIN PROYECTO ABIERTO LA BARRA ES OTRA, Y EL RAIL NO EXISTE.
        //
        // El rail entero actúa SOBRE una página —Chat, Resultados, Mensajes,
        // Marketing, Versiones—, así que sin página abierta son cinco iconos
        // que no llevan a ningún sitio. Y la cuenta vive a su pie, o sea que se
        // iría con él: por eso vuelve a la barra en esta pantalla.
        inicio={
          enElEditor
            ? undefined
            : {
                activa: startSurface,
                onIr: (s) =>
                  router.replace(
                    s === "crear"
                      ? "/new"
                      : `/new?view=${s === "mispaginas" ? "projects" : "explore"}`,
                  ),
                etiqueta: (s) => tws(`startTabs.${s}`),
                dark,
                onToggleDark: toggleDark,
                soundVolume,
                onSoundVolume: setSoundVolume,
                onToggleSoundMute: toggleSoundMute,
              }
        }
      />
      <div className="flex-1 min-h-0 flex relative">
        {enElEditor && (
        <LeftSidebar
          dark={dark}
          onToggleDark={toggleDark}
          soundVolume={soundVolume}
          onSoundVolume={setSoundVolume}
          onToggleSoundMute={toggleSoundMute}
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((c) => !c)}
          activeSection={normalizedCenterView}
          onSelectSection={setCenterView}
          hasDatabase={hasDatabase}
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
          projectLoading={projectLoadingFromUrl}
          savingStatus={savingStatus}
          currentProjectId={loadedProject?.id ?? null}
          onRestoreApplied={applyRestoredVersion}
          onPrepareSnapshot={flushPendingSave}
          sectionSelectMode={sectionSelectMode}
          onToggleSectionSelect={esApp ? undefined : (active) => setSectionSelectMode(active)}
          scopedSelection={scopedSelection}
          onClearScope={() => setScopedSelection(null)}
          pendingDraft={pendingChatDraft}
          pendingDraftAutoSend={pendingChatAutoSend}
          pendingAttachments={pendingChatAttachments}
          onPendingDraftConsumed={() => { setPendingChatDraft(null); setPendingChatAutoSend(false); setPendingChatAttachments(null); }}
          sitePages={sitePages}
          activeSitePage={activeSitePage}
          activePageLabel={activeSitePage ? `/${activeSitePage}` : t("modulesHub.home")}
          homePageLabel={t("modulesHub.home")}
          siteName={loadedProject?.title ?? null}
        />
        )}
        {/* One <main> landmark for the workspace center. `contents` keeps the
            flex layout byte-identical (generates no box) while giving the a11y
            tree exactly one main region (fixes landmark-one-main + region). The
            sr-only h1 gives every entry state a top-level heading. */}
        <main className="contents">
        <h1 className="sr-only">{t("a11y.workspaceHeading")}</h1>
        {normalizedCenterView === "messages" ? (
          <InboxHub
            franja={
              <FranjaDeEstado
                key={loadedProject?.id ?? "sin-proyecto"}
                projectId={loadedProject?.id ?? null}
                nombrePagina={loadedProject?.title ?? ""}
                publicada={Boolean(loadedProject?.subdomain)}
                cambiosSinPublicar={loadedProject?.hasUnpublishedChanges === true}
                asistente={loadedProject?.settings?.assistant?.enabled === true}
                chat={loadedProject?.settings?.chat?.enabled === true}
                ajustesChat={loadedProject?.settings?.chat}
                onAjustesGuardados={onAjustesGuardados}
              />
            }
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
            siteSlot={<AnalyticsSection />}
          />
        ) : normalizedCenterView === "database" ? (
          <DatabaseView projectId={loadedProject?.id ?? null} />
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
                lente={lente}
                onLente={setLente}
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
          // SIN PROYECTO, LA ENTRADA DE CREAR YA NO VIVE AQUÍ (plans/crear-es-len):
          // `/new` abre el proyecto en blanco, y su estado vacío es el compositor
          // (rama `editing`, más abajo). Esta rama sólo espera al blanco, o dice
          // por qué no llegó; y sigue pintando las otras dos superficies.
          <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-app">
            {/* ⚰️ LAS TRES PESTAÑAS ESTABAN AQUÍ, flotando en el centro justo
                debajo de la barra. Subieron A la barra el 2026-08-31: son la
                navegación global, y ahí competían por el centro con el propio
                contenido de la pantalla (el brief, la rejilla de páginas). */}
            {startSurface === "mispaginas" ? (
              <ProjectsSection
                onOpenExplore={() => router.replace("/new?view=explore")}
              />
            ) : startSurface === "comunidad" ? (
              <ExploreView />
            ) : blankFailure ? (
              <ProjectUnavailable
                failure={blankFailure}
                projectId=""
                onRetry={() => setBlankAttempt((n) => n + 1)}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center bg-preview-a">
                <div className="text-[12px] fg-faint">{t("editing.loading")}</div>
              </div>
            )}
          </div>
        )}
        {entryMode === "paste" && (
          // SIN PROYECTO NO HAY BARRA LATERAL (las dos pantallas del taller,
          // `enElEditor`), y el panel de pegar vivía sólo ahí: esta pantalla
          // decía «Pega tu HTML en la barra lateral» sin barra y sin cuadro. Va
          // aquí, en el centro, con el ancho de un formulario.
          <section className="relative flex flex-col flex-1 min-w-0 bg-preview-a">
            <div className="flex-1 min-h-0 flex justify-center px-4 py-6">
              <div className="w-full max-w-2xl min-h-0 flex flex-col rounded-xl ring-1 ring-[color:var(--border)] bg-elev">
                <PastePanel />
              </div>
            </div>
          </section>
        )}
        {entryMode === "editing" && proyectoEnBlanco &&
          (previewingTemplate ? (
            <div className="flex-1 min-w-0 flex flex-col">
              {templateError && (
                <div className="h-7 shrink-0 flex items-center justify-center gap-2 text-[11.5px] bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-b bd">
                  {templateError}
                </div>
              )}
              <PreviewArea
                doc=""
                lente={lente}
                onLente={setLente}
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
            // EL ESTADO VACÍO DEL CHAT DE LEN (plans/crear-es-len): el
            // compositor de la entrada de siempre, y enviar es el primer
            // mensaje (`handleHeroSend`).
            <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-app">
              <StartLanding
                aiState={aiBriefFormState}
                onGenerate={() => void handleHeroSend()}
                generating={heroSending}
                effort={effort}
                onEffortChange={setEffort}
                onPreviewTemplate={(tpl) => {
                  setPreviewingTemplate(tpl);
                  setTemplateError(null);
                }}
                onPaste={() => router.push("/new?mode=paste")}
                naceComo={naceComo}
                onNaceComoChange={setNaceComo}
              />
            </div>
          ))}
        {entryMode === "editing" && !proyectoEnBlanco && !previewingTemplate &&
          // Con el primer mensaje mandado, el lienzo aparece VACÍO y se va
          // llenando con la página a medias que Len escribe (`page_preview`).
          (loadedProject && (activeDoc || heroSent || loadedProject.chatHistory.length > 0) ? (
            <>
              <PreviewArea
                doc={activeDoc}
                lente={lente}
                onLente={setLente}
                projectId={loadedProject.id}
                pagina={activeSitePage ?? null}
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
                    esApp={esApp}
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
                onToggleInspect={esApp ? undefined : toggleInspect}
                esApp={esApp}
                insertRequest={insertRequest}
                removeRequest={removeRequest}
                dropEnabled={dropEnabled}
                suppressReloadNonce={suppressReload}
                onIframeRef={(el) => {
                  iframeElRef.current = el;
                }}
                // ABRE LO QUE ESTÁS EDITANDO, no lo que está publicado.
                //
                // Antes esto miraba `subdomain`: con la página ya publicada te
                // llevaba al sitio en vivo, así que el botón hacía DOS COSAS
                // distintas según un estado que no ves, y justo cuando más
                // falta hace —revisar un cambio a pantalla completa antes de
                // publicarlo— te enseñaba la versión vieja. Jesús: «cuando
                // tengo ya el subdominio me abre el subdominio y no el editor
                // para verlo bien».
                //
                // `raw?bake=1` es el documento ACTUAL con el mismo horneado que
                // la vista previa, y va protegido por sesión. Desde el
                // 2026-10-04 redirige al lienzo en `.app` (ver su ruta): la
                // página corre allí con su origen, no con el de openlen.com.
                // Para ver lo publicado está el botón de la barra de
                // publicación, que es donde esa intención vive.
                openInNewTabUrl={`/api/projects/${loadedProject.id}/raw?bake=1${
                  activeSitePage ? `&page=${activeSitePage}` : ""
                }`}
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
              {/* ⚰️ Aquí vivía la píldora «Hazla tuya», que empujaba a rellenar
                  el perfil de negocio. Se fue con él el 2026-08-31: sin perfil
                  que rellenar, la píldora habría salido SIEMPRE — un aviso que
                  no se puede satisfacer es peor que ninguno. */}
              {/* What the page lost on the way in. Shown once, then dismissed
                  for good — a warning that reappears on every load is noise,
                  and noise is how a silent failure comes back through another
                  door. */}
              {showDegradedNotice && loadedProject && (
                <div className="absolute top-12 lg:top-3 left-1/2 -translate-x-1/2 z-30 w-[min(30rem,calc(100%-2rem))] rounded-2xl bg-elev border bd shadow-card fade-in overflow-hidden">
                  <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2.5">
                    <AlertTriangle size={14} className="text-accent shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      {/* EL TÍTULO SIGUE A LA CAUSA, y hasta hoy no lo hacía.
                          «Algunas cosas no se pudieron traer» se escribió para
                          la INGESTIÓN —clonar una plantilla y perder algo por el
                          camino— y se reutilizaba para `runtime_stale`, que es
                          otra cosa: el JavaScript de la página dejó de arrancar.
                          El dueño leía «no se pudieron traer» sobre una página
                          suya que nadie había traído de ningún sitio.

                          Sólo cuando ES la única causa: con varias mezcladas el
                          título genérico vuelve a ser el correcto. */}
                      <b className="block text-[12.5px] fg mb-1">
                        {(() => {
                          const codigos = [
                            ...new Set((loadedProject.degradations ?? []).map((d) => d.code)),
                          ];
                          return codigos.length === 1 && codigos[0] === "runtime_stale"
                            ? t("degraded.runtime_stale_title")
                            : t("degraded.title");
                        })()}
                      </b>
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
                    // PROBAR EL DESTINO SIN SALIR DEL EDITOR. Editando, el clic
                    // en un enlace lo captura el inspector para SELECCIONARLO
                    // —que es lo correcto— y por eso no llega a `use-page-links`
                    // ni abre nada. Sin esto, el usuario escribe su WhatsApp y
                    // no tiene forma de comprobar que abre lo que debe: se ve
                    // como que no funciona, y funciona (publicada abre).
                    //
                    // MISMA puerta que los clics del lienzo: `abrir-fuera.ts`,
                    // que es el unico sitio donde se decide que se abre y como.
                    onAbrirEnlace={(href) => {
                      if (abrirDesdeElTaller(href) === "sin-gesto") {
                        toast.error(t("toast.enlaceBloqueado"));
                      }
                    }}
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
          ) : projectUnavailable && projectParam && projectLoadFailure ? (
            <ProjectUnavailable
              failure={projectLoadFailure}
              projectId={projectParam}
              onRetry={() => void openProjectFromUrl(projectParam)}
            />
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
      {/* ⚰️ AQUÍ IBA LA BARRA DE ESTADO, el pie del taller. Se fue el
          2026-08-31 con sus tres inquilinos, y cada uno se iba por su cuenta:

          «Ready to ship» salía justo cuando las otras ramas no tenían nada que
          decir —sin publicar y sin guardado reciente— y llenaba el hueco con
          una promesa. Una barra de ESTADO que dice un deseo en vez de un hecho
          enseña a no leerla.

          «Saving…» duplicaba lo que la barra superior ya dice, y el aviso de
          cambios sin aplicar lo dice mejor y más cerca del lienzo.

          «⌘K command palette» era un cartel permanente para un atajo que se
          aprende una vez. Cobraba una franja de 24px en todas las pantallas
          para siempre.

          Lo último que sujetaba la franja era «Live at …», y eso vive en la
          barra de dirección, encima del lienzo, donde el visitante lo leería. */}
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
            // ⚰️ Aquí se avisaba de bandas presentes con su módulo APAGADO,
            // porque publicar las recortaba en silencio. Ya no hay módulos que
            // apagar: lo que queda de esas secciones lo conserva
            // `strip-disabled-bands` cuando el modelo las diseñó.
          }}
          onSuccess={(newSubdomain) => {
            if (newSubdomain) {
              playReward(); // celebrate a real publish (not unpublish)
              toast.success(t("toast.publishedTitle"), {
                description: t("toast.publishedBody", { subdomain: newSubdomain, host: PUBLISHED_BASE_HOST }),
                action: {
                  label: t("toast.openSite"),
                  // De `base-host`, como el texto de al lado. Estaba cableado
                  // a .com: el aviso decía «tusitio.openlen.app» y su propio
                  // botón te llevaba a .com. Sexto sitio con el dominio a mano
                  // encontrado hoy.
                  href: `https://${newSubdomain}.${PUBLISHED_BASE_HOST}`,
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
      <ReplaceAssetModal
        open={!!assetModal}
        kind={assetModal?.kind ?? null}
        currentSvg={assetModal?.currentSvg ?? null}
        currentSrc={assetModal?.currentSrc ?? null}
        projectId={loadedProject?.id ?? null}
        onInsertMotion={loadedProject ? handleInsertMotion : undefined}
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

