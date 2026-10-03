// A restaurant's slot grid, opening hours, occupancy intervals and cutoff (§4, §8, §9).
import { MS_PER_MINUTE } from './constants';
import { unprocessable, validationFailed } from './errors';
import type { OpeningHours, Restaurant } from './state';
import {
  atMinute, formatInstant, formatLocalDateTime, minuteOfDay, parseClock, parseLocalDateTime,
  resolveLocal, resolveLocalLenient, weekdayOf, type LocalDate, type LocalDateTime,
} from './time';

/** When a booking happens: its local start and its absolute interval [start_ms, end_ms). */
export interface Timing {
  starts_at_local: string;
  starts_at: string;
  ends_at: string;
  start_ms: number;
  end_ms: number;
}

/** A confirmed booking's hold on every table in its set. */
export interface Occupancy {
  table_ids: string[];
  start_ms: number;
  end_ms: number;
}

/**
 * Two holds conflict when they share a table and their half-open intervals overlap,
 * i.e. each starts before the other ends (§1).
 */
export const overlaps = (a: Occupancy, b: Occupancy) =>
  a.start_ms < b.end_ms && b.start_ms < a.end_ms && a.table_ids.some((id) => b.table_ids.includes(id));

/** A bookable seating: one table, or a declared pair in `combinable` order. */
export interface SeatingOption {
  table_ids: string[];
  capacity: number;
}

/** Every seating the restaurant offers: singles in fixture order, then pairs in `combinable` order. */
export function seatingOptions(restaurant: Restaurant): SeatingOption[] {
  const capacity = (id: string) => restaurant.tables.find((t) => t.id === id)!.capacity;
  return [
    ...restaurant.tables.map((t) => ({ table_ids: [t.id], capacity: t.capacity })),
    ...restaurant.combinable.map((pair) => ({ table_ids: [...pair], capacity: capacity(pair[0]) + capacity(pair[1]) })),
  ];
}

/** `starts_at_local` must be a bare `YYYY-MM-DDTHH:MM` naming a real calendar time. */
export function parseStartsAtLocal(text: string): LocalDateTime {
  const parsed = parseLocalDateTime(text);
  if (!parsed) throw validationFailed('starts_at_local must be a local YYYY-MM-DDTHH:MM');
  return parsed;
}

function timingAt(restaurant: Restaurant, local: LocalDateTime, startMs: number): Timing {
  const endMs = startMs + restaurant.reservation_duration_minutes * MS_PER_MINUTE;
  return {
    starts_at_local: formatLocalDateTime(local),
    starts_at: formatInstant(restaurant.timezone, startMs),
    ends_at: formatInstant(restaurant.timezone, endMs),
    start_ms: startMs,
    end_ms: endMs,
  };
}

const hoursOn = (restaurant: Restaurant, date: LocalDate) =>
  restaurant.opening_hours.filter((h) => h.weekday === weekdayOf(date));

const closesMs = (restaurant: Restaurant, date: LocalDate, hours: OpeningHours) =>
  resolveLocalLenient(restaurant.timezone, atMinute(date, parseClock(hours.closes)!));

/**
 * The timing of a booking starting at `local`, or the rule it breaks:
 * a skipped local time, a start outside opening hours, a start off the slot grid,
 * or an end after closing time.
 */
export function bookingTiming(restaurant: Restaurant, local: LocalDateTime): Timing {
  const startMs = resolveLocal(restaurant.timezone, local);
  if (startMs === null) {
    throw unprocessable('invalid_local_time', 'That local time does not exist in the restaurant\'s time zone');
  }
  const minute = minuteOfDay(local);
  const hours = hoursOn(restaurant, local).find(
    (h) => parseClock(h.opens)! <= minute && minute < parseClock(h.closes)!);
  const outside = () => unprocessable('outside_opening_hours', 'The restaurant is not open for that booking');
  if (!hours) throw outside();
  if ((minute - parseClock(hours.opens)!) % restaurant.slot_minutes !== 0) {
    throw unprocessable('not_on_slot_grid', 'starts_at_local is not on the restaurant\'s slot grid');
  }
  const timing = timingAt(restaurant, local, startMs);
  if (timing.end_ms > closesMs(restaurant, local, hours)) throw outside();
  return timing;
}

/** True once now is within the cancellation cutoff of the start, or later (§8). */
export function cutoffPassed(restaurant: Restaurant, startMs: number, nowMs = Date.now()): boolean {
  return nowMs >= startMs - restaurant.cancellation_cutoff_minutes * MS_PER_MINUTE;
}

export interface Slot {
  starts_at_local: string;
  starts_at: string;
  available_table_ids: string[];
  available_options: SeatingOption[];
}

/**
 * Every slot of `date`: each slot_minutes step from opens whose reservation ends by closes.
 * Skipped local times are absent; repeated ones appear once, at their first occurrence.
 */
export function slotsOn(
  restaurant: Restaurant, date: LocalDate, partySize: number, occupied: Occupancy[],
): Slot[] {
  const seen = new Set<string>();
  const options = seatingOptions(restaurant).filter((o) => o.capacity >= partySize);
  const slots: (Slot & { start_ms: number })[] = [];
  for (const hours of hoursOn(restaurant, date)) {
    const closes = parseClock(hours.closes)!;
    const closing = closesMs(restaurant, date, hours);
    for (let minute = parseClock(hours.opens)!; minute < closes; minute += restaurant.slot_minutes) {
      const local = atMinute(date, minute);
      const startMs = resolveLocal(restaurant.timezone, local);
      if (startMs === null) continue;
      const timing = timingAt(restaurant, local, startMs);
      if (timing.end_ms > closing || seen.has(timing.starts_at_local)) continue;
      seen.add(timing.starts_at_local);
      const free = options.filter((o) => !occupied.some((held) => overlaps(held, { ...timing, table_ids: o.table_ids })));
      slots.push({
        starts_at_local: timing.starts_at_local, starts_at: timing.starts_at,
        available_table_ids: free.filter((o) => o.table_ids.length === 1).map((o) => o.table_ids[0]),
        available_options: free,
        start_ms: startMs,
      });
    }
  }
  return slots
    .sort((a, b) => a.start_ms - b.start_ms)
    .map(({ start_ms: _ignored, ...slot }) => slot);
}
