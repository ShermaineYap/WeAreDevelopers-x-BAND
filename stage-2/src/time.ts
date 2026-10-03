// Local calendar arithmetic against IANA zones (§9). Instants are epoch milliseconds;
// durations are absolute minutes. Zone offsets come from luxon's IANA data.
import { IANAZone } from 'luxon';
import { MS_PER_DAY, MS_PER_MINUTE, WEEKDAYS, type Weekday } from './constants';

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const CLOCK_RE = /^(\d{2}):(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDate(year: number, month: number, day: number): boolean {
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** A strict `YYYY-MM-DD` calendar date, or null. */
export function parseDate(text: string): LocalDate | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return validDate(year, month, day) ? { year, month, day } : null;
}

/** A strict bare local `YYYY-MM-DDTHH:MM` (no seconds, offset or `Z`), or null. */
export function parseLocalDateTime(text: string): LocalDateTime | null {
  const m = LOCAL_DATE_TIME_RE.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number);
  if (!validDate(year, month, day) || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

/** Minutes after local midnight for a 24-hour `HH:MM`, or null. */
export function parseClock(text: string): number | null {
  const m = CLOCK_RE.exec(text);
  if (!m) return null;
  const [hour, minute] = [Number(m[1]), Number(m[2])];
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function formatDate(d: LocalDate): string {
  return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
}

export function formatLocalDateTime(d: LocalDateTime): string {
  return `${formatDate(d)}T${pad(d.hour)}:${pad(d.minute)}`;
}

export function weekdayOf(d: LocalDate): Weekday {
  // getUTCDay: 0 = Sunday; WEEKDAYS starts on Monday.
  return WEEKDAYS[(new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7];
}

export function minuteOfDay(d: LocalDateTime): number {
  return d.hour * 60 + d.minute;
}

/** The local date-time `minutes` after midnight of `date` (minutes < one day). */
export function atMinute(date: LocalDate, minutes: number): LocalDateTime {
  return { ...date, hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

export function isValidZone(name: string): boolean {
  return IANAZone.isValidZone(name);
}

/** Wall-clock reading as if it were UTC; the starting point for offset resolution. */
function naiveMs(d: LocalDateTime): number {
  const ms = Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute);
  // Date.UTC maps years 0-99 onto 1900-1999; correct that for completeness.
  return d.year < 100 ? new Date(ms).setUTCFullYear(d.year) : ms;
}

function offsetMinutes(zone: IANAZone, ms: number): number {
  return zone.offset(ms);
}

/**
 * The instant of a local wall-clock time in `zone`. A time in a spring-forward gap does not
 * exist (null). A time in a fall-back overlap resolves to its first occurrence, i.e. the
 * candidate with the larger (pre-change) offset.
 */
export function resolveLocal(zoneName: string, d: LocalDateTime): number | null {
  const zone = IANAZone.create(zoneName);
  const naive = naiveMs(d);
  const candidates = new Set(
    [naive - MS_PER_DAY, naive, naive + MS_PER_DAY].map((ms) => offsetMinutes(zone, ms)),
  );
  const valid = [...candidates].filter(
    (offset) => offsetMinutes(zone, naive - offset * MS_PER_MINUTE) === offset,
  );
  if (valid.length === 0) return null;
  return naive - Math.max(...valid) * MS_PER_MINUTE;
}

/**
 * Like resolveLocal, but a time inside a gap maps to where the clock reads it after the jump
 * (the pre-change offset applied). Used for boundaries such as closing time.
 */
export function resolveLocalLenient(zoneName: string, d: LocalDateTime): number {
  const exact = resolveLocal(zoneName, d);
  if (exact !== null) return exact;
  const naive = naiveMs(d);
  return naive - offsetMinutes(IANAZone.create(zoneName), naive - MS_PER_DAY) * MS_PER_MINUTE;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** RFC 3339 with an explicit numeric offset (never `Z`), as the instant reads in `zone`. */
export function formatInstant(zoneName: string, ms: number): string {
  const offset = offsetMinutes(IANAZone.create(zoneName), ms);
  const local = new Date(ms + offset * MS_PER_MINUTE).toISOString().slice(0, 19);
  return `${local}${formatOffset(offset)}`;
}

/** RFC 3339 in UTC with a `+00:00` offset, second precision. */
export function formatUtcNow(): string {
  return `${new Date().toISOString().slice(0, 19)}+00:00`;
}
