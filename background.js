// Transcript requests from content.js.
// 1. Instagram's own caption file (subsUrl) when the page exposed one.
// 2. Otherwise the native helper: yt-dlp + whisper.cpp on this Mac.
const HOST = 'com.instacontrols.host';
const cache = new Map();

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'transcript') return;
  const key = msg.url;
  if (!cache.has(key)) cache.set(key, transcript(msg).catch(e => { cache.delete(key); return { error: e.message }; }));
  cache.get(key).then(reply);
  return true;
});

async function transcript({ url, subsUrl }) {
  if (subsUrl && /^https:\/\/[^/]+\.(fbcdn\.net|cdninstagram\.com)\//.test(subsUrl)) {
    try {
      const text = captionText(await (await fetch(subsUrl)).text());
      if (text) return { text, source: 'instagram' };
    } catch { /* fall through to speech-to-text */ }
  }
  const jar = await chrome.cookies.getAll({ domain: 'instagram.com' });
  const res = await native({ url, jar });
  if (res.error) throw new Error(res.error);
  return { text: res.text, source: 'whisper' };
}

// WebVTT / SRT -> plain text: drop headers, cue numbers, timings, tags and repeated lines.
function captionText(raw) {
  const out = [];
  for (let line of raw.replace(/\r/g, '').split('\n')) {
    line = line.replace(/<[^>]+>/g, '').trim();
    if (!line || /^WEBVTT|^NOTE\b|^STYLE|^\d+$|-->/.test(line)) continue;
    if (out[out.length - 1] !== line) out.push(line);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function native(msg) {
  return new Promise(resolve => {
    let port;
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { return resolve({ error: 'helper-missing' }); }
    let done = false;
    port.onMessage.addListener(m => { done = true; resolve(m); port.disconnect(); });
    port.onDisconnect.addListener(() => {
      if (done) return;
      const err = chrome.runtime.lastError?.message || '';
      resolve({ error: /not found|forbidden/i.test(err) ? 'helper-missing' : err || 'Helper stopped' });
    });
    port.postMessage(msg);
  });
}
