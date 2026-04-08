import crypto from 'crypto';
import { ensureBaseDirs, readJSON, USERS_FILE, writeJSON } from './storage.js';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const [salt, saved] = encoded.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(saved));
}

export function registerUser(username, password) {
  ensureBaseDirs();
  const users = readJSON(USERS_FILE, []);
  if (users.find((u) => u.username === username)) {
    return { ok: false, error: 'Username already exists.' };
  }
  users.push({ username, password: hashPassword(password), createdAt: new Date().toISOString() });
  writeJSON(USERS_FILE, users);
  return { ok: true };
}

export function loginUser(username, password) {
  ensureBaseDirs();
  const users = readJSON(USERS_FILE, []);
  const user = users.find((u) => u.username === username);
  if (!user) return { ok: false, error: 'User not found.' };
  if (!verifyPassword(password, user.password)) return { ok: false, error: 'Invalid password.' };
  return { ok: true, user: { username } };
}
