/**
 * EL PLANIFICADOR DE LAS LLAMADAS DE UNA VUELTA — pieza 4 de Len 2.5, el de
 * DeepSeek (`deepseek-harness` @ 5badb15, MIT, LICENSES/deepseek-harness.MIT.txt:
 * `packages/core/agent-loop/src/tool-calls.ts`, `executeToolCalls` y `runGroup`).
 *
 * Las seguras seguidas (`isParallel`, ver `tool-concurrency.ts`) forman un
 * grupo con un pool RODANTE de `maxParallel`; cada exclusiva es un grupo de una
 * y una barrera. Sólo se solapa el cuerpo: las guardas (`prepare`) y lo de
 * después (`commit`) van en el orden del modelo, y un resultado rápido espera
 * detrás de uno lento anterior. Antes de reponer el pool se reclasifica la
 * siguiente. Con el ■ no se repone: se esperan las empezadas, se confirman en
 * orden y las demás reciben `skip`, en orden. Un fallo deja de empezar, espera
 * a todas las empezadas y relanza el primero.
 *
 * Lo único nuestro es `"stop"` en `prepare`: el tope de acciones del turno.
 * Para como el ■ pero sin respuestas sintéticas: quien llama cierra el turno con
 * lo confirmado (`finishOnCap` del bucle).
 */

export type Prepared<V> =
  | { kind: "dispatch"; run: () => Promise<V> }
  | { kind: "result"; value: V }
  | { kind: "stop" };

export interface ScheduleOptions<C, V> {
  calls: readonly C[];
  isParallel(call: C): boolean;
  maxParallel: number;
  signal?: AbortSignal;
  prepare(call: C, index: number): Prepared<V> | Promise<Prepared<V>>;
  commit(call: C, index: number, value: V): void | Promise<void>;
  skip(call: C, index: number): void;
}

export interface ScheduleOutcome {
  aborted: boolean;
  stopped: boolean;
}

interface GroupOutcome extends ScheduleOutcome {
  /** La primera llamada que el grupo NO empezó. */
  end: number;
}

export async function scheduleToolCalls<C, V>(o: ScheduleOptions<C, V>): Promise<ScheduleOutcome> {
  const cap = Math.max(1, Math.floor(o.maxParallel) || 1);
  let next = 0;
  while (next < o.calls.length) {
    const g = await runGroup(o, next, o.isParallel(o.calls[next]), cap);
    next = g.end;
    if (g.aborted) {
      for (let i = next; i < o.calls.length; i++) o.skip(o.calls[i], i);
      return { aborted: true, stopped: false };
    }
    if (g.stopped) return { aborted: false, stopped: true };
  }
  return { aborted: false, stopped: false };
}

async function runGroup<C, V>(o: ScheduleOptions<C, V>, start: number, parallel: boolean, cap: number): Promise<GroupOutcome> {
  const limit = parallel ? cap : 1;
  const settled = new Map<number, V>();
  const inFlight = new Map<number, Promise<number>>();
  let nextToStart = start;
  let committed = start;
  let aborted = Boolean(o.signal?.aborted);
  let stopped = false;
  let failure: { error: unknown } | undefined;
  const throwFailure = (): void => {
    if (failure) throw failure.error;
  };

  // `committed` sólo avanza por huecos contiguos del orden del modelo.
  const commitReady = async (): Promise<void> => {
    while (settled.has(committed)) {
      const value = settled.get(committed) as V;
      settled.delete(committed);
      await o.commit(o.calls[committed], committed, value);
      committed++;
    }
  };

  /** false = `prepare` dijo `stop`. */
  const startCall = async (i: number): Promise<boolean> => {
    const prepared = await o.prepare(o.calls[i], i);
    if (prepared.kind === "stop") return false;
    if (prepared.kind === "result") {
      settled.set(i, prepared.value);
      return true;
    }
    inFlight.set(
      i,
      Promise.resolve()
        .then(prepared.run)
        .then(
          (value) => {
            settled.set(i, value);
            return i;
          },
          (error: unknown) => {
            failure ??= { error };
            return i;
          },
        ),
    );
    return true;
  };

  const fillPool = async (): Promise<void> => {
    while (!aborted && !stopped && nextToStart < o.calls.length && inFlight.size < limit) {
      // Reclasificar la siguiente antes de reponer: si ya no es segura, espera
      // a que se vacíe el pool y es la barrera del grupo siguiente.
      if (nextToStart > start && !(parallel && o.isParallel(o.calls[nextToStart]))) break;
      if (!(await startCall(nextToStart))) {
        stopped = true;
        break;
      }
      nextToStart++;
      throwFailure();
      await commitReady();
      // El ■ pudo llegar mientras la guarda esperaba.
      if (o.signal?.aborted) aborted = true;
    }
  };

  try {
    await fillPool();
    while (inFlight.size > 0) {
      const done = await Promise.race(inFlight.values());
      inFlight.delete(done);
      throwFailure();
      await commitReady();
      if (o.signal?.aborted) aborted = true;
      await fillPool();
    }
  } catch (error: unknown) {
    failure ??= { error };
    await Promise.allSettled(inFlight.values());
    throw failure.error;
  }
  return { end: nextToStart, aborted, stopped };
}
