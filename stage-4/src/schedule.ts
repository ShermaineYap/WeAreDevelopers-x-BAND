// Slot grid, opening hours, occupancy intervals and cutoff (§4, §8, §9). Every rule here
// is read from the terms that apply (stage 3): policy 0 is the fixture's configuration.
import { MS_PER_MINUTE } from './constants';
import { unprocessable, validationFailed } from './errors';
import type { OpeningHours } from './hours';
import type { Restaurant } from './state';
import type { Terms } from './terms';
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

/**
 * Every seating the restaurant offers under `terms`: singles in fixture order, then pairs in
 * `combinable` order, each with the capacity those terms give it (a pair seats the sum).
 */
export function seatingOptions(restaurant: Restaurant, terms: Terms): SeatingOption[] {
  const capacity = (id: string) => terms.capacities[id];
  return [
    ...restaurant.tables.map((t) => ({ table_ids: [t.id], capacity: capacity(t.id) })),
    ...restaurant.combinable.map((pair) => ({ table_ids: [...pair], capacity: capacity(pair[0]) + capacity(pair[1]) })),
  ];
}

/** `starts_at_local` must be a bare `YYYY-MM-DDTHH:MM` naming a real calendar time. */
export function parseStartsAtLocal(text: string): LocalDateTime {
  const parsed = parseLocalDateTime(text);
  if (!parsed) throw validationFailed('starts_at_local must be a local YYYY-MM-DDTHH:MM');
  return parsed;
}

function timingAt(restaurant: Restaurant, terms: Terms, local: LocalDateTime, startMs: number): Timing {
  const endMs = startMs + terms.reservation_duration_minutes * MS_PER_MINUTE;
  return {
    starts_at_local: formatLocalDateTime(local),
    starts_at: formatInstant(restaurant.timezone, startMs),
    ends_at: formatInstant(restaurant.timezone, endMs),
    start_ms: startMs,
    end_ms: endMs,
  };
}

const hoursOn = (terms: Terms, date: LocalDate) =>
  terms.opening_hours.filter((h) => h.weekday === weekdayOf(date));

const closesMs = (restaurant: Restaurant, date: LocalDate, hours: OpeningHours) =>
  resolveLocalLenient(restaurant.timezone, atMinute(date, parseClock(hours.closes)!));

/**
 * The timing of a booking starting at `local` under `terms`, or the rule it breaks:
 * a skipped local time, a start outside opening hours, a start off the slot grid,
 * or an end after closing time.
 */
export function bookingTiming(restaurant: Restaurant, terms: Terms, local: LocalDateTime): Timing {
  const startMs = resolveLocal(restaurant.timezone, local);
  if (startMs === null) {
    throw unprocessable('invalid_local_time', 'That local time does not exist in the restaurant\'s time zone');
  }
  const minute = minuteOfDay(local);
  const hours = hoursOn(terms, local).find(
    (h) => parseClock(h.opens)! <= minute && minute < parseClock(h.closes)!);
  const outside = () => unprocessable('outside_opening_hours', 'The restaurant is not open for that booking');
  if (!hours) throw outside();
  if ((minute - parseClock(hours.opens)!) % terms.slot_minutes !== 0) {
    throw unprocessable('not_on_slot_grid', 'starts_at_local is not on the restaurant\'s slot grid');
  }
  const timing = timingAt(restaurant, terms, local, startMs);
  if (timing.end_ms > closesMs(restaurant, local, hours)) throw outside();
  return timing;
}

/** True once now is within `cutoffMinutes` of the start, or later (§8). */
export function cutoffPassed(cutoffMinutes: number, startMs: number, nowMs = Date.now()): boolean {
  return nowMs >= startMs - cutoffMinutes * MS_PER_MINUTE;
}

/** Why one table is or is not available for a slot (stage 3 `explain`). */
export interface TableExplanation {
  table_id: string;
  policy_version: number;
  available: boolean;
  rules: [{ rule: 'capacity'; holds: boolean }, { rule: 'no_overlap'; holds: boolean }];
}

export interface Slot {
  starts_at_local: string;
  starts_at: string;
  available_table_ids: string[];
  available_options: SeatingOption[];
  explain?: TableExplanation[];
}

/**
 * Every slot of `date` under `terms`: each slot_minutes step from opens whose reservation
 * ends by closes. Skipped local times are absent; repeated ones appear once, at their first
 * occurrence. With `explain`, every table reports both rules, each judged independently.
 */
export function slotsOn(
  restaurant: Restaurant, terms: Terms, date: LocalDate, partySize: number, occupied: Occupancy[], explain: boolean,
): Slot[] {
  const seen = new Set<string>();
  const options = seatingOptions(restaurant, terms).filter((o) => o.capacity >= partySize);
  const slots: (Slot & { start_ms: number })[] = [];
  for (const hours of hoursOn(terms, date)) {
    const closes = parseClock(hours.closes)!;
    const closing = closesMs(restaurant, date, hours);
    for (let minute = parseClock(hours.opens)!; minute < closes; minute += terms.slot_minutes) {
      const local = atMinute(date, minute);
      const startMs = resolveLocal(restaurant.timezone, local);
      if (startMs === null) continue;
      const timing = timingAt(restaurant, terms, local, startMs);
      if (timing.end_ms > closing || seen.has(timing.starts_at_local)) continue;
      seen.add(timing.starts_at_local);
      const isFree = (tableIds: string[]) => !occupied.some((held) => overlaps(held, { ...timing, table_ids: tableIds }));
      const free = options.filter((o) => isFree(o.table_ids));
      const slot: Slot & { start_ms: number } = {
        starts_at_local: timing.starts_at_local, starts_at: timing.starts_at,
        available_table_ids: free.filter((o) => o.table_ids.length === 1).map((o) => o.table_ids[0]),
        available_options: free,
        start_ms: startMs,
      };
      if (explain) {
        slot.explain = restaurant.tables.map((t) => {
          const capacity = terms.capacities[t.id] >= partySize;
          const noOverlap = isFree([t.id]);
          return {
            table_id: t.id, policy_version: terms.policy_version, available: capacity && noOverlap,
            rules: [{ rule: 'capacity', holds: capacity }, { rule: 'no_overlap', holds: noOverlap }],
          };
        });
      }
      slots.push(slot);
    }
  }
  return slots
    .sort((a, b) => a.start_ms - b.start_ms)
    .map(({ start_ms: _ignored, ...slot }) => slot);
}
