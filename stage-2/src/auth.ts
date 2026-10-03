// Accounts, password hashing and bearer tokens (§6).
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { BCRYPT_COST, MIN_PASSWORD_LENGTH } from './constants';
import { db, inTransaction } from './db';
import { conflict, unauthenticated, validationFailed } from './errors';
import { assertStringTyped, stringField } from './fields';
import { newId } from './ids';
import type { JsonObject } from './shape';
import { emailKey, type UserRow } from './state';

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const BEARER_RE = /^Bearer +(\S+)$/i;

// bcrypt reads at most 72 bytes; a SHA-256 pre-hash keeps every character significant.
const prehash = (password: string) => createHash('sha256').update(password, 'utf8').digest('base64');

export const hashPassword = (password: string) => bcrypt.hash(prehash(password), BCRYPT_COST);
const verifyPassword = (password: string, hash: string) => bcrypt.compare(prehash(password), hash);

/** Tokens are stored only as their SHA-256 digest. */
export const tokenDigest = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

const selectUserByEmail = db.prepare(
  'SELECT id, email, password_hash, display_name FROM users WHERE email_key = ?');
const selectUserById = db.prepare('SELECT id, password_hash FROM users WHERE id = ?');
const insertUser = db.prepare(
  `INSERT INTO users (id, email, email_key, password_hash, display_name)
   VALUES (?, ?, ?, ?, ?)`);
const insertToken = db.prepare('INSERT INTO tokens (token_hash, user_id) VALUES (?, ?)');
const selectTokenUser = db.prepare(
  'SELECT u.id FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?');

function issueToken(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  insertToken.run(tokenDigest(token), userId);
  return token;
}

/** The user id behind an `Authorization: Bearer <token>` header, or 401. */
export function authenticate(header: string | undefined): string {
  const match = header ? BEARER_RE.exec(header.trim()) : null;
  if (!match) throw unauthenticated();
  const row = selectTokenUser.get(tokenDigest(match[1])) as { id: string } | undefined;
  if (!row) throw unauthenticated();
  return row.id;
}

interface Session {
  user_id: string;
  display_name: string;
  token: string;
}

export async function signup(body: JsonObject): Promise<Session> {
  assertStringTyped(body, ['email', 'password', 'display_name']);
  const email = stringField(body, 'email', true)!;
  const password = stringField(body, 'password', true)!;
  const displayName = stringField(body, 'display_name', true)!;
  if (!EMAIL_RE.test(email)) throw validationFailed('email must be of the form local@domain');
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw validationFailed(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const taken = () => conflict('email_taken', 'That email is already registered');
  if (selectUserByEmail.get(emailKey(email))) throw taken();
  const hash = await hashPassword(password);
  // Re-checked inside the write: a concurrent signup may have claimed the email meanwhile.
  return inTransaction(() => {
    if (selectUserByEmail.get(emailKey(email))) throw taken();
    const userId = newId('u');
    insertUser.run(userId, email, emailKey(email), hash, displayName);
    return { user_id: userId, display_name: displayName, token: issueToken(userId) };
  });
}

// Compared against when the email is unknown, so both failures cost the same.
const decoyHash = bcrypt.hashSync(prehash('decoy password'), BCRYPT_COST);

export async function login(body: JsonObject): Promise<Session> {
  assertStringTyped(body, ['email', 'password']);
  const email = stringField(body, 'email', true)!;
  const password = stringField(body, 'password', true)!;
  const user = selectUserByEmail.get(emailKey(email)) as UserRow | undefined;
  const ok = await verifyPassword(password, user?.password_hash ?? decoyHash);
  const failure = () => unauthenticated('Wrong email or password');
  if (!user || !ok) throw failure();
  return inTransaction(() => {
    // The account may have been replaced by a reset/import while the hash was compared.
    const current = selectUserById.get(user.id) as { password_hash: string } | undefined;
    if (!current || current.password_hash !== user.password_hash) throw failure();
    return { user_id: user.id, display_name: user.display_name, token: issueToken(user.id) };
  });
}
