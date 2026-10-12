"use client";

import { useEffect, useState } from "react";

/** Dos clics: el primero arma, el segundo hace. Sin diálogo nativo. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  icon,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={armed ? confirmLabel : label}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      className={`inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] transition disabled:opacity-40 ${
        armed ? "bg-red-500 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-900"
      }`}
    >
      {icon}
      {armed && <span>{confirmLabel}</span>}
    </button>
  );
}
