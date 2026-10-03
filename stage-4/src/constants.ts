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
 * Earlier stages wrote the older schemas; imports of those are upgraded on the way in:
 * stage 1 had one `table_id` per reservation and no `combinable`; stages 1 and 2 had no
 * policies, revisions, history or series.
 */
export const STATE_SCHEMA = 'tablekeeper-store/4';
export const STAGE1_STATE_SCHEMA = 'tablekeeper-store/1';
export const STAGE2_STATE_SCHEMA = 'tablekeeper-store/2';
export const STAGE3_STATE_SCHEMA = 'tablekeeper-store/3';

/** Stage 2: a combination is a declared pair, never three or more tables. */
export const MAX_TABLES_PER_BOOKING = 2;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MINUTES_PER_DAY = 24 * 60;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

/** Write paths that take an Idempotency-Key (§7). Records are scoped per path. */
export const PATH_RESERVATIONS = '/reservations';
export const PATH_MOVES = '/reservation-moves';
export const PATH_SERIES = '/series';
export const policiesPath = (restaurantId: string) => `/restaurants/${restaurantId}/policies`;

/** Stage 3 policy ranges. */
export const POLICY_MINUTES_MIN = 1;
export const POLICY_MINUTES_MAX = 1440;
export const POLICY_CUTOFF_MAX = 10080;
export const POLICY_CAPACITY_MIN = 1;
export const POLICY_CAPACITY_MAX = 100;

/** Stage 3 recurring reservations: occurrences including the anchor, and their spacing. */
export const SERIES_COUNT_MIN = 2;
export const SERIES_COUNT_MAX = 12;
export const SERIES_INTERVAL_WEEKS_MIN = 1;
export const SERIES_INTERVAL_WEEKS_MAX = 4;
export const DAYS_PER_WEEK = 7;

/** Stage 4 replans: inputs within these limits are always planned exhaustively. */
export const PLANNING_MAX_TABLES = 6;
export const PLANNING_MAX_PAIRS = 4;
export const PLANNING_MAX_CONSIDERED = 6;
/** Beyond the limits, a search space larger than this is refused with 422 planning_limit. */
export const PLANNING_MAX_COMBINATIONS = 5_000_000;
export const replansPath = (restaurantId: string) => `/restaurants/${restaurantId}/replans`;
export const applyPath = (restaurantId: string, planId: string) => `/restaurants/${restaurantId}/replans/${planId}/apply`;
export const seriesAmendPath = (seriesId: string) => `/series/${seriesId}/amend`;
