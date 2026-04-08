import axios from 'axios';
import { create, all } from 'mathjs';

const math = create(all);

export async function askAI(prompt) {
  const url = 'https://api.affiliateplus.xyz/api/chatbot';
  const { data } = await axios.get(url, { params: { message: prompt, botname: 'Cypherus', ownername: 'User' }, timeout: 20000 });
  return data?.message || 'No response.';
}

export function summarizeText(input) {
  const clean = input.replace(/\s+/g, ' ').trim();
  if (clean.length <= 300) return clean;
  const parts = clean.split(/(?<=[.!?])\s+/);
  return parts.slice(0, 3).join(' ');
}

export async function translateText(text, target = 'en') {
  const { data } = await axios.post('https://libretranslate.de/translate', {
    q: text,
    source: 'auto',
    target,
    format: 'text'
  }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } });
  return data?.translatedText || 'Translation failed';
}

export async function shortenUrl(url) {
  const { data } = await axios.get('https://tinyurl.com/api-create.php', { params: { url }, timeout: 15000 });
  return String(data);
}

export function calculate(expression) {
  return String(math.evaluate(expression));
}

export async function resolveDownload(url) {
  if (/tiktok\.com/.test(url)) {
    const { data } = await axios.get('https://www.tikwm.com/api/', { params: { url }, timeout: 30000 });
    return {
      title: data?.data?.title || 'TikTok',
      type: 'video',
      media: data?.data?.play,
      meta: data?.data || {}
    };
  }

  if (/youtube\.com|youtu\.be/.test(url)) {
    return { title: 'YouTube link detected', type: 'link', media: url, meta: { note: 'Direct YouTube download is restricted; returning source URL.' } };
  }

  if (/instagram\.com/.test(url)) {
    const { data } = await axios.get('https://r.jina.ai/http://'+url, { timeout: 30000 });
    return { title: 'Instagram metadata', type: 'text', media: null, meta: { preview: String(data).slice(0, 1000) } };
  }

  return { title: 'Unknown URL', type: 'link', media: url, meta: {} };
}
