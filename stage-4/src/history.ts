// Reservation history (stage 3): an append-only record per reservation with contiguous
// `seq`, each entry carrying the resulting revision and accepted terms.
import { db } from './db';
import {
  insertHistory, historyDbRow, type Change, type HistoryEvent, type HistoryRow, type ReservationRow,
} from './state';
import { termsView } from './terms';
import { formatUtcNow } from './time';

const selectEntries = db.prepare(
  'SELECT seq, at, event, changes, revision, accepted_terms FROM history WHERE reservation_id = ? ORDER BY seq');
const selectLastSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM history WHERE reservation_id = ?');

/**
 * The table-set change between two sets: `table_id` while both are single tables, otherwise
 * `table_ids` with the complete before and after lists (stage 3 combined-table history).
 */
function tableChange(from: string[] | null, to: string[]): Change {
  const single = (ids: string[] | null) => ids === null || ids.length === 1;
  return single(from) && single(to)
    ? { field: 'table_id', from: from === null ? null : from[0], to: to[0] }
    : { field: 'table_ids', from, to };
}

/** The changes a creation records: every field, from null. */
export function creationChanges(r: ReservationRow): Change[] {
  return [
    tableChange(null, r.table_ids),
    { field: 'starts_at_local', from: null, to: r.starts_at_local },
    { field: 'party_size', from: null, to: r.party_size },
  ];
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Only the fields that differ, in the order table, starts_at_local, party_size. */
export function amendmentChanges(before: ReservationRow, after: ReservationRow): Change[] {
  const changes: Change[] = [];
  if (!sameSet(before.table_ids, after.table_ids)) changes.push(tableChange(before.table_ids, after.table_ids));
  if (before.starts_at_local !== after.starts_at_local) {
    changes.push({ field: 'starts_at_local', from: before.starts_at_local, to: after.starts_at_local });
  }
  if (before.party_size !== after.party_size) changes.push({ field: 'party_size', from: before.party_size, to: after.party_size });
  return changes;
}

/** Appends an entry for `row` as it is after the event. */
export function record(row: ReservationRow, event: HistoryEvent, changes: Change[]): void {
  const seq = (selectLastSeq.get(row.id) as { seq: number }).seq + 1;
  const entry: HistoryRow = {
    reservation_id: row.id, seq, at: formatUtcNow(), event, changes,
    revision: row.revision, accepted_terms: row.accepted_terms,
  };
  insertHistory.run(historyDbRow(entry));
}

export function entriesOf(reservationId: string) {
  return (selectEntries.all(reservationId) as { seq: number; at: string; event: string; changes: string; revision: number; accepted_terms: string }[])
    .map((e) => ({
      seq: e.seq, at: e.at, event: e.event, changes: JSON.parse(e.changes) as Change[],
      revision: e.revision, accepted_terms: termsView(JSON.parse(e.accepted_terms)),
    }));
}
