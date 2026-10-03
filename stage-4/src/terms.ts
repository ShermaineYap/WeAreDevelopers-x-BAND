// Booking rules ("terms"): what a policy decides and what a reservation accepts (stage 3).
// Policy 0 is the restaurant's fixture configuration; published policies replace it from
// their effective date. A reservation's `accepted_terms` is a snapshot of one of these.
import {
  POLICY_CAPACITY_MAX, POLICY_CAPACITY_MIN, POLICY_CUTOFF_MAX, POLICY_MINUTES_MAX, POLICY_MINUTES_MIN,
} from './constants';
import { validationFailed } from './errors';
import { expectObject, hasField, isInteger, isObject, type JsonObject } from './shape';
import { parseOpeningHours, type OpeningHours } from './hours';
import type { Restaurant } from './state';
import { parseDate } from './time';

/** One policy's rules, as reported in `accepted_terms` (everything but `effective_from`). */
export interface Terms {
  policy_version: number;
  slot_minutes: number;
  reservation_duration_minutes: number;
  cancellation_cutoff_minutes: number;
  opening_hours: OpeningHours[];
  capacities: Record<string, number>;
}

/** A published policy: its terms plus the date it applies from. */
export interface Policy extends Terms {
  effective_from: string;
}

/** Policy 0: the fixture's own rules. */
export function policyZero(restaurant: Restaurant): Terms {
  return {
    policy_version: 0,
    slot_minutes: restaurant.slot_minutes,
    reservation_duration_minutes: restaurant.reservation_duration_minutes,
    cancellation_cutoff_minutes: restaurant.cancellation_cutoff_minutes,
    opening_hours: restaurant.opening_hours.map(({ weekday, opens, closes }) => ({ weekday, opens, closes })),
    capacities: Object.fromEntries(restaurant.tables.map((t) => [t.id, t.capacity])),
  };
}

/** The table's capacity under `terms` (every table of the restaurant is named there). */
export const capacityUnder = (terms: Terms, tableId: string) => terms.capacities[tableId];

/** Terms in their reporting order (stable JSON for responses and snapshots). */
export function termsView(t: Terms): Terms {
  return {
    policy_version: t.policy_version,
    slot_minutes: t.slot_minutes,
    reservation_duration_minutes: t.reservation_duration_minutes,
    cancellation_cutoff_minutes: t.cancellation_cutoff_minutes,
    opening_hours: t.opening_hours.map(({ weekday, opens, closes }) => ({ weekday, opens, closes })),
    capacities: { ...t.capacities },
  };
}

function rangedInteger(obj: JsonObject, name: string, min: number, max: number): number {
  const value = obj[name];
  if (!isInteger(value) || value < min || value > max) {
    throw validationFailed(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/**
 * Validates the rule fields shared by a policy and a terms snapshot: grid and duration
 * 1..1440, cutoff 0..10080, stage-1 opening hours without duplicate weekdays, and capacities
 * naming exactly the restaurant's tables, 1..100 each. Every defect is 422 validation_failed.
 */
export function parseRules(obj: JsonObject, restaurant: Restaurant): Omit<Terms, 'policy_version'> {
  for (const name of ['slot_minutes', 'reservation_duration_minutes', 'cancellation_cutoff_minutes', 'opening_hours', 'capacities']) {
    if (!hasField(obj, name)) throw validationFailed(`${name} is required`);
  }
  const slot_minutes = rangedInteger(obj, 'slot_minutes', POLICY_MINUTES_MIN, POLICY_MINUTES_MAX);
  const reservation_duration_minutes = rangedInteger(obj, 'reservation_duration_minutes', POLICY_MINUTES_MIN, POLICY_MINUTES_MAX);
  const cancellation_cutoff_minutes = rangedInteger(obj, 'cancellation_cutoff_minutes', 0, POLICY_CUTOFF_MAX);
  if (!Array.isArray(obj.opening_hours)) throw validationFailed('opening_hours must be an array');
  const opening_hours = obj.opening_hours.map((h, i) => parseOpeningHours(h, `opening_hours[${i}]`));
  if (new Set(opening_hours.map((h) => h.weekday)).size !== opening_hours.length) {
    throw validationFailed('opening_hours must not repeat a weekday');
  }
  if (!isObject(obj.capacities)) throw validationFailed('capacities must be an object');
  const given = obj.capacities;
  const ids = restaurant.tables.map((t) => t.id);
  if (Object.keys(given).length !== ids.length || !ids.every((id) => hasField(given, id))) {
    throw validationFailed('capacities must name exactly the restaurant\'s tables');
  }
  const capacities = Object.fromEntries(ids.map((id) => [id, rangedInteger(given, id, POLICY_CAPACITY_MIN, POLICY_CAPACITY_MAX)]));
  return { slot_minutes, reservation_duration_minutes, cancellation_cutoff_minutes, opening_hours, capacities };
}

/** A complete policy body for publication (stage 3). */
export function parsePolicyBody(body: JsonObject, restaurant: Restaurant): Omit<Policy, 'policy_version'> {
  const effective = body.effective_from;
  if (typeof effective !== 'string' || !parseDate(effective)) {
    throw validationFailed('effective_from must be a calendar date YYYY-MM-DD');
  }
  return { effective_from: effective, ...parseRules(body, restaurant) };
}

/** Validates a stored terms snapshot (import). */
export function parseTerms(value: unknown, path: string, restaurant: Restaurant): Terms {
  const obj = expectObject(value, path);
  const version = obj.policy_version;
  if (!isInteger(version) || version < 0) throw validationFailed(`${path}.policy_version is invalid`);
  return { policy_version: version, ...parseRules(obj, restaurant) };
}
