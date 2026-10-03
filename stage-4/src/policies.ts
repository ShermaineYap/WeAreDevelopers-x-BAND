// Dated booking policies (stage 3): publication by managers, the public list, and the
// selection rule every availability and booking decision uses.
import { db } from './db';
import { ApiError, notFound } from './errors';
import type { Outcome } from './idempotency';
import type { JsonObject } from './shape';
import {
  bumpRestaurantRevision, findRestaurant, insertPolicy, policyDbRow, type PolicyRow, type Restaurant,
} from './state';
import { parsePolicyBody, policyZero, type Policy, type Terms } from './terms';

type PolicyDbRow = Omit<PolicyRow, 'opening_hours' | 'capacities'> & { opening_hours: string; capacities: string };

const POLICY_COLUMNS = `restaurant_id, policy_version, effective_from, slot_minutes, reservation_duration_minutes,
  cancellation_cutoff_minutes, opening_hours, capacities`;
const selectPolicies = db.prepare(`SELECT ${POLICY_COLUMNS} FROM policies WHERE restaurant_id = ? ORDER BY policy_version`);
const selectApplicable = db.prepare(
  `SELECT ${POLICY_COLUMNS} FROM policies WHERE restaurant_id = ? AND effective_from <= ?
    ORDER BY effective_from DESC, policy_version DESC LIMIT 1`);
const selectLatestVersion = db.prepare(
  'SELECT COALESCE(MAX(policy_version), 0) AS version FROM policies WHERE restaurant_id = ?');

const hydrate = (row: PolicyDbRow): PolicyRow => ({
  ...row, opening_hours: JSON.parse(row.opening_hours), capacities: JSON.parse(row.capacities),
});

/** The public shape: the six supplied fields plus `policy_version`. */
function policyView(p: Policy) {
  return {
    effective_from: p.effective_from,
    slot_minutes: p.slot_minutes,
    reservation_duration_minutes: p.reservation_duration_minutes,
    cancellation_cutoff_minutes: p.cancellation_cutoff_minutes,
    opening_hours: p.opening_hours.map(({ weekday, opens, closes }) => ({ weekday, opens, closes })),
    capacities: { ...p.capacities },
    policy_version: p.policy_version,
  };
}

/**
 * The terms that decide a booking starting on local `date` (YYYY-MM-DD): the policy with the
 * greatest `effective_from` not after that date, ties by the greatest version; policy 0 (the
 * fixture's rules) before any.
 */
export function termsFor(restaurant: Restaurant, date: string): Terms {
  const row = selectApplicable.get(restaurant.id, date) as PolicyDbRow | undefined;
  if (!row) return policyZero(restaurant);
  const { restaurant_id: _restaurant, effective_from: _from, ...terms } = hydrate(row);
  return terms;
}

export function listPolicies(restaurantId: string): Outcome {
  if (!findRestaurant(restaurantId)) throw notFound('No such restaurant');
  const rows = (selectPolicies.all(restaurantId) as PolicyDbRow[]).map(hydrate);
  return { status: 200, body: { policies: rows.map(policyView) } };
}

/** The restaurant, if the caller manages it: unknown 404, not a manager 403 (stage 3/4). */
export function managedRestaurant(userId: string, restaurantId: string): Restaurant {
  const restaurant = findRestaurant(restaurantId);
  if (!restaurant) throw notFound('No such restaurant');
  if (!restaurant.manager_user_ids.includes(userId)) {
    throw new ApiError(403, 'forbidden', 'Only the restaurant\'s managers may do this');
  }
  return restaurant;
}

/**
 * Publishes a complete policy (runs inside the idempotency transaction): unknown restaurant
 * 404, non-manager 403, invalid policy 422; versions are allocated only on success.
 */
export function publishPolicy(userId: string, restaurantId: string, body: JsonObject): Outcome {
  const restaurant = managedRestaurant(userId, restaurantId);
  const parsed = parsePolicyBody(body, restaurant);
  const version = (selectLatestVersion.get(restaurant.id) as { version: number }).version + 1;
  const policy: PolicyRow = { restaurant_id: restaurant.id, policy_version: version, ...parsed };
  insertPolicy.run(policyDbRow(policy));
  bumpRestaurantRevision(restaurant.id);
  return { status: 201, body: policyView(policy) };
}
