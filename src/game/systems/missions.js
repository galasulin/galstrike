// OWNER: systems engineer. Story missions + scoring: a data-driven chain (MISSIONS) built from reusable objective types
// that ride on the open-world systems (travel waypoints, towers, crimes, combat, backpacks, landmark photos) plus
// mission-owned checkpoint rings for races. One mission runs at a time; they unlock in order.
//   objective types: reach {landmark|district, r?}   tower {district}   crimes {n, crime?}   defeat {n}   collect {n}
//                    race {x, z0, dir, n, sp, limit}   photo {landmark}
//   score = objective points + time bonus (vs par) + no-damage bonus + style (best combo, air time) -> rank S/A/B/C.
//   save.state.missions = { done:[ids], best:{ id:{score, rank, time} }, total }  (sum of best scores)
// Events: mission:start {id}  mission:objective {id, index, type}  mission:race {id, index, time}  mission:complete {id, score, rank}  mission:failed {id, reason}
//   mission:abandon {id}.  Debug: __sys.debug.mission.{start(id), skip(), fail(), abandon(), unlockAll(), state()}
import * as THREE from 'three';
import { on, emit } from './events.js';
import { onLand } from '../../world/layout.js';

export const MISSIONS = [
  { id: 'm1', title: 'Signal Lost', district: 'mid', par: 240,
    blurb: 'Every research tower in Manhattan just went dark. Start where the city is loudest.',
    intro: [['Lab', 'Every research tower in Manhattan just went dark. Someone is jamming the grid.'], ['You', 'Then I start where the city is loudest. Midtown.']],
    obj: [{ type: 'reach', landmark: 'mid' }, { type: 'tower', district: 'mid' }, { type: 'crimes', n: 1 }] },
  { id: 'm2', title: 'Rooftop Relay', district: 'hk', par: 150,
    blurb: 'Jammer pings are hopping block to block. Outrun the signal through Hell\'s Kitchen.',
    intro: [['Lab', 'Jammer pings are hopping block to block through Hell\'s Kitchen. Follow the relay rings.'], ['You', 'Faster than a signal? Watch me.']],
    obj: [{ type: 'race', x: -430, z0: -60, dir: -1, n: 8, sp: 85, limit: 70 }] },
  { id: 'm3', title: 'Static Crew', district: 'hk', par: 420,
    blurb: 'A gang in wired jackets is shaking down the neighbourhood. Show them the door.',
    intro: [['Dispatch', 'Multiple assaults reported in Hell\'s Kitchen. Suspects wearing wired jackets.'], ['You', 'The Static Crew. So they have a name now.']],
    obj: [{ type: 'reach', district: 'hk' }, { type: 'crimes', n: 2, crime: 'mugging' }, { type: 'defeat', n: 6 }] },
  { id: 'm4', title: 'Paper Trail', district: 'ct', par: 360,
    blurb: 'The crew stashed stolen parts in old backpacks. The paper wants pictures.',
    intro: [['Lab', 'The crew hid stolen transmitter parts in old backpacks all over town.'], ['You', 'And the paper will want pictures. Two birds, one web.']],
    obj: [{ type: 'collect', n: 2 }, { type: 'photo', landmark: 'ct' }] },
  { id: 'm5', title: 'Uptown Uplink', district: 'ues', par: 300,
    blurb: 'The Upper East Side tower is broadcasting on the crew\'s frequency. Take it back.',
    intro: [['Lab', 'The Upper East Side tower is broadcasting on the crew\'s frequency.'], ['You', 'Time to take it back. Then I want eyes on that tower across the street.']],
    obj: [{ type: 'tower', district: 'ues' }, { type: 'reach', landmark: 'ues' }, { type: 'photo', landmark: 'ues' }] },
  { id: 'm6', title: 'Getaway Grid', district: 'fd', par: 360,
    blurb: 'A crew sedan is running the grid downtown. Stop it, then chase the relay south.',
    intro: [['Unit 7', 'Black sedan, crew colours, heading downtown fast!'], ['You', 'Not on my streets.']],
    obj: [{ type: 'crimes', n: 1, crime: 'carChase' }, { type: 'race', x: 0, z0: 2000, dir: 1, n: 10, sp: 90, limit: 85 }] },
  { id: 'm7', title: 'Vault Breakers', district: 'fd', par: 480,
    blurb: 'The crew is hitting banks to pay for the jammer. Close the account.',
    intro: [['Dispatch', 'Silent alarms across the Financial District. Suspects may be armed.'], ['You', 'They\'re robbing banks to fund the jammer. Let\'s close the account.']],
    obj: [{ type: 'reach', district: 'fd' }, { type: 'crimes', n: 2, crime: 'bankAlarm' }] },
  { id: 'm8', title: 'Lights Out', district: 'harlem', par: 600,
    blurb: 'The master jammer is on the move through Harlem. This ends tonight.',
    intro: [['Lab', 'Found it. The master jammer is on the move through Harlem.'], ['You', 'Then this ends tonight. Every block, every roof.']],
    obj: [{ type: 'race', x: 0, z0: -3000, dir: 1, n: 10, sp: 80, limit: 90 }, { type: 'defeat', n: 8 }, { type: 'reach', landmark: 'park' }] },
];

const PTS = { reach: 300, tower: 500, crimes: 400, defeat: 60, collect: 300, race: 150, raceEnd: 300, photo: 400 };
const BONUS = { time: 1500, clean: 1000, combo: 600, air: 400 }; // style = combo (only counted in missions with fights) + air time
const CRIME_NAMES = { mugging: 'muggings', bankAlarm: 'bank robberies', carChase: 'getaway cars' };
const RING_R = 7;
export const rankOf = pct => (pct >= 0.85 ? 'S' : pct >= 0.7 ? 'A' : pct >= 0.5 ? 'B' : 'C');
const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export function createMissions(sys) {
  const { ctx, save, ui, audio, prog, data, flow } = sys;
  const S = () => save.state.missions;
  const dName = id => data.districts.find(d => d.id === id)?.name || id;
  const lmOf = id => data.landmarks.find(l => l.district === id);
  const unlocked = i => i === 0 || S().done.includes(MISSIONS[i - 1]?.id);
  // (debug) unlock everything without completing: kept in memory only
  let unlockAllFlag = false;
  const isUnlocked = id => { const i = MISSIONS.findIndex(m => m.id === id); return i >= 0 && (unlockAllFlag || unlocked(i)); };

  let M = null; // running mission: { def, idx, t, objs, pts, dmg, combo, air, ... }
  let result = null, resultT = 0; // results panel
  const prevPos = new THREE.Vector3();

  // ---------------------------------------------------------------- objective text / max points
  function objMax(o) {
    switch (o.type) { case 'crimes': return PTS.crimes * o.n; case 'defeat': return PTS.defeat * o.n; case 'collect': return PTS.collect * o.n; case 'race': return PTS.race * o.n + PTS.raceEnd; default: return PTS[o.type]; }
  }
  const fights = def => def.obj.some(o => o.type === 'defeat' || (o.type === 'crimes' && o.crime !== 'carChase'));
  function maxScore(def) { return def.obj.reduce((s, o) => s + objMax(o), 0) + BONUS.time + BONUS.clean + BONUS.air + (fights(def) ? BONUS.combo : 0); }
  function describe(o, st = null) {
    const k = st ? `${st.count}/${st.need}` : '';
    switch (o.type) {
      case 'reach': return o.landmark ? `Swing to ${lmOf(o.landmark)?.name || dName(o.landmark)}` : `Head to ${dName(o.district)}`;
      case 'tower': return (st ? st.sync : sys.towers.isActive('tower_' + o.district)) ? `Sync the ${dName(o.district)} tower` : `Activate the ${dName(o.district)} tower`;
      case 'crimes': return `Stop ${o.crime ? CRIME_NAMES[o.crime] : 'crimes'}${k ? ' ' + k : ` (${o.n})`}`;
      case 'defeat': return `Defeat enemies${k ? ' ' + k : ` (${o.n})`}`;
      case 'collect': return `Recover backpacks${k ? ' ' + k : ` (${o.n})`}`;
      case 'race': return st ? (st.started ? `Checkpoints ${k} · ${fmtT(Math.max(0, o.limit - st.rt))}` : 'Reach the first relay ring') : `Relay race: ${o.n} rings in ${o.limit}s`;
      case 'photo': return `Photograph ${lmOf(o.landmark)?.name || dName(o.landmark)}`;
    }
    return '';
  }

  // ---------------------------------------------------------------- HUD (live timer / score / objective) + results
  const hud = document.createElement('div'); hud.className = 'sys-mis';
  hud.innerHTML = '<div class="hd"><small></small><b></b></div><div class="row"><span class="tm"></span><span class="sc"></span></div><div class="ob"></div>';
  const res = document.createElement('div'); res.className = 'sys-mres';
  ui.root.appendChild(hud); ui.root.appendChild(res);
  const hudEls = { cap: hud.querySelector('small'), ttl: hud.querySelector('.hd b'), tm: hud.querySelector('.tm'), sc: hud.querySelector('.sc'), ob: hud.querySelector('.ob') }, last = {};
  const put = (k, v) => { if (last[k] !== v) { last[k] = v; hudEls[k].textContent = v; } };
  on('flow:mode', ({ mode }) => { const hide = mode !== 'play'; hud.classList.toggle('hid', hide); res.classList.toggle('hid', hide); });

  function showResult(r) {
    result = r; resultT = r.ok ? 12 : 20;
    const rows = r.ok ? [['Objectives', r.obj], ['Time bonus', r.time, fmtT(r.t)], ['No-damage bonus', r.clean, r.dmg ? `${Math.round(r.dmg)} dmg taken` : 'untouched'], ['Style', r.style, `combo x${r.combo} · ${Math.round(r.air)}s air`]] : [];
    res.innerHTML = `<div class="box ${r.ok ? '' : 'fail'}"><small>${r.ok ? 'MISSION COMPLETE' : 'MISSION FAILED'}</small><h3></h3>
      ${r.ok ? `<div class="rk rk-${r.rank}">${r.rank}</div>` : '<p class="why"></p>'}
      ${rows.map(([n, v, d]) => `<div class="ln"><span>${n}${d ? `<i>${d}</i>` : ''}</span><b>+${v}</b></div>`).join('')}
      ${r.ok ? `<div class="ln tot"><span>Score${r.best ? '<em>NEW BEST</em>' : ''}</span><b>${r.score}</b></div><div class="xp">+${r.xp} XP</div>` : ''}
      <div class="keys">${r.ok ? '<span><span class="sys-key">Enter</span>Continue</span>' : '<span><span class="sys-key">Enter</span>Retry</span><span><span class="sys-key">Backspace</span>Dismiss</span>'}</div></div>`;
    res.querySelector('h3').textContent = r.title; if (!r.ok) res.querySelector('.why').textContent = r.reason;
    res.classList.remove('on'); void res.offsetWidth; res.classList.add('on');
  }
  function hideResult() { result = null; res.classList.remove('on'); }
  flow.onKey((e, mode) => {
    if (mode !== 'play' || !result || e.repeat) return false;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { const r = result; hideResult(); if (!r.ok) start(r.id); else audio.sfx.select(); return true; }
    if (e.code === 'Backspace') { hideResult(); audio.sfx.back(); return true; }
    return false;
  });

  // ---------------------------------------------------------------- race rings
  const ringGeo = new THREE.TorusGeometry(RING_R, 0.32, 10, 48);
  function buildRace(o) {
    const out = [];
    for (let i = 0; i < o.n; i++) {
      const z = o.z0 + o.dir * o.sp * i, x = o.x + (i % 2 ? 4.5 : -4.5) * (i ? 1 : 0);
      if (!onLand(x, z)) break;
      const gy = ctx.world.groundHeight(x, z, 2);
      let y = gy + 14 + 12 * Math.abs(Math.sin(i * 1.3));
      // something overhead (bridge / sign gantry)? lift the ring above it
      const hit = ctx.world.raycast(_a.set(x, y + 30, z), _b.set(0, -1, 0), 32); if (hit && hit.point.y > y - RING_R - 1) y = hit.point.y + RING_R + 2;
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.2, 2.2), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      m.position.set(x, y, z); m.renderOrder = 4; m.frustumCulled = false; ctx.scene.add(m);
      out.push({ pos: m.position, m, n: new THREE.Vector3(0, 0, o.dir) });
    }
    return out;
  }
  function clearRace(st) { for (const r of st?.rings || []) { r.m.parent?.remove(r.m); r.m.material.dispose(); } if (st) st.rings = []; }
  function styleRings(st) {
    st.rings.forEach((r, i) => {
      r.m.visible = i >= st.count;
      const next = i === st.count;
      r.m.material.color.setRGB(...(next ? [2.6, 1.7, 0.3] : [0.3, 1.2, 2.2])); r.m.material.opacity = next ? 0.95 : Math.max(0.15, 0.55 - (i - st.count) * 0.08);
    });
  }

  // ---------------------------------------------------------------- objective lifecycle
  function targetOf(st) {
    const o = st.o;
    if (o.type === 'reach') { if (o.landmark) { const l = lmOf(o.landmark); return l && { x: l.target.x, z: l.target.z, r: o.r ?? Math.max(60, (l.radius || 30) + 35) }; } const d = data.districts.find(x => x.id === o.district); return d && { x: d.anchor[0], z: d.anchor[1], r: o.r ?? 90 }; }
    if (o.type === 'tower') { const t = data.towers.find(x => x.district === o.district); return t && { x: t.pos.x, z: t.pos.z, y: t.pos.y, r: 10 }; }
    if (o.type === 'photo') { const l = lmOf(o.landmark); return l && { x: l.target.x, z: l.target.z, y: l.target.y, r: 0 }; }
    if (o.type === 'race') { const r = st.rings[st.count]; return r && { x: r.pos.x, z: r.pos.z, y: r.pos.y, r: 0 }; }
    if (o.type === 'collect') { const b = st.pack; return b && { x: b.pos.x, z: b.pos.z, y: b.pos.y, r: 0 }; }
    if (o.type === 'crimes' || o.type === 'defeat') { const c = sys.crimes.active; return c && { x: c.pos.x, z: c.pos.z, y: c.pos.y, r: 0 }; }
    return null;
  }
  function setWp(x, z) {
    const wp = sys.travel.waypoint;
    if (x == null) { if (wp && sys.travel.waypointTag === 'mission') sys.travel.setWaypoint(null, { silent: true }); return; }
    if (wp && Math.hypot(wp.x - x, wp.z - z) < 1) return;
    sys.travel.setWaypoint(new THREE.Vector3(x, 0, z), { silent: true, tag: 'mission' });
  }
  function nearestPack(p) { let best = null, bd = Infinity; for (const b of data.backpacks) { if (save.state.backpacks.includes(b.id)) continue; const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z); if (d < bd) { bd = d; best = b; } } return best; }

  function beginObjective() {
    const st = M.objs[M.idx], o = st.o, p = ctx.player.position;
    st.count = 0; st.need = o.n || 1; st.spawnT = 2;
    if (o.type === 'tower') st.sync = sys.towers.isActive('tower_' + o.district);
    if (o.type === 'collect') { const left = data.backpacks.filter(b => !save.state.backpacks.includes(b.id)).length; st.need = Math.min(o.n, left); st.pack = nearestPack(p); }
    if (o.type === 'race') { st.rings = buildRace(o); st.need = st.rings.length; st.started = false; st.rt = 0; styleRings(st); }
    emit('mission:objective', { id: M.def.id, index: M.idx, type: o.type });
    if (o.type === 'collect' && st.need <= 0) { advance(true); return; } // every backpack already found: nothing to do
    const tg = targetOf(st); if (tg && o.type !== 'crimes' && o.type !== 'defeat') setWp(tg.x, tg.z); else setWp(null);
    if (M.idx > 0) ui.toast({ title: 'New Objective', text: describe(o), icon: 'waypoint', tone: 'gold', ms: 3200 });
  }
  function advance(skipPts = false) {
    const st = M.objs[M.idx];
    if (st.o.type === 'race' && st.started && !skipPts) emit('mission:race', { id: M.def.id, index: M.idx, time: st.rt }); // records (achievements.js)
    if (!skipPts) M.pts += st.o.type === 'race' ? PTS.raceEnd : st.o.type === 'reach' || st.o.type === 'tower' || st.o.type === 'photo' ? PTS[st.o.type] : 0;
    st.done = true; clearRace(st); setWp(null);
    audio.sfx.success?.();
    M.idx++;
    if (M.idx >= M.objs.length) complete(); else beginObjective();
  }
  function progress(st, n = 1, pts = 0) {
    st.count = Math.min(st.need, st.count + n); M.pts += pts;
    if (st.count >= st.need) advance(); else audio.sfx.xp?.();
  }

  // ---------------------------------------------------------------- mission lifecycle
  function start(id) {
    const def = MISSIONS.find(m => m.id === id); if (!def || !isUnlocked(id)) return false;
    if (M) cleanup();
    hideResult();
    M = { def, idx: 0, t: 0, objs: def.obj.map(o => ({ o, count: 0, need: o.n || 1 })), pts: 0, dmg: 0, combo: 0, air: 0 };
    prevPos.copy(ctx.player.position);
    const n = MISSIONS.indexOf(def) + 1;
    ui.banner(`MISSION ${n}`, def.title, def.blurb, 'district');
    def.intro.forEach(([w, t], i) => setTimeout(() => { if (M?.def === def) ui.subtitle(w, t, 4200); }, 900 + i * 50));
    hud.classList.add('on');
    beginObjective();
    emit('mission:start', { id });
    return true;
  }
  function cleanup() {
    if (!M) return;
    for (const st of M.objs) clearRace(st);
    setWp(null); M = null; hud.classList.remove('on');
  }
  function breakdown() {
    const def = M.def, t = M.t;
    const time = Math.round(BONUS.time * THREE.MathUtils.clamp(1 - (t - def.par * 0.5) / def.par, 0, 1));
    const clean = Math.round(Math.max(0, BONUS.clean - M.dmg * 8));
    const style = Math.round(Math.min(BONUS.combo, M.combo * 25) + Math.min(BONUS.air, M.air * 4));
    const score = M.pts + time + clean + style;
    return { obj: M.pts, time, clean, style, score, rank: rankOf(score / maxScore(def)), t, dmg: M.dmg, combo: M.combo, air: M.air };
  }
  function complete() {
    const def = M.def, b = breakdown(), s = S();
    const first = !s.done.includes(def.id);
    const prev = s.best[def.id], best = !prev || b.score > prev.score;
    if (first) s.done.push(def.id);
    if (best) s.best[def.id] = { score: b.score, rank: b.rank, time: +b.t.toFixed(1) };
    s.total = Object.values(s.best).reduce((a, x) => a + (x.score || 0), 0);
    save.markDirty();
    const xp = first ? 500 + Math.round(b.score / 10) : Math.round(b.score / 20);
    cleanup();
    audio.sfx.levelUp?.();
    prog.addXp(xp, 'mission');
    showResult({ ok: true, id: def.id, title: def.title, ...b, best: best && !!prev, xp });
    const next = MISSIONS[MISSIONS.indexOf(def) + 1];
    if (first && next) setTimeout(() => ui.toast({ title: 'Mission Unlocked', text: `${next.title} — pause menu › Missions`, icon: 'xp', tone: 'gold' }), 2500);
    else if (first && !next) setTimeout(() => ui.banner('STORY COMPLETE', 'Manhattan Protected', `Total mission score ${s.total}`, 'levelUp'), 1500);
    emit('mission:complete', { id: def.id, score: b.score, rank: b.rank });
  }
  function fail(reason = 'Mission failed') {
    if (!M) return;
    const def = M.def; cleanup();
    audio.sfx.deny?.();
    showResult({ ok: false, id: def.id, title: def.title, reason });
    emit('mission:failed', { id: def.id, reason });
  }
  function abandon() {
    if (!M) return false;
    const id = M.def.id; cleanup();
    ui.toast({ title: 'Mission Abandoned', text: MISSIONS.find(m => m.id === id).title, icon: 'waypoint', sound: 'deny' });
    emit('mission:abandon', { id });
    return true;
  }

  // ---------------------------------------------------------------- world events -> objectives
  const cur = () => (M ? M.objs[M.idx] : null);
  on('player:hurt', e => { if (M) M.dmg += e?.dmg || 0; });
  on('player:defeated', () => { const m = M; if (m) setTimeout(() => { if (M === m) fail('You were knocked out'); }, 1200); });
  on('combat:enemyDown', e => { if (!M) return; M.combo = Math.max(M.combo, e?.combo || 0); const st = cur(); if (st?.o.type === 'defeat') progress(st, 1, PTS.defeat); });
  on('crime:resolved', c => { const st = cur(); if (st?.o.type === 'crimes' && (!st.o.crime || st.o.crime === c.type)) progress(st, 1, PTS.crimes); });
  on('tower:activated', e => { const st = cur(); if (st?.o.type === 'tower' && e.district === st.o.district) advance(); });
  on('collectible:pickup', e => { const st = cur(); if (st?.o.type === 'collect' && e.kind === 'backpack') { progress(st, 1, PTS.collect); if (cur() === st) { st.pack = nearestPack(ctx.player.position); const tg = targetOf(st); if (tg) setWp(tg.x, tg.z); } } });
  // photo mode capture: re-check the mission landmark against the photo camera (already-collected landmarks count too)
  on('photo:captured', () => { const st = cur(); if (st?.o.type !== 'photo') return; const l = lmOf(st.o.landmark); if (l && sys.collect.photographable(l, ctx.camera, 1.4)) advance(); });

  // ---------------------------------------------------------------- per-frame (playing only)
  function update(dt, p) {
    if (result && (resultT -= dt) <= 0) hideResult();
    if (!M) return;
    M.t += dt;
    const a = ctx.player.anim; if (a && a.grounded === false) M.air += dt;
    M.combo = Math.max(M.combo, ctx.combat?.combo?.n || 0);
    const st = cur(), o = st.o;
    if (o.type === 'reach') { const tg = targetOf(st); if (tg && Math.hypot(tg.x - p.x, tg.z - p.z) < tg.r) advance(); }
    else if (o.type === 'crimes' || o.type === 'defeat') {
      // keep the city busy: spawn a matching crime when none is running (a wrong-type crime that hasn't started is replaced)
      const c = sys.crimes.active;
      if (c && o.crime && c.type !== o.crime && c.state === 'active' && !c.claimed) sys.crimes.cancel();
      if (!sys.crimes.active) { st.spawnT -= dt; if (st.spawnT <= 0) { st.spawnT = 4; sys.crimes.spawn(o.crime || (o.type === 'defeat' ? (Math.random() < 0.5 ? 'bankAlarm' : 'mugging') : null)); } }
    }
    else if (o.type === 'race') {
      const r = st.rings[st.count];
      if (st.started) { st.rt += dt; if (st.rt > o.limit) { fail('Out of time — the relay signal got away'); return; } }
      if (r) {
        // pass-through: the segment since last frame crosses the ring plane inside the ring (or we're simply in it)
        const d0 = _a.subVectors(prevPos, r.pos).dot(r.n), d1 = _b.subVectors(p, r.pos).dot(r.n);
        let hit = p.distanceTo(r.pos) < RING_R * 0.8;
        if (!hit && d0 * d1 <= 0 && d0 !== d1) { const k = d0 / (d0 - d1); _a.lerpVectors(prevPos, p, k); hit = _a.distanceTo(r.pos) < RING_R + 1.5; }
        if (hit) {
          if (!st.started) { st.started = true; st.rt = 0; ui.toast({ title: 'Relay Race', text: `${o.limit} seconds — go!`, icon: 'swing', tone: 'gold', ms: 2200, sound: null }); }
          audio.sfx.thwip?.(1.3); progress(st, 1, PTS.race);
          if (cur() === st) { styleRings(st); const tg = targetOf(st); if (tg) setWp(tg.x, tg.z); }
        } else { r.m.rotation.z += dt * 0.8; const s = 1 + 0.06 * Math.sin(M.t * 5); r.m.scale.setScalar(s); }
      }
    }
    prevPos.copy(p);
    if (!M) return; // the objective above finished (or failed) the mission
    // HUD
    const n = MISSIONS.indexOf(M.def) + 1;
    put('cap', `MISSION ${n}`); put('ttl', M.def.title); put('tm', fmtT(M.t)); put('sc', `${M.pts} PTS`);
    put('ob', describe(cur().o, cur()));
  }

  return {
    list: MISSIONS, isUnlocked, maxScore,
    get active() { return M; }, get result() { return result; },
    start, abandon, fail, update, describe,
    objective(p) {
      if (!M) return null; const st = cur(); const tg = targetOf(st);
      return { cap: `Mission · ${M.def.title}`, text: describe(st.o, st), dist: tg ? Math.hypot(tg.x - p.x, tg.z - p.z) : null };
    },
    interact(p) {
      const st = cur(); if (!st) return null; const o = st.o;
      if (o.type === 'tower' && st.sync) {
        const t = data.towers.find(x => x.district === o.district); const dh = Math.hypot(t.pos.x - p.x, t.pos.z - p.z), dy = p.y - t.pos.y;
        if (dh < 9.5 && dy > -2 && dy < 8) return { id: 'ms_' + t.id, pos: t.panel || (t.panel = t.pos.clone().setY(t.pos.y + 2.2)), label: 'Sync Research Tower', sub: 'Purge the jammer', hold: 1.2, priority: 8, tick: k => audio.sfx.towerCharge?.(k), action: () => { sys.markers.pulse(t.pos); sys.markers.flareTower?.(t.id); advance(); } };
      }
      if (o.type === 'photo') {
        const l = lmOf(o.landmark);
        if (l && sys.collect.photographable(l, ctx.camera, 1.4)) return { id: 'mp_' + l.id, label: 'Photograph Landmark', sub: `${l.name} · Mission`, hold: 0, priority: 7, action: () => { if (!save.state.landmarks.includes(l.id)) sys.collect.photoLandmark(l); sys.photo.snap(); advance(); } };
      }
      return null;
    },
    pins(p, out) {
      const st = cur(); if (!st) return; const tg = targetOf(st); if (!tg) return;
      if (st.o.type === 'crimes' || st.o.type === 'defeat' || st.o.type === 'collect') return; // crime / backpack pins already show these
      const d = Math.hypot(tg.x - p.x, tg.z - p.z);
      out.push({ kind: 'waypoint', pos: st.pinPos = (st.pinPos || new THREE.Vector3()).set(tg.x, (tg.y ?? ctx.world.groundHeight(tg.x, tg.z)) + (st.o.type === 'race' ? RING_R + 1.5 : 4), tg.z), dist: d, edge: true, scale: 1 });
    },
    minimap(list) { const st = cur(); if (!st) return; const tg = targetOf(st); if (tg && st.o.type !== 'crimes' && st.o.type !== 'defeat') list.push({ kind: 'waypoint', pos: _a.set(tg.x, 0, tg.z).clone(), clamp: true, mscale: 1 }); },
    debug: {
      start, abandon, fail: () => fail('Debug fail'),
      skip() { if (!M) return null; const st = cur(), ty = st.o.type; if (!['reach', 'tower', 'photo'].includes(ty)) M.pts += (st.need - st.count) * PTS[ty]; advance(); return M ? M.idx : 'done'; },
      unlockAll() { unlockAllFlag = true; },
      state() { return M ? { id: M.def.id, idx: M.idx, obj: cur()?.o.type, text: describe(cur().o, cur()), t: +M.t.toFixed(1), pts: M.pts, dmg: M.dmg, combo: M.combo, air: +M.air.toFixed(1), rings: cur()?.rings?.length ?? null } : { active: null, result: result && { ok: result.ok, score: result.score, rank: result.rank }, save: S() }; },
      ringPos(i) { const st = cur(); return st?.rings?.[i ?? st.count]?.pos.toArray().map(v => +v.toFixed(1)) ?? null; },
    },
  };
}
