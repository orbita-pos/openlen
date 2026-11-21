"use client";

// THE PERSON'S SPACE (spec local 2026-11-19-agentes-para-todos, §6.2–6.3): Len's chat alone, in the middle — no canvas,
// no Publicar, no page addresses. It is where an agent is asked for and changed: Len writes its file here and leaves
// the card that creates it. «Ficheros» opens the Code lens on what the agents keep here (delivery 2).
//
// WHAT ARRIVES: the home's Agente comes with the one-use ticket (`lib/marketing/first-message-in-transit.ts`) for the
// brief in the address, and that is THE send — the person already pressed it on the home. Anything else only fills the
// box: a brief without its ticket (a link from elsewhere, a reload), a page's ticket, or a draft («Cambiar a <nombre>»).
// Either way the address loses them, through the router, so a reload writes nothing again. The send carries what the
// home attached, as /new's does: its photos and files, uploaded to the space first.
import { ArrowLeft, FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { CaraDeLen } from "@/components/llamada/cara-de-len";
import { AGENT_JOBS } from "@/components/marketing/agent-job-chips";
import { Link, useRouter } from "@/i18n/navigation";
import { takeFirstMessage } from "@/lib/marketing/first-message-in-transit";
import { takeFilesInTransit } from "@/lib/marketing/files-in-transit";
import { tomarReferenciasEnTransito } from "@/lib/referencia-en-transito";
import { spaceHref } from "@/lib/space/href";
import type { StoredChatTurn } from "@/lib/projects/types";
import { uploadAttachment } from "@/lib/workspace-v2/upload-attachment";
import { uploadPhotos } from "@/lib/workspace-v2/upload-photos";

import { NewChatPanel } from "../chat/new-chat-panel";
import type { PendingAttachments } from "../chat/use-agent-chat";
import { CodeView } from "../code-view";
import { useCodeViewLabels } from "../code-view-labels";
import { ToastProvider, useToast } from "../toast";

const noCanvas = () => {};

interface Start {
  readonly text: string;
  readonly send: boolean;
  readonly attachments?: PendingAttachments | null;
}

/** What the home attached (photos in sessionStorage, files in IndexedDB), read and spent, and uploaded to the space —
 *  as /new does for its first message. What doesn't upload is counted; the message goes without it. */
async function fromTheHome(projectId: string): Promise<{ attachments: PendingAttachments | null; photosFailed: number; filesFailed: number }> {
  const photos = tomarReferenciasEnTransito();
  const uploaded = photos.length > 0 ? await uploadPhotos(photos, projectId) : { images: [], failed: 0 };
  const files = await takeFilesInTransit();
  const done = await Promise.all(files.map((file) => uploadAttachment(file, projectId)));
  const ok = done.flatMap((r) => (r.ok ? [r.file] : []));
  const attachments = uploaded.images.length > 0 || ok.length > 0 ? { images: uploaded.images, ...(ok.length > 0 ? { files: ok } : {}) } : null;
  return { attachments, photosFailed: uploaded.failed, filesFailed: files.length - ok.length };
}

/** What the box starts with: the home's ticket for this brief (sent), else the brief or the draft (filled). */
function startOf(arrivalBrief: string | null, draft: string | null): Start | null {
  if (arrivalBrief) {
    const ticket = takeFirstMessage(arrivalBrief);
    if (ticket?.kind === "agent") return { text: ticket.brief, send: true };
    return { text: arrivalBrief, send: false };
  }
  return draft ? { text: draft, send: false } : null;
}

interface SpaceProps {
  projectId: string;
  initialChat: StoredChatTurn[];
  arrivalBrief: string | null;
  draft: string | null;
}

export function SpaceHome(props: SpaceProps) {
  const tc = useTranslations("common");
  return (
    <ToastProvider dismissLabel={tc("close")}>
      <SpaceView {...props} />
    </ToastProvider>
  );
}

function SpaceView({ projectId, initialChat, arrivalBrief, draft }: SpaceProps) {
  const t = useTranslations("wsChrome");
  const tp = useTranslations("wsPage");
  const toast = useToast();
  const router = useRouter();
  const [start, setStart] = useState<Start | null>(null);
  // The home's send waits for what it attached to upload: meanwhile the chat isn't there to send anything before it
  // (final review of this pass: a message sent then made the home's, and its attachments, drop without a word).
  const [preparing, setPreparing] = useState(false);
  // THE SPACE'S FILES (delivery 2, spec §6.2): what the agents keep, in the Code lens, beside the chat.
  const [files, setFiles] = useState(false);
  const codeViewLabels = useCodeViewLabels("space");
  // The space has agents, never a page: its box and its empty screen say so, with the home’s five jobs (delivery 1/2
  // deferred minor, seen in the walk).
  const emptyState = {
    title: t("space.emptyTitle"),
    subtitle: t("space.emptySubtitle"),
    suggestions: AGENT_JOBS.map((job) => ({ key: job, label: t(`start.kind.agentJobs.${job}`), text: t(`start.kind.agentJobs.${job}Prompt`) })),
  };
  // Read once: the ticket is spent on the first read, and a second effect run (React's development double-run) must
  // not turn the send into a fill.
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const first = startOf(arrivalBrief, draft);
    // Through the router, not history.replaceState: the refresh after Len's turn put the old address back (walked with
    // a real turn, 20/11), and a reload then filled the box with the brief again.
    if (arrivalBrief || draft) router.replace(spaceHref(), { scroll: false });
    if (!first?.send) {
      setStart(first);
      return;
    }
    // The home's send: what it attached goes with it (delivery 1 deferred it, and it was lost on the way).
    setPreparing(true);
    void fromTheHome(projectId)
      .then(({ attachments, photosFailed, filesFailed }) => {
        if (photosFailed > 0) toast.error(tp("toast.photosNotUploaded", { count: photosFailed }));
        if (filesFailed > 0) toast.error(tp("toast.filesNotUploaded", { count: filesFailed }));
        setStart({ ...first, attachments });
      })
      // Reading what was left failed: the message still goes, alone, as on /new.
      .catch(() => setStart(first))
      .finally(() => setPreparing(false));
  }, [arrivalBrief, draft, router, projectId, toast, tp]);

  return (
      <div className="workspace-v2 relative h-dvh" data-space="">
        <div className="flex h-full flex-col bg-app">
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          <Link
            href="/"
            data-space-home=""
            aria-label={t("space.home")}
            title={t("space.home")}
            className="flex h-8 w-8 items-center justify-center rounded-full fg-muted transition-colors hover:bg-hover hover:fg"
          >
            <ArrowLeft size={17} aria-hidden="true" />
          </Link>
          <h1 className="text-[13.5px] font-semibold fg">{t("space.title")}</h1>
          <button
            type="button"
            data-space-files-toggle=""
            aria-pressed={files}
            onClick={() => setFiles((v) => !v)}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] fg-muted transition-colors hover:bg-hover hover:fg"
          >
            <FolderOpen size={15} aria-hidden="true" />
            {t("space.files")}
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {preparing ? (
            <div data-space-preparing="" role="status" aria-live="polite" className="m-auto grid justify-items-center gap-3 text-[13.5px] fg-muted">
              <CaraDeLen estado="pensando" props="compact" className="h-[64px] w-[64px]" />
              {t("space.preparing")}
            </div>
          ) : (
          <NewChatPanel
            flatProjectId={projectId}
            flatProjectHtml=""
            onFlatHtmlUpdate={noCanvas}
            flatProjectChat={initialChat}
            centered
            pendingDraft={start?.text ?? null}
            pendingDraftAutoSend={start?.send === true}
            pendingAttachments={start?.attachments ?? null}
            onPendingDraftConsumed={() => setStart(null)}
            disclaimer={t("space.disclaimer")}
            placeholder={t("space.placeholder")}
            emptyState={emptyState}
            noPage
          />
          )}
        </div>
        {/* Beside the chat on a wide screen; over it on a phone. The lens fills its box (it is absolute inset-0). */}
        {files && (
          <div className="absolute inset-0 z-30 md:relative md:inset-auto md:w-1/2 md:shrink-0 md:border-l bd" data-space-files="">
            <CodeView html="" projectId={projectId} rutaActual={null} space onClose={() => setFiles(false)} labels={codeViewLabels} />
          </div>
        )}
        </div>
        </div>
      </div>
  );
}
