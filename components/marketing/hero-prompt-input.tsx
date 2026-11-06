"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { useSession } from "next-auth/react";
import { Sparkles, X } from "lucide-react";
import { useHeroLenReport } from "./hero-len";
import { useGhostTyping } from "./use-ghost-typing";
import {
  dejarReferenciasEnTransito,
  olvidarReferenciasEnTransito,
} from "@/lib/referencia-en-transito";
import { dropFirstMessage, leaveFirstMessage } from "@/lib/marketing/first-message-in-transit";
import type { NaceComo } from "@/components/workspace-v2/tarjetas-nace-como";
import { newProjectHref } from "@/components/workspace-v2/chat/nace-como";
import { useGamesAvailable } from "@/components/workspace-v2/use-games-available";
import { PromptBox, type PromptBoxPhoto } from "@/components/prompt-box";

// ─────────────────────────────────────────────────────────────────────────────
// THE HOME'S BOX — the way in (Jesús, 09/10: the box itself, not a button that leads to it).
//
// It is /new's box (`components/prompt-box.tsx`, Jesús, 06/11: «dos inputs así es duplicación») in the home's
// colours. What stays here is what is the home's: the text lives here until it is sent, the box types examples while
// nobody touches it, Len's face in the menu watches it, and «send» is THE send: it leaves the one-use ticket /new sends
// on arrival (`lib/marketing/first-message-in-transit.ts`) and goes to /new with the brief — which, if the storage is
// blocked, still arrives written in /new's box. Signed out, a dialog asks to sign in first; the brief rides along in
// `?next=` and the ticket waits in this tab, unless the dialog is closed.
// ─────────────────────────────────────────────────────────────────────────────

export function HeroPromptInput() {
  const t = useTranslations("marketing");
  const tw = useTranslations("wsChrome");
  const router = useRouter();
  const { status } = useSession();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  // What the project is born as (the pill). A page by default, as in /new.
  const [kind, setKind] = useState<NaceComo>("pagina");
  // THE GAME MODE (spec local 2026-11-05-modo-juego-design, §8.2): Juego in the pill, unless games are off here.
  const juegos = useGamesAvailable();
  // THE PHOTOS, up to `MAX_REFERENCIAS`. Several are fine: Len's context says how to read each one
  // (`attachedImagesBlock`, lib/agent/context.ts) — the logo, the shop and a mood board are three different things.
  const [photos, setPhotos] = useState<readonly PromptBoxPhoto[]>([]);
  const [activity, setActivity] = useState({ focused: false, listening: false });
  const onActivity = useCallback((a: { focused: boolean; listening: boolean }) => setActivity(a), []);

  // Types by itself while empty and untouched (use-ghost-typing.ts). Its examples are pages: with another kind it
  // stays quiet and that kind's placeholder speaks.
  const ghost = useGhostTyping(
    t.raw("heroPrompt.ghost") as string[],
    kind === "pagina" && !activity.focused && value === "" && photos.length === 0 && !activity.listening,
  );
  // LEN'S FACE IN THE MENU watches this box: it listens while you type or dictate and thinks when you send
  // (hero-len.tsx). Outside the home, a no-op.
  const reportLen = useHeroLenReport();
  useEffect(() => {
    reportLen({
      focused: activity.focused,
      hasText: value.trim().length > 0,
      listening: activity.listening,
      sent: submitting || loginOpen,
      ghost: ghost.typing,
    });
  }, [reportLen, activity, value, submitting, loginOpen, ghost.typing]);

  // The brief WRITTEN in /new's URL too: it fills /new's box if the ticket can't be read there. With another kind, `kind=`.
  const target = newProjectHref(value, kind);

  const submit = () => {
    if (submitting || status === "loading") return;
    // Photos don't fit in a URL: they cross in `sessionStorage`, left BEFORE navigating and BEFORE the sign-in
    // dialog — the signed-out visitor goes to /register and comes back, and they must still be there.
    if (photos.length) dejarReferenciasEnTransito(photos);
    // THIS IS THE SEND (Jesús, 06/11: «dos inputs así es duplicación»): /new sends it on arrival instead of showing
    // the same text in a second box. Left before the sign-in dialog too: the detour is the same tab.
    leaveFirstMessage({ brief: value, kind });
    if (status === "authenticated") {
      setSubmitting(true);
      router.push(target);
    } else {
      setLoginOpen(true);
    }
  };

  return (
    <div className="relative">
      <PromptBox
        piel="portada"
        id="hero-prompt"
        value={value}
        onValueChange={setValue}
        photos={photos}
        onPhotosChange={(next) => {
          setPhotos(next);
          // Also out of the transit: if they were already left there (a send and a trip to sign up), removing one
          // here must really remove it. Emptied WHOLE: `submit` leaves what is there again right before going.
          olvidarReferenciasEnTransito();
        }}
        kind={{ value: kind, onChange: setKind, conJuego: juegos }}
        placeholder={
          kind === "app"
            ? tw("start.kind.appPlaceholder")
            : kind === "game"
              ? tw("start.kind.gamePlaceholder")
              : t("heroPrompt.placeholder")
        }
        ghost={ghost.text || null}
        onActivity={onActivity}
        onSend={submit}
        sending={submitting}
        sendDisabled={status === "loading"}
      />

      {/* No example chips under the box any more (Jesús, 06/11: «quitemos el example», for a cleaner home): the box
          types its own examples while nobody touches it (`use-ghost-typing.ts`), which says the same thing quietly. */}
      {loginOpen && (
        <SignInDialog
          next={target}
          onClose={() => {
            // Closed, not followed: what they wrote is not on its way to /new any more.
            dropFirstMessage();
            setLoginOpen(false);
          }}
        />
      )}
    </div>
  );
}

// Shown when a signed-out visitor hits Generate. The brief rides along in
// `next` so they land back in the workspace, generating, after auth.
function SignInDialog({
  next,
  onClose,
}: {
  next: string;
  onClose: () => void;
}) {
  const t = useTranslations("marketing");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const q = `?next=${encodeURIComponent(next)}`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-dialog-title"
    >
      <div
        className="absolute inset-0 bg-zinc-950/55 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] p-6 text-center">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("signInDialog.close")}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-900 transition"
        >
          <X size={15} />
        </button>
        <div className="mx-auto mb-3.5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-coral-500/10 text-coral-600 dark:text-coral-400">
          <Sparkles size={20} />
        </div>
        <h2
          id="signin-dialog-title"
          className="text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          {t("signInDialog.title")}
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t("signInDialog.body")}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link
            href={`/register${q}`}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-coral-500 text-white text-[13.5px] font-medium hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow transition"
          >
            <Sparkles size={14} /> {t("signInDialog.createAccount")}
          </Link>
          <Link
            href={`/login${q}`}
            className="inline-flex h-10 items-center justify-center rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 text-[13.5px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition"
          >
            {t("signInDialog.logIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
