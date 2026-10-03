// Field reading for API request bodies (§5): a field of the wrong JSON type is
// 400 malformed_request, a missing required field is 422 validation_failed.
import { MAX_TABLES_PER_BOOKING } from './constants';
import { malformed, unprocessable, validationFailed } from './errors';
import { hasField, isInteger, type JsonObject } from './shape';

/** A string field; undefined when absent and optional. `null` is a wrong type. */
export function stringField(body: JsonObject, name: string, required: boolean): string | undefined {
  if (!hasField(body, name)) {
    if (required) throw validationFailed(`${name} is required`);
    return undefined;
  }
  const value = body[name];
  if (typeof value !== 'string') throw malformed(`${name} must be a string`);
  return value;
}

/** Throws 400 when a present field is not a string; checks types before any value rule. */
export function assertStringTyped(body: JsonObject, names: readonly string[]): void {
  for (const name of names) {
    if (hasField(body, name) && typeof body[name] !== 'string') throw malformed(`${name} must be a string`);
  }
}

/**
 * party_size (§5, §8): any value that is not an integer of at least 1 — strings and booleans
 * included — is 422 validation_failed, never 400.
 */
export function partySizeField(body: JsonObject, required: boolean): number | undefined {
  if (!hasField(body, 'party_size')) {
    if (required) throw validationFailed('party_size is required');
    return undefined;
  }
  const value = body.party_size;
  if (!isInteger(value) || value < 1) throw validationFailed('party_size must be an integer of at least 1');
  return value;
}

/** Throws 400 when `table_id` is not a string or `table_ids` is not an array of strings. */
export function assertTableSetTyped(body: JsonObject): void {
  assertStringTyped(body, ['table_id']);
  if (hasField(body, 'table_ids')) {
    const ids = body.table_ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw malformed('table_ids must be an array of table id strings');
    }
  }
}

/**
 * The table set of a booking (stage 2): `table_ids`, or `table_id` meaning a set of one.
 * Sending both, an empty set or a repeated id is 422 validation_failed; more than
 * MAX_TABLES_PER_BOOKING tables is 422 combination_not_allowed. Undefined when absent and optional.
 */
export function tableSetField(body: JsonObject, required: boolean): string[] | undefined {
  assertTableSetTyped(body);
  const hasOne = hasField(body, 'table_id');
  const hasSet = hasField(body, 'table_ids');
  if (hasOne && hasSet) throw validationFailed('Send table_id or table_ids, not both');
  if (!hasOne && !hasSet) {
    if (required) throw validationFailed('table_ids (or table_id) is required');
    return undefined;
  }
  const ids = hasOne ? [body.table_id as string] : (body.table_ids as string[]);
  if (ids.length === 0) throw validationFailed('table_ids must name at least one table');
  if (new Set(ids).size !== ids.length) throw validationFailed('table_ids must not repeat a table');
  if (ids.length > MAX_TABLES_PER_BOOKING) {
    throw unprocessable('combination_not_allowed', `At most ${MAX_TABLES_PER_BOOKING} tables can be combined`);
  }
  return ids;
}
