import type { CreativeDirection } from "@/lib/generation/creative-contracts";
import type { AssetManifest, AssetResolutionTrace } from "@/lib/generation/asset-contracts";
import type { SectionCompositionManifest } from "@/lib/generation/section-composition-contracts";
import type { VisualQualityScores, VisualRepairIssueCode } from "@/lib/generation/visual-repair-contracts";

// The shape of a project's `data` JSONB column.
//
// A project's `data` holds the page as a self-contained HTML string. There
// is no orchestrator envelope: generation is free-form HTML.

/** Per-<form> configuration set in the inspector's Form section (Phase 2).
 *  Stored outside the HTML — the notify email must never ship to the
 *  published page source. */
export interface FormConfig {
  /** Address that gets the lead email. Empty/absent → the account email. */
  notifyEmail?: string;
  /** Message shown after a successful submit. Empty/absent → the default. */
  successMessage?: string;
  /** URL to send the visitor to after submit, instead of the message. */
  redirectUrl?: string;
}

/** Site assistant — the visitor-facing AI chat on the published page. The
 *  brain (`facts`) never ships in the page source; the widget calls
 *  /api/assistant/[sub] which reads it server-side. */
export interface AssistantSettings {
  /** Master switch. Absent/false → no widget injected, endpoint refuses. */
  enabled?: boolean;
  /** Owner-written business facts (hours, prices, shipping, policies, FAQ)
   *  that the page itself doesn't spell out. */
  facts?: string;
  /** Optional tone steer ("cálido", "formal", …). Absent → default. */
  tone?: string;
}

/** Private chat module — a closed per-space @username messenger. Only the per-site switches live here; chat users/messages live in the chat* tables. */
export interface ChatSettings {
  /** Master switch. Absent/false → chat widget not baked + API routes refuse. */
  enabled?: boolean;
  /** true (default) → any visitor can register a chat username.
   *  false → owner must invite (future). */
  selfServeJoin?: boolean;
  /** Where the widget mounts on the published page. Default "both". */
  mount?: "fab" | "section" | "both";
  /** How non-members identify. "guest" (default) = name + optional email, no password
   *  (= lead capture). "account" = @username + password. Members are auto-identified
   *  regardless (the member bridge). */
  identityMode?: "guest" | "account";
  /** Greeting bubble shown at the top of the "message the business" thread. */
  welcome?: string;
  /** FAQ chips answered client-side on tap (never hits the inbox). */
  quickReplies?: { q: string; a: string }[];
  /** Widget appearance. Default "light". The brand accent is unchanged either way. */
  theme?: "light" | "dark";
}





// ⚰️ AQUÍ VIVÍA `CollectionsSettings` — el interruptor por sitio del módulo
// Colecciones, más su tema y su hoja de origen. Sale el 2026-08-29 con el
// resto del módulo: no queda tabla, ni store, ni horneado, ni panel.
//
// Lo que valía la pena de aquello —que un catálogo fuera contenido indexable
// y no un `fetch`— lo hace `horneaLectura` sobre un almacén declarado en la
// propia página, sin módulo que encender.

/** Project-level settings that aren't part of the HTML document. */
export interface ProjectSettings {
  /** Per-form config, keyed by the form's index — its position among all
   *  <form> elements in document order, so the workspace inspector and the
   *  publish-time wiring agree on which form is which. */
  forms?: Record<string, FormConfig>;
  /** Opt-out for the per-page analytics snippet injected at publish time
   *  (lib/analytics/snippet.ts). Default behaviour is enabled — a true value
   *  here causes publishToDir to skip the inject, leaving the published HTML
   *  with no tracker. The Insights tab still works for whatever rows were
   *  captured before the toggle flipped. */
  analyticsDisabled?: boolean;
  /** Speak Every Language: locale codes the page is also published in
   *  (/<code>/index.html variants, translated at publish time). Validated
   *  against PUBLISH_LOCALES; the page's own language is skipped. */
  languages?: string[];
  // MOTION, MÚSICA Y 3D SE RETIRARON el 2026-08-26. Los tres eran horneados
  // nuestros que suplían el JavaScript prohibido: una coreografía de scroll, un
  // reproductor flotante y una escena WebGL con su runtime diferido. Ahora el
  // modelo escribe la animación, el reproductor y el canvas dentro del
  // documento — y a diferencia de un preset, puede hacer EL que la página pide.
  /** Site assistant: visitor-facing AI chat. Absent = off. */
  assistant?: AssistantSettings;
  /** Private chat module: per-project visitor chat. Absent = off. */
  chat?: ChatSettings;
  /** Datos vivos: la página se rellena desde un Google Sheet público del dueño
   *  en cada publicación/republicación programada. `sheetUrl` es la URL normal
   *  del Sheet (compartido como "cualquiera con el link"); OpenLen lee su
   *  export CSV público. Absent = sin datos vivos. Ver lib/live/. */
  liveData?: { sheetUrl: string };
  /** Marketing Kit tab state (register = user-picked giro). */
  marketing?: { register?: string; match?: boolean };
}

/** One additional page of a multi-page site. The home page stays at
 *  ProjectData.html; extra pages live under their URL slug ("menu" →
 *  <sub>.openlen.com/menu). Same HTML contract as the home document. */
export interface SitePage {
  /** Publish-ready static HTML for this page. */
  html: string;
  /** Display name in the site-pages panel. Absent → derived from the slug. */
  title?: string;
  /** Members-only: when the members module is enabled, this page publishes
   *  as a login stub and its real document is served only to a logged-in
   *  member (lib/members). Only subpages can carry this — home never gates. */
  membersOnly?: boolean;
}

/** Shareable draft-preview link. Present once the owner enables "Share a
 *  preview" in the workspace; `token` gates the public GET /p/<id>?t=… handler
 *  that serves the CURRENT draft HTML to anyone holding it — no login, before
 *  the page is ever published to a subdomain. Deleting this revokes every
 *  outstanding link. Never baked into published HTML (it's config, like
 *  settings). */
export interface PreviewSettings {
  token: string;
  /** ISO timestamp; the link 404s once passed. Absent = never expires. */
  expiresAt?: string;
  /** HMAC of the viewer passcode (lib/projects/preview.hashPasscode) — never
   *  the plaintext. Absent = no passcode (anyone with the link gets in). */
  passcodeHash?: string;
}

export interface VisualRepairProjectMetadata {
  schemaVersion: "visual-repair-metadata/1.0";
  accepted: true;
  promptVersion: string;
  criticVersion: "visual-quality-verdict/2.0" | "visual-quality-verdict/2.1";
  compilerVersion: "creative-direction/1.0";
  issueCodesBefore: VisualRepairIssueCode[];
  issueCodesAfter: VisualRepairIssueCode[];
  scoresBefore: VisualQualityScores;
  scoresAfter: VisualQualityScores;
  outputHashBefore: string;
  outputHashAfter: string;
}

export type VisualEngineAssetMetadata =
  | { assetManifest: AssetManifest; assetTrace: AssetResolutionTrace }
  | { assetManifest?: never; assetTrace?: never };

export type VisualEngineProjectMetadata =
  | ({
      schemaVersion: "visual-engine-project/1.0";
      route: "template_skeleton";
      templateId: string;
      creativeDirection: CreativeDirection;
      promptVersion: string;
      policyVersion: string;
      contractVersion: "creative-direction/1.0";
      structuralFingerprintBefore: string;
      structuralFingerprintAfter: string;
      repair?: VisualRepairProjectMetadata;
    } & VisualEngineAssetMetadata)
  | ({
      schemaVersion: "visual-engine-project/1.0";
      route: "section_composition";
      templateId: null;
      creativeDirection: CreativeDirection;
      promptVersion: string;
      policyVersion: string;
      contractVersion: "creative-direction/1.0";
      compositionManifest: SectionCompositionManifest;
      repair?: VisualRepairProjectMetadata;
    } & VisualEngineAssetMetadata);

import type { Declaracion } from "@/lib/page-data/declaracion";

export interface ProjectData {
  /** Publish-ready static HTML — the source of truth for the project. */
  html: string;
  /** Non-HTML project settings (form config, …). Absent on older rows. */
  settings?: ProjectSettings;
  /** Multi-page: extra pages keyed by slug. Absent/empty = classic
   *  single-page project (every pre-existing row). Home is `html` above. */
  pages?: Record<string, SitePage>;
  /** Shareable draft-preview link. Absent = no preview link issued. */
  preview?: PreviewSettings;
  /** Versioned Visual Engine memory. Present only for accepted skeleton routes. */
  generation?: { visualEngine?: VisualEngineProjectMetadata };
  /** What the page lost on the way in. Machine codes only — the user-facing
   *  sentence is built in the surface, from i18n, never stored. Absent = the
   *  page came through whole, which is the overwhelmingly common case.
   *  Lives here (a JSON column) rather than a new column so it needs no
   *  migration, and on the ROW rather than in the create response because
   *  every creation client navigates away and destructures the response down
   *  to `projectId` — the row is what survives a reload and a shared link. */
  degradations?: Degradation[];
  /** Set once the user closes the notice. A warning that reappears forever is
   *  noise, and noise is how we arrive back at silence through another door. */
  degradationsDismissed?: boolean;
  /** Los almacenes que la página DECLARA, extraídos del HTML al publicar.
   *
   *  La fuente de verdad es el documento publicado, no esto: aquí vive una
   *  copia para no tener que parsear el HTML en cada escritura. No hay forma
   *  de editarlo salvo republicando — si el modelo borra el bloque, la
   *  siguiente publicación deja el almacén sin permisos y sus documentos
   *  dejan de aceptar escrituras (se conservan; el dueño puede exportarlos).
   *
   *  Ausente = la página no declara ninguno, que es el caso de todas las que
   *  existían antes del 2026-08-29. Ver lib/page-data/declaracion.ts. */
  almacenes?: Declaracion;
}

/** One thing lost during ingestion. `count` is for diagnosis; `code` is what
 *  the surface translates. A code with no user-facing phrasing is not
 *  recorded — if we cannot say what broke in the user's language, we are not
 *  ready to tell them anything. */
export interface Degradation {
  surface: "from-html" | "from-template" | "generate" | "publish";
  stage: "transform" | "sanitize" | "behaviors" | "publish";
  code: DegradationCode;
  count: number;
  /** Lo que se rompió, EN CONCRETO — la frase que el sistema ya sabía y que
   *  hasta ahora se tiraba al guardar.
   *
   *  El diagnóstico existía completo (el atributo, la fórmula literal, qué
   *  nombre falta y qué hacer), se usaba para reparar y reintentar, y al
   *  llegar al usuario se reducía a un código y un número. "Algunos controles
   *  quedaron mal conectados" no le dice a nadie qué tocar.
   *
   *  Va acotado a propósito: son texto de máquina en la fila del proyecto, no
   *  un registro. Tres frases bastan para saber qué pedirle al asistente. */
  detail?: string[];
}

export type DegradationCode =
  | "scripts"
  | "embeds"
  | "unsafe_links"
  | "dynamic_content"
  | "broken_controls"
  /** El clon de una plantilla perdió los `on*`. Es su PROPIA degradación y no
   *  `scripts`: en `from-template` los bloques `<script>` SÍ vuelven
   *  (`conservarScripts`), así que la función está viva y lo único muerto es el
   *  cableado del botón. Decirle al usuario «se quitó tu JavaScript» sería
   *  falso y le mandaría a rehacer lo que ya tiene. */
  | "handlers_lost"
  /* ⚰️ AQUÍ ESTABA `interactivity_lost` — «el JavaScript que el modelo escribió
   *  no llegó al release». Sus dos causas eran de la CÁPSULA: que dejara de
   *  cuadrar con el documento, o que se perdiera el sellado CSP. La cápsula
   *  murió (el JS del modelo vive hoy en `data.html`), y con ella el emisor.
   *
   *  Nunca se sustituyó. Quedaba el miembro de la unión y su frase en los diez
   *  idiomas, sin un solo `.ts` capaz de producir el código: comprobado por
   *  grep sobre todo el repo, UNA aparición y era esta declaración.
   *
   *  Eso es peor que código muerto — es una promesa. Cualquiera que leyera esta
   *  lista concluiría que al publicar avisamos si el JavaScript se cae por el
   *  camino, y no avisamos. Borrado el 2026-09-05, con la base ya limpia de
   *  filas que lo llevaran. Si algún día ese aviso hace falta, nace con su
   *  emisor: un código sin quien lo escriba no vigila nada. */
  /** Una edición cambió CUÁNTOS formularios tiene la página, y la config de
   *  cada formulario (a qué correo avisa, a dónde redirige) se resuelve por su
   *  POSICIÓN en el documento — `formConfigKey`. Insertar o quitar uno corre
   *  esa numeración, así que un ajuste que el usuario hizo para el formulario
   *  de contacto puede acabar aplicándose al de newsletter.
   *
   *  No se puede arreglar solo: emparejar formularios entre dos versiones del
   *  documento es adivinar, y adivinar mal manda los mensajes de alguien al
   *  sitio equivocado sin decirlo. Se AVISA, que es lo que la doctrina pide
   *  cuando la página no miente pero algo dejó de estar donde estaba. */
  | "form_routing_stale"
  /** El JavaScript guardado busca elementos que la edición quitó. No es que
   *  ese control deje de responder: `getElementById(...)` sobre lo que ya no
   *  está LANZA, y la excepción aborta el script entero — un elemento borrado
   *  puede apagar toda la interactividad de la página, con el error viviendo
   *  en la consola del visitante, que nadie mira.
   *
   *  Se AVISA en vez de reparar: reescribir el código del modelo sería
   *  inventar. Y el aviso llega también al modelo en el turno siguiente, que
   *  ahora sí puede arreglarlo — el runtime es direccionable por ops. */
  | "runtime_stale"
  /** Al publicar se cayó una sección entera: su banda era de un módulo que
   *  OpenLen ya no tiene (Reservas y Comentarios se retiraron el 2026-08-21;
   *  Colecciones y Plataformas el 2026-08-29). `stripDisabledModuleBands` la
   *  quita porque sin módulo detrás quedaba un titular sobre la nada, y eso
   *  está bien — lo que estaba mal es que lo hacía EN SILENCIO.
   *
   *  El dueño publicaba, veía su página sin la sección, y no tenía forma de
   *  saber si la había quitado él, si se la comió la IA o si el sitio estaba
   *  roto. Es la segunda degradación que nace al PUBLICAR y no al ingerir.
   *
   *  Se avisa una vez por publicación, no una por página: la banda podía vivir
   *  sólo en una subpágina y la pérdida es igual de real. Y `data.html` la
   *  conserva — esto no borra nada del proyecto, sólo del release. */
  | "section_removed";

// One persisted Chat-tab turn. The Chat panel's live turn type carries HTML
// snapshots for in-session Undo; this is the transcript-only form written to
// `projects.chatHistory` so a page reload — or a sidebar tab switch, which
// unmounts the panel — restores the conversation instead of an empty
// composer. HTML revisions are NOT stored here — those live in
// `projectVersions`.
export interface StoredChatTurn {
  id: string;
  userText: string;
  /** Image the user attached to this turn — shown in the restored bubble. */
  attachedImage?: { url: string; alt?: string };
  assistantReasoning: string;
  /** Settled status only — a turn is persisted once it stops streaming. */
  status: "applied" | "error" | "reverted";
  errorText?: string;
  /** ms-epoch the turn was applied — drives the "Applied · 3h ago" label. */
  appliedAt?: number;
  /** Site page this turn edited. null/undefined = home (data.html); a slug =
   *  data.pages[slug].html. Pre-multipage rows are NULL → home. */
  page?: string | null;
  /** F2: agent-mode tool cards, final states only (a trailing `running` card
   *  persists as-is). Rehydrated on restore so a reload shows the same cards
   *  the live turn had. Absent = an ai-design turn or a pre-F2 row. Confirm
   *  cards (`AgentConfirm`) are intentionally NOT part of this — see the
   *  `persistTurn` comment in chat-panel.tsx for why. */
  actions?: Array<{
    tool: string;
    /** `warning` desde el 2026-09-04 — ver `agent-action-card.tsx`. Las filas
     *  anteriores sólo traen los tres viejos y siguen siendo válidas. */
    status: "running" | "done" | "warning" | "error";
    summary: string;
    /** Cuántas ediciones aplicó esta llamada. */
    edits?: number;
    /** QUÉ cambió, resuelto en el servidor mientras los `data-op-id` valían.
     *  Va aquí y no en el turno porque `actions` es la ÚNICA parte del turno
     *  que se guarda como JSON — `appendChatMessage` escribe columnas
     *  explícitas. Ver `lib/agent/ops-descritas.ts`. */
    ops?: Array<{
      tipo: "replace" | "insert_before" | "insert_after" | "delete" | "attrs" | "text";
      donde: "documento" | "estilos" | "cabecera" | "comportamiento";
      etiqueta: string;
      indice: number;
    }>;
  }>;
  /** F2: true when the turn changed no document (answer-only or
   *  settings-only agent turn) — the restored footer must suppress
   *  Applied/Undo exactly like the live turn does. Absent/false = a document
   *  changed (every pre-F2 row implicitly falls here). */
  noDocChange?: boolean;
}
