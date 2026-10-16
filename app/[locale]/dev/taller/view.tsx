"use client";

// The demo of /dev/taller: the same turn an app is born in, card by card.

import { useEffect, useState } from "react";

import "../../new/tokens.css";

import type { TodoItem, TodoStatus } from "@/lib/agent/todo-list";
import { workshopOf, type WorkshopAction } from "@/lib/workspace-v2/app-birth";
import { AppBirthWorkshop } from "@/components/workspace-v2/app-birth-workshop";

const STEPS = ["Las reglas del inventario", "La pantalla de inicio", "El formulario de entradas", "Probarla como una persona", "Revisarla en el teléfono"];

function list(...statuses: TodoStatus[]): WorkshopAction {
  const todos: TodoItem[] = statuses.map((status, i) => ({ content: STEPS[i]!, status }));
  return { tool: "todo_write", status: "done", summary: "", todos };
}
const running = (tool: string, summary = ""): WorkshopAction => ({ tool, status: "running", summary });

/** Each step is the turn's cards so far; the last one is the app ready. */
const DEMO: readonly (readonly WorkshopAction[])[] = [
  [],
  [list("in_progress", "pending", "pending", "pending", "pending")],
  [list("in_progress", "pending", "pending", "pending", "pending"), running("Read", "src/App.tsx")],
  [list("in_progress", "pending", "pending", "pending", "pending"), running("ask_user_question", "¿Qué productos vendes?")],
  [list("in_progress", "pending", "pending", "pending", "pending"), running("Write", "src/lib/inventory.ts")],
  [list("completed", "in_progress", "pending", "pending", "pending"), running("bash", "npm run build")],
  [list("completed", "in_progress", "pending", "pending", "pending"), running("Write", "src/screens/Home.tsx")],
  [list("completed", "completed", "completed", "in_progress", "pending"), running("use_page", "#/")],
  [list("completed", "completed", "completed", "completed", "in_progress"), running("view_page", "#/")],
  [list("completed", "completed", "completed", "completed", "completed")],
];

export function WorkshopPreview({ dark, step }: { dark: boolean; step: number | null }) {
  const [at, setAt] = useState(step ?? 0);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  useEffect(() => {
    if (step !== null) return;
    const id = window.setTimeout(() => {
      const next = (at + 1) % DEMO.length;
      if (next === 0) setStartedAt(Date.now());
      setAt(next);
    }, at === DEMO.length - 1 ? 3200 : 4600);
    return () => window.clearTimeout(id);
  }, [at, step]);
  const index = Math.min(at, DEMO.length - 1);
  return (
    <div className={dark ? "dark" : ""} style={{ width: "100vw", height: "100vh" }}>
      <div className="workspace-v2 relative h-full bg-preview-a">
        <AppBirthWorkshop
          view={workshopOf(DEMO[index]!)}
          finished={index === DEMO.length - 1}
          appName="Inventario de granos"
          startedAt={startedAt}
        />
      </div>
    </div>
  );
}
