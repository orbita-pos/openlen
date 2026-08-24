"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEventHandler,
  type ClipboardEventHandler,
} from "react";
import {
  GENERATION_BRIEF_MAX_LENGTH,
  applyGenerationBriefPaste,
  isGenerationBriefLengthValid,
  shouldShowGenerationBriefCounter,
} from "@/lib/generation/brief-contract";

interface TruncationMarker {
  value: string;
  announcement: string | null;
  source: "external" | "paste";
}

export interface UseGenerationBriefLimitOptions {
  value: string;
  onValueChange: (value: string) => void;
  externallyTruncatedValue?: string | null;
  onTruncatedValueChange?: (value: string | null) => void;
  externalAnnouncementToken?: string | null;
  onExternalAnnouncementTokenChange?: (token: string | null) => void;
}

export interface GenerationBriefLimitState {
  maxLength: number;
  isValid: boolean;
  showCounter: boolean;
  warningVisible: boolean;
  feedbackId: string;
  announcement: string | null;
  replaceValue: (value: string) => void;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
}

/** Shared state machine for every generation textarea. The warning belongs to
 *  one exact value and is consumed by a later valid edit/paste. */
export function useGenerationBriefLimit({
  value,
  onValueChange,
  externallyTruncatedValue = null,
  onTruncatedValueChange,
  externalAnnouncementToken = null,
  onExternalAnnouncementTokenChange,
}: UseGenerationBriefLimitOptions): GenerationBriefLimitState {
  const reactId = useId().replace(/:/g, "");
  const feedbackId = `generation-brief-limit-${reactId}`;
  const nextAnnouncement = useRef(1);
  const [marker, setMarker] = useState<TruncationMarker | null>(() =>
    externallyTruncatedValue === value
      ? {
          value,
          announcement: externalAnnouncementToken,
          source: "external",
        }
      : null,
  );

  useEffect(() => {
    if (
      externallyTruncatedValue !== null &&
      externallyTruncatedValue !== value
    ) {
      onTruncatedValueChange?.(null);
      onExternalAnnouncementTokenChange?.(null);
    }
    setMarker((current) => {
      if (externallyTruncatedValue === value) {
        if (current?.value === value) {
          if (
            externalAnnouncementToken !== null &&
            current.announcement !== externalAnnouncementToken
          ) {
            return {
              value,
              announcement: externalAnnouncementToken,
              source: "external",
            };
          }
          return current;
        }
        return {
          value,
          announcement: externalAnnouncementToken,
          source: "external",
        };
      }
      if (current?.source === "external" || (current && current.value !== value)) {
        return null;
      }
      return current;
    });
  }, [
    externalAnnouncementToken,
    externallyTruncatedValue,
    onExternalAnnouncementTokenChange,
    onTruncatedValueChange,
    value,
  ]);

  useEffect(() => {
    if (
      marker &&
      externalAnnouncementToken !== null &&
      marker.announcement === externalAnnouncementToken
    ) {
      onExternalAnnouncementTokenChange?.(null);
    }
  }, [
    externalAnnouncementToken,
    marker,
    onExternalAnnouncementTokenChange,
  ]);

  const replaceValue = useCallback(
    (nextValue: string) => {
      setMarker(null);
      onTruncatedValueChange?.(null);
      onExternalAnnouncementTokenChange?.(null);
      onValueChange(nextValue);
    },
    [
      onExternalAnnouncementTokenChange,
      onTruncatedValueChange,
      onValueChange,
    ],
  );

  const onChange = useCallback<ChangeEventHandler<HTMLTextAreaElement>>(
    (event) => replaceValue(event.currentTarget.value),
    [replaceValue],
  );

  const onPaste = useCallback<ClipboardEventHandler<HTMLTextAreaElement>>(
    (event) => {
      event.preventDefault();
      const textarea = event.currentTarget;
      const result = applyGenerationBriefPaste({
        value,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
        pastedText: event.clipboardData.getData("text"),
      });
      const announcement = result.truncated
        ? `${feedbackId}-paste-${nextAnnouncement.current++}`
        : null;
      setMarker(
        result.truncated
          ? {
              value: result.value,
              announcement,
              source: "paste",
            }
          : null,
      );
      onTruncatedValueChange?.(result.truncated ? result.value : null);
      onExternalAnnouncementTokenChange?.(announcement);
      onValueChange(result.value);
      queueMicrotask(() => {
        if (textarea.isConnected) {
          textarea.setSelectionRange(result.caret, result.caret);
        }
      });
    },
    [
      feedbackId,
      onExternalAnnouncementTokenChange,
      onTruncatedValueChange,
      onValueChange,
      value,
    ],
  );

  const warningVisible = marker?.value === value;
  return {
    maxLength: GENERATION_BRIEF_MAX_LENGTH,
    isValid: isGenerationBriefLengthValid(value),
    showCounter: shouldShowGenerationBriefCounter(value.length),
    warningVisible,
    feedbackId,
    announcement: warningVisible ? marker.announcement : null,
    replaceValue,
    onChange,
    onPaste,
  };
}

export function GenerationBriefLimitFeedback({
  valueLength,
  state,
  warningText,
  className = "",
  warningClassName = "",
  counterClassName = "",
}: {
  valueLength: number;
  state: GenerationBriefLimitState;
  warningText: string;
  className?: string;
  warningClassName?: string;
  counterClassName?: string;
}) {
  if (!state.warningVisible && !state.showCounter) return null;
  return (
    <>
      {state.warningVisible && (
        <div className={`${className} ${warningClassName}`.trim()}>
          <span id={state.feedbackId}>{warningText}</span>
          {state.announcement !== null && (
            <span
              key={state.announcement}
              role="status"
              aria-atomic="true"
              className="sr-only"
            >
              {warningText}
            </span>
          )}
        </div>
      )}
      {state.showCounter && (
        <div
          className={`${className} ${counterClassName}`.trim()}
          aria-live="off"
        >
          {valueLength} / {state.maxLength}
        </div>
      )}
    </>
  );
}
