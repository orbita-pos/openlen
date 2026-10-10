"use client";

// LA MARCA «DATOS DE PRUEBA» del lienzo (spec local
// 2026-10-09-borrador-y-produccion-de-datos): con base de datos, el lienzo
// trabaja contra la de PRUEBAS, y se dice para que nadie confunda lo que ve
// con su inventario real. Va junto a la dirección (preview-area.tsx).

import { useTranslations } from "next-intl";

export function TestDataBadge({ show }: { show: boolean }) {
  const t = useTranslations("wsChrome");
  if (!show) return null;
  return (
    <span title={t("preview.testDataHint")} className="shrink-0 rounded-full border bd px-2 py-0.5 text-[11px] fg-muted">
      {t("preview.testData")}
    </span>
  );
}
