// A least-recently-used cache of git objects, capped by BYTES: objects never change, so a hit is
// always right, but a count cap would let a few thousand half-megabyte pages fill the box's memory.
import type { GitObject } from "./objects";

export class ObjectCache {
  private readonly entries = new Map<string, GitObject>();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  get totalBytes(): number {
    return this.bytes;
  }

  get(key: string): GitObject | undefined {
    const found = this.entries.get(key);
    if (found) {
      // Most recently used goes last; eviction takes from the front.
      this.entries.delete(key);
      this.entries.set(key, found);
    }
    return found;
  }

  set(key: string, object: GitObject): void {
    if (object.content.byteLength > this.maxBytes) return;
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.bytes -= previous.content.byteLength;
    }
    this.entries.set(key, object);
    this.bytes += object.content.byteLength;
    while (this.bytes > this.maxBytes) {
      const [oldestKey, oldest] = this.entries.entries().next().value!;
      this.entries.delete(oldestKey);
      this.bytes -= oldest.content.byteLength;
    }
  }
}
