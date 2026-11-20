"use client";

// WHETHER A/B TESTING IS ON HERE (review item 28): the chat's A/B cards ask GET /api/ab once. Off until the server says
// «on» — a network failure leaves it off and the next chat to open asks again — so with the flag off no chat polls anything.
import { useEffect, useState } from "react";

export function useAbAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetch("/api/ab", { cache: "no-store" })
      .then((res) => {
        if (alive) setAvailable(res.ok);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return available;
}
