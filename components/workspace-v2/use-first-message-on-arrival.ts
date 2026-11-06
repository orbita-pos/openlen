"use client";

import { useEffect, useRef } from "react";
import { takeFirstMessage, type FirstMessage } from "@/lib/marketing/first-message-in-transit";

/**
 * /new SENDS WHAT THE HOME SENT (Jesús, 06/11: «dos inputs así es duplicación»). Pressing send on the home leaves a
 * one-use ticket (`lib/marketing/first-message-in-transit.ts`); here, the first time the blank project is open
 * (`ready`), it is taken and `send` makes it the first message to Len — no second box, no second press.
 *
 * `arrivalBrief` is the `?brief=` this tab arrived with (the page keeps it from its first render: the URL loses it
 * when the blank project opens). It runs once per visit: another blank project opened later sends nothing.
 *
 * WITHOUT A TICKET THERE IS NOTHING TO DO HERE (Jesús, 06/11: «¿para qué tener 2 inputs?»): /new has no box of its
 * own any more, so a blank project reached any other way — a reload, a link, an old tab — calls `onNothing`, and the
 * page goes back to the home's box.
 */
export function useFirstMessageOnArrival({
  arrivalBrief,
  ready,
  send,
  onNothing,
}: {
  arrivalBrief: string | null;
  ready: boolean;
  send: (message: FirstMessage) => void;
  onNothing: () => void;
}): void {
  const taken = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const nothingRef = useRef(onNothing);
  nothingRef.current = onNothing;
  useEffect(() => {
    if (!ready || taken.current) return;
    taken.current = true;
    const message = takeFirstMessage(arrivalBrief);
    if (message) sendRef.current(message);
    else nothingRef.current();
  }, [ready, arrivalBrief]);
}
