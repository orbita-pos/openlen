"use client";

// A TOOL, FRAMED IN THE WORKSPACE (spec local 2026-11-04-herramientas-hechas-por-len, §4.3, §4.4): its private `.app`
// host in an iframe — isolated like the canvas (`SANDBOX_REMOTO`), never on openlen.com — with the workspace
// answering its bridge, and OpenLen's confirmation mounted when it asks to write production; and, for its jobs and
// files (§4.6), OpenLen's confirmation, its file picker and the line of each running job.
import { useCallback, useRef, useState, type RefObject } from "react";

import type { ToolContext } from "@/lib/tools/bridge/protocol";

import { ALLOW_REMOTO, SANDBOX_REMOTO } from "../sandbox-del-lienzo";
import { DataChangeDialog, type ToolDataChange } from "./data-change-dialog";
import { useToolBridgeHost, type BridgeHostCaller } from "./use-tool-bridge-host";
import { useToolDialogs } from "./use-tool-dialogs";

export function ToolFrame({
  src,
  frameOrigin,
  caller,
  context,
  onPrompt,
  title,
  projectTitle,
  theme,
  frameRef,
}: {
  src: string;
  frameOrigin: string;
  caller: BridgeHostCaller;
  context: Omit<ToolContext, "theme">;
  onPrompt: ((text: string) => void) | null;
  title: string;
  /** The title the confirmation names for the project a change targets; its id when unknown. */
  projectTitle?: (projectId: string) => string;
  /** The colours the tool is given; the workspace's own tokens when absent (an app on the desktop gives its own). */
  theme?: () => ToolContext["theme"];
  /** The frame's element, for whoever else answers it (the desktop window's `window.openlenApp` host). */
  frameRef?: RefObject<HTMLIFrameElement | null>;
}) {
  const ownFrame = useRef<HTMLIFrameElement>(null);
  const iframe = frameRef ?? ownFrame;
  const [asking, setAsking] = useState<{ change: ToolDataChange; resolve: (ok: boolean) => void } | null>(null);

  const onConfirmChange = useCallback(
    (change: ToolDataChange) =>
      new Promise<boolean>((resolve) => {
        setAsking((prev) => {
          prev?.resolve(false);
          return { change, resolve };
        });
      }),
    [],
  );
  const settle = (ok: boolean) => {
    asking?.resolve(ok);
    setAsking(null);
  };

  const tools = useToolDialogs({ toolTitle: title, locale: context.person.locale, caller });
  useToolBridgeHost({
    iframe,
    frameOrigin,
    caller,
    context,
    onPrompt,
    onConfirmChange,
    onConfirmJob: tools.onConfirmJob,
    onPickFiles: tools.onPickFiles,
    onJobStarted: tools.onJobStarted,
    theme,
  });

  const nameOf = (change: ToolDataChange) => change.projectTitle ?? projectTitle?.(change.projectId) ?? change.projectId;
  return (
    <div className="relative h-full w-full">
      <iframe ref={iframe} src={src} title={title} sandbox={SANDBOX_REMOTO} allow={ALLOW_REMOTO} className="h-full w-full border-0 bg-[var(--bg)]" data-tool-frame={caller && "installationId" in caller ? caller.installationId : caller && "lenArtifactId" in caller ? caller.lenArtifactId : "draft"} />
      {asking ? (
        <DataChangeDialog
          open
          toolTitle={title}
          projectTitle={nameOf(asking.change)}
          change={asking.change}
          onAccept={() => settle(true)}
          onCancel={() => settle(false)}
        />
      ) : null}
      {tools.dialogs}
    </div>
  );
}
