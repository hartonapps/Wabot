import fs from 'fs';
import path from 'path';
import jimpModule from 'jimp';
import mime from 'mime-types';
import { downloadMediaMessage, getContentType } from '@whiskeysockets/baileys';
import pino from 'pino';

const Jimp = jimpModule?.Jimp || jimpModule;
const PNG_MIME = jimpModule?.JimpMime?.png || jimpModule?.MIME_PNG || 'image/png';

export async function downloadMessageMedia(sock, message) {
  const buffer = await downloadMediaMessage(
    message,
    'buffer',
    {},
    { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
  );
  return buffer;
}

export function getTextFromMessage(msg) {
  const m = msg?.message || {};
  const t = getContentType(m);
  if (t === 'conversation') return m.conversation || '';
  if (t === 'extendedTextMessage') return m.extendedTextMessage?.text || '';
  if (t === 'imageMessage') return m.imageMessage?.caption || '';
  if (t === 'videoMessage') return m.videoMessage?.caption || '';
  return '';
}

export function parseCommand(prefix, msg) {
  const text = getTextFromMessage(msg);
  if (!text || !text.startsWith(prefix)) return null;
  const body = text.slice(prefix.length).trim();
  const [cmd, ...args] = body.split(/\s+/);
  return { cmd: (cmd || '').toLowerCase(), args, text: body };
}

export function getQuoted(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const key = msg?.message?.extendedTextMessage?.contextInfo?.stanzaId;
  const participant = msg?.message?.extendedTextMessage?.contextInfo?.participant;
  const remoteJid = msg?.key?.remoteJid;
  if (!q) return null;
  return { key: { id: key, fromMe: false, participant, remoteJid }, message: q };
}

export async function stickerToImage(buffer) {
  const img = await Jimp.read(buffer);
  if (typeof img.getBufferAsync === 'function') {
    return await img.getBufferAsync(PNG_MIME);
  }
  return await img.getBuffer(PNG_MIME);
}

export async function saveBufferToFile(dir, buffer, ext = '.bin') {
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const file = path.join(dir, filename);
  fs.writeFileSync(file, buffer);
  return file;
}

export function extFromMimetype(type) {
  return mime.extension(type || '') ? `.${mime.extension(type)}` : '.bin';
}

export function unwrapViewOnce(message = {}) {
  const t = getContentType(message);
  if (['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'].includes(t)) {
    return message[t]?.message || {};
  }
  return message;
}
