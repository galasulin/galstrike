// OWNER: systems engineer. Missions page (pause menu): story mission list with lock state + best rank, detail panel with
// story, objectives, best score / time, Start / Replay / Abandon. Data + runtime live in game/systems/missions.js.
import { icon } from './icons.js';

export function createMissionsPage(sys) {
  const { save, audio, data } = sys;
  const el = document.createElement('div'); el.className = 'sys-coll sys-mpage';
  el.innerHTML = `<div class="cats sys-panel cut interactive"></div><div class="main sys-panel cut interactive"><div class="hd"><div><div class="sys-h3 cap"></div><h2 class="sys-h2 ttl"></h2></div><div class="pc"></div></div><div class="det sys-scroll"></div></div>`;
  let sel = 0;
  const MS = () => sys.missions;
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function renderList() {
    const L = MS().list, best = save.state.missions.best, act = MS().active?.def.id;
    el.querySelector('.cats').innerHTML = L.map((m, i) => {
      const ok = MS().isUnlocked(m.id), b = best[m.id];
      const tag = act === m.id ? '<em class="live">ACTIVE</em>' : b ? `<em class="rk rk-${b.rank}">${b.rank}</em>` : ok ? '<em class="new">NEW</em>' : `<em class="lk">${icon('lock', { sw: 2.4 })}</em>`;
      return `<div class="sys-list-item ${i === sel ? 'on' : ''} ${ok ? '' : 'locked'}" data-i="${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span><b>${ok ? esc(m.title) : 'Locked'}</b>${tag}</div>`;
    }).join('');
    el.querySelectorAll('.cats .sys-list-item').forEach(n => { n.addEventListener('click', () => { sel = +n.dataset.i; audio.sfx.move(); render(); }); n.addEventListener('mouseenter', () => audio.sfx.hover()); });
  }
  function render() {
    renderList();
    const m = MS().list[sel], ok = MS().isUnlocked(m.id), b = save.state.missions.best[m.id], act = MS().active;
    const dn = data.districts.find(d => d.id === m.district)?.name || '';
    el.querySelector('.cap').textContent = `Mission ${sel + 1} · ${dn}`;
    el.querySelector('.ttl').textContent = ok ? m.title : 'Locked';
    el.querySelector('.pc').innerHTML = b ? `<span class="rk rk-${b.rank}">${b.rank}</span>` : '';
    const det = el.querySelector('.det');
    if (!ok) { det.innerHTML = `<p class="sys-p">Complete <b>${esc(MS().list[sel - 1]?.title || '')}</b> to unlock this mission.</p>`; return; }
    const running = act?.def.id === m.id;
    det.innerHTML = `<p class="sys-p story">${esc(m.blurb)}</p>
      <div class="sys-rule"></div><div class="sys-h3">Objectives</div>
      <ol class="objs">${m.obj.map((o, i) => `<li class="${running && i < act.idx ? 'done' : running && i === act.idx ? 'cur' : ''}">${esc(MS().describe(o))}</li>`).join('')}</ol>
      <div class="sys-rule"></div>
      <div class="stats"><div><small>Best score</small><b>${b ? b.score : '—'}</b></div><div><small>Best rank</small><b>${b ? b.rank : '—'}</b></div><div><small>Best time</small><b>${b ? fmt(b.time) : '—'}</b></div><div><small>Par</small><b>${fmt(m.par)}</b></div></div>
      <div class="acts">${running ? '<button class="sys-btn red" data-a="abandon">Abandon Mission</button>' : `<button class="sys-btn red" data-a="start">${b ? 'Replay' : 'Start'} Mission</button>`}
        ${act && !running ? '<span class="warn">Starting will abandon the current mission</span>' : ''}</div>
      <p class="sys-p hint">Score = objective points + time bonus + no-damage bonus + style (combos, air time). Rank S ≥ 85% · A ≥ 70% · B ≥ 50%.</p>`;
    det.querySelectorAll('[data-a]').forEach(bt => bt.addEventListener('click', () => act_(bt.dataset.a)));
  }
  function act_(a) {
    const m = MS().list[sel];
    if (a === 'abandon') { MS().abandon(); audio.sfx.back(); render(); return; }
    if (!MS().isUnlocked(m.id)) { audio.sfx.deny?.(); return; }
    audio.sfx.select(); sys.pause.close(); MS().start(m.id);
  }
  return {
    id: 'missions', title: 'Missions', el,
    hints: [['W/S', 'Select'], ['Enter', 'Start'], ['X', 'Abandon']],
    footer: () => `${save.state.missions.done.length}/${MS()?.list.length ?? 0} COMPLETE · TOTAL SCORE ${save.state.missions.total}`,
    show() { const a = MS().active; if (a) sel = MS().list.indexOf(a.def); else { const i = MS().list.findIndex(m => MS().isUnlocked(m.id) && !save.state.missions.done.includes(m.id)); if (i >= 0) sel = i; } render(); },
    key(e) {
      const n = MS().list.length;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { sel = (sel + 1) % n; audio.sfx.move(); render(); return true; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { sel = (sel - 1 + n) % n; audio.sfx.move(); render(); return true; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (MS().active?.def.id !== MS().list[sel].id) act_('start'); return true; }
      if (e.code === 'KeyX' && MS().active) { act_('abandon'); return true; }
      return false;
    },
  };
}
