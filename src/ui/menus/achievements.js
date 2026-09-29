// OWNER: systems engineer. Achievements page (pause menu): progress header (unlocked / total, % complete), a grid of
// achievement cards (progress bars, locked / unlocked, hidden ones as "???") and a Records panel. Data + counters live
// in game/systems/achievements.js (sys.ach).
import { achBadge } from '../../game/systems/achievements.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`; };
const raceT = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const num = n => Math.floor(n).toLocaleString('en-US');

export function createAchievementsPage(sys) {
  const { audio } = sys;
  const A = () => sys.ach;
  const el = document.createElement('div'); el.className = 'sys-coll sys-ach';
  el.innerHTML = `<div class="cats side sys-panel cut interactive sys-scroll"><div class="sum"></div><div class="sys-rule"></div><div class="sys-h3">Records</div><div class="recs"></div></div>
    <div class="main sys-panel cut interactive"><div class="hd"><div><div class="sys-h3 cap">Trophy Case</div><h2 class="sys-h2">Achievements</h2></div><div class="pc"></div></div><div class="grid sys-scroll"></div></div>`;
  const grid = el.querySelector('.grid');

  const val = (d, v) => (d.fmt === 'min' ? Math.floor(v / 60) : num(v));
  function card(d) {
    const on = A().isUnlocked(d.id), hid = d.hidden && !on, p = A().progress(d);
    const goal = d.fmt === 'min' ? Math.floor(p.goal / 60) : num(p.goal);
    const date = on ? new Date(A().state.unlocked[d.id]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return `<div class="sys-achc ${on ? 'on' : 'off'} ${hid ? 'hid' : ''}">
      <div class="bd">${achBadge(d.icon, 46, !on)}</div>
      <div class="tx"><b>${hid ? '???' : esc(d.title)}</b><p>${hid ? 'Hidden achievement — keep playing to reveal it.' : esc(d.desc)}</p>
        ${on ? `<div class="ok">Unlocked · ${esc(date)}<span>+${d.xp ?? 100} XP</span></div>`
    : hid ? '' : `<div class="pr"><div class="bar"><i style="width:${(p.k * 100).toFixed(1)}%"></i></div><span>${val(d, p.value)} / ${goal}${d.fmt === 'min' ? ' min' : ''}</span></div>`}</div></div>`;
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
    el.querySelector('.sum').innerHTML = `<div class="sys-h3">Progress</div><div class="big"><b>${n}</b><small>/ ${L.length}</small></div>
      <div class="bar"><i style="width:${pct}%"></i></div><div class="lbl">${pct}% complete · ${L.filter(d => d.hidden && !A().isUnlocked(d.id)).length} hidden</div>`;
    const r = A().records();
    const rows = [
      ['Longest air time', r.longestAir ? r.longestAir.toFixed(1) + ' s' : '—'],
      ['Top speed', r.topSpeed ? `${Math.round(r.topSpeed)} m/s · ${Math.round(r.topSpeed * 3.6)} km/h` : '—'],
      ['Longest combo', r.bestCombo ? '×' + r.bestCombo : '—'],
      ['Distance swung', r.distance >= 1000 ? (r.distance / 1000).toFixed(2) + ' km' : Math.round(r.distance) + ' m'],
      ['Total air time', clock(r.airTime)],
      ['Crimes stopped', num(r.crimes)],
      ['Enemies defeated', num(r.enemies)],
      ['Play time', clock(r.playTime)],
      ...r.races.map(x => [`Race · ${x.title}`, x.time != null ? raceT(x.time) : '—']),
    ];
    el.querySelector('.recs').innerHTML = rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  }
  let visible = false;
  sys.events.on('achievement:unlocked', () => { if (visible) render(); });
  return {
    id: 'achievements', title: 'Achievements', el,
    hints: [['W/S', 'Scroll']],
    footer: () => `${A()?.count ?? 0}/${A()?.list.length ?? 0} UNLOCKED`,
    show() { visible = true; grid.scrollTop = 0; render(); },
    hide() { visible = false; },
    key(e) {
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { grid.scrollBy({ top: 160, behavior: 'smooth' }); audio.sfx.move(); return true; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { grid.scrollBy({ top: -160, behavior: 'smooth' }); audio.sfx.move(); return true; }
      return false;
    },
  };
}
