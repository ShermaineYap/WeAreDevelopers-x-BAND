// The single in-memory SQLite store. Every write path runs inside one synchronous
// transaction; since handlers never yield between their reads and writes, a request's
// checks and effects are atomic with respect to every other request.
import Database from 'better-sqlite3';

export const db = new Database(':memory:');
db.pragma('foreign_keys = OFF');

db.exec(`
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL,
    email_key     TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL
  );
  CREATE TABLE tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL
  );
  CREATE TABLE restaurants (
    id                           TEXT PRIMARY KEY,
    position                     INTEGER NOT NULL,
    name                         TEXT NOT NULL,
    timezone                     TEXT NOT NULL,
    slot_minutes                 INTEGER NOT NULL,
    reservation_duration_minutes INTEGER NOT NULL,
    cancellation_cutoff_minutes  INTEGER NOT NULL,
    opening_hours                TEXT NOT NULL
  );
  CREATE TABLE restaurant_tables (
    restaurant_id TEXT NOT NULL,
    id            TEXT NOT NULL,
    position      INTEGER NOT NULL,
    label         TEXT,
    capacity      INTEGER NOT NULL,
    PRIMARY KEY (restaurant_id, id)
  );
  CREATE TABLE reservations (
    id              TEXT PRIMARY KEY,
    reference       TEXT NOT NULL UNIQUE,
    user_id         TEXT NOT NULL,
    restaurant_id   TEXT NOT NULL,
    table_id        TEXT NOT NULL,
    party_size      INTEGER NOT NULL,
    status          TEXT NOT NULL,
    starts_at_local TEXT NOT NULL,
    starts_at       TEXT NOT NULL,
    ends_at         TEXT NOT NULL,
    start_ms        INTEGER NOT NULL,
    end_ms          INTEGER NOT NULL,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX reservations_by_table ON reservations (restaurant_id, table_id, status, start_ms);
  CREATE INDEX reservations_by_user ON reservations (user_id);
  CREATE TABLE idempotency (
    user_id      TEXT NOT NULL,
    path         TEXT NOT NULL,
    key          TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response     TEXT NOT NULL,
    PRIMARY KEY (user_id, path, key)
  );
`);

/** Run `fn` in one transaction; it commits on return and rolls back if `fn` throws. */
export function inTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}
