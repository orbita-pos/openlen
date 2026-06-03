import { Check, Layers, X } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type CellValue =
  | { type: "price"; v: string; strike?: boolean }
  | { type: "yes"; note?: string }
  | { type: "no" }
  | { type: "partial"; v: string };

interface Row {
  name: string;
  us?: boolean;
  values: CellValue[];
}

function Cell({ v }: { v: CellValue }) {
  if (v.type === "price") {
    return (
      <span
        className={cn(
          "text-sm tabular-nums font-medium",
          v.strike
            ? "text-zinc-500 dark:text-zinc-400 line-through"
            : "text-zinc-900 dark:text-zinc-100",
        )}
      >
        {v.v}
      </span>
    );
  }
  if (v.type === "yes") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400 font-medium">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200/60 dark:ring-emerald-500/30">
          <Check size={12} strokeWidth={2.5} />
        </span>
        {v.note && (
          <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
            {v.note}
          </span>
        )}
      </span>
    );
  }
  if (v.type === "no") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-200/60 dark:ring-zinc-800">
          <X size={12} strokeWidth={2.5} />
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15 ring-1 ring-amber-200/60 dark:ring-amber-500/30 text-[10px] font-bold">
        ~
      </span>
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{v.v}</span>
    </span>
  );
}

export async function Comparison() {
  const t = await getTranslations("marketing");

  const cols = [
    t("comparison.cols.price"),
    t("comparison.cols.yourCode"),
    t("comparison.cols.openSource"),
    t("comparison.cols.selfHost"),
    t("comparison.cols.analytics"),
  ];

  const rows: Row[] = [
    {
      name: "OpenLen",
      us: true,
      values: [
        { type: "price", v: t("comparison.values.freeAlpha") },
        { type: "yes", note: "HTML" },
        { type: "yes", note: "AGPLv3" },
        { type: "yes" },
        { type: "yes", note: t("comparison.values.builtIn") },
      ],
    },
    {
      name: "Lovable",
      values: [
        { type: "price", v: "$25-220/mo" },
        { type: "partial", v: t("comparison.values.export") },
        { type: "no" },
        { type: "no" },
        { type: "no" },
      ],
    },
    {
      name: "Framer",
      values: [
        { type: "price", v: "$30+/mo" },
        { type: "no" },
        { type: "no" },
        { type: "no" },
        { type: "partial", v: t("comparison.values.basic") },
      ],
    },
    {
      name: "Linktree",
      values: [
        { type: "price", v: "$4-24/mo" },
        { type: "no" },
        { type: "no" },
        { type: "no" },
        { type: "partial", v: t("comparison.values.paidTier") },
      ],
    },
  ];

  return (
    <section className="relative border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="text-center max-w-2xl mx-auto">
          <Badge tone="zinc">
            <Layers size={11} /> {t("comparison.badge")}
          </Badge>
          <h2 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.05]">
            {t("comparison.title")}
          </h2>
          <p className="mt-4 text-zinc-500 dark:text-zinc-400">
            {t("comparison.subtitle")}
          </p>
        </div>

        <div className="mt-14 rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] overflow-hidden">
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={t("comparison.title")}
          >
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950">
                  <th scope="col" className="sticky left-0 z-10 bg-zinc-50/80 dark:bg-zinc-950 px-6 py-4 text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                    <span className="sr-only">{t("comparison.featureColumn")}</span>
                  </th>
                  {cols.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400 whitespace-nowrap"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.name}
                    className={cn(
                      "border-b last:border-0 border-zinc-200 dark:border-zinc-800",
                      row.us && "bg-coral-50/30 dark:bg-coral-500/[0.04]",
                    )}
                  >
                    <th
                      scope="row"
                      className={cn(
                        "sticky left-0 px-6 py-5 whitespace-nowrap text-left font-normal",
                        row.us
                          ? "bg-coral-50/30 dark:bg-coral-500/[0.04]"
                          : "bg-white dark:bg-[#0a0a0a]",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {row.us && (
                          <span className="h-2 w-2 rounded-full bg-coral-500" />
                        )}
                        <span
                          className={cn(
                            "font-medium",
                            row.us
                              ? "text-coral-700 dark:text-coral-300"
                              : "text-zinc-900 dark:text-zinc-100",
                          )}
                        >
                          {row.name}
                        </span>
                        {row.us && (
                          <Badge tone="coral" className="ml-1 !py-0.5 !text-[10px]">
                            {t("comparison.thatsUs")}
                          </Badge>
                        )}
                      </div>
                    </th>
                    {row.values.map((v, vi) => (
                      <td key={vi} className="px-6 py-5">
                        <Cell v={v} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          {t("comparison.footnote")}
        </p>
      </div>
    </section>
  );
}
