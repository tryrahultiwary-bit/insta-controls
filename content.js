// Insta Controls — YouTube-style controls for every <video> on instagram.com.
// Videos are found by tag (MutationObserver), never by Instagram's class names.
(() => {
  'use strict';

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const DEF = { bar: true, keys: true, loop: true, autoScroll: false, remember: true, clickPause: true, speed: 1 };
  let S = { ...DEF };
  const P = { volume: 1, muted: null, rate: 1 }; // what the user last chose (muted null = never chose: leave Instagram's default)
  let ready = false;

  const safe = fn => { try { fn(); } catch { /* extension reloaded: context gone */ } };
  safe(() => chrome.storage.sync.get(DEF, s => {
    S = s;
    chrome.storage.local.get({ volume: 1, muted: null, rate: s.speed }, l => {
      if (s.remember) Object.assign(P, l); else P.rate = s.speed;
      ready = true;
      videos.forEach(v => apply(v, true));
    });
  }));
  safe(() => chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'sync') return;
    for (const k in ch) S[k] = ch[k].newValue;
    if (ch.speed) P.rate = S.speed;
    if (!S.bar) hide();
    videos.forEach(v => apply(v, false));
    render();
  }));
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => safe(() => chrome.storage.local.set(P)), 300); };

  // ---------- video tracking ----------
  const videos = new Set();
  const touched = new WeakSet();   // videos the user changed through us this session
  const fights = new WeakMap();    // video -> [timestamps] of re-applies, to give up on loops
  const lastT = new WeakMap();
  let lastInput = 0;               // last trusted pointer/key input outside our bar

  function track(v) {
    if (videos.has(v)) return;
    videos.add(v);
    v.addEventListener('loadstart', () => apply(v, true));
    v.addEventListener('play', () => apply(v, true));
    v.addEventListener('volumechange', () => onVol(v));
    v.addEventListener('ratechange', () => { if (ready && v.playbackRate !== P.rate && !fought(v)) v.playbackRate = P.rate; });
    v.addEventListener('timeupdate', () => {
      const t = v.currentTime, p = lastT.get(v) || 0;
      lastT.set(v, t);
      if (v.duration > 1 && p > v.duration - 0.8 && t < 0.5) onEnd(v); // looped (Instagram restarts instead of ending)
    });
    v.addEventListener('ended', () => onEnd(v));
    apply(v, true);
  }
  new MutationObserver(ms => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'VIDEO') track(n);
      else if (n.firstElementChild) n.querySelectorAll('video').forEach(track);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('video').forEach(track);

  const canUnmute = () => navigator.userActivation?.hasBeenActive !== false;
  function applyVol(v) {
    if (Math.abs(v.volume - P.volume) > 0.001) v.volume = P.volume;
    if (P.muted !== null && v.muted !== P.muted && (P.muted || canUnmute())) v.muted = P.muted; // unmuting before any click would pause it
  }
  function apply(v, fresh) {
    if (!ready) return;
    if (v.playbackRate !== P.rate) v.playbackRate = P.rate;
    if (S.remember || touched.has(v)) applyVol(v);
    v.loop = S.loop && !S.autoScroll;
    if (fresh) fights.delete(v);
  }
  // Give up re-applying after 4 rounds in 2 s so we never ping-pong with the page.
  function fought(v) {
    const now = Date.now(), a = (fights.get(v) || []).filter(t => now - t < 2000);
    a.push(now); fights.set(v, a);
    return a.length > 4;
  }
  function onVol(v) {
    if (!ready) return;
    if (v === cur) render();
    const differs = (P.muted !== null && v.muted !== P.muted) || Math.abs(v.volume - P.volume) > 0.001;
    if (!differs) return;
    if (Date.now() - lastInput < 600) { // user used Instagram's own speaker button: adopt it
      P.muted = v.muted; P.volume = v.volume; touched.add(v); save();
    } else if ((S.remember || touched.has(v)) && !fought(v)) {
      applyVol(v);                     // page changed it on its own: put the user's choice back
    }
  }

  let endT = 0;
  function onEnd(v) {
    if (v !== mainVideo() || Date.now() - endT < 1500) return;
    endT = Date.now();
    if (S.autoScroll) go(1);
    else if (!S.loop) v.pause();
  }

  // ---------- helpers ----------
  const stories = () => location.pathname.startsWith('/stories/');
  // Ancestors that clip the video (carousel tracks, scrollers). Cached briefly: walked on every frame otherwise.
  const clipCache = new WeakMap();
  function clippers(v) {
    const c = clipCache.get(v);
    if (c && performance.now() - c.t < 1000) return c.els;
    const els = [];
    for (let e = v.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') els.push(e);
    }
    clipCache.set(v, { t: performance.now(), els });
    return els;
  }
  // The part of the video actually on screen: its rect cut by the viewport and every clipping ancestor.
  // A video on another carousel slide has a real rect, but it's clipped to nothing.
  function visibleRect(v) {
    const r = v.getBoundingClientRect();
    let l = Math.max(r.left, 0), t = Math.max(r.top, 0), rt = Math.min(r.right, innerWidth), b = Math.min(r.bottom, innerHeight);
    for (const e of clippers(v)) {
      const c = e.getBoundingClientRect();
      l = Math.max(l, c.left); t = Math.max(t, c.top); rt = Math.min(rt, c.right); b = Math.min(b, c.bottom);
    }
    return rt - l > 1 && b - t > 1 ? { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t } : null;
  }
  function visibleArea(v) {
    const r = visibleRect(v);
    return r ? r.width * r.height : 0;
  }
  // Click the carousel's own arrow. English labels only; elsewhere arrows fall back to seeking.
  function slide(v, dir) {
    const label = dir > 0 ? 'Next' : 'Go back';
    for (let e = v.closest('ul'), i = 0; e && i < 8; e = e.parentElement, i++) {
      const b = e.querySelector(`button[aria-label="${label}"]`);
      if (b) { b.click(); return true; }
    }
    return false;
  }
  const carousel = v => !!v.closest('li')?.parentElement?.querySelector(':scope > li ~ li');
  // Single post / Reel page or the post dialog: Instagram has its own next/previous there.
  const singlePost = v => !!v.closest('[role="dialog"]') || stories() || /^\/(?:[\w.]+\/)?(p|reel|tv)\//.test(location.pathname);
  function live() {
    const out = [];
    for (const v of videos) if (v.isConnected) out.push(v); else videos.delete(v);
    return out;
  }
  function mainVideo() {
    return cur && cur.isConnected && visibleArea(cur) > 0 ? cur : topVideo();
  }
  function topVideo() {
    let best = null, ba = 0;
    for (const v of live()) {
      const a = visibleArea(v) * (v.paused ? 1 : 2);
      if (a > ba) { ba = a; best = v; }
    }
    return best;
  }
  function videoAt(x, y) {
    let hit = null;
    for (const v of live()) {
      const full = v.getBoundingClientRect(), r = visibleRect(v);
      if (full.width < 120 || full.height < 80 || !r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (getComputedStyle(v).visibility === 'hidden' || covered(v, x, y)) continue;
      if (!hit || (hit.paused && !v.paused)) hit = v;
    }
    return hit;
  }
  function covered(v, x, y) { // a dialog that doesn't hold this video is on top of it
    const top = document.elementFromPoint(x, y), dlg = top?.closest('[role="dialog"]');
    return !!dlg && !dlg.contains(v);
  }
  const fmt = s => {
    if (!isFinite(s)) return '0:00';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  function scroller(el) {
    for (let e = el?.parentElement; e && e !== document.body; e = e.parentElement) {
      const o = getComputedStyle(e).overflowY;
      if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 10) return e;
    }
    return document.scrollingElement;
  }

  // Next / previous Reel or post. Uses <article> (feed posts) when present, else the videos themselves (Reels).
  let goT = 0;
  function go(dir) {
    if (Date.now() - goT < 450) return;
    goT = Date.now();
    const v = mainVideo();
    const arts = [...document.querySelectorAll('article')];
    const useArts = arts.length > 1;
    const items = (useArts ? arts : live().filter(x => x.getBoundingClientRect().height > 80))
      .map(el => ({ el, top: el.getBoundingClientRect().top })).sort((a, b) => a.top - b.top);
    const ref = items.find(i => v && (i.el === v || i.el.contains(v)));
    const refTop = ref ? ref.top : 0;
    const target = dir > 0 ? items.find(i => i.top > refTop + 10) : items.filter(i => i.top < refTop - 10).pop();
    if (target) target.el.scrollIntoView({ behavior: 'smooth', block: useArts ? 'start' : 'center' });
    else { const sc = scroller(v); sc.scrollBy({ top: dir * sc.clientHeight, behavior: 'smooth' }); }
    toastAt(v, dir > 0 ? 'Next' : 'Previous');
  }

  // ---------- copy link + transcript ----------
  const subs = {}; // shortcode -> Instagram caption file, reported by sniff.js
  window.addEventListener('message', e => { if (e.source === window && e.data?.icxSubs) Object.assign(subs, e.data.icxSubs); });
  const CODE_RE = /\/(reels?|p|tv)\/([\w-]+)/;
  const link = (kind, code) => `https://www.instagram.com/${kind === 'p' ? 'p' : 'reel'}/${code}/`;
  function permalink(v) {
    if (stories()) return { url: location.href.split('?')[0] };
    const m = location.pathname.match(CODE_RE);
    if (m && v === topVideo()) return { url: link(m[1], m[2]), code: m[2] }; // the page's own Reel/post
    for (let e = v.parentElement, i = 0; e && i < 12; e = e.parentElement, i++) {
      const a = [...e.querySelectorAll('a[href]')].map(x => x.getAttribute('href').match(CODE_RE)).find(Boolean);
      if (a) return { url: link(a[1], a[2]), code: a[2] };
    }
    return m ? { url: link(m[1], m[2]), code: m[2] } : { url: location.href.split('?')[0] };
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* page not focused: fall back */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
  const busy = new Set();
  async function copyTranscript(v) {
    const { url, code } = permalink(v);
    if (busy.has(url)) return toastAt(v, 'Transcribing…', 0, true);
    busy.add(url);
    toastAt(v, 'Transcribing…', 0, true);
    if (code && !subs[code]) { window.postMessage({ icxRescan: 1 }, location.origin); await new Promise(r => setTimeout(r, 60)); }
    let res;
    try { res = await chrome.runtime.sendMessage({ type: 'transcript', url, subsUrl: code && subs[code] }); }
    catch (e) { res = { error: String(e.message || e) }; }
    busy.delete(url);
    const text = res?.text?.trim();
    if (text) {
      const ok = await copyText(`${url}\n\n${text}`);
      return toastAt(v, ok ? 'Copied link + transcript' : 'Copy failed: click the page and retry', 1800);
    }
    await copyText(url);
    if (res?.error === 'helper-missing') toastAt(v, 'Link copied · run install.sh for transcripts', 3500);
    else if (res?.error) { console.warn('[Insta Controls] transcript:', res.error); toastAt(v, 'Transcript failed · link copied', 2500); }
    else toastAt(v, 'No speech found · link copied', 2200);
  }

  // ---------- actions ----------
  const touch = v => { touched.add(v); fights.delete(v); };
  function togglePlay(v) { v.paused ? v.play().catch(() => {}) : v.pause(); toastAt(v, v.paused ? '❚❚' : '▶'); }
  function seekBy(v, s) { v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.05, v.currentTime + s)); toastAt(v, (s > 0 ? '+' : '−') + Math.abs(s) + 's'); }
  function setRate(v, r) { P.rate = r; videos.forEach(x => { x.playbackRate = r; }); save(); toastAt(v, r + '×'); render(); }
  function setVol(v, vol) {
    P.volume = Math.max(0, Math.min(1, vol)); P.muted = P.volume === 0;
    touch(v); applyVol(v); save(); toastAt(v, 'Volume ' + Math.round(P.volume * 100) + '%');
  }
  function toggleMute(v) {
    P.muted = !v.muted;
    if (!P.muted && P.volume < 0.02) P.volume = 0.5;
    touch(v); applyVol(v); save(); toastAt(v, P.muted ? 'Muted' : 'Sound on');
  }
  function toggleLoop(v) {
    S.loop = !S.loop; videos.forEach(x => apply(x, false));
    safe(() => chrome.storage.sync.set({ loop: S.loop }));
    toastAt(v, S.loop ? 'Loop on' : 'Loop off'); render();
  }
  function pip(v) {
    if (document.pictureInPictureElement === v) return document.exitPictureInPicture().catch(() => {});
    v.disablePictureInPicture = false;
    v.removeAttribute('disablepictureinpicture');
    v.requestPictureInPicture().catch(() => toastAt(v, 'PiP unavailable'));
  }
  function fullscreen(v) {
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
    (v.parentElement || v).requestFullscreen().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => {
    const f = document.fullscreenElement;
    (f && f.tagName !== 'VIDEO' ? f : document.documentElement).append(host);
    render();
  });

  // ---------- UI (closed shadow root, outside Instagram's React tree) ----------
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });
  const I = (d, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}">${d}</svg>`;
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .bar { position: fixed; display: flex; flex-direction: column; justify-content: flex-end; padding: 34px 8px 4px;
      background: linear-gradient(transparent, rgba(0,0,0,.35) 40%, rgba(0,0,0,.7)); 
      color: #fff; font: 500 12px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
      -webkit-font-smoothing: antialiased; opacity: 0; transition: opacity .2s; pointer-events: none;
      container-type: inline-size; user-select: none; }
    .bar.on { opacity: 1; }
    .bar.on .seek, .bar.on button, .bar.on .vol input { pointer-events: auto; }
    .row { display: flex; align-items: center; gap: 1px; height: 36px; }
    .sp { flex: 1; }
    button { all: unset; height: 32px; min-width: 32px; display: grid; place-items: center; border-radius: 8px; cursor: pointer;
      transition: background .15s; }
    button:hover { background: rgba(255,255,255,.16); }
    button:focus-visible { box-shadow: 0 0 0 2px #0a84ff; }
    svg { width: 20px; height: 20px; fill: #fff; filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)); }
    svg.s { fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    input[type=range] { appearance: none; background: transparent; margin: 0; cursor: pointer; outline: none; }
    input[type=range]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px;
      background: linear-gradient(90deg, #fff var(--p, 0%), rgba(255,255,255,.3) var(--p, 0%)); }
    input[type=range]::-webkit-slider-thumb { appearance: none; width: 13px; height: 13px; margin-top: -4.5px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); transform: scale(0); transition: transform .15s; }
    input[type=range]:hover::-webkit-slider-thumb, input[type=range]:focus-visible::-webkit-slider-thumb, .seek.drag::-webkit-slider-thumb { transform: scale(1); }
    .seek { width: 100%; height: 16px; }
    .vol { display: flex; align-items: center; }
    .vol input { width: 0; height: 32px; transition: width .2s, margin .2s; }
    .vol:hover input, .vol input:focus-visible { width: 64px; margin: 0 6px 0 2px; }
    .time { padding: 0 6px; white-space: nowrap; overflow: hidden; min-width: 0; flex-shrink: 1; font-variant-numeric: tabular-nums; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
    .rate { padding: 0 8px; font-weight: 600; font-size: 13px; }
    .loop:not(.act) svg { opacity: .45; }
    .menu { position: absolute; right: 8px; bottom: 46px; display: none; flex-direction: column; padding: 4px; border-radius: 12px;
      background: rgba(30,30,32,.9); backdrop-filter: blur(20px) saturate(1.6); box-shadow: 0 8px 30px rgba(0,0,0,.35); }
    .menu.open { display: flex; }
    .menu button { justify-content: start; display: flex; gap: 6px; padding: 0 12px 0 8px; height: 28px; font-size: 13px; }
    .menu button::before { content: "✓"; width: 12px; visibility: hidden; color: #0a84ff; font-weight: 700; }
    .menu button.cur::before { visibility: visible; }
    [data-paused="1"] .i-pause, [data-paused="0"] .i-play,
    [data-muted="1"] .i-vol, [data-muted="0"] .i-mute,
    [data-fs="1"] .i-fs, [data-fs="0"] .i-unfs { display: none; }
    .nav { position: absolute; right: 10px; bottom: var(--mid, 50%); transform: translateY(50%); display: flex; flex-direction: column; gap: 8px; }
    .nav button { width: 40px; height: 40px; border-radius: 50%; background: rgba(0,0,0,.4); backdrop-filter: blur(10px); }
    .nav button:hover { background: rgba(0,0,0,.6); }
    .nonav .nav { display: none; }
    @container (max-width: 320px) { .time, .vol input { display: none; } }
    @container (max-width: 200px) { .nav, .pip, .loop, .rate { display: none; } }
    .toast { position: fixed; transform: translate(-50%, -50%) scale(.9); padding: 9px 16px; border-radius: 14px;
      background: rgba(0,0,0,.62); backdrop-filter: blur(12px); color: #fff; font: 600 15px -apple-system, sans-serif;
      opacity: 0; transition: opacity .25s, transform .25s; pointer-events: none; white-space: nowrap; }
    .toast.on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    .toast.busy::before { content: ""; display: inline-block; width: 13px; height: 13px; margin-right: 9px; vertical-align: -2px;
      border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
  <div class="bar" part="bar">
    <input class="seek" type="range" min="0" max="1" step="any" value="0" aria-label="Seek">
    <div class="row">
      <button class="play" title="Play/Pause (K)">${I('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>', 'i-play')}${I('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>', 'i-pause')}</button>
      <div class="vol">
        <button class="mute" title="Mute (M)">${I('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="#fff"/><path class="i-vol" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/><path class="i-mute" d="M16 9.5l5 5M21 9.5l-5 5"/>', 's')}</button>
        <input type="range" min="0" max="1" step="0.01" aria-label="Volume">
      </div>
      <span class="time">0:00 / 0:00</span>
      <span class="sp"></span>
      <button class="tx" title="Copy link + transcript (T)">${I('<path d="M5 6h14M5 10h14M5 14h9M5 18h6"/><path d="M17 15v6M14.5 18.5L17 21l2.5-2.5"/>', 's')}</button>
      <button class="rate" title="Speed (< >)">1×</button>
      <button class="loop" title="Loop">${I('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>', 's')}</button>
      <button class="pip" title="Picture-in-picture (I)">${I('<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="12" width="6" height="4" rx="1" fill="#fff"/>', 's')}</button>
      <button class="fs" title="Fullscreen (F)">${I('<path class="i-fs" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path class="i-unfs" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>', 's')}</button>
    </div>
    <div class="nav">
      <button class="prev" title="Previous (Shift+↑ / P)">${I('<path d="M6 15l6-6 6 6"/>', 's')}</button>
      <button class="next" title="Next (Shift+↓ / N)">${I('<path d="M6 9l6 6 6-6"/>', 's')}</button>
    </div>
    <div class="menu" role="menu">${SPEEDS.map(s => `<button data-r="${s}" role="menuitemradio">${s === 1 ? 'Normal' : s + '×'}</button>`).join('')}</div>
  </div>
  <div class="toast"></div>`;
  document.documentElement.append(host);

  const $ = s => root.querySelector(s);
  const bar = $('.bar'), seek = $('.seek'), volIn = $('.vol input'), time = $('.time'), rateB = $('.rate'),
    loopB = $('.loop'), menu = $('.menu'), toast = $('.toast');

  // Keep our clicks away from Instagram's listeners (click-to-mute, double-tap like, etc.).
  for (const t of ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown', 'keyup'])
    bar.addEventListener(t, e => e.stopPropagation());

  let cur = null, shown = false, hideT = 0, raf = 0, dragging = false;
  function show(v) {
    if (!S.bar || !v) return;
    cur = v;
    if (!shown) { shown = true; bar.classList.add('on'); loop(); }
    clearTimeout(hideT);
    hideT = setTimeout(() => { if (!cur?.paused && !dragging && !menu.classList.contains('open')) hide(); }, 2500);
  }
  function hide() {
    shown = false; bar.classList.remove('on'); menu.classList.remove('open');
    cancelAnimationFrame(raf); clearTimeout(hideT);
  }
  function loop() {
    if (!shown) return;
    if (!cur?.isConnected || visibleArea(cur) === 0) return hide();
    place(); render();
    raf = requestAnimationFrame(loop);
  }
  function place() {
    const r = visibleRect(cur);
    bar.style.left = r.left + 'px'; bar.style.width = r.width + 'px';
    bar.style.top = 'auto'; bar.style.bottom = (innerHeight - r.bottom) + 'px';
    bar.style.setProperty('--mid', r.height / 2 + 'px');
    bar.classList.toggle('nonav', singlePost(cur) || carousel(cur)); // carousels: keep their own arrows clickable
  }
  function render() {
    const v = cur;
    if (!v) return;
    const d = v.duration, ok = isFinite(d) && d > 0;
    if (!dragging) seek.value = ok ? v.currentTime / d : 0;
    seek.style.setProperty('--p', seek.value * 100 + '%');
    const vol = v.muted ? 0 : v.volume;
    if (root.activeElement !== volIn) volIn.value = vol;
    volIn.style.setProperty('--p', vol * 100 + '%');
    time.textContent = `${fmt(ok ? seek.value * d : v.currentTime)} / ${ok ? fmt(d) : '–:––'}`;
    bar.dataset.paused = v.paused ? 1 : 0;
    bar.dataset.muted = v.muted || v.volume === 0 ? 1 : 0;
    bar.dataset.fs = document.fullscreenElement ? 1 : 0;
    rateB.textContent = v.playbackRate + '×';
    loopB.classList.toggle('act', S.loop);
    for (const b of menu.children) b.classList.toggle('cur', +b.dataset.r === v.playbackRate);
  }
  let toastT = 0;
  function toastAt(v, text, ms = 650, spin = false) {
    if (!v) return;
    toast.classList.toggle('busy', spin);
    const r = visibleRect(v) || v.getBoundingClientRect();
    toast.textContent = text;
    toast.style.left = (r.left + r.right) / 2 + 'px';
    toast.style.top = (r.top + r.bottom) / 2 + 'px';
    toast.classList.add('on');
    clearTimeout(toastT);
    if (ms) toastT = setTimeout(() => toast.classList.remove('on'), ms);
  }

  bar.addEventListener('click', e => {
    const b = e.target.closest('button'), v = cur;
    if (!b || !v) return;
    show(v);
    if (b.dataset.r) { setRate(v, +b.dataset.r); menu.classList.remove('open'); return; }
    if (!b.classList.contains('rate')) menu.classList.remove('open');
    if (b.classList.contains('play')) togglePlay(v);
    else if (b.classList.contains('prev')) go(-1);
    else if (b.classList.contains('next')) go(1);
    else if (b.classList.contains('mute')) toggleMute(v);
    else if (b.classList.contains('rate')) menu.classList.toggle('open');
    else if (b.classList.contains('loop')) toggleLoop(v);
    else if (b.classList.contains('pip')) pip(v);
    else if (b.classList.contains('tx')) copyTranscript(v);
    else if (b.classList.contains('fs')) fullscreen(v);
    render();
  });
  seek.addEventListener('pointerdown', () => { dragging = true; seek.classList.add('drag'); });
  seek.addEventListener('input', () => {
    if (cur && isFinite(cur.duration)) cur.currentTime = seek.value * cur.duration;
    render();
  });
  const endDrag = () => { dragging = false; seek.classList.remove('drag'); seek.blur(); };
  seek.addEventListener('change', endDrag);
  seek.addEventListener('pointerup', endDrag);
  volIn.addEventListener('input', () => { if (cur) { P.volume = +volIn.value; P.muted = P.volume === 0; touch(cur); applyVol(cur); save(); render(); } });

  // ---------- hover tracking ----------
  document.addEventListener('pointermove', e => {
    if (!S.bar) return;
    if (e.composedPath().includes(host)) return show(cur);
    const v = videoAt(e.clientX, e.clientY);
    if (v) show(v);
    else if (shown && !dragging) hide();
  }, { capture: true, passive: true });
  document.documentElement.addEventListener('pointerleave', () => { if (!dragging) hide(); });

  for (const t of ['pointerdown', 'keydown'])
    window.addEventListener(t, e => { if (e.isTrusted && !e.composedPath().includes(host)) lastInput = Date.now(); }, true);

  // Click on the video surface = play/pause (instead of Instagram's click-to-mute).
  window.addEventListener('click', e => {
    if (!S.clickPause || !e.isTrusted || e.button || stories() || e.composedPath().includes(host)) return;
    const v = videoAt(e.clientX, e.clientY);
    if (!v) return;
    const t = e.target;
    if (t !== v) {
      if (t.closest?.('a[href], input, textarea, select')) return;
      const tr = t.getBoundingClientRect(), vr = v.getBoundingClientRect();
      if (tr.width * tr.height < 0.6 * vr.width * vr.height) return; // a small button (like, speaker, profile…): leave it
    }
    e.preventDefault(); e.stopImmediatePropagation();
    lastInput = 0; // this click was ours, not a vote for Instagram's mute
    togglePlay(v); show(v);
  }, true);

  // ---------- keyboard ----------
  window.addEventListener('keydown', e => {
    if (!S.keys || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.composedPath()[0];
    const ours = e.composedPath().includes(host);
    if (!ours && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const v = mainVideo();
    if (!v) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const d = v.duration;
    switch (k) {
      case ' ': case 'k': togglePlay(v); break;
      case 'j': seekBy(v, -10); break;
      case 'l': seekBy(v, 10); break;
      case 'ArrowLeft': case 'ArrowRight': {
        if (stories() && !ours) return; // Stories: arrows switch stories
        const dir = k === 'ArrowRight' ? 1 : -1;
        if (!ours && carousel(v) && slide(v, dir)) break; // carousels: arrows change slide (J/L still seek)
        seekBy(v, 5 * dir); break;
      }
      case 'ArrowUp': if (e.shiftKey) { if (singlePost(v)) return; go(-1); } else setVol(v, (v.muted ? 0 : v.volume) + 0.05); break;
      case 'ArrowDown': if (e.shiftKey) { if (singlePost(v)) return; go(1); } else setVol(v, (v.muted ? 0 : v.volume) - 0.05); break;
      case 'n': if (singlePost(v)) return; go(1); break;
      case 'p': if (singlePost(v)) return; go(-1); break;
      case 'm': toggleMute(v); break;
      case 'f': fullscreen(v); break;
      case 'i': pip(v); break;
      case 't': copyTranscript(v); break;
      case '<': case '>': {
        const i = SPEEDS.indexOf(v.playbackRate), j = i < 0 ? 3 : Math.max(0, Math.min(SPEEDS.length - 1, i + (k === '>' ? 1 : -1)));
        setRate(v, SPEEDS[j]); break;
      }
      case ',': case '.': if (!v.paused) return; v.currentTime = Math.max(0, v.currentTime + (k === '.' ? 1 : -1) / 30); break;
      default:
        if (/^[0-9]$/.test(k) && isFinite(d)) { v.currentTime = d * k / 10; toastAt(v, k * 10 + '%'); break; }
        return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    if (S.bar && visibleArea(v) > 0) show(v);
  }, true);
})();
