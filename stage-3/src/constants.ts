// Every limit and fixed value the service enforces, in one place.

export const DEFAULT_PORT = 8080;
export const LISTEN_HOST = '0.0.0.0';

/** §3.4: IDs are opaque strings of at most 64 characters, including fixture IDs. */
export const MAX_ID_LENGTH = 64;

/** §5: shared range for the Idempotency-Key header. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** §6: minimum password length on signup. */
export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt work factor. Kept low so 50 concurrent logins stay far below the 5 s request timeout. */
export const BCRYPT_COST = 6;

/** §8: references are 6-12 characters of A-Z0-9. Generated ones use a fixed length. */
export const REFERENCE_PATTERN = /^[A-Z0-9]{6,12}$/;
export const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const GENERATED_REFERENCE_LENGTH = 8;

/** §11: a move batch holds 1..8 items. */
export const MIN_MOVES = 1;
export const MAX_MOVES = 8;

/** Request body limits: ordinary API calls vs. test control calls carrying whole states. */
export const API_BODY_LIMIT = '1mb';
export const TEST_BODY_LIMIT = '64mb';

/** §10: the export envelope. */
export const EXPORT_TRACK = 'tablekeeper';
export const EXPORT_FORMAT_VERSION = 1;
/**
 * Marker inside the opaque `state` so foreign objects are recognised as invalid.
 * Stage 1 wrote LEGACY_STATE_SCHEMA (single `table_id` per reservation, no `combinable`);
 * imports of that format are upgraded on the way in.
 */
export const STATE_SCHEMA = 'tablekeeper-store/2';
export const LEGACY_STATE_SCHEMA = 'tablekeeper-store/1';

/** Stage 2: a combination is a declared pair, never three or more tables. */
export const MAX_TABLES_PER_BOOKING = 2;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MINUTES_PER_DAY = 24 * 60;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

/** The two write paths that take an Idempotency-Key (§7). Records are scoped per path. */
export const PATH_RESERVATIONS = '/reservations';
export const PATH_MOVES = '/reservation-moves';
