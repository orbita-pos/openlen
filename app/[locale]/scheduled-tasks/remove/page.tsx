// «QUITAR ESTA TAREA» (spec local 2026-10-29-tareas-programadas, §7.8): the page the email's link opens.
// It only ASKS; removing is the button's POST (mail scanners open links on their own, so a GET never
// removes). The signed token is checked here too, so a wrong link says so instead of asking.
import { getTranslations } from "next-intl/server";

import { verifyRemovalToken } from "@/lib/scheduled-tasks/removal-token";
import { getTaskById } from "@/lib/scheduled-tasks/store";
import { RemoveTaskButton } from "./remove-button";

export const dynamic = "force-dynamic";

export default async function RemovePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const q = await searchParams;
  const taskId = typeof q.task === "string" ? q.task : "";
  const token = typeof q.token === "string" ? q.token : "";
  const t = await getTranslations({ locale, namespace: "panelsChat" });
  const valid = taskId !== "" && verifyRemovalToken(taskId, token);
  const task = valid ? await getTaskById(taskId) : null;
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      {!valid ? (
        <p className="text-[15px] text-neutral-600">{t("scheduled.removeInvalid")}</p>
      ) : !task ? (
        <p className="text-[15px] text-neutral-600">{t("scheduled.removeGone")}</p>
      ) : (
        <>
          <h1 className="text-xl font-semibold">{t("scheduled.removeQuestion", { title: task.record.title })}</h1>
          <RemoveTaskButton taskId={taskId} token={token} label={t("scheduled.removeConfirm")} done={t("scheduled.removeDone")} />
        </>
      )}
    </main>
  );
}
