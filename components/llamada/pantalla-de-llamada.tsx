"use client";
// La llamada de brand/len-movil, a pantalla completa: naranja de día, negro en
// modo oscuro; la cara, subtítulos con los números resaltados, tarjetas y
// Audio · Colgar · Silenciar. La lógica vive en `useLlamada`.
import { useTranslations } from "next-intl";
import { CaraDeLen, type EstadoDeLaCara } from "./cara-de-len";

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
  const estado: EstadoDeLaCara = "dormido";
  void projectId;
  void idioma;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-between bg-gradient-to-b from-[#ff7a2e] to-[#f05a12] px-4 pb-10 pt-12 text-white dark:from-black dark:to-black">
      <header className="text-center">
        <h1 className="text-3xl font-semibold">Len</h1>
        <p className="mt-1 text-sm opacity-80">{t("titulo")}</p>
      </header>
      <CaraDeLen estado={estado} />
      <button type="button" className="rounded-full bg-white px-8 py-4 text-lg font-semibold text-[#c2410c]">
        {t("llamar")}
      </button>
    </main>
  );
}
