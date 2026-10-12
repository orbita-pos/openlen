// lib/functions/engines/local.ts — EL MOTOR `local` (spec local 2026-10-11,
// Parte 2): el paquete en una carpeta temporal y un worker_thread por destino,
// con SÓLO sus variables (`env` de Worker) y su tope de memoria. Se pasa de
// tiempo → se termina el hilo (como Lambda mata su contenedor) y la siguiente
// llamada arranca otro. Para desarrollo, pruebas y autohospedaje de UN dueño:
// el código corre en el proceso de la app.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { FrameQueue } from "../frame-queue";
import { destinationName, type Destination, type EngineBundle, type EngineLimits, type Frame, type FunctionsEngine, type InvokeEvent } from "./types";

const HILO = path.join(process.cwd(), "lib", "functions", "engines", "local-worker.mjs");
const RAIZ = path.join(os.tmpdir(), "openlen-functions");

interface Slot {
  readonly hash: string;
  readonly dir: string;
  readonly env: Readonly<Record<string, string>>;
  readonly limits: EngineLimits;
  worker: Worker | null;
  nextId: number;
  readonly listeners: Map<number, FrameQueue<Frame>>;
}

export class LocalEngine implements FunctionsEngine {
  readonly name = "local" as const;
  readonly #slots = new Map<string, Slot>();

  async deploy(dest: Destination, bundle: EngineBundle, env: Readonly<Record<string, string>>, limits: EngineLimits): Promise<void> {
    const nombre = destinationName(dest);
    const dir = path.join(RAIZ, nombre, bundle.hash);
    for (const [f, texto] of Object.entries(bundle.files)) {
      const destino = path.join(dir, f);
      mkdirSync(path.dirname(destino), { recursive: true });
      writeFileSync(destino, texto);
    }
    const viejo = this.#slots.get(nombre);
    this.#slots.set(nombre, { hash: bundle.hash, dir, env: { ...env }, limits, worker: null, nextId: 0, listeners: new Map() });
    if (viejo) {
      this.#kill(viejo, "uncaught", "the function was redeployed");
      if (viejo.dir !== dir) rmSync(viejo.dir, { recursive: true, force: true });
    }
  }

  async deployedHash(dest: Destination): Promise<string | null> {
    return this.#slots.get(destinationName(dest))?.hash ?? null;
  }

  async setEnv(dest: Destination, env: Readonly<Record<string, string>>): Promise<void> {
    const nombre = destinationName(dest);
    const viejo = this.#slots.get(nombre);
    if (!viejo) return;
    // Mismo código y misma carpeta; OTRO hilo para lo que llegue. Las llamadas
    // en curso acaban en el suyo, con lo de antes: cambiar un secreto no corta
    // el streaming de nadie (Lambda tampoco corta lo que corre).
    this.#slots.set(nombre, { hash: viejo.hash, dir: viejo.dir, env: { ...env }, limits: viejo.limits, worker: null, nextId: 0, listeners: new Map() });
    this.#retire(viejo);
  }

  async *invoke(dest: Destination, event: InvokeEvent, o: { readonly timeoutMs: number }): AsyncIterable<Frame> {
    const nombre = destinationName(dest);
    const slot = this.#slots.get(nombre);
    if (!slot) {
      yield { t: "error", kind: "not_found" };
      return;
    }
    const w = this.#workerOf(slot);
    const id = ++slot.nextId;
    const q = new FrameQueue<Frame>();
    slot.listeners.set(id, q);
    const timer = setTimeout(() => {
      q.push({ t: "error", kind: "timeout" });
      q.close();
      slot.listeners.delete(id);
      this.#kill(slot, "uncaught", "another call on this worker timed out");
    }, o.timeoutMs);
    w.postMessage({ id, event });
    try {
      for await (const f of q) {
        yield f;
        if (f.t === "end") break;
      }
    } finally {
      clearTimeout(timer);
      slot.listeners.delete(id);
      // Un hilo retirado por `setEnv` se apaga al acabar su última llamada.
      if (this.#slots.get(nombre) !== slot) this.#retire(slot);
    }
  }

  async remove(dest: Destination): Promise<void> {
    const nombre = destinationName(dest);
    const slot = this.#slots.get(nombre);
    if (!slot) return;
    this.#slots.delete(nombre);
    this.#kill(slot, "not_found", null);
    rmSync(slot.dir, { recursive: true, force: true });
  }

  /** Para las pruebas y el apagado. */
  async stopAll(): Promise<void> {
    for (const [nombre, slot] of this.#slots) {
      this.#slots.delete(nombre);
      this.#kill(slot, "uncaught", "the engine stopped");
      rmSync(slot.dir, { recursive: true, force: true });
    }
  }

  #workerOf(slot: Slot): Worker {
    if (slot.worker) return slot.worker;
    const w = new Worker(HILO, {
      workerData: { entry: pathToFileURL(path.join(slot.dir, "index.mjs")).href },
      env: { ...slot.env },
      resourceLimits: { maxOldGenerationSizeMb: slot.limits.memoryMb },
      stdout: true,
      stderr: true,
    });
    // Lo que el código escribe FUERA de una llamada no es de nadie: se tira.
    w.stdout.resume();
    w.stderr.resume();
    w.on("message", (m: { id: number; frame: Frame }) => {
      const q = slot.listeners.get(m.id);
      if (!q) return;
      q.push(m.frame);
      if (m.frame.t === "end") q.close();
    });
    w.on("error", (e: Error & { code?: string }) => {
      if (slot.worker !== w) return;
      const kind = e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "boot";
      this.#kill(slot, kind, e.message);
    });
    w.on("exit", () => {
      if (slot.worker === w) this.#kill(slot, "uncaught", "the function's worker stopped");
    });
    w.unref();
    slot.worker = w;
    return w;
  }

  /** Apaga el hilo de un hueco que ya no es el de su destino, si no le queda nada en curso. */
  #retire(slot: Slot): void {
    if (slot.listeners.size > 0) return;
    const w = slot.worker;
    slot.worker = null;
    void w?.terminate();
  }

  /** El hilo fuera; lo que esperaba, con su error y su fin. */
  #kill(slot: Slot, kind: "uncaught" | "boot" | "memory" | "not_found", message: string | null): void {
    const w = slot.worker;
    slot.worker = null;
    for (const [id, q] of slot.listeners) {
      q.push(kind === "not_found" ? { t: "error", kind } : { t: "error", kind, ...(message ? { message } : {}) });
      q.push({ t: "end", ms: 0 });
      q.close();
      slot.listeners.delete(id);
    }
    void w?.terminate();
  }
}
