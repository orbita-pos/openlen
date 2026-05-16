"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefForm, SAMPLE_BRIEF } from "@/components/workspace/brief-form";
import { EditPromptModal } from "@/components/workspace/edit-prompt-modal";
import { Header } from "@/components/workspace/header";
import { PreviewPanel } from "@/components/workspace/preview-panel";
import { useDarkMode } from "@/lib/use-dark-mode";
import { useGeneration } from "@/lib/use-generation";
import { cn } from "@/lib/cn";

export default function NewPage() {
  const [dark, toggleDark] = useDarkMode();
  const { state, generate, regenerateSection } = useGeneration();
  const [editTarget, setEditTarget] = useState<{
    sectionId: string;
    sectionName: string;
  } | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const [prompt, setPrompt] = useState(SAMPLE_BRIEF);
  const [projectName, setProjectName] = useState("Untitled");
  const [savedLabel, setSavedLabel] = useState("Saved 2 min ago");
  const [panelOpen, setPanelOpen] = useState(true);

  const generating = state.kind === "generating";
  const generated = state.kind === "generated";

  const handleGenerate = useCallback(() => {
    if (generating) return;
    const brief = prompt.trim();
    if (brief.length < 10) return;
    setSavedLabel("Saving…");
    void generate({ brief });
  }, [generating, prompt, generate]);

  useEffect(() => {
    if (state.kind === "generated") setSavedLabel("Saved just now");
  }, [state.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleGenerate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleGenerate]);

  const handleDownloadZip = useCallback(async () => {
    if (state.kind !== "generated" || downloadingZip) return;
    setDownloadingZip(true);
    try {
      const response = await fetch("/api/export/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.result),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        // eslint-disable-next-line no-alert
        alert(`Couldn't build the zip: ${text}`);
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "landing-page.zip";
      triggerBlobDownload(blob, filename);
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Couldn't build the zip: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloadingZip(false);
    }
  }, [state, downloadingZip]);

  const cost = state.kind === "generated" ? state.result.cost : undefined;
  const formState = useMemo(
    () => ({ prompt, setPrompt }),
    [prompt],
  );

  return (
    <div className="md:h-screen flex flex-col min-h-screen md:min-h-0">
      <Header
        saved={!generating}
        savedLabel={generating ? "Saving…" : savedLabel}
        dark={dark}
        onToggleDark={toggleDark}
        projectName={projectName}
        onRename={setProjectName}
        generated={generated}
        totalCost={cost?.total}
        onDownloadZip={generated ? handleDownloadZip : undefined}
        downloadingZip={downloadingZip}
      />
      <div
        className={cn(
          "flex-1 min-h-0 grid grid-cols-1 transition-[grid-template-columns] duration-300 ease-out",
          panelOpen
            ? "md:grid-cols-[minmax(340px,40%)_minmax(0,1fr)]"
            : "md:grid-cols-[0_minmax(0,1fr)]",
        )}
      >
        <div
          className={cn(
            "min-w-0 min-h-0 overflow-hidden transition-opacity duration-200",
            !panelOpen && "md:opacity-0 md:pointer-events-none",
          )}
        >
          <BriefForm
            state={formState}
            onGenerate={handleGenerate}
            generating={generating}
            onCollapse={() => setPanelOpen(false)}
          />
        </div>
        <div className="flex flex-col min-w-0 min-h-0 overflow-hidden">
          <PreviewPanel
            state={state}
            panelOpen={panelOpen}
            onOpenPanel={() => setPanelOpen(true)}
            onRegenSection={(sectionId, sectionName) =>
              void regenerateSection({ sectionId, sectionName, mode: "regen" })
            }
            onEditSection={(sectionId, sectionName) =>
              setEditTarget({ sectionId, sectionName })
            }
          />
        </div>
      </div>
      {editTarget && (
        <EditPromptModal
          sectionName={editTarget.sectionName}
          onCancel={() => setEditTarget(null)}
          onApply={(instruction) => {
            const { sectionId, sectionName } = editTarget;
            setEditTarget(null);
            void regenerateSection({
              sectionId,
              sectionName,
              additionalInstruction: instruction,
              mode: "edit",
            });
          }}
        />
      )}
    </div>
  );
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

