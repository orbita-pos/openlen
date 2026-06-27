"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type PushState =
  | "loading"
  | "unsupported"
  | "ios-needs-install"
  | "default"
  | "denied"
  | "subscribed";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

export function PushActivation() {
  const t = useTranslations("inbox");

  const [state, setState] = useState<PushState>("loading");
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

    if (!supported) {
      setState("unsupported");
      return;
    }

    // iOS not-standalone check
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).standalone === true;

    if (isIos && !isStandalone) {
      setState("ios-needs-install");
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");

        const res = await fetch("/api/inbox/push/state");
        if (!res.ok) return;
        const data = (await res.json()) as {
          vapidPublicKey: string | null;
          subscribed: boolean;
        };

        if (cancelled) return;

        setVapidKey(data.vapidPublicKey);
        setRegistration(reg);

        const existingSub = await reg.pushManager.getSubscription();
        if (cancelled) return;

        if (existingSub) {
          setSubscription(existingSub);
          setState("subscribed");
          return;
        }

        const perm = Notification.permission;
        if (perm === "denied") {
          setState("denied");
        } else {
          setState("default");
        }
      } catch {
        // If registration fails, treat as unsupported
        if (!cancelled) setState("unsupported");
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleActivate() {
    if (!registration || !vapidKey) return;

    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;

    try {
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      await fetch("/api/inbox/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setSubscription(sub);
      setState("subscribed");
    } catch {
      // User may have blocked after the prompt — re-read permission
      if (Notification.permission === "denied") setState("denied");
    }
  }

  async function handleUnsubscribe() {
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await fetch("/api/inbox/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    setSubscription(null);
    setState("default");
  }

  if (state === "loading") return null;

  return (
    <div className="mx-4 mb-3 mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-[13px] dark:border-zinc-800 dark:bg-zinc-900/60">
      {state === "unsupported" && (
        <p className="text-zinc-500 dark:text-zinc-400">
          {t("push.unsupported")}
        </p>
      )}

      {state === "ios-needs-install" && (
        <>
          <p className="font-medium text-zinc-700 dark:text-zinc-300">
            {t("push.legend")}
          </p>
          <p className="mt-1 text-zinc-500 dark:text-zinc-400">
            {t("push.iosInstall")}
          </p>
        </>
      )}

      {state === "default" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-zinc-600 dark:text-zinc-400">{t("push.legend")}</p>
          <button
            type="button"
            onClick={handleActivate}
            className="shrink-0 rounded-lg bg-coral-500 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-coral-600 active:scale-95"
          >
            {t("push.activate")}
          </button>
        </div>
      )}

      {state === "denied" && (
        <p className="text-zinc-500 dark:text-zinc-400">{t("push.blocked")}</p>
      )}

      {state === "subscribed" && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-zinc-700 dark:text-zinc-300">
            {t("push.activeThisDevice")}
          </p>
          <button
            type="button"
            onClick={handleUnsubscribe}
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-[12px] text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {t("push.turnOff")}
          </button>
        </div>
      )}
    </div>
  );
}
