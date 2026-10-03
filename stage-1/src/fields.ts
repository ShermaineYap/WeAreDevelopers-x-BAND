// Field reading for API request bodies (§5): a field of the wrong JSON type is
// 400 malformed_request, a missing required field is 422 validation_failed.
import { malformed, validationFailed } from './errors';
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
