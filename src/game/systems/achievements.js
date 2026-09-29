// OWNER: systems engineer. Achievements + records. Data-driven: each ACHIEVEMENTS entry reads one stat (a persistent
// counter kept here, or a value derived from the existing save: towers, crimes, missions, level ...) and unlocks once
// stat >= goal. Checked after every relevant event and once a second while playing.
//   save.state.achievements = { unlocked: { [id]: epochMs }, stats: { enemies, photos, fastTravel, airTime, distance,
//                               suitsWorn:[ids] }, records: { longestAir, topSpeed, bestCombo, races: { [missionId]: s } } }
//   play time lives in save.state.playTime (seconds in 'play' mode).
// Unlock: gold toast "Achievement Unlocked" + success sfx + small XP (prog.addXp(def.xp, 'achievement')), emits
//   achievement:unlocked {id, title}.
// Debug: __sys.debug.ach.{state(), unlockAll(), reset()}
import { on, emit } from './events.js';
import { MISSIONS } from './missions.js';
import { icon } from '../../ui/menus/icons.js';
import { t, localize } from '../../ui/i18n.js';

// stat keys -> see createAchievements().stat
export const ACHIEVEMENTS = [
  { id: 'tower1', title: 'Signal Boost', desc: 'Activate your first research tower.', icon: 'tower', stat: 'towers', goal: 1 },
  { id: 'towerAll', title: 'Full Coverage', desc: 'Activate every research tower in Manhattan.', icon: 'tower', stat: 'towers', goal: 9, xp: 300 },
  { id: 'crime1', title: 'Friendly Neighbourhood', desc: 'Stop your first crime.', icon: 'crime', stat: 'crimes', goal: 1 },
  { id: 'crime10', title: 'Neighbourhood Watch', desc: 'Stop 10 crimes.', icon: 'crime', stat: 'crimes', goal: 10, xp: 150 },
  { id: 'crime50', title: 'Protector of Manhattan', desc: 'Stop 50 crimes.', icon: 'crime', stat: 'crimes', goal: 50, xp: 400 },
  { id: 'enemy25', title: 'Knockout Artist', desc: 'Defeat 25 enemies.', icon: 'mugging', stat: 'enemies', goal: 25 },
  { id: 'enemy100', title: 'One-Man Army', desc: 'Defeat 100 enemies.', icon: 'mugging', stat: 'enemies', goal: 100, xp: 300 },
  { id: 'pack5', title: 'Nostalgia Trip', desc: 'Find 5 of Peter\'s old backpacks.', icon: 'backpack', stat: 'backpacks', goal: 5 },
  { id: 'packAll', title: 'Memory Lane', desc: 'Find every backpack in the city.', icon: 'backpack', stat: 'backpacks', goal: 'allBackpacks', xp: 400 },
  { id: 'mission1', title: 'First Day on the Job', desc: 'Complete your first story mission.', icon: 'waypoint', stat: 'missions', goal: 1 },
  { id: 'missionAll', title: 'Lights Back On', desc: 'Complete every story mission.', icon: 'waypoint', stat: 'missions', goal: MISSIONS.length, xp: 500 },
  { id: 'rankS', title: 'Spectacular', desc: 'Earn an S rank on any mission.', icon: 'xp', stat: 'sRanks', goal: 1, xp: 200 },
  { id: 'score20k', title: 'High Scorer', desc: 'Reach a total mission score of 20,000.', icon: 'xp', stat: 'missionScore', goal: 20000, xp: 300 },
  { id: 'suits5', title: 'Wardrobe Change', desc: 'Wear 5 different suits.', icon: 'suit', stat: 'suitsWorn', goal: 5 },
  { id: 'israel', title: 'Blue and White', desc: 'Suit up in the Israel Suit.', icon: 'suit', stat: 'israelWorn', goal: 1, hidden: true },
  { id: 'air10', title: 'Frequent Flyer', desc: 'Spend 10 minutes in the air.', icon: 'swing', stat: 'airTime', goal: 600, fmt: 'min', xp: 200 },
  { id: 'level5', title: 'Rising Star', desc: 'Reach level 5.', icon: 'trick', stat: 'level', goal: 5 },
  { id: 'level10', title: 'Seasoned Hero', desc: 'Reach level 10.', icon: 'trick', stat: 'level', goal: 10, xp: 250 },
  { id: 'photo10', title: 'Shutterbug', desc: 'Take 10 photos in Photo Mode.', icon: 'camera', stat: 'photos', goal: 10 },
  { id: 'travel1', title: 'Mind the Gap', desc: 'Fast travel by subway.', icon: 'station', stat: 'fastTravel', goal: 1 },
  { id: 'play30', title: 'Dedicated', desc: 'Play for 30 minutes.', icon: 'gps', stat: 'playTime', goal: 1800, fmt: 'min', hidden: true },
];

for (const a of ACHIEVEMENTS) localize(a, 'ach.' + a.id, ['title', 'desc']); // (i18n)

const XP_DEFAULT = 100;
const defStats = () => ({ enemies: 0, photos: 0, fastTravel: 0, airTime: 0, distance: 0, suitsWorn: [] });
const defRecords = () => ({ longestAir: 0, topSpeed: 0, bestCombo: 0, races: {} });
export const defaultAchievements = () => ({ unlocked: {}, stats: defStats(), records: defRecords() });

// gold hexagon badge with the achievement glyph (toast + cards)
export function achBadge(ic, size = 38, locked = false) {
  const fill = locked ? '#39425c' : '#f5b82e', stroke = locked ? 'rgba(185,198,230,.5)' : 'rgba(255,255,255,.9)';
  const glyph = icon(locked ? 'lock' : ic, { color: locked ? '#9aa6c6' : '#1a1204', sw: 2.8 }).replace('<svg ', '<svg x="7" y="7.5" width="18" height="18" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><path d="M16 1.5 L29 9 L29 23 L16 30.5 L3 23 L3 9 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>${glyph}</svg>`;
}

export function createAchievements(sys) {
  const { ctx, save, ui, prog, data } = sys;
  // old saves: fill in the block and any field added later
  function ensure() {
    const st = save.state;
    const a = st.achievements = { ...defaultAchievements(), ...(st.achievements || {}) };
    a.unlocked = a.unlocked || {};
    a.stats = { ...defStats(), ...(a.stats || {}) };
    a.records = { ...defRecords(), ...(a.records || {}) };
    if (!Array.isArray(a.stats.suitsWorn)) a.stats.suitsWorn = [];
    if (typeof st.playTime !== 'number') st.playTime = 0;
    return a;
  }
  let A = ensure();
  const S = () => save.state;

  const stat = {
    towers: () => S().towers.length,
    crimes: () => S().crimes.stopped || 0,
    enemies: () => A.stats.enemies,
    backpacks: () => S().backpacks.length,
    missions: () => S().missions.done.length,
    sRanks: () => Object.values(S().missions.best || {}).filter(b => b.rank === 'S').length,
    missionScore: () => S().missions.total || 0,
    suitsWorn: () => A.stats.suitsWorn.length,
    israelWorn: () => (A.stats.suitsWorn.includes('israel') ? 1 : 0),
    airTime: () => A.stats.airTime,
    level: () => S().level,
    photos: () => A.stats.photos,
    fastTravel: () => A.stats.fastTravel,
    playTime: () => S().playTime || 0,
  };
  const goalOf = d => (d.goal === 'allBackpacks' ? data.backpacks.length : d.stat === 'towers' ? Math.min(d.goal, data.towers.length) : d.goal);
  const isUnlocked = id => !!A.unlocked[id];
  function progress(d) { const g = goalOf(d), v = stat[d.stat]?.() ?? 0; return { value: Math.min(v, g), goal: g, k: g ? Math.min(1, v / g) : 1 }; }

  function unlock(d, { silent = false } = {}) {
    if (A.unlocked[d.id]) return false;
    A.unlocked[d.id] = Date.now(); save.markDirty();
    if (!silent) {
      ui.toast({ title: t('ach.unlocked'), text: d.title, icon: achBadge(d.icon, 38), tone: 'gold ach', sound: 'success', ms: 5200, maxAge: 60000 });
      prog.addXp(d.xp ?? XP_DEFAULT, 'achievement');
    }
    emit('achievement:unlocked', { id: d.id, title: d.title });
    return true;
  }
  let checking = false;
  // bulk: several unlocks at once (old saves on load) -> XP for each, one summary toast instead of a flood
  function check({ bulk = false } = {}) {
    if (checking) return 0; checking = true; // an unlock's XP can level up, which re-enters check()
    const got = [];
    try { for (const d of ACHIEVEMENTS) if (!A.unlocked[d.id] && progress(d).k >= 1) { got.push(d); unlock(d, { silent: bulk && got.length > 0 }); } } finally { checking = false; }
    if (bulk && got.length > 1) {
      prog.addXp(got.slice(1).reduce((s, d) => s + (d.xp ?? XP_DEFAULT), 0), 'achievement');
      ui.toast({ title: t('ach.unlockedMany'), text: t('ach.more', { n: got.length - 1 }), icon: achBadge('xp', 38), tone: 'gold ach', sound: null, ms: 5200, maxAge: 60000 });
    }
    return got.length;
  }

  // ---------------------------------------------------------------- events -> counters / records
  const bump = (k, n = 1) => { A.stats[k] = (A.stats[k] || 0) + n; save.markDirty(); };
  const combo = n => { if (n > A.records.bestCombo) { A.records.bestCombo = n; save.markDirty(); } };
  const wear = id => { if (id && !A.stats.suitsWorn.includes(id)) { A.stats.suitsWorn.push(id); save.markDirty(); } };
  wear(S().suit);
  on('combat:enemyDown', e => { bump('enemies'); combo(e?.combo || 0); check(); });
  on('photo:captured', () => { bump('photos'); check(); });
  on('fasttravel:start', e => { if (e?.station) { bump('fastTravel'); } });
  on('fasttravel:end', () => { graceT = 3; air.cur = 0; check(); });
  on('suit:changed', e => { wear(e?.id); check(); });
  on('mission:race', e => {
    if (!e?.id || !(e.time > 0)) return;
    const r = A.records.races, t = +e.time.toFixed(2);
    if (!r[e.id] || t < r[e.id]) { r[e.id] = t; save.markDirty(); }
  });
  for (const ev of ['tower:activated', 'crime:resolved', 'collectible:pickup', 'mission:complete', 'level:up']) on(ev, () => check());

  // ---------------------------------------------------------------- per frame: play time, air time, speed, distance
  const air = { cur: 0 };
  let graceT = 0, checkT = 0, firstFrame = true;
  function update(dt, playing) {
    if (!playing || !(dt > 0) || dt > 0.25) return;
    // progress earned before achievements existed (old saves): unlocked on the first gameplay frame, one summary toast
    if (firstFrame) { firstFrame = false; check({ bulk: true }); }
    S().playTime = (S().playTime || 0) + dt;
    graceT = Math.max(0, graceT - dt);
    const P = ctx.player, a = P.anim, mode = a?.mode || P.mode || '';
    const v = P.velocity || a?.velocity, sp = v ? v.length() : 0;
    const airborne = a ? a.grounded === false : mode === 'air' || mode === 'swing';
    const inAir = airborne && !['wall', 'perch', 'rope'].includes(mode) && graceT <= 0;
    if (inAir) {
      air.cur += dt; A.stats.airTime += dt;
      if (air.cur > A.records.longestAir) A.records.longestAir = air.cur;
      if (sp < 150) A.stats.distance += sp * dt; // (teleports / glitches never count)
    } else air.cur = 0;
    if (sp > A.records.topSpeed && sp < 150 && graceT <= 0) A.records.topSpeed = sp;
    combo(ctx.combat?.combo?.n || 0);
    checkT += dt;
    if (checkT > 1) { checkT = 0; save.markDirty(3000); check(); }
  }

  const api = {
    list: ACHIEVEMENTS, progress, isUnlocked, update, check,
    get state() { return A; },
    get count() { return ACHIEVEMENTS.filter(d => A.unlocked[d.id]).length; },
    records() {
      const r = A.records, st = S();
      return {
        longestAir: r.longestAir, topSpeed: r.topSpeed, bestCombo: r.bestCombo, distance: A.stats.distance, airTime: A.stats.airTime,
        crimes: st.crimes.stopped || 0, enemies: A.stats.enemies, playTime: st.playTime || 0,
        races: MISSIONS.filter(m => m.obj.some(o => o.type === 'race')).map(m => ({ id: m.id, title: m.title, time: r.races[m.id] ?? null })),
      };
    },
    debug: {
      state() {
        return { unlocked: api.count, total: ACHIEVEMENTS.length, ids: Object.keys(A.unlocked),
          progress: Object.fromEntries(ACHIEVEMENTS.map(d => { const p = progress(d); return [d.id, `${Math.floor(p.value)}/${p.goal}`]; })),
          stats: { ...A.stats, airTime: +A.stats.airTime.toFixed(1), distance: Math.round(A.stats.distance) }, records: api.records() };
      },
      unlockAll() { let n = 0; for (const d of ACHIEVEMENTS) if (unlock(d, { silent: true })) n++; if (n) { ui.toast({ title: t('ach.unlocked'), text: t('ach.allNew', { n }), icon: achBadge('xp', 38), tone: 'gold ach', sound: 'success' }); } save.markDirty(); return n; },
      unlock(id) { const d = ACHIEVEMENTS.find(x => x.id === id); return d ? unlock(d) : false; },
      reset() { save.state.achievements = defaultAchievements(); save.state.playTime = 0; A = ensure(); wear(S().suit); save.flush(); return true; },
      check,
    },
  };
  return api;
}
