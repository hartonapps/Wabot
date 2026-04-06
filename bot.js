// !/usr/bin/env node

import fs from 'fs'
import path from 'path'
import pino from 'pino'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  downloadMediaMessage
} from '@whiskeysockets/baileys'

import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = __dirname
const AUTH_DIR = path.join(ROOT, 'auth');
const DATA_DIR = path.join(ROOT, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const CAPTURED_PATH = path.join(DATA_DIR, 'captured_messages.json');
const MESSAGE_CACHE_PATH = path.join(DATA_DIR, 'message_cache.json');

const DEFAULT_CONFIG = {
  prefix: '!',
  viewOnceEnabled: true,
  deletedEnabled: true,
  autoTrackContacts: true,
  trackedContacts: [],
  autoReactEnabled: false,
  autoReactEmoji: '👀',
  autoReactContacts: []
};

const state = {
  config: null,
  sock: null,
  selfJid: null,
  startedAt: Date.now(),
  messageCache: new Map(),
  capturedIndex: new Set()
};

function ensureDirs() {
  [AUTH_DIR, DATA_DIR, MEDIA_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function mergeConfig(config) {
  return {
    ...DEFAULT_CONFIG,
    ...(config || {}),
    trackedContacts: Array.isArray(config?.trackedContacts) ? config.trackedContacts : [],
    autoReactContacts: Array.isArray(config?.autoReactContacts) ? config.autoReactContacts : []
  };
}

function loadConfig() {
  state.config = mergeConfig(readJSON(CONFIG_PATH, DEFAULT_CONFIG));
  writeJSON(CONFIG_PATH, state.config);
}

function saveConfig() {
  writeJSON(CONFIG_PATH, state.config);
}

function loadMessageCache() {
  const cached = readJSON(MESSAGE_CACHE_PATH, {});
  for (const [key, value] of Object.entries(cached)) {
    state.messageCache.set(key, value);
  }
}

function saveMessageCache() {
  const obj = Object.fromEntries(state.messageCache.entries());
  writeJSON(MESSAGE_CACHE_PATH, obj);
}

function loadCapturedIndex() {
  const captured = readJSON(CAPTURED_PATH, []);
  for (const item of captured) {
    if (item?.captureKey) state.capturedIndex.add(item.captureKey);
  }
}

function appendCaptured(entry) {
  const captured = readJSON(CAPTURED_PATH, []);
  captured.push(entry);
  writeJSON(CAPTURED_PATH, captured);
}

function ts() {
  return new Date().toISOString();
}

function log(scope, message, extra = '') {
  const suffix = extra ? ` | ${extra}` : '';
  console.log(`[${ts()}] [${scope}] ${message}${suffix}`);
}

function normalizeJid(jid) {
  if (!jid) return '';
  return jidNormalizedUser(jid);
}

function numberToJid(number) {
  const cleaned = String(number || '').replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  return `${cleaned}@s.whatsapp.net`;
}

function messageKey(chatJid, messageId) {
  return `${chatJid || ''}:${messageId || ''}`;
}

function cacheMessage(msg) {
  try {
    const key = msg?.key;
    if (!key?.id || !key?.remoteJid || !msg?.message) return;
    const chatJid = normalizeJid(key.remoteJid);
    const cacheKey = messageKey(chatJid, key.id);
    state.messageCache.set(cacheKey, {
      key,
      message: msg.message,
      messageTimestamp: msg.messageTimestamp,
      pushName: msg.pushName || null
    });
    if (state.messageCache.size > 5000) {
      const first = state.messageCache.keys().next().value;
      state.messageCache.delete(first);
    }
  } catch (err) {
    log('CACHE', 'Failed to cache message', err.message);
  }
}

function detectMessageType(messageContent) {
  if (!messageContent) return 'unknown';
  const type = getContentType(messageContent);
  if (!type) return 'unknown';
  if (type === 'viewOnceMessage' || type === 'viewOnceMessageV2' || type === 'viewOnceMessageV2Extension') {
    const inner = messageContent[type]?.message;
    return detectMessageType(inner);
  }
  return type;
}

function unwrapViewOnce(messageContent) {
  if (!messageContent) return { unwrapped: null, wasViewOnce: false };
  const type = getContentType(messageContent);
  if (!type) return { unwrapped: messageContent, wasViewOnce: false };
  if (type === 'viewOnceMessage' || type === 'viewOnceMessageV2' || type === 'viewOnceMessageV2Extension') {
    return {
      unwrapped: messageContent[type]?.message || null,
      wasViewOnce: true
    };
  }
  return { unwrapped: messageContent, wasViewOnce: false };
}

async function trySaveMedia(messageObj, messageId) {
  try {
    const buffer = await downloadMediaMessage(
      messageObj,
      'buffer',
      {},
      { logger: pino({ level: 'silent' }), reuploadRequest: state.sock.updateMediaMessage }
    );

    if (!buffer) return null;

    const ext = '.bin';
    const filename = `${Date.now()}_${messageId}${ext}`;
    const fullPath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(fullPath, buffer);
    return fullPath;
  } catch {
    return null;
  }
}

async function forwardCaptureToSelf(entry, sourceMessage) {
  const selfJid = state.selfJid;
  if (!selfJid) return;

  const header = [
    '📦 *Captured Message*',
    `• reason: ${entry.reason}`,
    `• from: ${entry.sender || 'unknown'}`,
    `• chat: ${entry.chat || 'unknown'}`,
    `• type: ${entry.type}`,
    `• time: ${entry.time}`,
    entry.group ? `• group: ${entry.group}` : null
  ].filter(Boolean).join('\n');

  try {
    const msg = sourceMessage?.message || sourceMessage;
    const unwrapped = unwrapViewOnce(msg).unwrapped || msg;
    const msgType = getContentType(unwrapped || {});

    if (msgType === 'conversation' || msgType === 'extendedTextMessage') {
      const text = unwrapped.conversation || unwrapped.extendedTextMessage?.text || '';
      await state.sock.sendMessage(selfJid, { text: `${header}\n\n📝 ${text}` });
      return;
    }

    const mediaPath = await trySaveMedia(sourceMessage, entry.id || 'unknown');
    if (mediaPath) {
      await state.sock.sendMessage(selfJid, {
        document: fs.readFileSync(mediaPath),
        fileName: path.basename(mediaPath),
        mimetype: 'application/octet-stream',
        caption: header
      });
      return;
    }

    await state.sock.sendMessage(selfJid, { text: `${header}\n\n⚠️ Media/Text unavailable for forward.` });
  } catch (err) {
    log('FORWARD', 'Failed to forward captured message', err.message);
  }
}

function addTrackedContact(jid) {
  if (!jid || jid.endsWith('@g.us')) return;
  if (!state.config.trackedContacts.includes(jid)) {
    state.config.trackedContacts.push(jid);
    saveConfig();
    log('CONTACT', 'Tracked contact added', jid);
  }
}

function isCommand(text) {
  return typeof text === 'string' && text.startsWith(state.config.prefix);
}

function parseTextMessage(message) {
  const type = getContentType(message || {});
  if (type === 'conversation') return message.conversation;
  if (type === 'extendedTextMessage') return message.extendedTextMessage?.text || '';
  return '';
}

async function handleCommand(msg) {
  const key = msg?.key;
  const text = parseTextMessage(msg?.message);
  if (!isCommand(text)) return false;

  const sender = normalizeJid(key?.participant || key?.remoteJid);
  if (sender !== state.selfJid && !key?.fromMe) return false;

  const args = text.slice(state.config.prefix.length).trim().split(/\s+/);
  const command = (args.shift() || '').toLowerCase();

  const reply = async (textReply) => {
    await state.sock.sendMessage(state.selfJid, { text: textReply });
  };

  try {
    switch (command) {
      case 'ping': {
        const uptime = Math.floor((Date.now() - state.startedAt) / 1000);
        await reply(`pong ✅ online | uptime: ${uptime}s`);
        log('CMD', 'ping executed');
        break;
      }
      case 'block': {
        const jid = numberToJid(args[0]);
        if (!jid) {
          await reply('Usage: !block <number>');
          break;
        }
        await state.sock.updateBlockStatus(jid, 'block');
        await reply(`Blocked: ${jid}`);
        log('CMD', 'block executed', jid);
        break;
      }
      case 'unblock': {
        const jid = numberToJid(args[0]);
        if (!jid) {
          await reply('Usage: !unblock <number>');
          break;
        }
        await state.sock.updateBlockStatus(jid, 'unblock');
        await reply(`Unblocked: ${jid}`);
        log('CMD', 'unblock executed', jid);
        break;
      }
      case 'viewonce': {
        const val = (args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(val)) {
          await reply('Usage: !viewonce <on/off>');
          break;
        }
        state.config.viewOnceEnabled = val === 'on';
        saveConfig();
        await reply(`view-once auto-save: ${val}`);
        log('CMD', 'viewonce toggled', val);
        break;
      }
      case 'deleted': {
        const val = (args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(val)) {
          await reply('Usage: !deleted <on/off>');
          break;
        }
        state.config.deletedEnabled = val === 'on';
        saveConfig();
        await reply(`deleted-message auto-save: ${val}`);
        log('CMD', 'deleted toggled', val);
        break;
      }
      case 'contacts': {
        const list = state.config.trackedContacts;
        await reply(list.length ? `Tracked contacts:\n${list.join('\n')}` : 'No tracked contacts.');
        log('CMD', 'contacts listed', String(list.length));
        break;
      }
      case 'track': {
        const jid = numberToJid(args[0]);
        if (!jid) {
          await reply('Usage: !track <number>');
          break;
        }
        addTrackedContact(jid);
        await reply(`Tracked: ${jid}`);
        log('CMD', 'track executed', jid);
        break;
      }
      case 'untrack': {
        const jid = numberToJid(args[0]);
        if (!jid) {
          await reply('Usage: !untrack <number>');
          break;
        }
        state.config.trackedContacts = state.config.trackedContacts.filter((v) => v !== jid);
        saveConfig();
        await reply(`Untracked: ${jid}`);
        log('CMD', 'untrack executed', jid);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    log('CMD', 'Command failed', `${command}: ${err.message}`);
    await state.sock.sendMessage(state.selfJid, { text: `Command error: ${command}` });
  }

  return true;
}

function buildCaptureEntry(reason, source, msgObj, originalKey) {
  const key = originalKey || msgObj?.key || {};
  const chat = normalizeJid(key.remoteJid);
  const sender = normalizeJid(key.participant || key.remoteJid);
  const isGroup = chat.endsWith('@g.us');
  const type = detectMessageType(msgObj?.message);

  return {
    captureKey: `${reason}:${chat}:${key.id || 'unknown'}`,
    reason,
    id: key.id || null,
    sender,
    chat,
    group: isGroup ? chat : null,
    fromMe: Boolean(key.fromMe),
    type,
    source,
    time: new Date().toISOString(),
    messageTimestamp: msgObj?.messageTimestamp || null,
    message: msgObj?.message || null,
    mediaPath: null
  };
}

async function captureMessage(reason, source, msgObj, originalKey) {
  const entry = buildCaptureEntry(reason, source, msgObj, originalKey);
  if (state.capturedIndex.has(entry.captureKey)) return;
  state.capturedIndex.add(entry.captureKey);

  const mediaPath = await trySaveMedia(msgObj, entry.id || 'unknown');
  if (mediaPath) entry.mediaPath = mediaPath;

  appendCaptured(entry);
  await forwardCaptureToSelf(entry, msgObj);

  log('CAPTURE', `${reason} saved`, `${entry.type} | ${entry.chat}`);
}

async function handleUpsert(messages) {
  for (const msg of messages) {
    if (!msg?.message || !msg?.key?.remoteJid) continue;

    const chatJid = normalizeJid(msg.key.remoteJid);
    const senderJid = normalizeJid(msg.key.participant || msg.key.remoteJid);

    if (state.config.autoTrackContacts && !senderJid.endsWith('@g.us')) addTrackedContact(senderJid);

    if (state.config.autoReactEnabled && state.config.autoReactContacts.includes(senderJid) && !msg.key.fromMe) {
      try {
        await state.sock.sendMessage(chatJid, {
          react: {
            text: state.config.autoReactEmoji,
            key: msg.key
          }
        });
      } catch {
        // ignore react errors
      }
    }

    const handledCmd = await handleCommand(msg);
    if (handledCmd) continue;

    cacheMessage(msg);

    const msgType = getContentType(msg.message);
    const isVO = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'].includes(msgType);
    if (isVO && state.config.viewOnceEnabled) {
      await captureMessage('view-once', 'messages.upsert', msg, msg.key);
    }

    if (msgType === 'protocolMessage') {
      const protocol = msg.message.protocolMessage;
      if (protocol?.type === 0 && state.config.deletedEnabled) {
        const target = protocol.key;
        const cacheKey = messageKey(normalizeJid(target?.remoteJid || chatJid), target?.id);
        const original = state.messageCache.get(cacheKey);
        if (original) {
          await captureMessage('deleted', 'protocolMessage', original, target);
        } else {
          log('CAPTURE', 'Deleted message detected but original not found in cache', cacheKey);
        }
      }
    }
  }
}

async function connectBot() {
  ensureDirs();
  loadConfig();
  loadMessageCache();
  loadCapturedIndex();

  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: authState,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false
  });

  state.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (update?.qr) {
      log('AUTH', 'QR generated. Scan in WhatsApp Linked Devices.');
    }

    if (connection === 'open') {
      state.selfJid = normalizeJid(sock.user?.id);
      log('CONN', 'Connected', state.selfJid);
      await sock.sendMessage(state.selfJid, { text: '✅ Bot connected and running.' }).catch(() => {});
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      log('CONN', 'Disconnected', `code=${code || 'unknown'} loggedOut=${loggedOut}`);
      saveMessageCache();

      if (!loggedOut) {
        setTimeout(() => {
          connectBot().catch((err) => log('CONN', 'Reconnect failed', err.message));
        }, 3000);
      } else {
        log('AUTH', 'Session logged out. Delete auth/ and re-link.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      await handleUpsert(messages || []);
    } catch (err) {
      log('UPSERT', 'Error processing messages', err.message);
    }
  });

  const gracefulExit = () => {
    log('SYS', 'Shutting down, saving cache...');
    try { saveMessageCache(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', gracefulExit);
  process.on('SIGTERM', gracefulExit);
}

connectBot().catch((err) => {
  log('BOOT', 'Fatal startup error', err.message);
  process.exit(1);
});
