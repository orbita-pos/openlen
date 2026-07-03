import type { LimitWindow } from "@/lib/limits";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Anti-spam for anonymous /explore reports. Loose windows — a genuine reporter
// files one or two; a flooder gets throttled. IP-keyed via ipLimitKey.
// SOFT caps (the limiter is count-then-insert, no transaction) — a couple of
// extra reports during a race are harmless; admin-hide is the real net.
export const REPORT_LIMITS: LimitWindow[] = [
  { windowMs: MINUTE, max: 5, label: "cooldown" },
  { windowMs: HOUR, max: 40, label: "hourly" },
];
