// Opening hours (§4): per weekday, local HH:MM, closing later than opening on the same day.
import { WEEKDAYS, type Weekday } from './constants';
import { validationFailed } from './errors';
import { expectObject, expectString } from './shape';
import { parseClock } from './time';

export interface OpeningHours {
  weekday: Weekday;
  opens: string;
  closes: string;
}

export function parseOpeningHours(value: unknown, path: string): OpeningHours {
  const h = expectObject(value, path);
  const weekday = expectString(h, 'weekday', path);
  if (!(WEEKDAYS as readonly string[]).includes(weekday)) {
    throw validationFailed(`${path}.weekday must be one of ${WEEKDAYS.join(' ')}`);
  }
  const opens = expectString(h, 'opens', path);
  const closes = expectString(h, 'closes', path);
  const [o, c] = [parseClock(opens), parseClock(closes)];
  if (o === null || c === null) throw validationFailed(`${path} opens/closes must be HH:MM`);
  if (c <= o) throw validationFailed(`${path}.closes must be later than opens`);
  return { weekday: weekday as Weekday, opens, closes };
}
