// OWNER: systems engineer. Settings: graphics (quality preset -> reload with ?q=, live render scale), controls
// (mouse sensitivity, invert Y, keybind reference), audio (master / music / sfx / ambience / UI), interface (language,
// HUD), gameplay (world markers, reset progress). Persisted in the save's settings block; applied through sys.applySettings().
// (i18n) every label comes from src/ui/i18n.js (set.* keys); the Language row switches the whole UI live.
import { t, lang, setLang } from '../i18n.js';

export function createSettingsPage(sys) {
  const { save, audio } = sys;
  const el = document.createElement('div'); el.className = 'sys-settings';
  const CATS = ['graphics', 'camera', 'controls', 'audio', 'interface', 'gameplay'];
  const renderCats = () => {
    el.querySelector('.cats').innerHTML = CATS.map(k => `<div class="sys-list-item ${k === cat ? 'on' : ''}" data-c="${k}"><b>${t('set.cat.' + k)}</b></div>`).join('');
    el.querySelectorAll('.cats .sys-list-item').forEach(n => { n.addEventListener('click', () => { cat = n.dataset.c; audio.sfx.move(); render(); }); n.addEventListener('mouseenter', () => audio.sfx.hover()); });
  };
  el.innerHTML = `<div class="cats sys-panel cut interactive"></div>
    <div class="main sys-panel cut interactive sys-scroll"></div>`;
  let cat = 'graphics';
  const S = () => save.state.settings;
  const main = el.querySelector('.main');
  const curQ = new URLSearchParams(location.search).get('q') || 'high';

  const cur = key => (key === 'lang' ? lang() : S()[key]);
  // option labels: set.opt.<name> ('On', 'Off', 'Low' ...); the language names are always written in their own language
  const O = (v, n) => [v, n.startsWith('=') ? n.slice(1) : t('set.opt.' + n)];
  const seg = (key, opts, label, sub) => `<div class="sys-opt"><label>${t(label)}<small>${t(sub, { q: curQ })}</small></label><div class="sys-seg" data-k="${key}">${opts.map(([v, n]) => `<button data-v="${v}" class="${String(cur(key)) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
  const range = (key, min, max, step, label, sub, fmt = v => Math.round(v * 100) + '%') => `<div class="sys-opt"><label>${t(label)}<small>${t(sub)}</small></label><input type="range" class="sys-range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${S()[key]}"><span class="val" data-v="${key}" dir="ltr">${fmt(+S()[key])}</span></div>`;
  const FMT = { mouseSensitivity: v => v.toFixed(2) + '×', renderScale: v => Math.round(v * 100) + '%', fovOffset: v => Math.round(58 + v) + '°', hudScale: v => Math.round(v * 100) + '%', subtitleSize: v => Math.round(v * 100) + '%' };
  let onOff, offOn; // built per render: the labels follow the language

  function render() {
    onOff = [O('true', 'on'), O('false', 'off')]; offOn = [O('false', 'off'), O('true', 'on')];
    renderCats();
    if (cat === 'graphics') main.innerHTML = `<div class="sys-h3">${t('set.cat.graphics')}</div>
      ${seg('quality', [O('low', 'low'), O('med', 'medium'), O('high', 'high')], 'set.quality', 'set.quality.sub')}
      ${range('renderScale', 0.6, 1.25, 0.05, 'set.renderScale', 'set.renderScale.sub', FMT.renderScale)}
      ${seg('timeOfDay', [O('day', 'day'), O('morning', 'morning'), O('sunrise', 'sunrise'), O('sunset', 'sunset'), O('dusk', 'dusk'), O('night', 'night'), O('overcast', 'overcast')], 'set.tod', 'set.tod.sub')}
      ${seg('daySun', [O('a', 'midday'), O('b', 'lateMorning'), O('c', 'afternoon')], 'set.daySun', 'set.daySun.sub')}
      ${seg('puddles', onOff, 'set.puddles', 'set.puddles.sub')}`; // (lighting2 r3) fixed presets (no cycle)
    else if (cat === 'camera') main.innerHTML = `<div class="sys-h3">${t('set.cat.camera')}</div>
      ${range('fovOffset', -10, 20, 1, 'set.fov', 'set.fov.sub', FMT.fovOffset)}
      ${seg('motionBlur', [O('0', 'off'), O('0.5', 'low'), O('1', 'medium'), O('1.6', 'high'), O('2.4', 'veryHigh')], 'set.motionBlur', 'set.motionBlur.sub')}
      ${seg('dof', [O('0', 'off'), O('1', 'on')], 'set.dof', 'set.dof.sub')}`;
    else if (cat === 'interface') main.innerHTML = `<div class="sys-h3">${t('set.cat.interface')}</div>
      ${seg('lang', [O('en', '=English'), O('he', '=עברית')], 'set.lang', 'set.lang.sub')}
      ${seg('minimalHud', offOn, 'set.minimalHud', 'set.minimalHud.sub')}
      ${range('hudScale', 0.8, 1.25, 0.05, 'set.hudScale', 'set.hudScale.sub', FMT.hudScale)}
      ${seg('subtitles', onOff, 'set.subtitles', 'set.subtitles.sub')}
      ${range('subtitleSize', 0.8, 1.6, 0.1, 'set.subtitleSize', 'set.subtitleSize.sub', FMT.subtitleSize)}
      ${seg('showPins', onOff, 'set.pins', 'set.pins.sub')}`;
    else if (cat === 'controls') main.innerHTML = `<div class="sys-h3">${t('set.cat.controls')}</div>
      ${range('mouseSensitivity', 0.2, 3, 0.05, 'set.sens', 'set.sens.sub', FMT.mouseSensitivity)}
      ${seg('invertY', offOn, 'set.invertY', 'set.invertY.sub')}
      <div class="sys-h3" style="margin-top:28px">${t('set.binds')}</div>
      <div class="sys-binds"><div class="h">${t('set.binds.action')}</div><div class="h k">${t('set.binds.kbm')}</div><div class="h k">${t('set.binds.pad')}</div>
      ${[['move', 'W A S D', 'pad.ls'], ['camera', 'k.mouse', 'pad.rs'], ['swing', 'k.rmb', 'R2'], ['parkourWall', 'Shift', 'R2'], ['parkour', 'k.rmb', 'pad.r2ground'],
        ['jump', 'Space', 'Cross / A'], ['zip', 'k.eMmb', 'L2 + R2'], ['dive', 'C / Ctrl', 'Circle / B'], ['boost', 'Q', 'L1 / LB'], ['rope', 'k.tws', '—'], ['sling', 'k.ctrlMouse', '—'],
        ['attack', 'k.lmbHold', 'Square / X'], ['dodge', 'k.dodge', 'Circle / B'], ['webStrike', 'F / E', 'R1 / Triangle'], ['throw', 'R / Q / Z', '—'],
        ['interact', 'k.fHold', 'pad.interact'], ['pause', 'Esc / P', 'Options / Start'], ['map', 'M', 'pad.map'], ['photo', 'k.v', '—'], ['help', 'H', '—']]
        .map(([a, k, p]) => `<div>${t('bind.' + a)}</div><div class="k"><span class="sys-key">${k.startsWith('k.') ? t('bind.' + k) : k}</span></div><div class="k" style="color:var(--sys-soft)">${p.startsWith('pad.') ? t('bind.' + p) : p}</div>`).join('')}</div>`;
    else if (cat === 'audio') main.innerHTML = `<div class="sys-h3">${t('set.cat.audio')}</div>
      ${range('masterVolume', 0, 1, 0.01, 'set.master', 'set.master.sub')}
      ${range('musicVolume', 0, 1, 0.01, 'set.music', 'set.music.sub')}
      ${range('sfxVolume', 0, 1, 0.01, 'set.sfx', 'set.sfx.sub')}
      ${range('ambienceVolume', 0, 1, 0.01, 'set.ambience', 'set.ambience.sub')}
      ${range('uiVolume', 0, 1, 0.01, 'set.ui', 'set.ui.sub')}`;
    else main.innerHTML = `<div class="sys-h3">${t('set.cat.gameplay')}</div>
      ${seg('crimes', onOff, 'set.crimes', 'set.crimes.sub')}
      <div class="sys-opt"><label>${t('set.reset')}<small>${t('set.reset.sub')}</small></label><button class="sys-btn rst">${t('set.reset.btn')}</button></div>`;
    main.querySelectorAll('.sys-seg').forEach(sg => sg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const k = sg.dataset.k; let v = b.dataset.v; if (v === 'true' || v === 'false') v = v === 'true'; else if (v !== '' && !isNaN(+v)) v = +v;
      if (k === 'lang') { audio.sfx.select(); setLang(v); render(); return; } // (i18n) saved in settings.lang by setLang
      if (k === 'crimes') { sys.crimes.enable(v); S().crimesOn = v; save.markDirty(); render(); audio.sfx.select(); return; }
      S()[k] = v; if (k === 'quality') S().qualityManual = true; save.markDirty(); audio.sfx.select();
      if (k === 'quality') { save.flush(); if (v !== curQ) { const u = new URL(location.href); u.searchParams.set('q', v); location.href = u.toString(); return; } }
      sys.applySettings(); render();
    })));
    const crimesSeg = main.querySelector('.sys-seg[data-k="crimes"]');
    if (crimesSeg) crimesSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'true') === sys.crimes.enabled));
    main.querySelectorAll('input.sys-range').forEach(r => {
      const upd = () => { const k = r.dataset.k; S()[k] = +r.value; r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); main.querySelector(`[data-v="${k}"]`).textContent = (FMT[k] || (v => Math.round(v * 100) + '%'))(+r.value); sys.applySettings(); save.markDirty(); };
      r.addEventListener('input', upd); r.addEventListener('change', () => audio.sfx.move()); r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%');
    });
    const rst = main.querySelector('.rst');
    if (rst) rst.addEventListener('click', () => {
      if (rst.dataset.armed) { save.reset(); location.reload(); return; }
      rst.dataset.armed = '1'; rst.textContent = t('set.reset.confirm'); rst.classList.add('red'); audio.sfx.deny();
    });
  }
  return {
    id: 'settings', get title() { return t('tab.settings'); }, el, get hints() { return [[t('key.click'), t('hint.change')]]; },
    footer: () => (save.persistent ? t('set.foot.saved') : t('set.foot.test')),
    show() { render(); },
    key(e) {
      const i = CATS.indexOf(cat);
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { cat = CATS[(i + 1) % CATS.length]; audio.sfx.move(); render(); return true; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { cat = CATS[(i - 1 + CATS.length) % CATS.length]; audio.sfx.move(); render(); return true; }
      return false;
    },
  };
}
