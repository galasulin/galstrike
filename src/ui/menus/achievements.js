// OWNER: systems engineer. Achievements page (pause menu): progress header (unlocked / total, % complete), a grid of
// achievement cards (progress bars, locked / unlocked, hidden ones as "???") and a Records panel. Data + counters live
// in game/systems/achievements.js (sys.ach).
import { achBadge } from '../../game/systems/achievements.js';
import { t, lang } from '../i18n.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? t('time.hm', { h, m: String(m).padStart(2, '0') }) : t('time.ms', { m, s: String(s % 60).padStart(2, '0') }); };
const raceT = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const num = n => Math.floor(n).toLocaleString('en-US');

export function createAchievementsPage(sys) {
  const { audio } = sys;
  const A = () => sys.ach;
  const el = document.createElement('div'); el.className = 'sys-coll sys-ach';
  el.innerHTML = `<div class="cats side sys-panel cut interactive sys-scroll"><div class="sum"></div><div class="sys-rule"></div><div class="sys-h3 recl"></div><div class="recs"></div></div>
    <div class="main sys-panel cut interactive"><div class="hd"><div><div class="sys-h3 cap"></div><h2 class="sys-h2 ttl"></h2></div><div class="pc"></div></div><div class="grid sys-scroll"></div></div>`;
  const grid = el.querySelector('.grid');

  const val = (d, v) => (d.fmt === 'min' ? Math.floor(v / 60) : num(v));
  function card(d) {
    const on = A().isUnlocked(d.id), hid = d.hidden && !on, p = A().progress(d);
    const goal = d.fmt === 'min' ? Math.floor(p.goal / 60) : num(p.goal);
    const date = on ? new Date(A().state.unlocked[d.id]).toLocaleDateString(lang() === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return `<div class="sys-achc ${on ? 'on' : 'off'} ${hid ? 'hid' : ''}">
      <div class="bd">${achBadge(d.icon, 46, !on)}</div>
      <div class="tx"><b>${hid ? '???' : esc(d.title)}</b><p>${hid ? t('ap.hiddenDesc') : esc(d.desc)}</p>
        ${on ? `<div class="ok">${t('ap.unlockedOn', { d: esc(date) })}<span><bdi>+${d.xp ?? 100} XP</bdi></span></div>`
    : hid ? '' : `<div class="pr"><div class="bar"><i style="width:${(p.k * 100).toFixed(1)}%"></i></div><span dir="ltr">${val(d, p.value)} / ${goal}${d.fmt === 'min' ? t('ap.min') : ''}</span></div>`}</div></div>`;
  }
  function render() {
    const L = A().list, n = A().count, pct = Math.round(n / L.length * 100);
    // unlocked first, then by progress (closest to done), hidden locked last
    const order = [...L].sort((a, b) => {
      const ua = A().isUnlocked(a.id), ub = A().isUnlocked(b.id); if (ua !== ub) return ua ? -1 : 1;
      if (ua) return A().state.unlocked[b.id] - A().state.unlocked[a.id];
      const ha = !!a.hidden, hb = !!b.hidden; if (ha !== hb) return ha ? 1 : -1;
      return A().progress(b).k - A().progress(a).k;
    });
    grid.innerHTML = order.map(card).join('');
    el.querySelector('.pc').innerHTML = `${pct}<small>%</small>`;
    el.querySelector('.cap').textContent = t('ap.cap'); el.querySelector('.ttl').textContent = t('tab.achievements'); el.querySelector('.recl').textContent = t('ap.records');
    el.querySelector('.sum').innerHTML = `<div class="sys-h3">${t('ap.progress')}</div><div class="big" dir="ltr"><b>${n}</b><small>/ ${L.length}</small></div>
      <div class="bar"><i style="width:${pct}%"></i></div><div class="lbl">${t('ap.sumLine', { p: pct, h: L.filter(d => d.hidden && !A().isUnlocked(d.id)).length })}</div>`;
    const r = A().records();
    const rows = [
      [t('rec.longestAir'), r.longestAir ? t('rec.sec', { n: r.longestAir.toFixed(1) }) : '—'],
      [t('rec.topSpeed'), r.topSpeed ? t('rec.speed', { a: Math.round(r.topSpeed), b: Math.round(r.topSpeed * 3.6) }) : '—'],
      [t('rec.combo'), r.bestCombo ? '×' + r.bestCombo : '—'],
      [t('rec.distance'), r.distance >= 1000 ? t('dist.km', { n: (r.distance / 1000).toFixed(2) }) : t('dist.m', { n: Math.round(r.distance) })],
      [t('rec.airTime'), clock(r.airTime)],
      [t('rec.crimes'), num(r.crimes)],
      [t('rec.enemies'), num(r.enemies)],
      [t('rec.playTime'), clock(r.playTime)],
      ...r.races.map(x => [t('rec.race', { m: x.title }), x.time != null ? raceT(x.time) : '—']),
    ];
    el.querySelector('.recs').innerHTML = rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b><bdi>${esc(v)}</bdi></b></div>`).join('');
  }
  let visible = false;
  sys.events.on('achievement:unlocked', () => { if (visible) render(); });
  return {
    id: 'achievements', get title() { return t('tab.achievements'); }, el,
    get hints() { return [['W/S', t('hint.scroll')]]; },
    footer: () => t('ap.foot', { a: A()?.count ?? 0, b: A()?.list.length ?? 0 }),
    show() { visible = true; grid.scrollTop = 0; render(); },
    hide() { visible = false; },
    key(e) {
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { grid.scrollBy({ top: 160, behavior: 'smooth' }); audio.sfx.move(); return true; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { grid.scrollBy({ top: -160, behavior: 'smooth' }); audio.sfx.move(); return true; }
      return false;
    },
  };
}
