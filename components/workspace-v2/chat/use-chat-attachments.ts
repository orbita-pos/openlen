/**
 * THE CHAT'S UPLOADS IN FLIGHT (spec local 2026-10-27-chat-drop-and-images, Part A): what is
 * dropped, pasted or picked goes through `classifyDroppedFiles`, and each accepted file is a
 * pending chip until `/api/upload` answers — the same uploads as the `+` (`uploadAttachment`,
 * `uploadChatPhoto`). The limits count what is still on its way; a chip's × drops its upload's
 * result; what is left out is said once per reason, by name. The texts come in from the caller,
 * so this is tested without a translations provider.
 */
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { MAX_FILES_PER_MESSAGE, type AttachedFile } from "@/lib/projects/chat-files";
import { MAX_PHOTOS_PER_MESSAGE } from "@/lib/projects/chat-photos";
import { classifyDroppedFiles, type DropRejectReason } from "@/lib/workspace-v2/classify-dropped-files";
import { uploadAttachment, uploadChatPhoto } from "@/lib/workspace-v2/upload-attachment";
import type { AttachedImage } from "./use-agent-chat";

/** A file dropped, pasted or picked that is still uploading: its chip in the composer. */
export interface PendingUpload {
  readonly id: string;
  readonly name: string;
  readonly kind: "photo" | "file";
}

export interface ChatAttachmentMessages {
  notSupported(names: string): string;
  tooBig(names: string): string;
  limit(count: number): string;
  failed(name: string): string;
}

export function useChatAttachments(o: {
  projectId: string;
  images: readonly AttachedImage[];
  setImages: Dispatch<SetStateAction<readonly AttachedImage[]>>;
  files: readonly AttachedFile[];
  setFiles: Dispatch<SetStateAction<readonly AttachedFile[]>>;
  notify: (message: string) => void;
  messages: ChatAttachmentMessages;
  upload?: { photo?: typeof uploadChatPhoto; file?: typeof uploadAttachment };
}): { pending: readonly PendingUpload[]; addFiles: (files: readonly File[]) => void; cancel: (id: string) => void } {
  const [pending, setPending] = useState<readonly PendingUpload[]>([]);
  // The ids still wanted: a cancelled one's result is thrown away when it lands.
  const live = useRef(new Set<string>());
  // Read at drop time without waiting for a render: two quick drops see each other.
  const pendingRef = useRef<readonly PendingUpload[]>([]);
  const setBoth = (next: (p: readonly PendingUpload[]) => readonly PendingUpload[]) => {
    pendingRef.current = next(pendingRef.current);
    setPending(pendingRef.current);
  };

  const { projectId, images, files, setImages, setFiles, notify, messages } = o;
  const uploadPhoto = o.upload?.photo ?? uploadChatPhoto;
  const uploadFile = o.upload?.file ?? uploadAttachment;

  const addFiles = useCallback(
    (dropped: readonly File[]) => {
      if (dropped.length === 0) return;
      const inFlight = pendingRef.current;
      const room = {
        photos: Math.max(0, MAX_PHOTOS_PER_MESSAGE - images.length - inFlight.filter((p) => p.kind === "photo").length),
        files: Math.max(0, MAX_FILES_PER_MESSAGE - files.length - inFlight.filter((p) => p.kind === "file").length),
      };
      const c = classifyDroppedFiles(dropped, room);
      const by = (reason: DropRejectReason) => c.rejected.filter((r) => r.reason === reason).map((r) => r.name);
      if (by("not_supported").length) notify(messages.notSupported(by("not_supported").join(", ")));
      if (by("too_big").length) notify(messages.tooBig(by("too_big").join(", ")));
      if (by("limit").length) notify(messages.limit(by("limit").length));

      const start = (file: File, kind: PendingUpload["kind"]) => {
        const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `up-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        live.current.add(id);
        setBoth((p) => [...p, { id, name: file.name, kind }]);
        const done = () => {
          const wanted = live.current.delete(id);
          setBoth((p) => p.filter((x) => x.id !== id));
          return wanted;
        };
        if (kind === "photo") {
          void uploadPhoto(file, projectId).then((r) => {
            if (!done()) return;
            if (r.ok) setImages((prev) => [...prev, r.image].slice(0, MAX_PHOTOS_PER_MESSAGE));
            else notify(messages.failed(file.name));
          });
        } else {
          void uploadFile(file, projectId).then((r) => {
            if (!done()) return;
            if (r.ok) setFiles((prev) => [...prev, r.file].slice(0, MAX_FILES_PER_MESSAGE));
            else notify(messages.failed(file.name));
          });
        }
      };
      for (const f of c.photos) start(f, "photo");
      for (const f of c.files) start(f, "file");
    },
    [projectId, images.length, files.length, setImages, setFiles, notify, messages, uploadPhoto, uploadFile],
  );

  const cancel = useCallback((id: string) => {
    live.current.delete(id);
    setBoth((p) => p.filter((x) => x.id !== id));
  }, []);

  return { pending, addFiles, cancel };
}
