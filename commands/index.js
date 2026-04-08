import fs from 'fs';
import qrcode from 'qrcode';
import axios from 'axios';
import { getContentType } from '@whiskeysockets/baileys';
import {
  parseCommand,
  getQuoted,
  downloadMessageMedia,
  stickerToImage,
  extFromMimetype,
  saveBufferToFile,
  unwrapViewOnce
} from '../utils/media.js';
import { askAI, summarizeText, translateText, shortenUrl, calculate, resolveDownload } from '../utils/freeApis.js';

function jidFromNumber(number) {
  const cleaned = String(number || '').replace(/\D/g, '');
  if (!cleaned) return null;
  return `${cleaned}@s.whatsapp.net`;
}

function mentionFromMessage(msg) {
  const ctx = msg?.message?.extendedTextMessage?.contextInfo;
  return ctx?.mentionedJid?.[0] || null;
}

export async function handleIncoming(ctx, msg) {
  const { sock, config, username, saveConfig, mediaDir, cache, captureStore, log } = ctx;

  const parsed = parseCommand(config.prefix, msg);
  const chatId = msg?.key?.remoteJid;
  const isGroup = chatId?.endsWith('@g.us');

  if (!parsed) {
    if (!msg?.key?.fromMe && config.autoreply.enabled) {
      await sock.sendMessage(chatId, { text: config.autoreply.text });
    }
    if (!msg?.key?.fromMe && config.autoreact.enabled) {
      await sock.sendMessage(chatId, { react: { text: config.autoreact.emojis[0] || '😀', key: msg.key } });
    }
    return;
  }

  const { cmd, args } = parsed;
  const reply = (text) => sock.sendMessage(chatId, { text }, { quoted: msg });

  if (config.antispam && !msg.key.fromMe) return;

  switch (cmd) {
    case 'ping':
      return reply('Pong ✅');
    case 'menu':
    case 'help':
      return reply(`*Cypherus Menu*\n\nCore: .ping .menu .logout .reset\nAutomation: .autoreply .autoreact .antispam .autoviewonce\nViewOnce: .vv .vvsave\nMedia: .s .toimg .kang .save\nDownload: .dl .meta\nAI: .gpt .ask .summarize .translate\nGroup: .tagall .kick .promote .demote .pin .unpin\nPrivacy: .ghostmode .antidelete .antiedit\nUtils: .qr .short .calc\nSpecial: .msg <number> <message>`);
    case 'logout':
      await reply('Logging out this WhatsApp session...');
      return sock.logout();
    case 'reset':
      Object.assign(config, {
        autoreply: { enabled: false, text: 'I will reply later.' },
        autoreact: { enabled: false, emojis: ['😀'] },
        antispam: false,
        autoviewonce: false,
        ghostmode: false,
        antidelete: false,
        antiedit: false
      });
      saveConfig();
      return reply('Config reset ✅');

    case 'autoreply': {
      const mode = (args[0] || '').toLowerCase();
      if (mode === 'off') config.autoreply.enabled = false;
      if (mode === 'on') {
        config.autoreply.enabled = true;
        config.autoreply.text = args.slice(1).join(' ') || config.autoreply.text;
      }
      saveConfig();
      return reply(`autoreply: ${config.autoreply.enabled ? 'on' : 'off'} ${config.autoreply.enabled ? `(${config.autoreply.text})` : ''}`);
    }
    case 'autoreact': {
      const mode = (args[0] || '').toLowerCase();
      if (mode === 'off') config.autoreact.enabled = false;
      if (mode === 'on') {
        config.autoreact.enabled = true;
        const emojiText = args.slice(1).join(' ').trim();
        if (emojiText) config.autoreact.emojis = emojiText.split(/\s+/);
      }
      saveConfig();
      return reply(`autoreact: ${config.autoreact.enabled ? 'on' : 'off'}`);
    }
    case 'antispam':
      config.antispam = (args[0] || 'off').toLowerCase() === 'on'; saveConfig(); return reply(`antispam: ${config.antispam ? 'on' : 'off'}`);
    case 'autoviewonce':
      config.autoviewonce = (args[0] || 'off').toLowerCase() === 'on'; saveConfig(); return reply(`autoviewonce: ${config.autoviewonce ? 'on' : 'off'}`);

    case 'vv':
    case 'vvsave': {
      const quoted = getQuoted(msg);
      if (!quoted) return reply('Reply to a view-once message.');
      const unwrapped = unwrapViewOnce(quoted.message);
      const type = getContentType(unwrapped);
      if (!['imageMessage', 'videoMessage'].includes(type)) return reply('Quoted item is not view-once image/video.');
      const qmsg = { key: quoted.key, message: unwrapped };
      const buffer = await downloadMessageMedia(sock, qmsg);
      if (!buffer) return reply('Failed to extract media.');
      if (type === 'imageMessage') await sock.sendMessage(chatId, { image: buffer, caption: 'Extracted by Cypherus .vv' }, { quoted: msg });
      if (type === 'videoMessage') await sock.sendMessage(chatId, { video: buffer, caption: 'Extracted by Cypherus .vv' }, { quoted: msg });
      return;
    }

    case 's':
    case 'kang': {
      const quoted = getQuoted(msg);
      if (!quoted) return reply('Reply to image/video/sticker.');
      const buffer = await downloadMessageMedia(sock, quoted);
      if (!buffer) return reply('Could not fetch media.');
      return sock.sendMessage(chatId, { sticker: buffer }, { quoted: msg });
    }

    case 'toimg': {
      const quoted = getQuoted(msg);
      if (!quoted) return reply('Reply to a sticker.');
      const buffer = await downloadMessageMedia(sock, quoted);
      const png = await stickerToImage(buffer);
      return sock.sendMessage(chatId, { image: png, caption: 'Converted from sticker' }, { quoted: msg });
    }

    case 'save': {
      const quoted = getQuoted(msg);
      if (!quoted) return reply('Reply to media to save.');
      const buffer = await downloadMessageMedia(sock, quoted);
      const t = getContentType(quoted.message);
      const inner = quoted.message[t] || {};
      const file = await saveBufferToFile(mediaDir, buffer, extFromMimetype(inner.mimetype));
      return reply(`Saved: ${file}`);
    }

    case 'dl': {
      const url = args[0];
      if (!url) return reply('Usage: .dl <url>');
      const data = await resolveDownload(url);
      if (data.type === 'video' && data.media) {
        return sock.sendMessage(chatId, { video: { url: data.media }, caption: data.title }, { quoted: msg });
      }
      return reply(`Title: ${data.title}\n${JSON.stringify(data.meta).slice(0, 1500)}`);
    }

    case 'meta': {
      const url = args[0];
      if (!url) return reply('Usage: .meta <url>');
      const data = await resolveDownload(url);
      return reply(JSON.stringify(data, null, 2).slice(0, 3500));
    }

    case 'gpt':
    case 'ask': {
      const text = args.join(' ');
      if (!text) return reply('Usage: .gpt <text>');
      const out = await askAI(text);
      return reply(out.slice(0, 3500));
    }
    case 'summarize': {
      const text = args.join(' ');
      if (!text) return reply('Usage: .summarize <text>');
      return reply(summarizeText(text));
    }
    case 'translate': {
      const full = args.join(' ');
      const match = full.match(/(.+)\s+to\s+([a-z]{2,5})$/i);
      if (!match) return reply('Usage: .translate <text> to <lang>');
      return reply(await translateText(match[1], match[2]));
    }

    case 'tagall': {
      if (!isGroup) return reply('Group only.');
      const data = await sock.groupMetadata(chatId);
      const mentions = data.participants.map((p) => p.id);
      const text = mentions.map((m) => `@${m.split('@')[0]}`).join(' ');
      return sock.sendMessage(chatId, { text, mentions }, { quoted: msg });
    }
    case 'kick':
    case 'promote':
    case 'demote': {
      if (!isGroup) return reply('Group only.');
      const target = mentionFromMessage(msg) || jidFromNumber(args[0]);
      if (!target) return reply(`Usage: .${cmd} @user`);
      if (cmd === 'kick') await sock.groupParticipantsUpdate(chatId, [target], 'remove');
      if (cmd === 'promote') await sock.groupParticipantsUpdate(chatId, [target], 'promote');
      if (cmd === 'demote') await sock.groupParticipantsUpdate(chatId, [target], 'demote');
      return reply(`${cmd} executed on ${target}`);
    }
    case 'pin':
      await sock.chatModify({ pin: true }, chatId, []); return reply('Pinned chat.');
    case 'unpin':
      await sock.chatModify({ pin: false }, chatId, []); return reply('Unpinned chat.');

    case 'ghostmode':
      config.ghostmode = (args[0] || '').toLowerCase() === 'on'; saveConfig(); return reply(`ghostmode: ${config.ghostmode ? 'on' : 'off'}`);
    case 'antidelete':
      config.antidelete = (args[0] || '').toLowerCase() === 'on'; saveConfig(); return reply(`antidelete: ${config.antidelete ? 'on' : 'off'}`);
    case 'antiedit':
      config.antiedit = (args[0] || '').toLowerCase() === 'on'; saveConfig(); return reply(`antiedit: ${config.antiedit ? 'on' : 'off'}`);

    case 'qr': {
      const text = args.join(' ');
      if (!text) return reply('Usage: .qr <text>');
      const image = await qrcode.toBuffer(text);
      return sock.sendMessage(chatId, { image, caption: 'QR generated' }, { quoted: msg });
    }
    case 'short': {
      const url = args[0];
      if (!url) return reply('Usage: .short <url>');
      return reply(await shortenUrl(url));
    }
    case 'calc': {
      const expression = args.join(' ');
      if (!expression) return reply('Usage: .calc <expression>');
      return reply(calculate(expression));
    }

    case 'msg': {
      const number = args[0];
      const text = args.slice(1).join(' ');
      const jid = jidFromNumber(number);
      if (!jid) return reply('Usage: .msg <number> <message>');
      const quoted = getQuoted(msg);
      if (quoted) {
        const buffer = await downloadMessageMedia(sock, quoted);
        if (buffer) {
          const type = getContentType(quoted.message);
          if (type === 'imageMessage') await sock.sendMessage(jid, { image: buffer, caption: text || '' });
          else if (type === 'videoMessage') await sock.sendMessage(jid, { video: buffer, caption: text || '' });
          else if (type === 'audioMessage') await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mp4', ptt: false });
          else await sock.sendMessage(jid, { document: buffer, fileName: 'media.bin', caption: text || '' });
          return reply(`Media message sent to ${number}`);
        }
      }
      if (!text) return reply('Usage: .msg <number> <message>');
      await sock.sendMessage(jid, { text });
      return reply(`Message sent to ${number}`);
    }

    default:
      return;
  }
}

export async function handleSystemEvents(ctx, update) {
  const { sock, config, selfJid, cache, captureStore, log } = ctx;

  if (update?.messages?.length) {
    for (const msg of update.messages) {
      if (!msg?.message || !msg?.key?.id) continue;
      cache.set(msg.key.id, msg);

      const t = getContentType(msg.message);
      if (config.autoviewonce && ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'].includes(t)) {
        const cloned = { ...msg, message: unwrapViewOnce(msg.message) };
        captureStore.push({ at: Date.now(), type: 'viewonce', msg: cloned });
        const inner = getContentType(cloned.message);
        const buffer = await downloadMessageMedia(sock, cloned).catch(() => null);
        if (buffer) {
          if (inner === 'imageMessage') await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption: '[Auto ViewOnce Save]' });
          if (inner === 'videoMessage') await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: '[Auto ViewOnce Save]' });
        }
      }

      if (!msg.key.fromMe && !config.ghostmode) {
        await sock.readMessages([msg.key]).catch(() => {});
      }
    }
  }

  if (update?.type === 'notify' && update.messages) {
    for (const m of update.messages) await handleIncoming(ctx, m);
  }
}

export async function handleProtocol(ctx, msg) {
  const { config, cache, sock } = ctx;
  const protocol = msg?.message?.protocolMessage;
  if (!protocol) return;

  if (protocol.type === 0 && config.antidelete) {
    const original = cache.get(protocol.key?.id);
    if (original) {
      const text = `🛡️ AntiDelete\nUser deleted: ${protocol.key?.id}`;
      await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: original }).catch(() => {});
    }
  }

  if (protocol.type === 14 && config.antiedit) {
    const text = `🛡️ AntiEdit\nMessage edited: ${protocol.key?.id}`;
    await sock.sendMessage(msg.key.remoteJid, { text }).catch(() => {});
  }
}
