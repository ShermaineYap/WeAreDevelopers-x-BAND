// Generated identifiers: opaque IDs and human-facing booking references.
import { randomBytes, randomInt } from 'node:crypto';
import { GENERATED_REFERENCE_LENGTH, REFERENCE_ALPHABET } from './constants';

/** `<prefix>_<20 hex chars>`, well under the 64-character ID limit. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString('hex')}`;
}

/** A fresh reference of A-Z0-9 that `taken` does not already know. */
export function newReference(taken: (reference: string) => boolean): string {
  for (;;) {
    let reference = '';
    for (let i = 0; i < GENERATED_REFERENCE_LENGTH; i++) {
      reference += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
    }
    if (!taken(reference)) return reference;
  }
}
