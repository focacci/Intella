// ---------------------------------------------------------------------------
// "Today" and session scheduling (R1).
//
// R1: `Profile.timezone` (IANA) plus UTC storage define what "today" means.
// The concrete convention this file establishes, and which every training read
// depends on:
//
//   A `WorkoutSession.date` is the UTC midnight of the LOCAL calendar date the
//   session belongs to.
//
// So a session on 2026-07-20 in America/New_York is stored as
// 2026-07-20T00:00:00Z — not 04:00Z. That makes "is this today?" an exact
// equality test rather than a range query with a moving offset, and it means a
// session doesn't silently shift a day when the user travels or DST flips.
// The stored instant is a DATE LABEL, not a moment in time.
// ---------------------------------------------------------------------------

/**
 * The local calendar date at `instant` in `timezone`, as `YYYY-MM-DD`.
 * An invalid/unknown timezone degrades to UTC rather than throwing (R1 must
 * never be able to hard-stop a read).
 */
export function localDateString(instant: Date, timezone: string): string {
  return formatIn(instant, timezone) ?? formatIn(instant, "UTC") ?? "1970-01-01";
}

function formatIn(instant: Date, timezone: string): string | null {
  try {
    // en-CA renders as YYYY-MM-DD, which is exactly the key format we want.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(instant);
  } catch {
    return null;
  }
}

/** `YYYY-MM-DD` → the UTC-midnight Date used as the stored session date. */
export function dateKeyToUtc(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** A stored session date back to its `YYYY-MM-DD` key. */
export function utcToDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The stored date representing "today" for a user in `timezone`. */
export function todayInTimezone(timezone: string, now: Date = new Date()): Date {
  return dateKeyToUtc(localDateString(now, timezone));
}

/** Add whole days to a stored (UTC-midnight) session date. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Which days of a 7-day week to train on, given a frequency. Spreads sessions
 * as evenly as the week allows so rest days fall between hard days:
 *   3 days → Mon/Wed/Sat   ·   4 days → Mon/Wed/Fri/Sat   ·   6 days → all but one.
 * Offsets are relative to the block's start date, not to any named weekday.
 */
export function weekdayOffsets(daysPerWeek: number): number[] {
  const days = Math.min(Math.max(Math.round(daysPerWeek), 1), 7);

  const offsets: number[] = [];
  for (let index = 0; index < days; index += 1) {
    offsets.push(Math.round((index * 7) / days));
  }

  // Rounding can collide at high frequencies (6–7 days); push duplicates onto
  // the next free slot so every session still gets its own calendar day.
  const used = new Set<number>();
  return offsets.map((offset) => {
    let slot = offset;
    while (used.has(slot) && slot < 7) {
      slot += 1;
    }
    used.add(slot);
    return slot;
  });
}

/**
 * The full schedule for a block: one entry per session, in order, carrying the
 * week number (1-based) and the stored date.
 */
export function buildSchedule(options: {
  startDate: Date;
  weeks: number;
  daysPerWeek: number;
}): { weekNo: number; date: Date; dayIndex: number }[] {
  const offsets = weekdayOffsets(options.daysPerWeek);
  const schedule: { weekNo: number; date: Date; dayIndex: number }[] = [];

  for (let week = 0; week < options.weeks; week += 1) {
    for (const [dayIndex, offset] of offsets.entries()) {
      schedule.push({
        weekNo: week + 1,
        dayIndex,
        date: addDays(options.startDate, week * 7 + offset)
      });
    }
  }

  return schedule;
}
