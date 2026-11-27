"use client";

// WHAT THE WINDOW SAYS WHEN THERE IS NO APP TO FRAME (spec local 2026-11-26-apps-en-el-escritorio, §4.6, §6), as a page of its
// own in the workspace's tokens. Nothing is framed here:
//   · gone — «{app} is no longer available», why when it is the person's own app (removed, or its tool switched off, as
//     Claude's «Can't open the app» says why), and how to uninstall it from the browser (OpenLen can't delete a shortcut it
//     did not make on the person's computer). The name and the reason are there only when the row was the person's own;
//     for an id that is not, the page says «this app» and nothing else (the window never reveals whose app an id is);
//   · plan_required — the owner is on the Free plan: the app and its data are kept, and come back with a paid plan.
import { useTranslations } from "next-intl";

import type { DesktopGoneReason } from "@/lib/desktop-apps/live";

export type DesktopNoticeProps =
  | { kind: "gone"; name?: string; reason?: DesktopGoneReason; locale: string }
  | { kind: "plan_required"; name: string; locale: string };

const LINK =
  "mt-5 inline-flex h-9 items-center rounded-lg bg-[var(--accent-strong)] px-4 text-[13px] font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]";

export function DesktopNotice(props: DesktopNoticeProps) {
  const t = useTranslations("wsChrome.desktop");
  const gone = props.kind === "gone";
  const title = props.kind === "plan_required" ? t("planRequired.title", { name: props.name }) : props.name ? t("gone.title", { name: props.name }) : t("gone.titleUnnamed");
  const why = props.kind === "gone" && props.reason ? t(`gone.reason.${props.reason}`) : null;
  return (
    <div className="workspace-v2 h-dvh w-full overflow-auto">
      <main className="bg-app flex min-h-full items-center justify-center px-6 py-10" data-desktop-notice={props.kind}>
        <div className="bg-elev bd shadow-card w-full max-w-md rounded-2xl border p-6">
          <h1 className="fg text-[17px] font-semibold leading-snug">{title}</h1>
          {why ? (
            <p className="fg mt-2 text-[13px] leading-relaxed" data-desktop-gone-reason={props.kind === "gone" ? props.reason : undefined}>
              {why}
            </p>
          ) : null}
          <p className="fg-muted mt-2 text-[13px] leading-relaxed">{gone ? t("gone.body") : t("planRequired.body")}</p>
          <a className={LINK} href={gone ? `/${props.locale}` : `/${props.locale}/pricing`}>
            {gone ? t("gone.home") : t("planRequired.plans")}
          </a>
        </div>
      </main>
    </div>
  );
}
