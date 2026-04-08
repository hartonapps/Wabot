import fs from 'fs';
import path from 'path';

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, 'data');
export const SESSIONS_DIR = path.join(ROOT, 'sessions');
export const LOG_DIR = path.join(ROOT, 'logs');
export const USERS_FILE = path.join(DATA_DIR, 'users.json');
export const BOTS_FILE = path.join(DATA_DIR, 'bots.json');

export function ensureBaseDirs() {
  [DATA_DIR, SESSIONS_DIR, LOG_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  if (!fs.existsSync(BOTS_FILE)) fs.writeFileSync(BOTS_FILE, JSON.stringify({}, null, 2));
}

export function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJSON(file, payload) {
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

export function userSessionDir(username) {
  const p = path.join(SESSIONS_DIR, username);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

export function userBotConfigPath(username) {
  const p = path.join(SESSIONS_DIR, username, 'config.json');
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(defaultConfig(), null, 2));
  return p;
}

export function userCachePath(username) {
  return path.join(SESSIONS_DIR, username, 'cache.json');
}

export function userCapturedPath(username) {
  return path.join(SESSIONS_DIR, username, 'captured.json');
}

export function userMediaDir(username) {
  const p = path.join(SESSIONS_DIR, username, 'media');
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

export function defaultConfig() {
  return {
    prefix: '.',
    autoreply: { enabled: false, text: 'I will reply later.' },
    autoreact: { enabled: false, emojis: ['😀'] },
    antispam: false,
    autoviewonce: false,
    ghostmode: false,
    antidelete: false,
    antiedit: false
  };
}
