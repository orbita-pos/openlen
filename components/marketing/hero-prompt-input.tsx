"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowUp,
  ImageIcon,
  Loader2,
  Mic,
  Plus,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import "@/components/workspace-v2/chat/new-chat.css";
import { useMandoDesplegable } from "@/components/workspace-v2/use-mando-desplegable";
import { cn } from "@/lib/cn";
import { useDictado } from "./use-dictado";
import { useHeroLenReport } from "./hero-len";
import { useGhostTyping } from "./use-ghost-typing";
import { reducirImagen } from "./reducir-imagen";
import {
  dejarReferenciasEnTransito,
  olvidarReferenciasEnTransito,
} from "@/lib/referencia-en-transito";
import { MAX_REFERENCIAS } from "@/lib/ai/referencia-adjunta";
import {
  GenerationBriefLimitFeedback,
  useGenerationBriefLimit,
} from "@/components/generation-brief-limit";

// ─────────────────────────────────────────────────────────────────────────────
// LO QUE LE PEDIRÍAS A UN DESARROLLADOR (04/10). La portada enseñaba las ideas
// del taller (`QUICK_PROMPTS`: «SaaS launch», «Coffee subscription»…), en inglés
// en todos los idiomas y con cara de demo de SaaS. Aquí van encargos de negocio
// de verdad, traducidos, en la voz de quien se lo pide a Len.
const HERO_ASKS = ["bakery", "barber", "photographer", "course"] as const;

// Hero prompt input — the homepage entry into AI generation. Mirrors the
// /new AI brief panel: same quick-prompts, same composer affordances.
//
// Submit, when signed in, routes to /new?mode=ai&brief=…&autostart=1 so the
// build kicks off on arrival. When signed out, a dialog asks the user to sign
// in first — the brief rides along via ?next= so nothing is lost.
// ─────────────────────────────────────────────────────────────────────────────

export function HeroPromptInput() {
  const t = useTranslations("marketing");
  const tp = useTranslations("panelsA");
  const locale = useLocale();
  const router = useRouter();
  const { status } = useSession();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  // LAS FOTOS ADJUNTAS. Hasta `MAX_REFERENCIAS`.
  //
  // AQUI DECIA "una sola a proposito", y el motivo que daba era bueno: con dos
  // referencias el modelo promedia dos direcciones visuales y saca una tercera
  // que no es ninguna de las dos. Eso NO era un capricho y sigue siendo verdad.
  //
  // Lo que estaba mal era la solucion. El problema no es que haya dos imagenes:
  // es que llegaban al modelo SIN UNA LINEA que dijera que eran, y ante dos
  // imagenes mudas promediar es lo razonable. Casi nunca son dos versiones del
  // mismo estilo — son el logo, el local y un tablero de inspiracion, tres
  // cosas distintas que la pagina necesita a la vez—, y obligar a elegir una
  // era pagar el precio entero para no escribir esa linea.
  //
  // Ahora la linea existe: `/api/generate` antepone un bloque al brief cuando
  // llegan varias, diciendole que las lea por separado y con que criterio
  // resolver si se contradicen. El riesgo se trata donde vive, en el prompt.
  const [referencias, setReferencias] = useState<
    { dataUrl: string; nombre: string; bytes: number }[]
  >([]);
  const [leyendoFoto, setLeyendoFoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // El menú del `+`, con el gancho del chat: Esc, clic fuera y flechas.
  const [plusOpen, setPlusOpen] = useState(false);
  const plus = useMandoDesplegable({ abierto: plusOpen, cerrar: () => setPlusOpen(false) });
  const tc = useTranslations("panelsChat");
  const briefLimit = useGenerationBriefLimit({
    value,
    onValueChange: setValue,
  });

  // EL DICTADO ESCRIBE COMO ESCRIBE UNA PERSONA: por `replaceValue`, el mismo
  // camino que las pastillas de ideas. Asi el limite de brief lo recorta igual
  // y el contador de caracteres cuenta igual. Meterlo con `setValue` directo se
  // saltaria el tope y el usuario perderia el final de su frase al enviar.
  const dictado = useDictado({
    idioma: locale,
    onTexto: (fragmento) => {
      setValue((previo) => {
        // Un espacio si ya habia algo, y ninguno al empezar. El motor entrega
        // los trozos sin separador.
        const junto = previo ? `${previo.replace(/\s+$/, "")} ${fragmento.trim()}` : fragmento.trim();
        return junto.slice(0, briefLimit.maxLength);
      });
    },
  });

  // LA CARA DE LEN DEL HÉROE mira esta caja: escucha mientras escribes o
  // dictas y piensa al enviar (hero-len.tsx). Fuera del héroe, no-op.
  const reportLen = useHeroLenReport();
  const [focused, setFocused] = useState(false);
  // Teclea sola mientras está vacía y nadie la toca (use-ghost-typing.ts).
  const ghost = useGhostTyping(
    t.raw("heroPrompt.ghost") as string[],
    !focused && value === "" && referencias.length === 0 && !dictado.escuchando,
  );
  useEffect(() => {
    reportLen({
      focused,
      hasText: value.trim().length > 0,
      listening: dictado.escuchando,
      sent: submitting || loginOpen,
      ghost: ghost.typing,
    });
  }, [reportLen, focused, value, dictado.escuchando, submitting, loginOpen, ghost.typing]);

  // Auto-grow up to ~10 lines.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);

  // Match the /new brief panel — a real brief needs a little substance.
  const canSend = briefLimit.isValid;

  const target = `/new?mode=ai&brief=${encodeURIComponent(
    value.trim(),
  )}&autostart=1`;

  const submit = () => {
    if (!canSend || submitting || status === "loading") return;
    // Si sigue escuchando al enviar, el motor sigue vivo tras la navegacion y
    // el micro del navegador se queda encendido.
    dictado.parar();
    // Las fotos no caben en la URL, asi que cruzan por `sessionStorage`. Se
    // dejan ANTES de navegar y ANTES de abrir el dialogo de registro: el
    // visitante sin sesion se va a /register y vuelve, y tienen que seguir ahi.
    if (referencias.length) {
      dejarReferenciasEnTransito(
        referencias.map((r) => ({ dataUrl: r.dataUrl, nombre: r.nombre })),
      );
    }
    if (status === "authenticated") {
      setSubmitting(true);
      router.push(target);
    } else {
      setLoginOpen(true);
    }
  };

  const elegirFotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // El hueco QUE QUEDA, no el tope. Quien ya tiene tres y elige otras tres
    // se queda con cuatro, no con seis ni con un aviso.
    const hueco = MAX_REFERENCIAS - referencias.length;
    if (hueco <= 0) return;
    setLeyendoFoto(true);
    try {
      // EN PARALELO. `reducirImagen` decodifica fuera del hilo principal, asi
      // que cuatro a la vez tardan lo que la mas lenta; en serie tardarian la
      // suma, y el compositor se queda con el reloj girando ese rato entero.
      const reducidas = await Promise.all(
        Array.from(files)
          .slice(0, hueco)
          .map(async (file) => {
            const r = await reducirImagen(file);
            // `null` = no era una imagen que el navegador sepa decodificar. No
            // se grita: esa se cae y las demas entran igual.
            return r ? { dataUrl: r.dataUrl, nombre: file.name, bytes: r.bytes } : null;
          }),
      );
      const buenas = reducidas.filter((r): r is NonNullable<typeof r> => r !== null);
      if (buenas.length) {
        setReferencias((previas) => [...previas, ...buenas].slice(0, MAX_REFERENCIAS));
      }
    } finally {
      setLeyendoFoto(false);
      // El input se vacia SIEMPRE. Sin esto, elegir el mismo fichero dos veces
      // seguidas no dispara `change` y parece que el boton se rompio.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const quitarFoto = (indice: number) => {
    setReferencias((previas) => previas.filter((_, i) => i !== indice));
    // Tambien del transito: si ya se habia dejado ahi (envio + vuelta del
    // registro), quitarla de la caja tiene que quitarla de verdad. Se limpia
    // ENTERO y no se reescribe el resto: `submit` lo vuelve a dejar con lo que
    // haya justo antes de navegar, asi que reescribir aqui seria adelantar un
    // trabajo que se repite igual.
    olvidarReferenciasEnTransito();
  };

  return (
    <div className="relative">
      {/* soft coral glow under the input */}
      <div
        className="absolute -inset-x-8 -inset-y-4 -z-10 rounded-[28px] blur-2xl opacity-60 dark:opacity-80 bg-[radial-gradient(60%_50%_at_50%_50%,rgba(255,90,54,0.18)_0%,rgba(255,90,54,0)_70%)]"
        aria-hidden
      />

      {/* LA PIEL DEL CHAT NUEVO (Jesús, 03/10: «que sean como el chat nuevo»):
          la caja de radio 16 con su borde, las fichas encima del texto, el `+`
          con su menú, y el botón cuadrado al final. En los colores de la
          portada —aquí no viven los tokens del taller—; `.nc` sólo trae las
          animaciones de chat/new-chat.css. Lo que HACE no cambia. */}
      <div className="nc">
        <div className="relative rounded-[16px] border border-zinc-300 bg-white px-3 pb-[7px] pt-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition focus-within:border-coral-400 focus-within:shadow-[0_0_0_4px_rgb(255_90_54/0.13)] dark:border-zinc-700 dark:bg-zinc-950 dark:focus-within:border-coral-500">
          {/* LAS FOTOS VAN ARRIBA, DENTRO DE LA TARJETA (Jesus, 2026-08-28:
              "que se pongan arriba del input asi bonito"), ahora como las
              fichas del chat: dentro, y la caja crece con ellas. */}
          {referencias.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1.5">
              {referencias.map((referencia, i) => (
                <span
                  key={`${referencia.nombre}-${i}`}
                  title={referencia.nombre}
                  className="nc-pop inline-flex max-w-full items-center gap-1.5 rounded-lg border border-coral-500/30 bg-coral-500/[0.07] py-[3px] pl-[7px] pr-1 text-[11.5px] text-zinc-800 dark:text-zinc-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={referencia.dataUrl} alt="" className="h-[18px] w-[18px] shrink-0 rounded object-cover" />
                  <span className="min-w-0 max-w-[180px] truncate">{referencia.nombre || t("heroPrompt.attachedAlt")}</span>
                  <button
                    type="button"
                    onClick={() => quitarFoto(i)}
                    aria-label={t("heroPrompt.removeImage")}
                    className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] text-zinc-500 hover:bg-coral-500/15 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="relative">
          {ghost.text && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 mt-0.5 text-[15px] leading-normal text-zinc-500 dark:text-zinc-400"
            >
              {ghost.text}
              <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-coral-500" />
            </div>
          )}
          <textarea
            id="hero-prompt"
            ref={taRef}
            value={value}
            onChange={briefLimit.onChange}
            onPaste={briefLimit.onPaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              // COMO EN EL CHAT: Enter manda y Mayús+Enter salta de línea. El
              // ⌘/Ctrl+Enter de antes sigue valiendo. Mientras un IME compone
              // (japonés, coreano, chino), Enter confirma la palabra y no manda.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={ghost.text ? "" : t("heroPrompt.placeholder")}
            maxLength={briefLimit.maxLength}
            aria-describedby={briefLimit.warningVisible ? briefLimit.feedbackId : undefined}
            className="mt-0.5 block w-full resize-none bg-transparent text-[15px] leading-normal text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            style={{ minHeight: 52 }}
          />
          </div>

          {/* LO QUE EL MOTOR VA OYENDO, antes de darlo por bueno. Sin esto,
              dictar se siente roto: entre que hablas y que el motor cierra la
              frase la caja no cambia. No entra en el textarea a proposito: es
              texto que el motor todavia puede CORREGIR. */}
          {dictado.escuchando && (
            <p className="pb-1 text-[12.5px] italic text-zinc-500 dark:text-zinc-400" aria-live="polite">
              {dictado.parcial || t("heroPrompt.listening")}
            </p>
          )}
          {/* EL MOTOR ABRIO Y NO OYO NADA, y EL PERMISO DENEGADO: los dos se
              dicen, porque un fallo real no puede verse igual que escuchar. */}
          {dictado.mudo && (
            <p className="pb-1 text-[12px] text-amber-600 dark:text-amber-400" role="status">
              {t("heroPrompt.micSilent")}
            </p>
          )}
          {dictado.denegado && (
            <p className="pb-1 text-[12px] text-amber-600 dark:text-amber-400" role="status">
              {t("heroPrompt.micDenied")}
            </p>
          )}

          <GenerationBriefLimitFeedback
            valueLength={value.length}
            state={briefLimit}
            warningText={tp("aiBrief.trimmed", { max: briefLimit.maxLength })}
            className="pb-1 text-[11px]"
            warningClassName="text-amber-600 dark:text-amber-400"
            counterClassName="text-zinc-500 dark:text-zinc-400"
          />

          <div className="mt-0.5 flex items-center gap-[3px]">
            {/* El `<input>` real va oculto: su aspecto nativo no se puede
                estilar. `accept` FILTRA, no valida — el reductor y el servidor
                vuelven a comprobar el tipo. */}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/avif"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => void elegirFotos(e.target.files)}
            />
            {/* EL `+` ABRE SU MENÚ, como en el chat. */}
            <div className="relative" ref={plus.refContenedor} onKeyDown={plus.alPulsarTecla}>
              <button
                type="button"
                ref={plus.refDisparador}
                aria-label={tc("newChat.composer.plus")}
                title={tc("newChat.composer.plus")}
                aria-haspopup="menu"
                aria-expanded={plusOpen}
                onClick={() => setPlusOpen((x) => !x)}
                className={cn(
                  "grid h-[30px] w-[30px] place-items-center rounded-[9px] transition hover:bg-zinc-100 dark:hover:bg-zinc-900",
                  referencias.length > 0
                    ? "text-coral-600 dark:text-coral-400"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
                )}
              >
                {leyendoFoto ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Plus size={16} className={cn("transition-transform duration-200", plusOpen && "rotate-45")} />
                )}
              </button>
              {plusOpen && (
                <div
                  role="menu"
                  aria-label={tc("newChat.composer.plus")}
                  className="nc-card-in absolute bottom-[calc(100%+8px)] left-0 z-20 w-[290px] rounded-[14px] border border-zinc-300 bg-white p-1.5 shadow-[0_18px_40px_-12px_rgb(20_10_5/0.35)] dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={leyendoFoto || referencias.length >= MAX_REFERENCIAS}
                    onClick={() => {
                      setPlusOpen(false);
                      fileRef.current?.click();
                    }}
                    className="nc-up flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left hover:bg-zinc-100 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-zinc-900"
                  >
                    <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-coral-500/10 text-coral-600 dark:text-coral-400">
                      <ImageIcon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                        {t("heroPrompt.attachImages")}
                      </b>
                      <small className="block text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">
                        {referencias.length >= MAX_REFERENCIAS
                          ? t("heroPrompt.maxImages", { max: MAX_REFERENCIAS })
                          : t("heroPrompt.attachImagesHint", { max: MAX_REFERENCIAS })}
                      </small>
                    </span>
                    {referencias.length > 0 && (
                      <span className="shrink-0 text-[11px] font-semibold text-coral-600 dark:text-coral-400">
                        {referencias.length}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
            {/* EL MICROFONO, sólo si la API EXISTE — se comprueba el objeto, no
                una lista de navegadores. En Firefox no se pinta: un control gris
                que no responde es peor que ninguno. */}
            {dictado.soportado && (
              <button
                type="button"
                onClick={dictado.alternar}
                aria-pressed={dictado.escuchando}
                aria-label={dictado.escuchando ? t("heroPrompt.stopDictating") : t("heroPrompt.dictate")}
                title={dictado.escuchando ? t("heroPrompt.stopDictating") : t("heroPrompt.dictate")}
                className={cn(
                  "grid h-[30px] w-[30px] place-items-center rounded-[9px] transition hover:bg-zinc-100 dark:hover:bg-zinc-900",
                  dictado.escuchando
                    ? "bg-zinc-100 text-coral-600 dark:bg-zinc-900 dark:text-coral-400"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
                )}
              >
                {dictado.escuchando ? (
                  <span className="relative inline-flex h-4 w-4 items-center justify-center">
                    {/* El halo late para que se vea que el micro esta ABIERTO. */}
                    <span className="absolute inset-0 rounded-full bg-coral-500/30 motion-safe:animate-ping" />
                    <Square size={9} className="relative fill-current" />
                  </span>
                ) : (
                  <Mic size={15} />
                )}
              </button>
            )}
            {/* EL BOTÓN DEL CHAT: cuadrado redondeado, siempre del mismo tamaño;
                sólo cambia de color al haber algo que mandar. */}
            <button
              type="button"
              onClick={submit}
              disabled={!canSend || submitting || status === "loading"}
              aria-label={t("heroPrompt.generate")}
              title={t("heroPrompt.generate")}
              className={cn(
                "ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-white transition hover:-translate-y-px disabled:translate-y-0 disabled:cursor-default",
                canSend ? "bg-coral-500 hover:bg-coral-600" : "bg-zinc-300 dark:bg-zinc-700",
              )}
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 font-semibold mr-1">
          {t("heroPrompt.tryLabel")}
        </span>
        {HERO_ASKS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              briefLimit.replaceValue(t(`heroPrompt.asks.${key}.prompt`));
              taRef.current?.focus();
            }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] text-zinc-700 dark:text-zinc-300 ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur hover:bg-white dark:hover:bg-zinc-900 hover:ring-zinc-300 dark:hover:ring-zinc-700 transition"
          >
            <Sparkles size={10} className="text-coral-500" />
            {t(`heroPrompt.asks.${key}.label`)}
          </button>
        ))}
      </div>

      {loginOpen && (
        <SignInDialog next={target} onClose={() => setLoginOpen(false)} />
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
