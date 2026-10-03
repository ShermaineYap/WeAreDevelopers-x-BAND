// Recurring reservations (stage 3): adopting a booking as occurrence zero of a series and
// generating the rest, all or nothing; reading a series with current reservation states.
import {
  DAYS_PER_WEEK, MS_PER_DAY, SERIES_COUNT_MAX, SERIES_COUNT_MIN, SERIES_INTERVAL_WEEKS_MAX,
  SERIES_INTERVAL_WEEKS_MIN,
} from './constants';
import { db } from './db';
import { conflict, notFound, validationFailed } from './errors';
import { stringField } from './fields';
import { newId } from './ids';
import type { Outcome } from './idempotency';
import {
  assertFree, cutoffError, insertNewReservation, ownReservation, pastCutoff, resolveBooking, view,
} from './reservations';
import { hasField, isInteger, type JsonObject } from './shape';
import {
  RESERVATION_COLUMNS, bumpRestaurantRevision, findRestaurant, fromDbRow, insertSeries, type ReservationRow,
  type SeriesRow,
} from './state';
import { parseLocalDateTime, type LocalDateTime } from './time';

const selectSeries = db.prepare('SELECT id, user_id, restaurant_id, interval_weeks, revision FROM series WHERE id = ?');
const selectOccurrences = db.prepare(
  `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE series_id = ? ORDER BY series_index`);
const markAnchor = db.prepare('UPDATE reservations SET series_id = ?, series_index = 0 WHERE id = ?');

function seriesView(series: SeriesRow, occurrences: ReservationRow[]) {
  return {
    series_id: series.id,
    revision: series.revision,
    interval_weeks: series.interval_weeks,
    occurrences: occurrences.map((r) => ({
      index: r.series_index!, reference: r.reference, exception: r.exception, reservation: view(r),
    })),
  };
}

function rangedInteger(body: JsonObject, name: string, min: number, max: number): number {
  if (!hasField(body, name)) throw validationFailed(`${name} is required`);
  const value = body[name];
  if (!isInteger(value) || value < min || value > max) {
    throw validationFailed(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/** The same local clock time `days` calendar days later. */
function shiftDays(local: LocalDateTime, days: number): LocalDateTime {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day) + days * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: local.hour, minute: local.minute };
}

/**
 * POST /series (runs inside the idempotency transaction). The anchor stays exactly as it is;
 * occurrence i is the anchor's local date + i × interval weeks at the same clock time, under
 * its own date's policy. The first failing occurrence in index order decides the error.
 */
export function adoptSeries(userId: string, body: JsonObject): Outcome {
  const anchorReference = stringField(body, 'anchor_reference', true)!;
  const count = rangedInteger(body, 'count', SERIES_COUNT_MIN, SERIES_COUNT_MAX);
  const intervalWeeks = rangedInteger(body, 'interval_weeks', SERIES_INTERVAL_WEEKS_MIN, SERIES_INTERVAL_WEEKS_MAX);
  const anchor = ownReservation(userId, anchorReference);
  if (anchor.status === 'cancelled') throw conflict('reservation_cancelled', 'The reservation is cancelled');
  if (anchor.series_id !== null) throw conflict('already_in_series', 'The reservation already belongs to a series');
  if (pastCutoff(anchor)) throw cutoffError();
  const restaurant = findRestaurant(anchor.restaurant_id)!;
  const start = parseLocalDateTime(anchor.starts_at_local)!;
  const bookings = Array.from({ length: count - 1 }, (_, i) => {
    const booking = resolveBooking(restaurant, anchor.table_ids, shiftDays(start, (i + 1) * intervalWeeks * DAYS_PER_WEEK), anchor.party_size);
    assertFree(restaurant.id, booking, new Set());
    return booking;
  });
  const series: SeriesRow = {
    id: newId('ser'), user_id: userId, restaurant_id: restaurant.id, interval_weeks: intervalWeeks, revision: 1,
  };
  insertSeries.run(series);
  markAnchor.run(series.id, anchor.id);
  const occurrences = [
    { ...anchor, series_id: series.id, series_index: 0 },
    ...bookings.map((b, i) => insertNewReservation(userId, restaurant.id, b, { id: series.id, index: i + 1 })),
  ];
  bumpRestaurantRevision(restaurant.id);
  return { status: 201, body: seriesView(series, occurrences) };
}

/** GET /series/{id}: owner-only; anyone else, signed in or not, gets 404. */
export function getSeries(userId: string | null, seriesId: string): Outcome {
  const series = selectSeries.get(seriesId) as SeriesRow | undefined;
  if (!series || userId === null || series.user_id !== userId) throw notFound('No such series');
  return { status: 200, body: seriesView(series, selectOccurrences.all(series.id).map(fromDbRow)) };
}
