// OWNER: systems engineer. Photo mode UI: left control panel (Camera / Filters / Frames tabs), live frame overlay,
// rule-of-thirds grid, key hints, capture flash + saved-print card, landmark-in-frame indicator.
import { icon } from './icons.js';
import { FILTERS, FRAMES, POSES, STICKERS, STICKER_R, drawFrame, drawStickers, newSticker } from '../../game/systems/photo.js';
import { t, onLangChange } from '../i18n.js';

export function createPhotoUI(sys) {
  const { photo, audio, flow, ui } = sys;
  const el = document.createElement('div'); el.className = 'sys-photo';
  el.innerHTML = `<div class="catch"></div><canvas class="frame"></canvas><div class="grid3"></div>
    <div class="panel sys-panel cut interactive"><div class="ttl">${icon('camera', { color: '#e3262f' })}<h2 class="sys-h2" style="font-size:28px" data-i="ph.title"></h2></div>
      <div class="ptabs"><div data-t="cam" class="on" data-i="ph.tab.cam"></div><div data-t="filter" data-i="ph.tab.filter"></div><div data-t="frame" data-i="ph.tab.frame"></div><div data-t="pose" data-i="ph.tab.pose"></div><div data-t="sticker" data-i="ph.tab.sticker"></div></div>
      <div class="pbody sys-scroll"></div>
      <div class="pacts"><button class="sys-btn red cap" data-i="ph.capture"></button><button class="sys-btn rs" data-i="ph.reset"></button><button class="sys-btn ex" data-i="ph.exit"></button></div></div>
    <div class="lm"></div>
    <div class="hints"></div>
    <div class="flash"></div><div class="saved sys-panel"><img alt=""><div data-i="ph.saved"></div></div>`;
  ui.root.appendChild(el);
  // (i18n) static captions + key hints (rebuilt when the language changes)
  const K = k => `<span class="sys-key">${k}</span>`;
  function labels() {
    el.querySelectorAll('[data-i]').forEach(n => { n.textContent = t(n.dataset.i); });
    el.querySelector('.hints').innerHTML = [[K('WASD'), 'ph.h.move'], [K('Q') + K('E'), 'ph.h.updown'], [K(t('ph.k.drag')), 'ph.h.look'], [K(t('ph.k.wheel')), 'ph.h.zoom'], [K('R'), 'ph.h.af'], [K('H'), 'ph.h.hide'], [K('Enter'), 'ph.capture'], [K('Esc'), 'ph.exit']]
      .map(([k, l]) => `<span>${k}${t(l)}</span>`).join('');
  }
  labels(); onLangChange(() => { labels(); if (open) render(); });
  const st = photo.state, body = el.querySelector('.pbody'), frameC = el.querySelector('canvas.frame');
  let tab = 'cam', open = false;

  const row = (k, label, min, max, step, fmt) => `<div class="prow"><div class="l">${label}<span data-v="${k}">${fmt(st[k])}</span></div><input class="sys-range" type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${st[k]}"></div>`;
  const F = { fov: v => Math.round(v) + '°', roll: v => Math.round(v) + '°', focus: v => t('dist.m', { n: (+v).toFixed(1) }), aperture: v => (+v === 0 ? t('set.opt.off') : (+v).toFixed(1)), exposure: v => (v > 0 ? '+' : '') + (+v).toFixed(1) + ' EV' };
  function render() {
    el.querySelectorAll('.ptabs div').forEach(d => d.classList.toggle('on', d.dataset.t === tab));
    if (tab === 'cam') body.innerHTML = row('fov', t('ph.fov'), 15, 100, 1, F.fov) + row('roll', t('ph.roll'), -45, 45, 1, F.roll)
      + row('focus', t('ph.focus'), 0.5, 80, 0.1, F.focus) + row('aperture', t('ph.dof'), 0, 14, 0.5, F.aperture) + row('exposure', t('ph.exposure'), -2, 2, 0.1, F.exposure)
      + `<div class="prow"><div class="opts"><div data-tg="hideHero" class="${st.hideHero ? 'on' : ''}">${t('ph.hideHero')}</div><div data-tg="grid" class="${st.grid ? 'on' : ''}">${t('ph.grid')}</div></div></div>`;
    else if (tab === 'filter') body.innerHTML = `<div class="prow"><div class="opts">${FILTERS.map(f => `<div data-f="${f.id}" class="${st.filter === f.id ? 'on' : ''}">${f.name}</div>`).join('')}</div></div>` + row('exposure', t('ph.exposure'), -2, 2, 0.1, F.exposure);
    else if (tab === 'frame') body.innerHTML = `<div class="prow"><div class="opts">${FRAMES.map(f => `<div data-fr="${f.id}" class="${st.frame === f.id ? 'on' : ''}">${f.name}</div>`).join('')}</div></div>`;
    else if (tab === 'pose') body.innerHTML = `<div class="prow"><div class="l">${t('ph.pose')}</div><div class="opts">${POSES.map(f => `<div data-po="${f.id}" class="${st.pose === f.id ? 'on' : ''}">${f.name}</div>`).join('')}</div></div>
      <div class="prow"><div class="opts"><div data-tg="hideHero" class="${st.hideHero ? 'on' : ''}">${t('ph.hideHero')}</div></div></div>`;
    else body.innerHTML = `<div class="prow"><div class="l">${t('ph.stickers')}<span>${t('ph.stickersOn', { n: st.stickers.length })}</span></div><div class="opts">${STICKERS.map(f => `<div data-sk="${f.id}" class="${st.stickers.some(k => k.id === f.id) ? 'on' : ''}">${f.name}</div>`).join('')}</div>
      <div class="sys-p" style="font-size:12px;color:var(--sys-dim);margin-top:10px;line-height:1.5">${t('ph.stickerHelp')}</div></div>`;
    body.querySelectorAll('input.sys-range').forEach(r => {
      const upd = () => { photo.set(r.dataset.k, +r.value); body.querySelector(`[data-v="${r.dataset.k}"]`).textContent = F[r.dataset.k](+r.value); r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); };
      r.addEventListener('input', upd); r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%');
    });
    body.querySelectorAll('[data-f]').forEach(d => d.addEventListener('click', () => { photo.set('filter', d.dataset.f); audio.sfx.move(); render(); }));
    body.querySelectorAll('[data-fr]').forEach(d => d.addEventListener('click', () => { photo.set('frame', d.dataset.fr); audio.sfx.move(); render(); drawOverlay(); }));
    body.querySelectorAll('[data-po]').forEach(d => d.addEventListener('click', () => { photo.set('pose', d.dataset.po); audio.sfx.move(); render(); }));
    body.querySelectorAll('[data-sk]').forEach(d => d.addEventListener('click', () => { const i = st.stickers.findIndex(k => k.id === d.dataset.sk); if (i >= 0) { if (selSt === st.stickers[i]) selSt = null; st.stickers.splice(i, 1); } else { selSt = newSticker(d.dataset.sk); st.stickers.push(selSt); } audio.sfx.move(); render(); drawOverlay(); }));
    body.querySelectorAll('[data-tg]').forEach(d => d.addEventListener('click', () => { photo.set(d.dataset.tg, !st[d.dataset.tg]); audio.sfx.move(); render(); el.querySelector('.grid3').classList.toggle('on', st.grid); }));
  }
  el.querySelectorAll('.ptabs div').forEach(d => d.addEventListener('click', () => { tab = d.dataset.t; audio.sfx.move(); render(); }));
  el.querySelector('.cap').addEventListener('click', () => capture());
  el.querySelector('.rs').addEventListener('click', () => { photo.reset(); render(); drawOverlay(); audio.sfx.back(); });
  el.querySelector('.ex').addEventListener('click', () => close());

  function drawOverlay() {
    const dpr = Math.min(2, devicePixelRatio); const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    if (frameC.width !== W || frameC.height !== H) { frameC.width = W; frameC.height = H; }
    const g = frameC.getContext('2d'); g.clearRect(0, 0, W, H); drawFrame(g, st.frame, W, H); drawStickers(g, st.stickers, W, H);
    if (selSt && st.stickers.includes(selSt) && !el.classList.contains('clean')) { const u = Math.min(W, H) / 1080, r = (STICKER_R[selSt.id] || 100) * u * selSt.s; g.save(); g.translate(selSt.x * W, selSt.y * H); g.rotate(selSt.r); g.setLineDash([10 * u, 8 * u]); g.lineWidth = 2 * u; g.strokeStyle = 'rgba(255,255,255,.85)'; g.strokeRect(-r, -r * 0.7, r * 2, r * 1.4); g.restore(); }
  }
  function flash() { const f = el.querySelector('.flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  async function capture() {
    flash(); audio.sfx.shutter();
    const s = el.querySelector('.saved'); s.querySelector('img').removeAttribute('src'); s.querySelector('div').textContent = t('ph.saving'); s.classList.add('on', 'busy'); clearTimeout(s._t);
    const sel = selSt; selSt = null; drawOverlay(); // capture has no selection box
    const { thumb, items } = await photo.capture();
    selSt = sel; drawOverlay(); s.classList.remove('busy'); s.querySelector('img').src = thumb; s.querySelector('div').textContent = items.length ? t('ph.savedItems', { x: items.map(i => i.name).join(', ') }) : t('ph.saved');
    s.classList.add('on'); clearTimeout(s._t); s._t = setTimeout(() => s.classList.remove('on'), 3200);
  }

  // input
  const catchEl = el.querySelector('.catch'); let drag = null;
  let selSt = null;
  function stickerAt(cx, cy) {
    const u = Math.min(innerWidth, innerHeight) / 1080;
    for (let i = st.stickers.length - 1; i >= 0; i--) { const k = st.stickers[i]; const r = (STICKER_R[k.id] || 100) * u * k.s; if (Math.hypot(cx - k.x * innerWidth, cy - k.y * innerHeight) < r) return k; }
    return null;
  }
  catchEl.addEventListener('mousedown', e => {
    const k = stickerAt(e.clientX, e.clientY);
    if (k) { selSt = k; st.stickers.push(st.stickers.splice(st.stickers.indexOf(k), 1)[0]); drag = { x: e.clientX, y: e.clientY, st: k }; drawOverlay(); return; }
    if (selSt) { selSt = null; drawOverlay(); }
    drag = { x: e.clientX, y: e.clientY };
  });
  addEventListener('mousemove', e => {
    if (!drag || !open) return;
    if (drag.st) { drag.st.x = Math.min(0.98, Math.max(0.02, drag.st.x + (e.clientX - drag.x) / innerWidth)); drag.st.y = Math.min(0.98, Math.max(0.02, drag.st.y + (e.clientY - drag.y) / innerHeight)); drawOverlay(); }
    else photo.look(e.clientX - drag.x, e.clientY - drag.y);
    drag = { ...drag, x: e.clientX, y: e.clientY };
  });
  addEventListener('mouseup', () => { drag = null; });
  catchEl.addEventListener('wheel', e => { e.preventDefault(); if (selSt) { selSt.s = Math.min(3, Math.max(0.3, selSt.s * Math.exp(-e.deltaY * 0.0012))); drawOverlay(); return; } photo.set('fov', Math.max(15, Math.min(100, st.fov + Math.sign(e.deltaY) * 2))); if (tab === 'cam') render(); }, { passive: false });
  addEventListener('keyup', e => photo.keys.delete(e.code));
  flow.onKey((e, mode) => {
    if (mode === 'play' && e.code === 'KeyV') { photo.enter(); openUI(); return true; }
    if (mode !== 'photo') return false;
    if (e.code === 'Escape') { if (el.classList.contains('clean')) el.classList.remove('clean'); else close(); return true; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { capture(); return true; }
    if (e.code === 'KeyH') { el.classList.toggle('clean'); drawOverlay(); audio.sfx.move(); return true; }
    if (e.code === 'KeyR') { photo.autofocus(); if (tab === 'cam') render(); audio.sfx.move(); return true; }
    if (selSt && (e.code === 'KeyQ' || e.code === 'KeyE')) { selSt.r += (e.code === 'KeyQ' ? -1 : 1) * 0.12; drawOverlay(); return true; }
    if (selSt && (e.code === 'Delete' || e.code === 'Backspace')) { st.stickers.splice(st.stickers.indexOf(selSt), 1); selSt = null; drawOverlay(); if (tab === 'sticker') render(); return true; }
    if (e.code === 'KeyG') { photo.set('grid', !st.grid); el.querySelector('.grid3').classList.toggle('on', st.grid); return true; }
    photo.keys.add(e.code); return true;
  });

  // landmark-in-frame indicator
  let chk = 0;
  function openUI() { open = true; el.classList.add('open'); el.classList.remove('clean'); tab = 'cam'; render(); drawOverlay(); audio.sfx.open(); sys.ui.setVisible(false); }
  function close() { open = false; el.classList.remove('open'); photo.exit(); audio.sfx.close(); sys.ui.setVisible(true); }
  addEventListener('resize', () => open && drawOverlay());
  return {
    el, open: openUI, close, flash, get isOpen() { return open; },
    update(dt) {
      if (!open) return; chk -= dt; if (chk > 0) return; chk = 0.25;
      const items = sys.collect.checkPhoto(sys.ctx.camera, sys.ctx.player.position);
      const lm = el.querySelector('.lm'); lm.textContent = items.length ? t('ph.inFrame', { x: items.map(i => i.name).join(', ') }) : ''; lm.classList.toggle('on', !!items.length);
    },
  };
}
