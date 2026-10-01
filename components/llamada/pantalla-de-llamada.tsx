"use client";
// La llamada de brand/len-movil, a pantalla completa: naranja de día, negro en
// modo oscuro; la cara, subtítulos con los números resaltados, tarjetas y
// Audio · Colgar · Silenciar. La lógica vive en `useLlamada`.
import { useTranslations } from "next-intl";
import { CaraDeLen, type EstadoDeLaCara } from "./cara-de-len";
import { TarjetasDeLaLlamada } from "./tarjetas";
import { useLlamada } from "./use-llamada";

/** Resalta los números (312, 20 %, 9:00) en el subtítulo de Len. */
export function conNumerosResaltados(texto: string) {
  return texto.split(/(\d[\d.,:]*\s?%?)/).map((trozo, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-md bg-white px-1 text-[#9a3412]">
        {trozo}
      </mark>
    ) : (
      <span key={i}>{trozo}</span>
    ),
  );
}

export function PantallaDeLlamada({ projectId, idioma }: { projectId: string; idioma: string }) {
  const t = useTranslations("llamada");
  const ll = useLlamada({ projectId, idioma });
  const estado: EstadoDeLaCara =
    ll.fase !== "en_llamada" ? (ll.aviso ? "error" : "dormido") : ll.trabajando ? "buscando" : ll.lineaLen ? "avisando" : "escuchando";
  const boton = "flex flex-col items-center gap-1 text-xs";
  const redondo = "grid size-14 place-items-center rounded-full";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-between gap-6 bg-gradient-to-b from-[#ff7a2e] to-[#f05a12] px-4 pb-10 pt-12 text-white dark:from-black dark:to-black">
      <audio ref={ll.audioRef} autoPlay />
      <header className="text-center">
        <h1 className="text-3xl font-semibold">Len</h1>
        <p className="mt-1 text-sm opacity-80">
          {ll.fase === "conectando"
            ? t("conectando")
            : ll.trabajando
              ? t("lenMirando")
              : ll.fase === "en_llamada"
                ? t("enLlamada")
                : ll.fase === "terminada"
                  ? t("terminada")
                  : t("titulo")}
        </p>
      </header>
      <CaraDeLen estado={estado} />
      <TarjetasDeLaLlamada projectId={projectId} tarjetas={ll.tarjetas} />
      <section className="w-full max-w-md text-center" aria-live="polite">
        {ll.lineaLen && <p className="text-2xl font-medium leading-snug">{conNumerosResaltados(ll.lineaLen)}</p>}
        {ll.lineaTu && <p className="mt-3 text-sm opacity-70">{ll.lineaTu}</p>}
        {ll.aviso && (
          <p className="mt-3 text-sm">
            {t(ll.aviso)}{" "}
            {(ll.aviso === "sinMicro" || ll.aviso === "sinVoz") && (
              <a className="underline" href={`/${idioma}/new?project=${encodeURIComponent(projectId)}`}>
                {t("irAlChat")}
              </a>
            )}
          </p>
        )}
      </section>
      {ll.fase === "en_llamada" ? (
        <nav className="flex gap-10">
          <button type="button" className={boton} onClick={ll.alternarAudio} aria-pressed={!ll.audio}>
            <span className={`${redondo} ${ll.audio ? "bg-white/20" : "bg-white text-[#c2410c]"}`}>🔈</span>
            {t("audio")}
          </button>
          <button type="button" className={boton} onClick={ll.colgar}>
            <span className={`${redondo} bg-[#e5484d]`}>✕</span>
            {t("colgar")}
          </button>
          <button type="button" className={boton} onClick={ll.alternarMicro} aria-pressed={!ll.micro}>
            <span className={`${redondo} ${ll.micro ? "bg-white/20" : "bg-white text-[#c2410c]"}`}>🎙</span>
            {ll.micro ? t("silenciar") : t("activarMicro")}
          </button>
        </nav>
      ) : (
        <button
          type="button"
          disabled={ll.fase === "conectando"}
          onClick={ll.llamar}
          className="rounded-full bg-white px-8 py-4 text-lg font-semibold text-[#c2410c] disabled:opacity-50"
        >
          {ll.fase === "terminada" ? t("llamarOtraVez") : t("llamar")}
        </button>
      )}
    </main>
  );
}
