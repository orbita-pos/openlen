"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowUp,
  Loader2,
  Mic,
  Plus,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { QUICK_PROMPTS } from "@/lib/quick-prompts";
import { useDictado } from "./use-dictado";
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

      <div className="group rounded-2xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.18)] dark:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] focus-within:ring-2 focus-within:ring-coral-500 transition">
        {/* LA MINIATURA VA ARRIBA, DENTRO DE LA TARJETA (Jesus, 2026-08-28:
            "que se pongan arriba del input asi bonito"). Dentro y no encima
            porque la caja crece con ella: una foto flotando sobre el
            compositor taparia el titular en cuanto el brief pase de dos
            lineas. */}
        {referencias.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3.5">
            {referencias.map((referencia, i) => (
              <div key={`${referencia.nombre}-${i}`} className="relative inline-flex">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={referencia.dataUrl}
                  alt={referencia.nombre || t("heroPrompt.attachedAlt")}
                  className="h-16 w-16 rounded-xl object-cover ring-1 ring-zinc-200 dark:ring-zinc-800"
                />
                <button
                  type="button"
                  onClick={() => quitarFoto(i)}
                  aria-label={t("heroPrompt.removeImage")}
                  className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white ring-2 ring-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-950 dark:hover:bg-white"
                >
                  <X size={11} strokeWidth={2.6} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 pt-3.5">
          <textarea
            ref={taRef}
            value={value}
            onChange={briefLimit.onChange}
            onPaste={briefLimit.onPaste}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder={t("heroPrompt.placeholder")}
            maxLength={briefLimit.maxLength}
            aria-describedby={
              briefLimit.warningVisible ? briefLimit.feedbackId : undefined
            }
            className="block w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 focus:outline-none"
            style={{ minHeight: 56 }}
          />
        </div>

        {/* LO QUE EL MOTOR VA OYENDO, antes de darlo por bueno.

            Sin esto, dictar se siente roto: entre que hablas y que el motor
            cierra la frase pasan uno o dos segundos en los que la caja no
            cambia y parece que el boton no hizo nada. El parcial es la prueba
            de que te esta oyendo.

            No entra en el textarea a proposito: es texto que el motor todavia
            puede CORREGIR —cambia de palabra a media frase— y verlo reescribirse
            dentro de lo que ya escribiste da la sensacion de que te lo borra. */}
        {dictado.escuchando && (
          <p className="px-4 pb-1 text-[12.5px] italic text-zinc-500 dark:text-zinc-400" aria-live="polite">
            {dictado.parcial || t("heroPrompt.listening")}
          </p>
        )}

        {/* EL PERMISO DENEGADO SI SE DICE. Es la unica diferencia real con
            "no soportado": ahi no se pinta nada porque no hay nada que hacer,
            y aqui el usuario PUEDE arreglarlo — pero solo si sabe donde. */}
        {/* EL MOTOR ABRIO Y NO OYO NADA. Sin este aviso, un fallo real se ve
            igual que estar escuchando — y el usuario habla contra una caja que
            nunca le va a contestar. */}
        {dictado.mudo && (
          <p className="px-4 pb-1 text-[12px] text-amber-600 dark:text-amber-400" role="status">
            {t("heroPrompt.micSilent")}
          </p>
        )}

        {dictado.denegado && (
          <p className="px-4 pb-1 text-[12px] text-amber-600 dark:text-amber-400" role="status">
            {t("heroPrompt.micDenied")}
          </p>
        )}

        <GenerationBriefLimitFeedback
          valueLength={value.length}
          state={briefLimit}
          warningText={tp("aiBrief.trimmed", { max: briefLimit.maxLength })}
          className="px-4 pb-1 text-[11px]"
          warningClassName="text-amber-600 dark:text-amber-400"
          counterClassName="text-zinc-500 dark:text-zinc-400"
        />

        {/* EL PIE, con la silueta de la referencia de Jesús (2026-08-28): un
            renglón bajo el texto con la meta a la izquierda, muda, y UN botón
            redondo sólido a la derecha. Nada en medio.

            SE FUE «Listo» con su punto verde latiendo. Era el hueco que dejó
            «Gemini 3.1 Pro» esta mañana, y heredó su problema: un indicador de
            estado EN VIVO —punto que parpadea— para algo que no se mide. No
            hay comprobación detrás; dice «listo» siempre, incluso si la
            generación está caída. Un semáforo que sólo sabe ponerse en verde
            no es información, es decoración que parece información. */}
        <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
          {/* EL `+`. Abre el selector de ficheros del sistema; el `<input>`
              real va oculto porque su aspecto nativo no se puede estilar y
              rompe la silueta del compositor.

              `accept="image/*"` FILTRA, no valida. Quien quiera puede elegir
              "todos los archivos" y mandar un PDF; por eso el reductor comprueba
              el tipo y el servidor lo vuelve a comprobar en
              `leerReferenciaAdjunta`. Esto es comodidad, no una puerta. */}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/avif"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => void elegirFotos(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={leyendoFoto || referencias.length >= MAX_REFERENCIAS}
            aria-label={t("heroPrompt.attachImages")}
            title={
              referencias.length >= MAX_REFERENCIAS
                ? t("heroPrompt.maxImages", { max: MAX_REFERENCIAS })
                : t("heroPrompt.attachImages")
            }
            className="mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            {leyendoFoto ? <Loader2 size={17} className="animate-spin" /> : <Plus size={18} />}
          </button>

          {/* AQUI ESTABA LA PISTA `⌘ ↵ Generar` (fuera el 2026-08-28, Jesus).
              El atajo SIGUE funcionando —lo escucha el `onKeyDown` del
              textarea—; lo que se va es anunciarlo. En la referencia el pie
              lleva controles, no leyendas, y una pista de teclado en la portada
              le habla al 5% que iba a usarla de todas formas. */}
          {/* EL GRUPO DERECHO. `ml-auto` vive aqui y no en cada boton: con la
              pista de teclado fuera, el pie tiene UN elemento a la izquierda
              (el `+`) y este grupo a la derecha. Si el margen lo llevara el
              microfono, en Firefox —donde no se pinta— el boton de enviar se
              iria al centro. */}
          <span className="ml-auto flex items-center">
            {/* EL MICROFONO. Solo se pinta si la API EXISTE — no hay lista de
                navegadores, se comprueba el objeto. En Firefox, que no la trae,
                este boton sencillamente no esta: un control gris que no responde
                es lo que quitamos del heroe esta misma manana. */}
            {dictado.soportado && (
              <button
                type="button"
                onClick={dictado.alternar}
                aria-pressed={dictado.escuchando}
                aria-label={dictado.escuchando ? t("heroPrompt.stopDictating") : t("heroPrompt.dictate")}
                title={dictado.escuchando ? t("heroPrompt.stopDictating") : t("heroPrompt.dictate")}
                className={cn(
                  "mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition",
                  dictado.escuchando
                    ? "bg-coral-500/10 text-coral-600 dark:text-coral-400 ring-1 ring-coral-500/40"
                    : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900",
                )}
              >
                {dictado.escuchando ? (
                  <span className="relative inline-flex h-4 w-4 items-center justify-center">
                    {/* El halo late para que se vea que el micro esta ABIERTO.
                        Se apaga con `prefers-reduced-motion`. */}
                    <span className="absolute inset-0 rounded-full bg-coral-500/30 motion-safe:animate-ping" />
                    <Square size={9} className="relative fill-current" />
                  </span>
                ) : (
                  <Mic size={17} />
                )}
              </button>
            )}
          {/* REDONDO Y SIEMPRE DEL MISMO TAMAÑO. Antes cambiaba de forma según
              hubiera texto —píldora ancha con la palabra «Generar», o cuadrado
              estrecho— así que el pie se reacomodaba al teclear la primera
              letra. La referencia tiene un círculo fijo que sólo cambia de
              color: el control no se mueve, se enciende. */}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend || submitting || status === "loading"}
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition",
              canSend
                ? "bg-coral-500 text-white hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow disabled:opacity-80"
                : "bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 cursor-not-allowed",
            )}
            aria-label={t("heroPrompt.generate")}
          >
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ArrowUp size={17} strokeWidth={2.4} />
            )}
          </button>
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 font-semibold mr-1">
          {t("heroPrompt.tryLabel")}
        </span>
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              briefLimit.replaceValue(p.prompt);
              taRef.current?.focus();
            }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] text-zinc-700 dark:text-zinc-300 ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur hover:bg-white dark:hover:bg-zinc-900 hover:ring-zinc-300 dark:hover:ring-zinc-700 transition"
          >
            <Sparkles size={10} className="text-coral-500" />
            {p.label}
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
