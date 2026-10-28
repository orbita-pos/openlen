/**
 * DROPPING FILES ON THE CHAT OR THE START SCREEN (spec local 2026-10-27-chat-drop-and-images,
 * Part A). Only a drag that carries FILES counts: text, or something dragged inside the page,
 * passes through untouched. The enter/leave of the children under the pointer are counted, so
 * the overlay doesn't flicker on its way across.
 */
import { useCallback, useRef, useState, type DragEvent, type DragEventHandler } from "react";

const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

export function useFileDrop(o: { enabled: boolean; onFiles: (files: File[]) => void }): {
  dragging: boolean;
  handlers: { onDragEnter: DragEventHandler; onDragOver: DragEventHandler; onDragLeave: DragEventHandler; onDrop: DragEventHandler };
} {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const { enabled, onFiles } = o;

  const onDragEnter = useCallback<DragEventHandler>(
    (e) => {
      if (!enabled || !carriesFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    },
    [enabled],
  );
  const onDragOver = useCallback<DragEventHandler>(
    (e) => {
      if (!enabled || !carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [enabled],
  );
  const onDragLeave = useCallback<DragEventHandler>(
    (e) => {
      if (!enabled || !carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    [enabled],
  );
  const onDrop = useCallback<DragEventHandler>(
    (e) => {
      if (!enabled || !carriesFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [enabled, onFiles],
  );

  return { dragging: enabled && dragging, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
