"use client";
// Marketing Kit tab: goal chips + offer input + register picker → grid of
// post designs live-filled with the project's brand (scaled iframes; the
// heavy PNG render only happens on export/share, in PostDetail). Clicking a
// card opens PostDetail — caption + download/copy/share/WhatsApp.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFocusTrap } from "./use-focus-trap";
import {
  POST_FORMAT_SIZES,
  POST_GOALS,
  POST_REGISTERS,
  type PostGoal,
  type PostRegister,
} from "@/lib/marketing/post-templates/families";
import { listCaptions, fillCaption } from "@/lib/marketing/captions";
import { REGISTER_DEFAULT_PHOTOS } from "@/lib/marketing/post-data";
import type { PostData } from "@/lib/marketing/fill";
import { useToast } from "./toast";
import {
  AlertTriangle,
  Copy as CopyIcon,
  Download,
  RefreshCw,
  Share2,
  WhatsAppIcon,
  X,
} from "./icons";

interface PostMeta {
  id: string;
  name: string;
  register: PostRegister;
  format: "square" | "story";
  goal: PostGoal;
}

// "general" first — it's the default register and the safest fallback while
// a specific giro's catalog is still thin.
const REGISTER_ORDER: PostRegister[] = [
  "general",
  ...POST_REGISTERS.filter((r) => r !== "general"),
];
const REGISTER_KEY: Record<PostRegister, string> = {
  general: "registerGeneral",
  restaurante: "registerRestaurante",
  belleza: "registerBelleza",
  gym: "registerGym",
  consultorio: "registerConsultorio",
  tienda: "registerTienda",
  oficios: "registerOficios",
};
const GOAL_KEY: Record<PostGoal, string> = {
  promo: "goalPromo",
  anuncio: "goalAnuncio",
  testimonio: "goalTestimonio",
  info: "goalInfo",
};

const fieldInputCls =
  "w-full h-8 rounded-md px-2.5 text-[12px] bg-[color:var(--bg)] ring-1 ring-[color:var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]";

export function MarketingView({
  projectId,
  initialRegister,
  initialMatch,
  onSaveRegister,
  onSaveMatch,
}: {
  projectId: string | null;
  initialRegister?: string;
  initialMatch?: boolean;
  onSaveRegister: (r: PostRegister) => void;
  onSaveMatch: (m: boolean) => void;
}) {
  const t = useTranslations("wsPage.marketing");
  const [register, setRegister] = useState<PostRegister>(
    (initialRegister as PostRegister) || "general",
  );
  // "Combinar con mi página" — ON derives the palette+font from the page; OFF
  // shows the design's native curated look. Default ON.
  const [match, setMatch] = useState<boolean>(initialMatch ?? true);
  const [goal, setGoal] = useState<PostGoal>("promo");
  const [offer, setOffer] = useState("");
  const [debouncedOffer, setDebouncedOffer] = useState("");
  const [posts, setPosts] = useState<PostMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PostMeta | null>(null);
  const [nudgeData, setNudgeData] = useState<PostData | null>(null);
  const [dismissedNudges, setDismissedNudges] = useState<Set<"profile" | "publish">>(
    () => new Set(),
  );

  // Resync from the props: the parent only persists on a successful PATCH (and
  // reverts on failure), so following the props here rolls a control back when
  // a save fails.
  useEffect(() => {
    setRegister((initialRegister as PostRegister) || "general");
  }, [initialRegister]);
  useEffect(() => {
    setMatch(initialMatch ?? true);
  }, [initialMatch]);

  // `&match=0` disables page-matching in the preview/render endpoints.
  const matchParam = match ? "" : "&match=0";

  // Debounce the offer text → iframe src so each keystroke doesn't re-fetch
  // every card's preview (cheap server-side, but visibly janky at 60wpm).
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedOffer(offer), 400);
    return () => window.clearTimeout(id);
  }, [offer]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/marketing/posts?register=${register}&goal=${goal}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setPosts(d.posts ?? []);
      })
      .catch(() => {
        if (alive) setPosts([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [register, goal]);

  // Deferred T9 nudges: any loaded post's as=json data carries the same
  // project-level phone/whatsapp/url fields regardless of which design it is,
  // so the first post in the current list is enough to know whether to nudge.
  useEffect(() => {
    if (!projectId || posts.length === 0) {
      setNudgeData(null);
      return;
    }
    let alive = true;
    fetch(`/api/marketing/preview?projectId=${projectId}&postId=${posts[0].id}&as=json`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setNudgeData(d.data ?? null);
      })
      .catch(() => {
        if (alive) setNudgeData(null);
      });
    return () => {
      alive = false;
    };
  }, [projectId, posts]);

  const previewUrl = useMemo(
    () => (p: PostMeta) =>
      `/api/marketing/preview?projectId=${projectId}&postId=${p.id}${
        debouncedOffer ? `&offer=${encodeURIComponent(debouncedOffer)}` : ""
      }${matchParam}`,
    [projectId, debouncedOffer, matchParam],
  );

  if (!projectId) {
    return (
      <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-app">
        <div className="flex-1 min-h-0 flex items-center justify-center px-6 py-24 text-center">
          <div className="max-w-[260px]">
            <p className="text-[13px] fg-muted leading-relaxed">{t("perProject")}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="flex-1 min-w-0 min-h-0 flex flex-col bg-app"
      data-selected-post={selected?.id ?? undefined}
    >
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll">
        <div className="max-w-[960px] mx-auto px-6 sm:px-8 py-9">
          <h2 className="text-[17px] font-semibold fg mb-1">{t("title")}</h2>
          <p className="text-[13px] fg-muted mb-6">{t("subtitle")}</p>

          {nudgeData && !nudgeData.phone && !nudgeData.whatsapp && !dismissedNudges.has("profile") && (
            <NudgeBanner
              text={t("profileNudge")}
              onDismiss={() =>
                setDismissedNudges((prev) => new Set(prev).add("profile"))
              }
            />
          )}
          {nudgeData && !nudgeData.url && !dismissedNudges.has("publish") && (
            <NudgeBanner
              text={t("publishNudge")}
              onDismiss={() =>
                setDismissedNudges((prev) => new Set(prev).add("publish"))
              }
            />
          )}

          <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-5">
            <label className="block sm:w-56 shrink-0">
              <span className="text-[10.5px] font-medium fg-muted block mb-1">
                {t("registerLabel")}
              </span>
              <select
                value={register}
                onChange={(e) => {
                  const next = e.target.value as PostRegister;
                  setRegister(next);
                  onSaveRegister(next);
                }}
                className={fieldInputCls}
              >
                {REGISTER_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {t(REGISTER_KEY[r])}
                  </option>
                ))}
              </select>
            </label>

            <label className="block flex-1 min-w-0">
              <span className="text-[10.5px] font-medium fg-muted block mb-1">
                {t("offerLabel")}
              </span>
              <input
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                placeholder={t("offerPlaceholder")}
                className={fieldInputCls}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex flex-wrap gap-1.5">
              {POST_GOALS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGoal(g)}
                  className={`text-[10.5px] px-2.5 py-1 rounded-md transition font-medium ${
                    goal === g
                      ? "bg-[var(--accent-strong)] text-white"
                      : "fg-muted bg-hover hover:fg"
                  }`}
                >
                  {t(GOAL_KEY[g])}
                </button>
              ))}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={match}
              onClick={() => {
                const next = !match;
                setMatch(next);
                onSaveMatch(next);
              }}
              className="flex items-center gap-2 text-[11px] fg-muted hover:fg transition shrink-0"
              title={t("matchPageHint")}
            >
              <span
                className={`relative inline-block h-[18px] w-[32px] rounded-full transition-colors ${
                  match ? "bg-[var(--accent-strong)]" : "bg-[var(--border)]"
                }`}
              >
                <span
                  className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${
                    match ? "left-[16px]" : "left-[2px]"
                  }`}
                />
              </span>
              <span className="font-medium">{t("matchPage")}</span>
            </button>
          </div>

          {!loading && posts.length === 0 ? (
            <p className="text-[12.5px] fg-muted py-10 text-center">{t("empty")}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {loading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={`skel-${i}`}
                      className="rounded-lg animate-pulse"
                      style={{ width: 260, height: 260, background: "var(--bg-elev)" }}
                    />
                  ))
                : posts.map((p) => (
                    <PostCard
                      key={p.id}
                      post={p}
                      src={previewUrl(p)}
                      onOpen={() => setSelected(p)}
                    />
                  ))}
            </div>
          )}
        </div>
      </div>
      {selected && (
        <PostDetail
          post={selected}
          projectId={projectId}
          offer={debouncedOffer}
          matchParam={matchParam}
          posts={posts}
          onSelectPost={setSelected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function NudgeBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[color:var(--accent)]/8 ring-1 ring-[color:var(--accent)]/25 px-3 py-2 mb-3 text-[12px] fg">
      <AlertTriangle size={13} className="shrink-0 text-[var(--accent-strong)]" />
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded fg-faint hover:fg hover:bg-hover transition"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function PostCard({
  post,
  src,
  onOpen,
}: {
  post: PostMeta;
  src: string;
  onOpen: () => void;
}) {
  const size = POST_FORMAT_SIZES[post.format];
  const scale = 260 / size.width;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg overflow-hidden ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] hover:-translate-y-px hover:shadow-card transition-all duration-200 bg-[color:var(--bg)]"
      style={{ width: 260, height: size.height * scale }}
    >
      <iframe
        src={src}
        loading="lazy"
        sandbox="allow-scripts"
        title={post.name}
        style={{
          width: size.width,
          height: size.height,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          pointerEvents: "none",
          border: 0,
        }}
      />
    </button>
  );
}

// Strips format words so a square/story pair registered under the same
// concept (e.g. "Oferta relámpago — Story") still matches its sibling even
// when the curated name spells the format out; a no-op when names are
// already identical across the pair.
function nameStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(square|story|cuadrado|historia)\b/g, "")
    .replace(/[\s\-–—:|]+/g, " ")
    .trim();
}

function PostDetail({
  post,
  projectId,
  offer,
  matchParam,
  posts,
  onSelectPost,
  onClose,
}: {
  post: PostMeta;
  projectId: string;
  offer: string;
  matchParam: string;
  posts: PostMeta[];
  onSelectPost: (post: PostMeta) => void;
  onClose: () => void;
}) {
  const t = useTranslations("wsPage.marketing");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const toast = useToast();
  const trapRef = useFocusTrap(true);

  const [data, setData] = useState<PostData | null>(null);
  const [pagePhotos, setPagePhotos] = useState<string[]>([]);
  // Captions are for the page's AUDIENCE, not the editor's UI locale (spec
  // §4) — once the as=json fetch resolves, pageLang (derived server-side from
  // the page's own <html lang>) takes over; the locale-derived guess only
  // covers the brief window before that first response lands.
  const [pageLang, setPageLang] = useState<"es" | "en" | null>(null);
  const lang = pageLang ?? (locale.startsWith("es") ? "es" : "en");
  const [idx, setIdx] = useState(0);
  const [caption, setCaption] = useState("");
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  // Photo focal point + inline text edits, both driven by the iframe editor
  // script (drag the photo, click text to edit). Committed here for the export.
  const [photoPos, setPhotoPos] = useState({ x: 50, y: 50 });
  const [textEdits, setTextEdits] = useState<Record<string, string>>({});
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const offerParam = offer ? `&offer=${encodeURIComponent(offer)}` : "";
  const photoParam = photo ? `&photo=${encodeURIComponent(photo)}` : "";
  const posParam =
    photoPos.x !== 50 || photoPos.y !== 50 ? `&pos=${photoPos.x},${photoPos.y}` : "";
  // Preview carries no pos/edits — the iframe applies them live and the parent
  // re-applies committed state on reload (olReady). The export bakes them in:
  // pos as a query param, text edits in the POST body.
  const previewSrc = `/api/marketing/preview?projectId=${projectId}&postId=${post.id}${offerParam}${photoParam}${matchParam}`;
  const renderUrl = `/api/marketing/render?projectId=${projectId}&postId=${post.id}${offerParam}${photoParam}${posParam}${matchParam}`;

  // The other-format design that shares this one's concept, if the currently
  // loaded catalog (same register+goal filter) has one — the toggle jumps to
  // it; otherwise it's shown disabled.
  const sibling = useMemo(
    () =>
      posts.find(
        (p) =>
          p.id !== post.id &&
          p.goal === post.goal &&
          p.format !== post.format &&
          nameStem(p.name) === nameStem(post.name),
      ),
    [posts, post],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A fresh design (including a format-toggle jump) starts from its own
  // default photo and the first caption — a stale override from the previous
  // post would silently carry over otherwise.
  useEffect(() => {
    setPhoto(undefined);
    setIdx(0);
    setPhotoPos({ x: 50, y: 50 });
    setTextEdits({});
  }, [post.id]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/marketing/preview?projectId=${projectId}&postId=${post.id}&as=json${offerParam}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setData(d.data ?? {});
        setPagePhotos(d.pagePhotos ?? []);
        setPageLang(d.pageLang === "en" ? "en" : "es");
      })
      .catch(() => {
        if (alive) setData({});
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, post.id, offer]);

  useEffect(() => {
    if (!data) return;
    const formulas = listCaptions(post.register, post.goal, lang);
    setCaption(
      fillCaption(formulas[idx % formulas.length], { ...data, offer: offer || data.offer }),
    );
  }, [data, idx, post, lang, offer]);

  // Strip = the register's curated default (the current photo, shown first) +
  // the user's own page images as opt-in swaps. oficios/general have no default.
  const photos = useMemo(() => {
    const def = REGISTER_DEFAULT_PHOTOS[post.register];
    const rest = pagePhotos.filter((u) => u !== def);
    return def ? [def, ...rest] : rest;
  }, [pagePhotos, post.register]);

  async function fetchRenderBlob(): Promise<Blob | null> {
    // With inline text edits, POST them in the body (arbitrary text, too big
    // for the query string); without, a plain GET stays cacheable.
    const hasEdits = Object.keys(textEdits).length > 0;
    const res = await fetch(
      renderUrl,
      hasEdits
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ edits: textEdits }),
          }
        : undefined,
    );
    if (!res.ok) {
      toast.error(t("renderError"));
      return null;
    }
    return res.blob();
  }

  function downloadBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${post.id}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onDownload() {
    const blob = await fetchRenderBlob();
    if (blob) downloadBlob(blob);
  }

  async function onCopy() {
    await navigator.clipboard.writeText(caption);
    toast.success(t("copied"));
  }

  async function onShare() {
    const blob = await fetchRenderBlob();
    if (!blob) return; // renderError toast already shown
    try {
      const file = new File([blob], `${post.id}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: caption });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // user cancelled the sheet
    }
    // Desktop / unsupported fallback: copy + download, with a hint toast.
    await navigator.clipboard.writeText(caption);
    downloadBlob(blob);
    toast.info(t("shareHint"));
  }

  const waHref = `https://wa.me/?text=${encodeURIComponent(caption)}`;
  const size = POST_FORMAT_SIZES[post.format];
  const previewWidth = 300;
  const scale = previewWidth / size.width;
  const activePhoto = photo ?? data?.photoUrl;
  const boxHeight = size.height * scale;

  // Text edits + photo position come FROM the iframe (inline editor script); the
  // parent stores them (for export) and pushes committed state back on reload.
  // Refs keep the message handler reading current values without re-binding.
  const stateRef = useRef({ edits: textEdits, pos: photoPos });
  stateRef.current = { edits: textEdits, pos: photoPos };
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data;
      if (d?.olEdits && typeof d.olEdits === "object") setTextEdits(d.olEdits);
      else if (typeof d?.olPos === "string") {
        const [x, y] = d.olPos.split(",").map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) setPhotoPos({ x, y });
      } else if (d?.olReady) {
        const { edits, pos } = stateRef.current;
        iframeRef.current?.contentWindow?.postMessage(
          {
            olApplyEdits: edits,
            olPhotoPos: pos.x !== 50 || pos.y !== 50 ? `${pos.x}% ${pos.y}%` : undefined,
          },
          "*",
        );
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div
      className="workspace-v2 fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm fade-in p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={post.name}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full max-w-lg max-h-[92vh] rounded-t-2xl sm:rounded-2xl bg-elev border bd shadow-elev overflow-hidden slide-down"
      >
        <div className="shrink-0 h-12 px-4 flex items-center gap-3 border-b bd">
          <h2 className="text-[13px] font-semibold fg leading-tight truncate">{post.name}</h2>
          <div className="ml-auto inline-flex items-center gap-0.5 rounded-md border bd bg-app p-0.5">
            {(["square", "story"] as const).map((f) => {
              const active = post.format === f;
              const target = !active && sibling?.format === f ? sibling : undefined;
              return (
                <button
                  key={f}
                  type="button"
                  disabled={!active && !target}
                  onClick={() => target && onSelectPost(target)}
                  className={`inline-flex items-center justify-center h-6 px-2 rounded text-[10.5px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    active ? "bg-elev fg shadow-card" : "fg-faint hover:fg"
                  }`}
                >
                  {t(f)}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon("close")}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full fg-faint hover:fg hover:bg-hover transition"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto nice-scroll p-4 flex flex-col items-center gap-4">
          <div
            className="relative rounded-lg ring-1 ring-[color:var(--border)] overflow-hidden bg-[color:var(--bg)] shrink-0"
            style={{ width: previewWidth, height: boxHeight }}
          >
            <iframe
              ref={iframeRef}
              key={previewSrc}
              src={previewSrc}
              title={post.name}
              sandbox="allow-scripts"
              style={{
                width: size.width,
                height: size.height,
                transform: `scale(${scale})`,
                transformOrigin: "0 0",
                border: 0,
              }}
            />
          </div>
          <p className="-mt-2 text-[10px] fg-faint text-center">
            {t("editHint")}
            {activePhoto ? ` · ${t("reposition")}` : ""}
          </p>

          <div className="w-full">
            <span className="text-[10.5px] font-medium fg-muted block mb-1.5">
              {t("photoLabel")}
            </span>
            <div className="flex gap-1.5 overflow-x-auto nice-scroll pb-1">
              {photos.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setPhoto(url)}
                  className={`shrink-0 w-12 h-12 rounded-md overflow-hidden ring-2 transition ${
                    activePhoto === url
                      ? "ring-[var(--accent-strong)]"
                      : "ring-transparent hover:ring-[color:var(--border)]"
                  }`}
                >
                  {/* Arbitrary external URLs (page photos + curated fallback) — next/image would need per-domain config for a picker this open-ended. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          <div className="w-full">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10.5px] font-medium fg-muted">{t("copyCaption")}</span>
              <button
                type="button"
                onClick={() => setIdx((i) => i + 1)}
                className="inline-flex items-center gap-1 text-[10.5px] font-medium fg-muted hover:fg transition"
              >
                <RefreshCw size={11} />
                {t("otherVersion")}
              </button>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={5}
              className="w-full rounded-md px-2.5 py-2 text-[12px] leading-relaxed bg-[color:var(--bg)] ring-1 ring-[color:var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] resize-none"
            />
          </div>
        </div>

        <div className="shrink-0 px-4 py-3 border-t bd grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-[color:var(--bg)] ring-1 ring-[color:var(--border)] text-[12px] font-medium fg hover:bg-hover transition"
          >
            <Download size={14} />
            {t("download")}
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-[color:var(--bg)] ring-1 ring-[color:var(--border)] text-[12px] font-medium fg hover:bg-hover transition"
          >
            <CopyIcon size={14} />
            {t("copyCaption")}
          </button>
          <button
            type="button"
            onClick={onShare}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-[var(--accent-strong)] text-white text-[12px] font-semibold shadow-coral hover:brightness-105 transition"
          >
            <Share2 size={14} />
            {t("share")}
          </button>
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-white text-[12px] font-semibold transition hover:brightness-105"
            style={{ background: "#25D366" }}
          >
            <WhatsAppIcon size={14} />
            {t("whatsapp")}
          </a>
        </div>
      </div>
    </div>
  );
}
