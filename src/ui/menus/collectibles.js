// OWNER: systems engineer. Collectibles screen: categories (backpacks / landmarks / secret photos / towers /
// crimes) with completion, item grid per district; landmark thumbnails from your photos; secret-photo hints
// rendered live from the actual location as aged sepia prints (one render per frame while the page is open).
import { badge, icon } from './icons.js';
import { t, t as tr } from '../i18n.js';

export function createCollectiblesPage(sys) {
  const { data, save, audio } = sys;
  const el = document.createElement('div'); el.className = 'sys-coll';
  el.innerHTML = `<div class="cats sys-panel cut interactive"></div><div class="main sys-panel cut interactive"><div class="hd"><div><div class="sys-h3 cap"></div><h2 class="sys-h2 ttl"></h2></div><div class="pc"></div></div><div class="grid sys-scroll"></div></div>`;
  const CATS = [
    { id: 'backpack', list: () => data.backpacks, got: () => save.state.backpacks },
    { id: 'landmark', list: () => data.landmarks, got: () => save.state.landmarks },
    { id: 'photo', list: () => data.secretPhotos, got: () => save.state.secretPhotos },
    { id: 'tower', list: () => data.towers, got: () => save.state.towers },
    { id: 'crime', list: () => [], got: () => [] },
  ];
  for (const c of CATS) Object.defineProperties(c, { name: { get: () => t('cp.' + c.id) }, cap: { get: () => t('cp.' + c.id + '.cap') } }); // (i18n)
  let cat = 'backpack', pendingHints = [];
  const distName = id => data.districts.find(d => d.id === id).name;
  function renderCats() {
    el.querySelector('.cats').innerHTML = CATS.map(c => `<div class="sys-list-item ${c.id === cat ? 'on' : ''}" data-c="${c.id}">${badge(c.id === 'crime' ? 'crime' : c.id, 26)}<b>${c.name}</b><span>${c.id === 'crime' ? save.state.crimes.stopped : `${c.got().length}/${c.list().length}`}</span></div>`).join('');
    el.querySelectorAll('.cats .sys-list-item').forEach(n => { n.addEventListener('click', () => { cat = n.dataset.c; audio.sfx.move(); render(); }); n.addEventListener('mouseenter', () => audio.sfx.hover()); });
  }
  function render() {
    renderCats();
    const C = CATS.find(c => c.id === cat); const got = new Set(C.got()); const list = C.list();
    el.querySelector('.cap').textContent = C.cap; el.querySelector('.ttl').textContent = C.name;
    el.querySelector('.pc').innerHTML = cat === 'crime' ? `${save.state.crimes.stopped}<small> ${t('cp.stopped')}</small>` : `<bdi>${got.size}<small> / ${list.length}</small></bdi>`;
    const grid = el.querySelector('.grid'); pendingHints = [];
    const chk = `<div class="ck">${icon('check', { color: '#e3262f', sw: 3 })}</div>`;
    if (cat === 'backpack') {
      // one row per district: count + progress pips; recovered items listed; one line when the district is locked
      grid.innerHTML = '<div class="sys-drows">' + data.districts.map(d => {
        const bp = list.filter(b => b.district === d.id); if (!bp.length) return '';
        const n = bp.filter(b => got.has(b.id)).length, open = sys.towers.revealed(d.id);
        const pips = bp.map(b => `<i class="${got.has(b.id) ? 'on' : ''}"></i>`).join('');
        const items = bp.filter(b => got.has(b.id)).map(b => `<span title="${b.desc.replace(/"/g, '&quot;')}">${b.item}</span>`).join('');
        return `<div class="sys-drow ${n === bp.length ? 'done' : ''}"><div class="h"><b>${d.name}</b><div class="pips">${pips}</div><em dir="ltr">${n}/${bp.length}</em></div>
          <div class="t">${items || ''}${n < bp.length ? `<small>${open ? t('cp.leftOnMap', { n: bp.length - n }) : t('cp.lockedTower')}</small>` : ''}</div></div>`;
      }).join('') + '</div>';
    } else if (false) {
      grid.innerHTML = list.map(b => got.has(b.id)
        ? `<div class="sys-citem got">${chk}<div class="dn">${distName(b.district)}</div><div class="nm">${b.item}</div><div class="ds">${b.desc}</div></div>`
        : `<div class="sys-citem"><div class="dn">${distName(b.district)}</div><div class="nm" style="color:var(--sys-dim)">???</div><div class="ds">${sys.towers.revealed(b.district) ? (b.mount === 'roof' ? 'On a rooftop' : b.mount === 'wall' ? 'Webbed to a wall' : 'Somewhere in the park') + ' — shown on the map' : 'Activate the district tower to locate'}</div></div>`).join('');
    } else if (cat === 'landmark') {
      grid.innerHTML = list.map(l => { const th = save.state.photoThumbs[l.id]; const ok = got.has(l.id);
        return `<div class="sys-citem photo ${ok ? 'got' : ''}"><div class="img" style="${th ? `background-image:url(${th})` : ''}">${th ? '' : `<div class="q">${ok ? '' : '?'}</div>`}${ok ? `<div class="stamp">${t('cp.photographed')}</div>` : ''}</div>
          <div class="txt"><div class="dn">${distName(l.district)}</div><div class="nm">${ok || sys.towers.revealed(l.district) ? l.name : '???'}</div><div class="ds">${ok ? l.desc : sys.towers.revealed(l.district) ? t('cp.frameIt') : t('cp.locked')}</div></div></div>`; }).join('');
    } else if (cat === 'photo') {
      grid.innerHTML = list.map(p => { const ok = got.has(p.id); const th = ok ? save.state.photoThumbs[p.id] : null;
        return `<div class="sys-citem photo ${ok ? 'got' : ''}"><div class="img sepia" data-hint="${p.id}" style="${th ? `background-image:url(${th})` : ''}"><div class="q">…</div>${ok ? `<div class="stamp">${t('cp.matchedStamp')}</div>` : ''}</div>
          <div class="txt"><div class="dn">${distName(p.district)}</div><div class="nm">${ok ? t('cp.matched') : t('cp.where')}</div><div class="ds">${p.hint}</div></div></div>`; }).join('');
      pendingHints = list.filter(p => !(got.has(p.id) && save.state.photoThumbs[p.id]));
    } else if (cat === 'tower') {
      grid.innerHTML = list.map(t => `<div class="sys-citem ${got.has(t.id) ? 'got' : ''}">${got.has(t.id) ? chk : ''}<div class="dn">${distName(t.district)}</div><div class="nm">${t.name}</div><div class="ds">${got.has(t.id) ? tr('cp.activated') : tr('cp.notActivated')}</div></div>`).join('');
    } else {
      const bt = save.state.crimes.byType, bd = save.state.crimes.byDistrict;
      grid.innerHTML = ['mugging', 'bankAlarm', 'carChase'].map(k => `<div class="sys-citem"><div class="dn">${t('cp.crimeType')}</div><div class="nm">${t('cp.type.' + k)}</div><div class="ds" style="font-size:22px;color:#fff;font-family:var(--sys-head)">${bt[k] || 0}</div></div>`).join('')
        + data.districts.map(d => `<div class="sys-citem"><div class="dn">${t('district')}</div><div class="nm">${d.name}</div><div class="ds">${t('cp.crimesStopped', { n: bd[d.id] || 0 })}</div></div>`).join('');
    }
  }
  return {
    id: 'collectibles', get title() { return t('tab.collectibles'); }, el,
    get hints() { return [[t('key.click'), t('hint.category')]]; },
    footer: () => t('cp.foot', { a: save.state.backpacks.length + save.state.landmarks.length + save.state.secretPhotos.length, b: data.backpacks.length + data.landmarks.length + data.secretPhotos.length }),
    show() { render(); },
    update() {
      // render one sepia hint per frame (cached)
      const p = pendingHints.shift(); if (!p) return;
      const url = sys.collect.renderHint(p);
      const d = el.querySelector(`[data-hint="${p.id}"]`);
      if (d && url && !(save.state.secretPhotos.includes(p.id) && save.state.photoThumbs[p.id])) { d.style.backgroundImage = `url(${url})`; d.querySelector('.q')?.remove(); }
    },
    key(e) {
      const i = CATS.findIndex(c => c.id === cat);
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { cat = CATS[(i + 1) % CATS.length].id; audio.sfx.move(); render(); return true; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { cat = CATS[(i - 1 + CATS.length) % CATS.length].id; audio.sfx.move(); render(); return true; }
      return false;
    },
  };
}
