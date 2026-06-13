// Validation for a bookable service's rules — shared by the owner create/update
// routes. Sane bounds keep a malformed service from producing a runaway slot
// loop or an unparseable availability blob. weekdays are "0".."6" (Sun..Sat).

import { z } from "zod";
import { isKnownTimeZone } from "@/lib/bookings/tz";

const dayRange = z
  .object({
    startMin: z.number().int().min(0).max(2880),
    endMin: z.number().int().min(1).max(2880),
  })
  .refine((r) => r.endMin > r.startMin, { message: "endMin must exceed startMin" });

const weekdayKey = z.enum(["0", "1", "2", "3", "4", "5", "6"]);

const exception = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  blackout: z.boolean().optional(),
  ranges: z.array(dayRange).max(12).optional(),
});

export const serviceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullish(),
  durationMin: z.number().int().min(5).max(1440),
  slotIncrementMin: z.number().int().min(0).max(1440).optional(),
  bufferBeforeMin: z.number().int().min(0).max(1440).optional(),
  bufferAfterMin: z.number().int().min(0).max(1440).optional(),
  minLeadTimeMin: z.number().int().min(0).max(525600).optional(), // ≤ 1 year
  maxDaysAhead: z.number().int().min(1).max(365).optional(),
  creatorTz: z.string().refine(isKnownTimeZone, { message: "invalid IANA time zone" }),
  weeklyHours: z.record(weekdayKey, z.array(dayRange).max(12)).optional(),
  exceptions: z.array(exception).max(200).optional(),
  // capacity (multi-seat) is NOT a v1 input — seat allocation isn't built, so
  // an owner-set capacity>1 would silently under-book. The column stays at 1.
  priceDisplay: z.string().trim().max(80).nullish(),
  locationText: z.string().trim().max(300).nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export type ServiceInputParsed = z.infer<typeof serviceInputSchema>;

/** The create form requires the full object; updates patch a subset. */
export const serviceUpdateSchema = serviceInputSchema.partial();
