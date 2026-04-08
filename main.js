import fs from 'fs';
import path from 'path';
import pino from 'pino';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { ensureBaseDirs, readJSON, writeJSON, BOTS_FILE, userSessionDir, userBotConfigPath, userMediaDir, userCachePath, userCapturedPath, defaultConfig } from './utils/storage.js';
import { handleIncoming, handleSystemEvents, handleProtocol } from './commands/index.js';
import { log } from './utils/logger.js';

const running = new Map();

function loadUserConfig(username) {
  const file = userBotConfigPath(username);
  return { file, config: { ...defaultConfig(), ...readJSON(file, defaultConfig()) } };
}

function saveUserConfig(username, cfg) {
  writeJSON(userBotConfigPath(username), cfg);
}

async function startUserbot(username, opts = {}) {
  const existing = running.get(username);
  if (existing) return existing.sock;

  const sessionDir = userSessionDir(username);
  const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, 'auth'));
  const { config } = loadUserConfig(username);
  const mediaDir = userMediaDir(username);
  const cacheFile = userCachePath(username);
  const capturedFile = userCapturedPath(username);
  const cache = new Map(readJSON(cacheFile, []));
  const captureStore = readJSON(capturedFile, []);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  const ctx = {
    username,
    sock,
    config,
    mediaDir,
    cache,
    captureStore,
    selfJid: null,
    saveConfig: () => saveUserConfig(username, config),
    log: (scope, msg) => log(username, scope, msg)
  };

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      log(username, 'AUTH', 'QR generated for login.');
      qrcode.generate(qr, { small: true });
    }

    if (opts.pairingCode && opts.phone && !sock.authState.creds.registered && connection !== 'open') {
      try {
        const code = await sock.requestPairingCode(opts.phone);
        log(username, 'AUTH', `Pairing code: ${code}`);
        opts.pairingCode = false;
      } catch (e) {
        log(username, 'AUTH', `Pairing code request failed: ${e.message}`);
      }
    }

    if (connection === 'open') {
      ctx.selfJid = sock.user?.id;
      log(username, 'CONN', `Connected as ${ctx.selfJid}`);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const logout = code === DisconnectReason.loggedOut;
      log(username, 'CONN', `Disconnected code=${code} logout=${logout}`);
      fs.writeFileSync(cacheFile, JSON.stringify(Array.from(cache.entries()), null, 2));
      fs.writeFileSync(capturedFile, JSON.stringify(captureStore, null, 2));
      running.delete(username);

      const bots = readJSON(BOTS_FILE, {});
      const stillActive = Boolean(bots?.[username]?.active);
      if (!logout && stillActive) {
        setTimeout(() => startUserbot(username).catch((e) => log(username, 'ERR', e.message)), 5000);
      }
    }
  });

  sock.ev.on('messages.upsert', async (event) => {
    await handleSystemEvents(ctx, event).catch((e) => log(username, 'UPSERT', e.message));
    for (const msg of event.messages || []) {
      await handleIncoming(ctx, msg).catch((e) => log(username, 'CMD', e.message));
      if (msg?.message?.protocolMessage) {
        await handleProtocol(ctx, msg).catch((e) => log(username, 'PROTO', e.message));
      }
    }
  });

  running.set(username, { sock, ctx });
  return sock;
}

async function bootAllActive() {
  ensureBaseDirs();
  const bots = readJSON(BOTS_FILE, {});
  for (const [username, info] of Object.entries(bots)) {
    if (!info?.active) continue;
    await startUserbot(username).catch((e) => log(username, 'BOOT', e.message));
  }
}

export { startUserbot, running };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  bootAllActive().then(() => {
    console.log('Cypherus core started. Active sessions loaded.');
  });
}
