import fs from 'fs';
import path from 'path';
import { LOG_DIR } from './storage.js';

export function log(username, scope, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${username}] [${scope}] ${msg}`;
  console.log(line);
  const file = path.join(LOG_DIR, `${username}.log`);
  fs.appendFileSync(file, `${line}\n`);
}
