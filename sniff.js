// Runs in Instagram's own page (MAIN world). Watches Instagram's data responses for caption files
// (`video_subtitles_uri`) and passes {shortcode: url} to content.js. Reads only; never changes a response.
(() => {
  const KEY = 'video_subtitles_uri":"';
  const found = {};
  function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 60) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (typeof o.code === 'string' && typeof o.video_subtitles_uri === 'string' && !found[o.code]) {
      found[o.code] = o.video_subtitles_uri;
      window.postMessage({ icxSubs: { [o.code]: o.video_subtitles_uri } }, location.origin);
    }
    for (const k in o) walk(o[k], depth + 1);
  }
  function scan(text) {
    if (typeof text !== 'string' || !text.includes(KEY)) return;
    for (const part of text.replace(/^for \(;;\);/, '').split('\n')) {
      try { walk(JSON.parse(part), 0); } catch { /* not JSON */ }
    }
  }
  const of = window.fetch;
  window.fetch = function (...a) {
    const p = of.apply(this, a);
    p.then(r => r.clone().text().then(scan)).catch(() => {});
    return p;
  };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...a) {
    this.addEventListener('load', () => { try { if (!this.responseType || this.responseType === 'text') scan(this.responseText); } catch {} });
    return oo.apply(this, a);
  };
  // Data embedded in the first page load.
  const scanDom = () => document.querySelectorAll('script[type="application/json"]').forEach(s => scan(s.textContent));
  document.addEventListener('DOMContentLoaded', scanDom);
  window.addEventListener('message', e => { if (e.source === window && e.data?.icxRescan) scanDom(); });
})();
