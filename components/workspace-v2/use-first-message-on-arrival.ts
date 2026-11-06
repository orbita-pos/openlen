"use client";

import { useEffect, useRef } from "react";
import { takeFirstMessage, type FirstMessage } from "@/lib/marketing/first-message-in-transit";

/**
 * /new SENDS WHAT THE HOME SENT (Jesús, 06/11: «dos inputs así es duplicación»). Pressing send on the home leaves a
 * one-use ticket (`lib/marketing/first-message-in-transit.ts`); here, the first time the blank project's empty state
 * is open (`ready`), it is taken and `send` makes it the first message to Len — no second box, no second press.
 *
 * `arrivalBrief` is the `?brief=` this tab arrived with (the page keeps it from its first render: the URL loses it
 * when the blank project opens). Without a matching ticket — a link from elsewhere — nothing is sent and the brief
 * only fills the composer, as before. It runs once per visit: another blank project opened later sends nothing.
 */
export function useFirstMessageOnArrival({
  arrivalBrief,
  ready,
  send,
}: {
  arrivalBrief: string | null;
  ready: boolean;
  send: (message: FirstMessage) => void;
}): void {
  const taken = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!ready || taken.current) return;
    taken.current = true;
    const message = takeFirstMessage(arrivalBrief);
    if (message) sendRef.current(message);
  }, [ready, arrivalBrief]);
}
