/**
 * DROPPING FILES ON THE CHAT OR THE START SCREEN (spec local 2026-10-27-chat-drop-and-images,
 * Part A). Only a drag that carries FILES from outside counts: text, an image dragged inside the
 * page (Chromium lists it as "Files" too), or a drop a portaled dialog already handled (the image
 * picker has its own drop zone) pass through untouched. The enter/leave of the children under the
 * pointer are counted, so the overlay doesn't flicker on its way across.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type DragEventHandler } from "react";

/** A drag that began in this document: nothing a person brought from outside. */
let dragFromPage = false;
let listeners = 0;
const onDragStart = () => void (dragFromPage = true);
const onDragEnd = () => void (dragFromPage = false);

const fromOutside = (e: DragEvent) =>
  !dragFromPage &&
  !e.defaultPrevented &&
  Array.from(e.dataTransfer?.types ?? []).includes("Files") &&
  // React bubbles through portals; a dialog's drop zone isn't the chat's.
  e.currentTarget.contains(e.target as Node);

export function useFileDrop(o: { enabled: boolean; onFiles: (files: File[]) => void }): {
  dragging: boolean;
  handlers: { onDragEnter: DragEventHandler; onDragOver: DragEventHandler; onDragLeave: DragEventHandler; onDrop: DragEventHandler };
} {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const { enabled, onFiles } = o;

  useEffect(() => {
    if (listeners++ === 0) {
      window.addEventListener("dragstart", onDragStart, true);
      window.addEventListener("dragend", onDragEnd, true);
    }
    return () => {
      if (--listeners === 0) {
        window.removeEventListener("dragstart", onDragStart, true);
        window.removeEventListener("dragend", onDragEnd, true);
        dragFromPage = false;
      }
    };
  }, []);

  const onDragEnter = useCallback<DragEventHandler>(
    (e) => {
      if (!enabled || !fromOutside(e)) return;
      depth.current += 1;
      setDragging(true);
    },
    [enabled],
  );
  const onDragOver = useCallback<DragEventHandler>(
    (e) => {
      if (!enabled || !fromOutside(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [enabled],
  );
  const onDragLeave = useCallback<DragEventHandler>(
    (e) => {
      if (!enabled || !fromOutside(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    [enabled],
  );
  const onDrop = useCallback<DragEventHandler>(
    (e) => {
      if (!enabled || !fromOutside(e)) return;
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
