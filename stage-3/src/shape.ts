// Structural checks for documents supplied whole by test control calls (reset fixtures and
// import states). Any defect there is 422 validation_failed, naming the offending path.
import { MAX_ID_LENGTH } from './constants';
import { validationFailed } from './errors';

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasField(obj: JsonObject, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, name);
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function expectObject(value: unknown, path: string): JsonObject {
  if (!isObject(value)) throw validationFailed(`${path} must be an object`);
  return value;
}

export function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw validationFailed(`${path} must be an array`);
  return value;
}

/** An optional array field: absent means empty. */
export function optionalArray(obj: JsonObject, name: string, path: string): unknown[] {
  return hasField(obj, name) ? expectArray(obj[name], `${path}.${name}`) : [];
}

export function expectString(obj: JsonObject, name: string, path: string): string {
  const value = obj[name];
  if (typeof value !== 'string') throw validationFailed(`${path}.${name} must be a string`);
  return value;
}

export function expectId(obj: JsonObject, name: string, path: string): string {
  const value = expectString(obj, name, path);
  if (value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw validationFailed(`${path}.${name} must be 1 to ${MAX_ID_LENGTH} characters`);
  }
  return value;
}

export function expectInteger(obj: JsonObject, name: string, path: string, min: number): number {
  const value = obj[name];
  if (!isInteger(value) || value < min) {
    throw validationFailed(`${path}.${name} must be an integer of at least ${min}`);
  }
  return value;
}

/** Throws when `ids` repeats a value. */
export function expectDistinct(ids: string[], what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw validationFailed(`duplicate ${what} ${JSON.stringify(id)}`);
    seen.add(id);
  }
}
