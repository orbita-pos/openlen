"use client";
// Marketing Kit tab: goal chips + offer input + register picker → grid of
// post designs live-filled with the project's brand (scaled iframes; the
// heavy PNG render only happens on export, Task 10). Selected-post state is
// wired here but renders nothing yet — <PostDetail> lands in Task 10.
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  POST_FORMAT_SIZES,
  POST_GOALS,
  POST_REGISTERS,
  type PostGoal,
  type PostRegister,
} from "@/lib/marketing/post-templates/families";

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
  onSaveRegister,
}: {
  projectId: string | null;
  initialRegister?: string;
  onSaveRegister: (r: PostRegister) => void;
}) {
  const t = useTranslations("wsPage.marketing");
  const [register, setRegister] = useState<PostRegister>(
    (initialRegister as PostRegister) || "general",
  );
  const [goal, setGoal] = useState<PostGoal>("promo");
  const [offer, setOffer] = useState("");
  const [debouncedOffer, setDebouncedOffer] = useState("");
  const [posts, setPosts] = useState<PostMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PostMeta | null>(null);

  // Resync from the prop: the parent only persists the register on a
  // successful PATCH (and reverts on failure), so following it here is what
  // rolls the select back when a save fails.
  useEffect(() => {
    setRegister((initialRegister as PostRegister) || "general");
  }, [initialRegister]);

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

  const previewUrl = useMemo(
    () => (p: PostMeta) =>
      `/api/marketing/preview?projectId=${projectId}&postId=${p.id}${
        debouncedOffer ? `&offer=${encodeURIComponent(debouncedOffer)}` : ""
      }`,
    [projectId, debouncedOffer],
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

          <div className="flex flex-wrap gap-1.5 mb-6">
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
      {/* selected → <PostDetail post={selected} onClose={() => setSelected(null)} /> — Task 10 */}
    </section>
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
