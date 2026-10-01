"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";

export function Volver({ url }: { url: string | null }) {
  const t = useTranslations("movil.entrar");
  useEffect(() => {
    if (url) window.location.href = url;
  }, [url]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#ff7a2e] to-[#f05a12] px-4 text-center text-white dark:from-black dark:to-black">
      <h1 className="text-3xl font-semibold">Len</h1>
      {url ? (
        <>
          <p className="text-lg">{t("listo")}</p>
          <a className="rounded-full bg-white px-6 py-3 font-semibold text-[#9a3412]" href={url}>
            {t("volver")}
          </a>
        </>
      ) : (
        <p className="text-lg">{t("enlaceRoto")}</p>
      )}
    </main>
  );
}
