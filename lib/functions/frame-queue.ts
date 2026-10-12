// lib/functions/frame-queue.ts — UNA COLA ASÍNCRONA de marcos: el motor empuja
// lo que llega de su hilo (o de Lambda) y la puerta lo lee como `for await`.
// Varios `next()` a la vez esperan en orden (la puerta lee desde `pull` del
// cuerpo y, si el visitante corta, desde `cancel`).

export class FrameQueue<T> implements AsyncIterable<T> {
  readonly #items: T[] = [];
  readonly #waiters: ((r: IteratorResult<T>) => void)[] = [];
  #closed = false;

  push(item: T): void {
    if (this.#closed) return;
    const w = this.#waiters.shift();
    if (w) w({ value: item, done: false });
    else this.#items.push(item);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const w of this.#waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.#items.length > 0) return Promise.resolve({ value: this.#items.shift()!, done: false });
        if (this.#closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}
