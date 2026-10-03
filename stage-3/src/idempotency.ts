// Idempotent writes (§7). A record exists only for a successful first use; it is stored in
// the same transaction as the write it describes, so a failed request leaves its key reusable.
import { IDEMPOTENCY_KEY_MAX_LENGTH } from './constants';
import { db, inTransaction } from './db';
import { conflict, missingIdempotencyKey, validationFailed } from './errors';
import { isObject } from './shape';

export interface Outcome {
  status: number;
  body: unknown;
}

/** The Idempotency-Key header: absent or empty is 400, longer than the limit is 422. */
export function idempotencyKey(header: string | undefined): string {
  if (header === undefined || header.length === 0) throw missingIdempotencyKey();
  if (header.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw validationFailed(`Idempotency-Key must be 1 to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`);
  }
  return header;
}

/** JSON value identity: object keys sorted, whitespace irrelevant. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const selectRecord = db.prepare(
  'SELECT request_hash, response FROM idempotency WHERE user_id = ? AND path = ? AND key = ?');
const insertRecord = db.prepare(
  'INSERT INTO idempotency (user_id, path, key, request_hash, response) VALUES (?, ?, ?, ?, ?)');

/**
 * Resolve `key` for this user and path before anything else about `body` is examined:
 * a replay returns the stored response with 200, a different body is 409. Otherwise `run`
 * performs the write; its response is recorded atomically with it.
 */
export function idempotent(
  userId: string, path: string, key: string, body: unknown, run: () => Outcome,
): Outcome {
  const requestHash = canonicalJson(body);
  return inTransaction(() => {
    const record = selectRecord.get(userId, path, key) as { request_hash: string; response: string } | undefined;
    if (record) {
      if (record.request_hash !== requestHash) {
        throw conflict('idempotency_key_reuse', 'This Idempotency-Key was already used with a different request');
      }
      return { status: 200, body: JSON.parse(record.response) };
    }
    const outcome = run();
    insertRecord.run(userId, path, key, requestHash, JSON.stringify(outcome.body));
    return outcome;
  });
}
