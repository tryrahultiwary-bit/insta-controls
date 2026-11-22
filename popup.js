const DEF = { bar: true, keys: true, loop: true, autoScroll: false, remember: true, clickPause: true, speed: 1 };
const seg = document.getElementById('speed');

chrome.storage.sync.get(DEF, s => {
  for (const el of document.querySelectorAll('[data-k]')) {
    el.checked = s[el.dataset.k];
    el.onchange = () => chrome.storage.sync.set({ [el.dataset.k]: el.checked });
  }
  mark(s.speed);
});
seg.onclick = e => {
  const s = +e.target.dataset.s;
  if (!s) return;
  mark(s);
  chrome.storage.sync.set({ speed: s });
  chrome.storage.local.set({ rate: s });
};
function mark(s) { for (const b of seg.children) b.classList.toggle('on', +b.dataset.s === s); }
