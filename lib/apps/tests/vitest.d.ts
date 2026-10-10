// Los tipos de `vitest` tal como lo da OpenLen a las pruebas de una app
// (lib/apps/tests/vitest-runtime.js): los de @vitest/expect y @vitest/spy, más
// el corredor, `vi` y los globales. Lo lee el comprobador (plan 03) desde el
// types.json del kit de pruebas (plan 04).
import type { Assertion, ExpectStatic } from "@vitest/expect";
import type { Mock, MockInstance } from "@vitest/spy";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "@vitest/expect" {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}

type Awaitable<T> = T | PromiseLike<T>;
type TestFunction = () => Awaitable<unknown>;
type TestOptions = { timeout?: number };
interface TestAPI {
  (name: string, fn?: TestFunction, timeout?: number | TestOptions): void;
  (name: string, options: TestOptions, fn?: TestFunction): void;
  skip: TestAPI;
  only: TestAPI;
  todo(name: string): void;
  skipIf(condition: unknown): TestAPI;
  runIf(condition: unknown): TestAPI;
  concurrent: TestAPI;
  sequential: TestAPI;
  each<T extends readonly unknown[] | unknown>(cases: readonly T[]): (name: string, fn: (...args: T extends readonly unknown[] ? T : [T]) => Awaitable<unknown>, timeout?: number) => void;
}
interface SuiteAPI {
  (name: string, fn?: () => void): void;
  skip: SuiteAPI;
  only: SuiteAPI;
  todo(name: string): void;
  skipIf(condition: unknown): SuiteAPI;
  runIf(condition: unknown): SuiteAPI;
  concurrent: SuiteAPI;
  sequential: SuiteAPI;
  each<T extends readonly unknown[] | unknown>(cases: readonly T[]): (name: string, fn: (...args: T extends readonly unknown[] ? T : [T]) => void) => void;
}
type Hook = (fn: () => Awaitable<unknown>, timeout?: number) => void;

export type { Assertion, Mock, MockInstance };
export declare const expect: ExpectStatic;
export declare const assert: Chai.AssertStatic;
export declare const describe: SuiteAPI;
export declare const suite: SuiteAPI;
export declare const it: TestAPI;
export declare const test: TestAPI;
export declare const beforeAll: Hook;
export declare const afterAll: Hook;
export declare const beforeEach: Hook;
export declare const afterEach: Hook;

export declare const vi: {
  fn: typeof import("@vitest/spy").fn;
  spyOn: typeof import("@vitest/spy").spyOn;
  isMockFunction: typeof import("@vitest/spy").isMockFunction;
  mocked<T>(item: T, deep?: boolean): T extends (...args: any[]) => any ? Mock<T> : T;
  mock(path: string, factory?: (importOriginal: <M = any>() => Promise<M>) => Awaitable<Record<string, unknown>>): void;
  unmock(path: string): void;
  hoisted<T>(factory: () => T): T;
  clearAllMocks(): typeof vi;
  resetAllMocks(): typeof vi;
  restoreAllMocks(): typeof vi;
  useFakeTimers(config?: { now?: number | Date; toFake?: string[] }): typeof vi;
  useRealTimers(): typeof vi;
  isFakeTimers(): boolean;
  advanceTimersByTime(ms: number): typeof vi;
  advanceTimersByTimeAsync(ms: number): Promise<typeof vi>;
  advanceTimersToNextTimer(): typeof vi;
  runAllTimers(): typeof vi;
  runAllTimersAsync(): Promise<typeof vi>;
  runOnlyPendingTimers(): typeof vi;
  getTimerCount(): number;
  setSystemTime(time: number | string | Date): typeof vi;
  getRealSystemTime(): number;
  stubGlobal(name: string, value: unknown): typeof vi;
  unstubAllGlobals(): typeof vi;
  waitFor<T>(callback: () => Awaitable<T>, options?: number | { timeout?: number; interval?: number }): Promise<T>;
  waitUntil<T>(callback: () => Awaitable<T>, options?: number | { timeout?: number; interval?: number }): Promise<T>;
};

declare global {
  const describe: SuiteAPI;
  const suite: SuiteAPI;
  const it: TestAPI;
  const test: TestAPI;
  const expect: ExpectStatic;
  const vi: typeof import("vitest").vi;
  const beforeAll: Hook;
  const afterAll: Hook;
  const beforeEach: Hook;
  const afterEach: Hook;
}
