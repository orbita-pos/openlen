import { expect, it } from "vitest";
import { LONG_SLEEP_SECONDS, longSleep, longSleepRefusal } from "./sleep-rule";

it("names a long sleep that opens the command, alone or followed by something", () => {
  expect(longSleep("sleep 180")).toBe("standalone sleep 180");
  expect(longSleep("sleep 180; echo listo")).toBe("sleep 180 followed by: echo listo");
  expect(longSleep("sleep 30 && curl /x")).toBe("sleep 30 followed by: curl /x");
  expect(longSleep(`sleep ${LONG_SLEEP_SECONDS}`)).toBe(`standalone sleep ${LONG_SLEEP_SECONDS}`);
});

it("lets short sleeps, sleeps inside other commands and the word in quotes through", () => {
  expect(longSleep("sleep 2")).toBeNull();
  expect(longSleep(`sleep ${LONG_SLEEP_SECONDS - 1}.5`)).toBeNull();
  expect(longSleep("echo hola; sleep 180")).toBeNull();
  expect(longSleep("echo 'sleep 180'")).toBeNull();
  expect(longSleep("sleep 1m")).toBeNull();
});

it("says what to do instead: a render is waited for with inspect_artifact, not with time", () => {
  const withRenders = longSleepRefusal("sleep 180 followed by: echo listo", true);
  expect(withRenders).toMatch(/^Not run: sleep 180 followed by: echo listo\./);
  expect(withRenders).toMatch(/inspect_artifact.*wait_ms/);
  expect(withRenders).toMatch(/shorter sleeps/);
  expect(longSleepRefusal("standalone sleep 60", false)).not.toMatch(/inspect_artifact/);
});
