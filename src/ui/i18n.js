// OWNER: systems engineer. UI language (English / Hebrew): t(key, vars), lang(), setLang(l), onLangChange(fn).
//   - The language lives in save.state.settings.lang ('en' | 'he'). First run: the browser language (he* / iw* -> 'he').
//     ?lang=he|en overrides (tests / screenshots). index.html applies the same rule in <head> before the page paints
//     (dir / lang / .lang-he on <html>) and translates the loading screen itself.
//   - Hebrew: <html dir="rtl" lang="he" class="lang-he">. Layout fixes live in src/ui/rtl.css (text UI only: the 3D view,
//     minimap, compass and the city map are never mirrored). Numbers, times and key names stay LTR (<bdi> / dir="ltr").
//   - Fonts (bundled by Vite from npm, never fetched from a CDN, OFL): 'Secular One' (Hebrew headings) and 'Heebo Variable'
//     (Hebrew body text). Both faces are declared with the Hebrew unicode-range only, so Latin words in Hebrew mode (GalStrike,
//     Iron Man, key names) keep the game's own Latin fonts (Spiderbench Condensed / Sans).
//   - t(key, vars): he[key] (in Hebrew) -> en[key] -> fallback -> key. Values are strings with {name} placeholders or
//     functions (vars) => string (Hebrew plurals). localize(obj, prefix, fields) turns data fields (suit names, mission titles
//     ...) into getters: '<prefix>.<field>' from the Hebrew dictionary, the original English text otherwise.
//   - Changing the language re-renders the visible UI live: every module with static text subscribes with onLangChange.
import secularHebrew from '@fontsource/secular-one/files/secular-one-hebrew-400-normal.woff2?url';
import heeboHebrew from '@fontsource-variable/heebo/files/heebo-hebrew-wght-normal.woff2?url';
import './rtl.css';

const SAVE_KEY = 'spiderbench.save.v1'; // src/game/systems/save.js
const LANGS = ['en', 'he'];
const HEBREW_RANGE = 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F';

function detect() {
  const q = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(q)) return q;
  try { const l = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')?.settings?.lang; if (LANGS.includes(l)) return l; } catch { /* private mode */ }
  return /^(he|iw)\b/i.test(navigator.language || '') ? 'he' : 'en';
}

let cur = detect(), save = null;
const subs = new Set();

export const lang = () => cur;
export const isRtl = () => cur === 'he';

export function t(key, vars, fallback) {
  let v = cur === 'he' ? he[key] : undefined;
  if (v == null) v = en[key];
  if (v == null) v = fallback ?? key;
  if (typeof v === 'function') return v(vars || {});
  return vars ? String(v).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : v;
}

// data fields -> getters (Hebrew text from the dictionary, the original English value otherwise)
export function localize(obj, prefix, fields) {
  for (const f of fields) {
    const base = obj[f]; if (base == null) continue;
    Object.defineProperty(obj, f, { get: () => (cur === 'he' && he[`${prefix}.${f}`] != null ? he[`${prefix}.${f}`] : base), enumerable: true, configurable: true });
  }
  return obj;
}

export function onLangChange(fn) { subs.add(fn); return () => subs.delete(fn); }

export function setLang(l) {
  if (!LANGS.includes(l) || l === cur) return;
  cur = l;
  if (save) { save.state.settings.lang = l; save.markDirty(); save.flush?.(); }
  applyDocument(); loadFonts();
  for (const fn of subs) { try { fn(l); } catch (e) { console.error('[i18n] listener failed', e); } }
}

// called once the save exists (systems/index.js): the stored choice wins; a first run stores the detected language
export function bindSave(s) {
  save = s;
  const st = s.state.settings, forced = LANGS.includes(new URLSearchParams(location.search).get('lang'));
  if (!forced && LANGS.includes(st.lang)) { if (st.lang !== cur) { const was = cur; cur = st.lang; if (was !== cur) { applyDocument(); loadFonts(); for (const fn of subs) fn(cur); } } }
  else if (!forced) { st.lang = cur; s.markDirty(); }
}

function applyDocument() {
  const h = document.documentElement;
  h.lang = cur; h.dir = isRtl() ? 'rtl' : 'ltr'; h.classList.toggle('lang-he', isRtl());
}

// Hebrew faces: registered always (they only download when Hebrew text is drawn), preloaded in Hebrew mode so the
// loading screen / canvases get them early
function registerFonts() {
  if (document.getElementById('i18n-fonts')) return;
  const s = document.createElement('style'); s.id = 'i18n-fonts';
  s.textContent = `@font-face { font-family: 'Secular One'; src: url(${JSON.stringify(secularHebrew)}) format('woff2'); font-weight: 400; font-style: normal; font-display: block; unicode-range: ${HEBREW_RANGE}; }
@font-face { font-family: 'Heebo Variable'; src: url(${JSON.stringify(heeboHebrew)}) format('woff2-variations'), url(${JSON.stringify(heeboHebrew)}) format('woff2'); font-weight: 100 900; font-style: normal; font-display: block; unicode-range: ${HEBREW_RANGE}; }`;
  document.head.appendChild(s);
}
function loadFonts() {
  if (!isRtl() || !document.fonts?.load) return;
  for (const f of ["400 20px 'Secular One'", "400 16px 'Heebo Variable'", "700 16px 'Heebo Variable'"]) document.fonts.load(f, 'אבג').catch(() => {});
}
registerFonts(); applyDocument(); loadFonts();

// ================================================================================================= English
// UI strings. Data text (suits, skills, missions, achievements, districts, backpack items, photo options, crime types)
// stays in its data file and is the English fallback of localize().
export const en = {
  // units / time
  'dist.m': '{n} m', 'dist.km': '{n} km', 'dist.M': '{n} M', 'dist.KM': '{n} KM', 'dist.pin': '{n}m',
  'time.hm': '{h}h {m}m', 'time.ms': '{m}m {s}s',
  // pause shell
  'tab.map': 'Map', 'tab.missions': 'Missions', 'tab.achievements': 'Achievements', 'tab.suits': 'Suits', 'tab.skills': 'Skills',
  'tab.collectibles': 'Collectibles', 'tab.photo': 'Photo Mode', 'tab.settings': 'Settings',
  'key.resume': 'Resume', 'key.continue': 'Continue', 'key.retry': 'Retry', 'key.dismiss': 'Dismiss', 'key.click': 'Click', 'key.dblClick': 'Dbl-Click', 'key.rClick': 'R-Click',
  'hint.change': 'Change', 'hint.select': 'Select', 'hint.start': 'Start', 'hint.abandon': 'Abandon', 'hint.scroll': 'Scroll', 'hint.equip': 'Equip', 'hint.unlock': 'Unlock',
  'hint.category': 'Category', 'hint.waypoint': 'Waypoint', 'hint.clear': 'Clear', 'hint.center': 'Center',
  'pause.level': 'LEVEL {n}', 'pause.sp': ({ n }) => `${n} SKILL POINT${n === 1 ? '' : 'S'}`,
  // HUD layer (ui.js)
  'ui.lvl': 'LVL', 'ui.xp': 'EXPERIENCE', 'ui.crimeInProgress': 'CRIME IN PROGRESS', 'ui.fastTravel': 'FAST TRAVEL', 'ui.loading': 'Loading',
  'lvl.cap': 'LEVEL UP', 'lvl.big': 'LEVEL {n}', 'lvl.sub': ({ n }) => `+${n} Skill Point${n > 1 ? 's' : ''} — open the pause menu to spend ${n > 1 ? 'them' : 'it'}`,
  'suit.unlocked': 'Suit Unlocked',
  'district': 'District', 'district.scrambled': 'Signal scrambled — find the research tower',
  'tut.towers': 'Research Towers', 'tut.towersText': 'Activate towers to reveal districts, collectibles and fast travel. Esc / M opens the map.',
  'obj.waypoint': 'Waypoint', 'obj.waypointText': 'Travel to the marked location', 'obj.cap': 'Objective', 'obj.activateTower': 'Activate the {d} tower',
  // world data names
  'tower.name': '{d} Research Tower', 'station.name': '{s} Station', 'secretPhoto.name': 'Secret Photo: {d}',
  // towers / travel / collectibles
  'tower.unlockedCap': 'DISTRICT UNLOCKED', 'tower.unlockedSub': 'Collectibles and crimes revealed on the map', 'tower.ftUnlocked': 'Fast Travel Unlocked',
  'travel.subwayIn': '{d} · Subway', 'travel.subway': 'Subway', 'travel.arrived': 'Arrived', 'travel.web': 'Web Travel', 'travel.reached': 'Destination Reached',
  'coll.backpackFound': 'Backpack Found', 'coll.allPacksCap': 'ALL BACKPACKS FOUND', 'coll.allPacksBig': 'Memory Lane', 'coll.allPacksSub': 'Every one of Peter\'s old backpacks recovered',
  'coll.landmarkShot': 'Landmark Photographed', 'coll.secretMatched': 'Secret Photo Matched',
  // interaction prompts
  'prompt.activateTower': 'Activate Research Tower', 'prompt.syncTower': 'Sync Research Tower', 'prompt.purge': 'Purge the jammer',
  'prompt.photoLandmark': 'Photograph Landmark', 'prompt.photoMission': '{x} · Mission', 'prompt.grabPack': 'Grab Backpack', 'prompt.webPull': 'Web-pull',
  'prompt.matchPhoto': 'Match Secret Photo', 'prompt.theSpot': 'This looks like the spot', 'prompt.webCar': 'Web the Car', 'prompt.pinRoad': 'Pin it to the road',
  'prompt.zipCar': 'Web-Zip to Car', 'prompt.getaway': 'Getaway car', 'prompt.webStrike': 'Web Strike', 'prompt.thug': 'Thug', 'prompt.finishHim': 'Finish him',
  // crimes
  'crime.inProgress': 'Crime in Progress', 'crime.stopped': 'Crime Stopped', 'crime.thanks': '"Thanks, Spider-Man!"', 'crime.escaped': 'Suspects Escaped', 'crime.failed': 'Crime Failed',
  'crime.onCar': 'On the Car', 'crime.onCarText': 'Hold [F] to web it to the road', 'crime.suspended': 'Suspended — return to the scene · {n} m', 'crime.onHold': 'CRIME ON HOLD',
  'crime.stopCar': 'Stop the Getaway Car', 'crime.holdWeb': 'Hold [F] — web the car', 'crime.zipOnto': '[F] Web-zip onto the car', 'crime.catchUp': 'Catch up — {n} m', 'crime.carChaseCap': 'CAR CHASE',
  'crime.stopRobbers': 'Stop the Robbers', 'crime.stopMuggers': 'Stop the Muggers', 'crime.leftStrike': '{a} of {b} left — [F] Web Strike', 'crime.areaClear': 'Area clear',
  'crime.left': '{a} of {b} left', 'crime.takeDown': 'Take them down',
  // achievements (toasts)
  'ach.unlocked': 'Achievement Unlocked', 'ach.unlockedMany': 'Achievements Unlocked', 'ach.more': '{n} more — pause menu › Achievements', 'ach.allNew': 'All achievements ({n} new)',
  // missions (runtime)
  'mis.newObjective': 'New Objective', 'mis.n': 'MISSION {n}', 'mis.unlocked': 'Mission Unlocked', 'mis.unlockedText': '{m} — pause menu › Missions',
  'mis.storyComplete': 'STORY COMPLETE', 'mis.storyBig': 'Manhattan Protected', 'mis.storyTotal': 'Total mission score {n}', 'mis.abandoned': 'Mission Abandoned',
  'mis.relay': 'Relay Race', 'mis.relayGo': '{n} seconds — go!', 'mis.pts': '{n} PTS', 'mis.cap': 'Mission · {m}',
  'mfail.generic': 'Mission failed', 'mfail.ko': 'You were knocked out', 'mfail.time': 'Out of time — the relay signal got away',
  'mobj.swingTo': 'Swing to {x}', 'mobj.headTo': 'Head to {x}', 'mobj.sync': 'Sync the {d} tower', 'mobj.activate': 'Activate the {d} tower',
  'mobj.crimes.any': 'Stop crimes{k}', 'mobj.crimes.mugging': 'Stop muggings{k}', 'mobj.crimes.bankAlarm': 'Stop bank robberies{k}', 'mobj.crimes.carChase': 'Stop getaway cars{k}',
  'mobj.defeat': 'Defeat enemies{k}', 'mobj.collect': 'Recover backpacks{k}', 'mobj.checkpoints': 'Checkpoints {k} · {t}', 'mobj.firstRing': 'Reach the first relay ring',
  'mobj.race': 'Relay race: {n} rings in {s}s', 'mobj.photo': 'Photograph {x}',
  'mres.objectives': 'Objectives', 'mres.time': 'Time bonus', 'mres.clean': 'No-damage bonus', 'mres.dmg': '{n} dmg taken', 'mres.untouched': 'untouched', 'mres.style': 'Style',
  'mres.styleSub': 'combo x{c} · {a}s air', 'mres.complete': 'MISSION COMPLETE', 'mres.failed': 'MISSION FAILED', 'mres.score': 'Score', 'mres.newBest': 'NEW BEST',
  // missions page
  'mp.active': 'ACTIVE', 'mp.new': 'NEW', 'mp.locked': 'Locked', 'mp.cap': 'Mission {n} · {d}', 'mp.unlockHint': 'Complete {m} to unlock this mission.', 'mp.objectives': 'Objectives',
  'mp.bestScore': 'Best score', 'mp.bestRank': 'Best rank', 'mp.bestTime': 'Best time', 'mp.par': 'Par', 'mp.abandon': 'Abandon Mission', 'mp.replay': 'Replay Mission', 'mp.start': 'Start Mission',
  'mp.warn': 'Starting will abandon the current mission', 'mp.scoreHint': 'Score = objective points + time bonus + no-damage bonus + style (combos, air time). Rank S ≥ 85% · A ≥ 70% · B ≥ 50%.',
  'mp.foot': '{a}/{b} COMPLETE · TOTAL SCORE {s}',
  // achievements page
  'ap.hiddenDesc': 'Hidden achievement — keep playing to reveal it.', 'ap.unlockedOn': 'Unlocked · {d}', 'ap.min': ' min', 'ap.cap': 'Trophy Case', 'ap.records': 'Records',
  'ap.progress': 'Progress', 'ap.sumLine': '{p}% complete · {h} hidden', 'ap.foot': '{a}/{b} UNLOCKED',
  'rec.longestAir': 'Longest air time', 'rec.sec': '{n} s', 'rec.topSpeed': 'Top speed', 'rec.speed': '{a} m/s · {b} km/h', 'rec.combo': 'Longest combo', 'rec.distance': 'Distance swung',
  'rec.airTime': 'Total air time', 'rec.crimes': 'Crimes stopped', 'rec.enemies': 'Enemies defeated', 'rec.playTime': 'Play time', 'rec.race': 'Race · {m}',
  // suits page
  'sp.cap': 'Suit Selection', 'sp.rotate': 'Drag to rotate', 'sp.equippedTag': 'EQUIPPED', 'sp.lvl': 'LVL {n}', 'sp.equipped': 'Equipped', 'sp.available': 'Available',
  'sp.unlocksAt': 'Unlocks at level {n}', 'sp.equip': 'Equip', 'sp.foot': '{a}/{b} SUITS UNLOCKED',
  // skills page
  'sk.unlocked': 'Unlocked', 'sk.available': 'Available', 'sk.needPoint': 'Need a skill point — level up', 'sk.requires': 'Requires {r}', 'sk.traversal': 'Traversal', 'sk.next': 'Available next',
  'sk.unlockBtn': 'Unlock · 1 SP', 'sk.toast': 'Skill Unlocked', 'sk.foot': ({ n }) => `${n} SKILL POINT${n === 1 ? '' : 'S'} AVAILABLE`,
  'sk.stat.swingSpeed': 'Swing speed', 'sk.stat.swingReleaseBoost': 'Release boost', 'sk.stat.webRange': 'Web range', 'sk.stat.zipSpeed': 'Web-zip', 'sk.stat.pointLaunch': 'Point launch',
  'sk.stat.jump': 'Jump', 'sk.stat.wallRunSpeed': 'Wall run', 'sk.stat.diveSpeed': 'Dive',
  // collectibles page
  'cp.backpack': 'Backpacks', 'cp.backpack.cap': 'Peter\'s memories', 'cp.landmark': 'Landmarks', 'cp.landmark.cap': 'Photograph the city', 'cp.photo': 'Secret Photos',
  'cp.photo.cap': 'Find where they were taken', 'cp.tower': 'Research Towers', 'cp.tower.cap': 'District scanners', 'cp.crime': 'Crimes', 'cp.crime.cap': 'Street justice',
  'cp.stopped': 'STOPPED', 'cp.leftOnMap': '{n} left — shown on the map', 'cp.lockedTower': 'Locked — activate the district research tower', 'cp.photographed': 'PHOTOGRAPHED',
  'cp.frameIt': 'Frame it and press [F], or capture it in Photo Mode.', 'cp.locked': 'Locked', 'cp.matchedStamp': 'MATCHED', 'cp.matched': 'Matched', 'cp.where': 'Where was this taken?',
  'cp.activated': 'Activated · fast travel unlocked', 'cp.notActivated': 'Not yet activated', 'cp.crimeType': 'Crime type', 'cp.type.mugging': 'Muggings', 'cp.type.bankAlarm': 'Bank Robberies',
  'cp.type.carChase': 'Car Chases', 'cp.crimesStopped': '{n} crimes stopped', 'cp.foot': '{a}/{b} COLLECTED',
  // map page
  'map.cat.tower': 'Research Towers', 'map.cat.station': 'Fast Travel', 'map.cat.backpack': 'Backpacks', 'map.cat.landmark': 'Landmarks', 'map.cat.photo': 'Secret Photos', 'map.cat.crime': 'Crimes',
  'map.h.zoom': 'Wheel / + - &nbsp;zoom', 'map.h.pan': 'Drag / WASD &nbsp;pan', 'map.h.click': 'Click &nbsp;teleport / set waypoint', 'map.h.rclick': 'Right-click &nbsp;clear waypoint', 'map.h.center': 'C &nbsp;center on Spider-Man',
  'map.eastRiver': 'E A S T   R I V E R', 'map.hudson': 'H U D S O N   R I V E R',
  'map.tw.done': 'Activated', 'map.tw.cap': 'Research Tower', 'map.tw.doneText': 'District scanned. Collectibles revealed.', 'map.tw.text': 'Reach the rooftop and hold [F] to activate. Reveals this district.',
  'map.st.cap': 'Fast Travel', 'map.st.locked': 'Subway Station — Locked', 'map.st.text': 'Take the subway to travel here instantly.', 'map.st.lockedText': 'Activate this district\'s research tower to unlock fast travel.',
  'map.bp.title': 'Backpack', 'map.bp.got': 'Collected', 'map.bp.roof': 'Rooftop', 'map.bp.wall': 'Webbed to a wall', 'map.bp.ground': 'Ground level', 'map.bp.text': 'One of Peter\'s old backpacks, webbed up years ago.',
  'map.lm.got': 'Photographed', 'map.lm.cap': 'Landmark', 'map.lm.text': 'Get it in frame and press [F] (or use Photo Mode).', 'map.sp.title': 'Secret Photo', 'map.sp.around': 'Somewhere around here',
  'map.crimeCap': 'Crime in progress', 'map.scrambled': 'SIGNAL SCRAMBLED · FIND THE RESEARCH TOWER', 'map.pct': '{n}% COMPLETE', 'map.distPct': 'DISTRICT · {n}% COMPLETE', 'map.distLocked': 'DISTRICT · LOCKED',
  'map.c.backpacks': 'BACKPACKS', 'map.c.landmark': 'LANDMARK', 'map.c.photo': 'PHOTO', 'map.c.crimes': 'CRIMES', 'map.btn.ft': 'Fast Travel', 'map.btn.tp': 'Teleport Here', 'map.btn.wp': 'Set Waypoint',
  'map.loc.cap': 'Map Location', 'map.loc.title': 'Drop In Here', 'map.loc.text': 'Teleport and fall in from the sky above this spot, or mark it with a waypoint.', 'map.foot': '{a}/{b} DISTRICTS UNLOCKED',
  // photo mode
  'ph.title': 'Photo Mode', 'ph.tab.cam': 'Camera', 'ph.tab.filter': 'Filter', 'ph.tab.frame': 'Frame', 'ph.tab.pose': 'Pose', 'ph.tab.sticker': 'Sticker',
  'ph.capture': 'Capture', 'ph.reset': 'Reset', 'ph.exit': 'Exit', 'ph.saved': 'Saved to downloads', 'ph.saving': 'Saving…', 'ph.savedItems': '{x} — saved', 'ph.inFrame': 'In frame: {x}',
  'ph.k.drag': 'Drag', 'ph.k.wheel': 'Wheel', 'ph.h.move': 'Move', 'ph.h.updown': 'Down / Up', 'ph.h.look': 'Look', 'ph.h.zoom': 'Zoom', 'ph.h.af': 'Autofocus', 'ph.h.hide': 'Hide UI',
  'ph.fov': 'Field of View', 'ph.roll': 'Camera Roll', 'ph.focus': 'Focus Distance', 'ph.dof': 'Depth of Field', 'ph.exposure': 'Exposure', 'ph.hideHero': 'Hide Spidey', 'ph.grid': 'Grid',
  'ph.pose': 'Spider-Man Pose', 'ph.stickers': 'Stickers', 'ph.stickersOn': '{n} on', 'ph.stickerHelp': 'Drag a sticker to move it · wheel to scale · Q / E to rotate · Del removes it',
  // settings
  'set.cat.graphics': 'Graphics', 'set.cat.camera': 'Camera', 'set.cat.controls': 'Controls', 'set.cat.audio': 'Audio', 'set.cat.interface': 'Interface', 'set.cat.gameplay': 'Gameplay',
  'set.opt.on': 'On', 'set.opt.off': 'Off', 'set.opt.low': 'Low', 'set.opt.medium': 'Medium', 'set.opt.high': 'High', 'set.opt.veryHigh': 'Very High', 'set.opt.day': 'Day',
  'set.opt.morning': 'Morning', 'set.opt.sunrise': 'Sunrise', 'set.opt.sunset': 'Sunset', 'set.opt.dusk': 'Dusk', 'set.opt.night': 'Night', 'set.opt.overcast': 'Overcast',
  'set.opt.midday': 'Midday', 'set.opt.lateMorning': 'Late Morning', 'set.opt.afternoon': 'Afternoon',
  'set.quality': 'Quality Preset', 'set.quality.sub': 'Shadows, AO, clouds, DoF samples. Applying reloads the game (current: {q}).',
  'set.renderScale': 'Render Resolution', 'set.renderScale.sub': 'Internal resolution scale. Lower for more FPS.', 'set.tod': 'Time of Day', 'set.tod.sub': 'Hand-tuned lighting preset',
  'set.daySun': 'Day Sun', 'set.daySun.sub': 'Sun direction for the Day preset (shadow angle)', 'set.puddles': 'Puddles', 'set.puddles.sub': 'Water and wet patches on the ground in dry weather (rain always wets the streets)',
  'set.fov': 'Field of View', 'set.fov.sub': 'Base chase-camera FOV (speed widens it further)', 'set.motionBlur': 'Motion Blur', 'set.motionBlur.sub': 'Speed blur, stronger the faster you move',
  'set.dof': 'Depth of Field', 'set.dof.sub': 'Cinematic focus blur in menus and cutscenes (Photo Mode always has its own control)',
  'set.lang': 'Language', 'set.lang.sub': 'Interface language', 'set.minimalHud': 'Minimal HUD', 'set.minimalHud.sub': 'Hide all on-screen UI except the minimap',
  'set.hudScale': 'HUD Scale', 'set.hudScale.sub': 'Minimap, objective, XP and notifications', 'set.subtitles': 'Subtitles', 'set.subtitles.sub': 'Police scanner and dispatch chatter',
  'set.subtitleSize': 'Subtitle Size', 'set.subtitleSize.sub': 'Text size of subtitles', 'set.pins': 'World Markers', 'set.pins.sub': 'On-screen icons for towers, crimes and nearby collectibles',
  'set.sens': 'Camera Sensitivity', 'set.sens.sub': 'Mouse / right stick look speed', 'set.invertY': 'Invert Y-Axis', 'set.invertY.sub': 'Flip vertical camera look',
  'set.binds': 'Key Bindings', 'set.binds.action': 'Action', 'set.binds.kbm': 'Keyboard / Mouse', 'set.binds.pad': 'Gamepad',
  'set.master': 'Master Volume', 'set.master.sub': 'Everything', 'set.music': 'Music', 'set.music.sub': 'Ambient score and the swing pulse', 'set.sfx': 'Effects',
  'set.sfx.sub': 'Web thwips, landings, footsteps, combat, alarms', 'set.ambience': 'City Ambience', 'set.ambience.sub': 'Distant horns and sirens', 'set.ui': 'Interface', 'set.ui.sub': 'Menus and notifications',
  'set.crimes': 'Random Crimes', 'set.crimes.sub': 'Street crimes are reported while you explore', 'set.reset': 'Reset Progress', 'set.reset.sub': 'Erase XP, skills, suits, towers and collectibles. Settings are kept.',
  'set.reset.btn': 'Reset', 'set.reset.confirm': 'Click again to confirm', 'set.foot.saved': 'PROGRESS SAVES AUTOMATICALLY', 'set.foot.test': 'TEST SESSION — PROGRESS NOT SAVED',
  'bind.move': 'Move', 'bind.camera': 'Camera', 'bind.swing': 'Web-Swing (hold)', 'bind.parkourWall': 'Parkour (ground) / Wall-Run (walls)', 'bind.parkour': 'Parkour (ground)',
  'bind.jump': 'Jump (hold to charge)', 'bind.zip': 'Web-Zip / Point-Launch', 'bind.dive': 'Dive / Drop', 'bind.boost': 'Quick Web Boost (air)', 'bind.rope': 'Web Tightrope (perched)',
  'bind.sling': 'Web Slingshot (ground)', 'bind.attack': 'Attack / Launcher (combat)', 'bind.dodge': 'Dodge (combat)', 'bind.webStrike': 'Web Shooter / Web Strike (combat)',
  'bind.throw': 'Throw / Finisher / Heal (combat)', 'bind.interact': 'Interact / Photograph', 'bind.pause': 'Pause Menu', 'bind.map': 'Map', 'bind.photo': 'Photo Mode', 'bind.help': 'Controls Help',
  'bind.k.mouse': 'Mouse', 'bind.k.rmb': 'Right Mouse', 'bind.k.eMmb': 'E / Middle Mouse', 'bind.k.tws': 'T, then W / S', 'bind.k.ctrlMouse': 'Ctrl + Left / Right Mouse',
  'bind.k.lmbHold': 'Left Mouse (hold)', 'bind.k.dodge': 'C / Ctrl · Space jump evades a warning', 'bind.k.fHold': 'F (hold)', 'bind.k.v': 'V (or pause menu)',
  'bind.pad.ls': 'Left Stick', 'bind.pad.rs': 'Right Stick', 'bind.pad.r2ground': 'R2 (ground)', 'bind.pad.interact': 'D-pad Up / X / Square (hold)', 'bind.pad.map': 'Touchpad / View',
  // title screen
  'title.kick': 'Manhattan · Open World', 'title.by': 'A game by {name} · <span dir="rtl" lang="he">משחק מאת גל אסולין</span>', 'title.author': 'Gal Asulin', 'title.play': 'Play',
  'title.hint': 'Enter / A to select · ↑ ↓ to move', 'title.tod': 'Time & weather', 'title.tod.day': 'Day', 'title.tod.morning': 'Morning', 'title.tod.sunset': 'Sunset',
  'title.tod.dusk': 'Dusk', 'title.tod.night': 'Night', 'title.tod.overcast': 'Rain', 'title.sound': 'Sound', 'title.master': 'Master',
  'title.sndnote': 'Sound starts with your first click or key press. Press N in game to mute.', 'title.soundOnBtn': 'Sound on · click to mute', 'title.soundOffBtn': 'Sound off · click to unmute',
  'title.soundOn': 'Sound on', 'title.soundOff': 'Sound off', 'title.pressMute': 'Press N to mute', 'title.pressUnmute': 'Press N to unmute',
  // touch controls
  'touch.tapSelect': 'Tap to select', 'touch.back': '‹ Back', 'touch.rotate': 'Rotate your device', 'touch.landscape': 'GalStrike plays in landscape',
  'touch.swing': 'Swing', 'touch.jump': 'Jump', 'touch.zip': 'Zip', 'touch.boost': 'Boost', 'touch.dive': 'Dive', 'touch.parkour': 'Parkour', 'touch.rope': 'Rope', 'touch.use': 'Use',
  'touch.attack': 'Attack', 'touch.dodge': 'Dodge', 'touch.web': 'Web', 'touch.strike': 'Strike', 'touch.throw': 'Throw', 'touch.finish': 'Finish', 'touch.heal': 'Heal', 'touch.map': 'Map', 'touch.pause': 'Pause',
  // combat HUD
  'cmb.health': 'HEALTH', 'cmb.combo': 'COMBO', 'cmb.perfectDodge': 'PERFECT DODGE', 'cmb.healed': 'Healed', 'cmb.defeated': 'DEFEATED', 'cmb.backUp': 'Back on your feet', 'cmb.areaClear': 'AREA CLEAR',
  'cmb.k.holdLmb': 'Hold LMB', 'cmb.h.attack': 'Attack', 'cmb.h.launch': 'Launch / Slam', 'cmb.h.dodge': 'Dodge', 'cmb.h.jump': 'Jump (evades)', 'cmb.h.strike': 'Web Strike', 'cmb.h.web': 'Web',
  'cmb.h.throw': 'Throw', 'cmb.h.finisher': 'Finisher', 'cmb.h.heal': 'Heal',
  // controls help (HUD, H)
  'hud.help.title': 'CONTROLS', 'hud.help.k.mouse': 'Mouse', 'hud.help.k.rmouse': 'R-Mouse', 'hud.help.k.emouse': 'E / M-Mouse', 'hud.help.k.ewall': 'E on wall', 'hud.help.k.ctrlmouse': 'Ctrl+Mouse',
  'hud.help.move': 'Move (camera relative)', 'hud.help.mouse': 'Camera (click to capture)',
  'hud.help.swing': 'Hold: web-swing · let go to release · press again to chain · on ground / wall: hop off into a swing · during a zip: cancel into a swing',
  'hud.help.shift': 'On ground: parkour run · on walls: wall-run',
  'hud.help.space': 'Jump (hold = charged high jump) · in a swing: release + launch · double-tap in air: flip · at zip arrival: launch off the point · wall jump · point-launch from perch',
  'hud.help.zip': 'Web-zip to ◯ point &amp; perch · air web-dash', 'hud.help.rope': 'While perched: web tightrope to the ◯ point · W / S walk the line · A / D sway · Space jump off',
  'hud.help.wallzip': 'Wall zip upward', 'hud.help.boost': 'Quick web boost (in air)', 'hud.help.dive': 'Hold while falling: head-first dive',
  'hud.help.sling': 'On ground, Ctrl + Left / Right Mouse: web slingshot', 'hud.help.drop': 'Dive (hold in air) · drop off wall / perch', 'hud.help.toggle': 'Toggle this help',
};

// ================================================================================================= עברית
// Glossary (one term per concept, everywhere):
//   Swing = סווינג · Web = קורים · Web-zip = זינוק קורים · Web Strike = מכת קורים · Point launch = שיגור מנקודה
//   Tower (Research Tower) = מגדל (מגדל מחקר) · District = רובע · Crime = פשע · Mission = משימה · Objective = יעד
//   Suit = חליפה · Skill = מיומנות · Skill point = נקודת מיומנות · Level = רמה · XP = XP · Achievement = הישג · Records = שיאים
//   Backpack = תרמיל · Landmark = ציון דרך · Secret Photo = תמונה סודית · Collectibles = פריטי אספנות
//   Fast Travel = נסיעה מהירה · Waypoint = נקודת ציון · Photo Mode = מצב צילום · Map = מפה · Settings = הגדרות
//   Dive = צלילה · Wall-run = ריצת קיר · Perch = נקודת תצפית · Dodge = התחמקות · Finisher = מכת גמר · Heal = ריפוי · Focus = פוקוס
// Imperatives: masculine singular (הפעל, החזק, אסוף, עצור, צלם). Brand / hero names stay Latin where Israeli gaming UI keeps
// them (GalStrike, Iron Man, Captain America, Iron Spider, XP, FPS, HUD); city places are transliterated.
export const he = {
  'dist.m': '{n} מ׳', 'dist.km': '{n} ק״מ', 'dist.M': '{n} מ׳', 'dist.KM': '{n} ק״מ', 'dist.pin': '{n} מ׳',
  'time.hm': '{h} שע׳ {m} דק׳', 'time.ms': '{m} דק׳ {s} שנ׳',
  'tab.map': 'מפה', 'tab.missions': 'משימות', 'tab.achievements': 'הישגים', 'tab.suits': 'חליפות', 'tab.skills': 'מיומנויות',
  'tab.collectibles': 'פריטי אספנות', 'tab.photo': 'מצב צילום', 'tab.settings': 'הגדרות',
  'key.resume': 'חזרה למשחק', 'key.continue': 'המשך', 'key.retry': 'נסה שוב', 'key.dismiss': 'סגור', 'key.click': 'קליק', 'key.dblClick': 'דאבל-קליק', 'key.rClick': 'קליק ימני',
  'hint.change': 'שנה', 'hint.select': 'בחר', 'hint.start': 'התחל', 'hint.abandon': 'נטוש', 'hint.scroll': 'גלול', 'hint.equip': 'לבש', 'hint.unlock': 'פתח',
  'hint.category': 'קטגוריה', 'hint.waypoint': 'נקודת ציון', 'hint.clear': 'נקה', 'hint.center': 'מרכז',
  'pause.level': 'רמה {n}', 'pause.sp': ({ n }) => (n === 1 ? 'נקודת מיומנות אחת' : `${n} נקודות מיומנות`),
  'ui.lvl': 'רמה', 'ui.xp': 'ניסיון', 'ui.crimeInProgress': 'פשע בהתרחשות', 'ui.fastTravel': 'נסיעה מהירה', 'ui.loading': 'טוען',
  'lvl.cap': 'עלית רמה', 'lvl.big': 'רמה {n}', 'lvl.sub': ({ n }) => (n > 1 ? `+${n} נקודות מיומנות — פתח את תפריט ההשהיה כדי לנצל אותן` : '+1 נקודת מיומנות — פתח את תפריט ההשהיה כדי לנצל אותה'),
  'suit.unlocked': 'חליפה חדשה נפתחה',
  'district': 'רובע', 'district.scrambled': 'האות משובש — מצא את מגדל המחקר',
  'tut.towers': 'מגדלי מחקר', 'tut.towersText': 'הפעל מגדלים כדי לחשוף רבעים, פריטי אספנות ונסיעה מהירה. Esc / M פותח את המפה.',
  'obj.waypoint': 'נקודת ציון', 'obj.waypointText': 'הגע למיקום המסומן', 'obj.cap': 'יעד', 'obj.activateTower': 'הפעל את מגדל {d}',
  'tower.name': 'מגדל המחקר של {d}', 'station.name': 'תחנת {s}', 'secretPhoto.name': 'תמונה סודית: {d}',
  'tower.unlockedCap': 'רובע נפתח', 'tower.unlockedSub': 'פריטי אספנות ופשעים נחשפו במפה', 'tower.ftUnlocked': 'נסיעה מהירה נפתחה',
  'travel.subwayIn': '{d} · רכבת תחתית', 'travel.subway': 'רכבת תחתית', 'travel.arrived': 'הגעת', 'travel.web': 'מסע בקורים', 'travel.reached': 'הגעת ליעד',
  'coll.backpackFound': 'מצאת תרמיל', 'coll.allPacksCap': 'כל התרמילים נמצאו', 'coll.allPacksBig': 'שביל הזיכרונות', 'coll.allPacksSub': 'כל התרמילים הישנים של פיטר חזרו הביתה',
  'coll.landmarkShot': 'ציון דרך צולם', 'coll.secretMatched': 'תמונה סודית זוהתה',
  'prompt.activateTower': 'הפעל מגדל מחקר', 'prompt.syncTower': 'סנכרן מגדל מחקר', 'prompt.purge': 'נטרל את המשבש',
  'prompt.photoLandmark': 'צלם ציון דרך', 'prompt.photoMission': '{x} · משימה', 'prompt.grabPack': 'אסוף תרמיל', 'prompt.webPull': 'משיכת קורים',
  'prompt.matchPhoto': 'התאם תמונה סודית', 'prompt.theSpot': 'נראה שזה המקום', 'prompt.webCar': 'הדבק את המכונית', 'prompt.pinRoad': 'קבע אותה לכביש',
  'prompt.zipCar': 'זינוק קורים למכונית', 'prompt.getaway': 'רכב מילוט', 'prompt.webStrike': 'מכת קורים', 'prompt.thug': 'בריון', 'prompt.finishHim': 'גמור אותו',
  'crime.inProgress': 'פשע בהתרחשות', 'crime.stopped': 'הפשע נעצר', 'crime.thanks': '״תודה, ספיידר-מן!״', 'crime.escaped': 'החשודים נמלטו', 'crime.failed': 'הפשע לא נעצר',
  'crime.onCar': 'על המכונית', 'crime.onCarText': 'החזק [F] כדי להדביק אותה לכביש', 'crime.suspended': 'מושהה — חזור לזירה · {n} מ׳', 'crime.onHold': 'פשע בהמתנה',
  'crime.stopCar': 'עצור את רכב המילוט', 'crime.holdWeb': 'החזק [F] — הדבק את המכונית', 'crime.zipOnto': '[F] זינוק קורים אל המכונית', 'crime.catchUp': 'תשיג אותם — {n} מ׳', 'crime.carChaseCap': 'מרדף מכוניות',
  'crime.stopRobbers': 'עצור את השודדים', 'crime.stopMuggers': 'עצור את הבריונים', 'crime.leftStrike': 'נשארו {a} מתוך {b} — [F] מכת קורים', 'crime.areaClear': 'האזור נקי',
  'crime.left': 'נשארו {a} מתוך {b}', 'crime.takeDown': 'תוריד אותם',
  'ach.unlocked': 'הישג נפתח', 'ach.unlockedMany': 'הישגים נפתחו', 'ach.more': ({ n }) => (n === 1 ? 'ועוד אחד — תפריט השהיה › הישגים' : `ועוד ${n} — תפריט השהיה › הישגים`), 'ach.allNew': 'כל ההישגים ({n} חדשים)',
  'mis.newObjective': 'יעד חדש', 'mis.n': 'משימה {n}', 'mis.unlocked': 'משימה חדשה נפתחה', 'mis.unlockedText': '{m} — תפריט השהיה › משימות',
  'mis.storyComplete': 'העלילה הושלמה', 'mis.storyBig': 'מנהטן מוגנת', 'mis.storyTotal': 'ניקוד משימות כולל: {n}', 'mis.abandoned': 'המשימה ננטשה',
  'mis.relay': 'מרוץ ממסר', 'mis.relayGo': '{n} שניות — צא!', 'mis.pts': '{n} נק׳', 'mis.cap': 'משימה · {m}',
  'mfail.generic': 'המשימה נכשלה', 'mfail.ko': 'הופלת', 'mfail.time': 'נגמר הזמן — אות הממסר חמק',
  'mobj.swingTo': 'סווינג אל {x}', 'mobj.headTo': 'סע אל {x}', 'mobj.sync': 'סנכרן את מגדל {d}', 'mobj.activate': 'הפעל את מגדל {d}',
  'mobj.crimes.any': 'עצור פשעים{k}', 'mobj.crimes.mugging': 'עצור שודים ברחוב{k}', 'mobj.crimes.bankAlarm': 'עצור שודי בנקים{k}', 'mobj.crimes.carChase': 'עצור רכבי מילוט{k}',
  'mobj.defeat': 'הבס אויבים{k}', 'mobj.collect': 'אסוף תרמילים{k}', 'mobj.checkpoints': 'נקודות ביקורת {k} · {t}', 'mobj.firstRing': 'הגע לטבעת הממסר הראשונה',
  'mobj.race': 'מרוץ ממסר: {n} טבעות ב-{s} שניות', 'mobj.photo': 'צלם את {x}',
  'mres.objectives': 'יעדים', 'mres.time': 'בונוס זמן', 'mres.clean': 'בונוס בלי פגיעה', 'mres.dmg': 'ספגת {n} נזק', 'mres.untouched': 'בלי שריטה', 'mres.style': 'סטייל',
  'mres.styleSub': 'קומבו x{c} · {a} שנ׳ באוויר', 'mres.complete': 'המשימה הושלמה', 'mres.failed': 'המשימה נכשלה', 'mres.score': 'ניקוד', 'mres.newBest': 'שיא חדש',
  'mp.active': 'פעילה', 'mp.new': 'חדשה', 'mp.locked': 'נעולה', 'mp.cap': 'משימה {n} · {d}', 'mp.unlockHint': 'השלם את {m} כדי לפתוח את המשימה הזו.', 'mp.objectives': 'יעדים',
  'mp.bestScore': 'ניקוד שיא', 'mp.bestRank': 'דירוג שיא', 'mp.bestTime': 'זמן שיא', 'mp.par': 'זמן יעד', 'mp.abandon': 'נטוש משימה', 'mp.replay': 'שחק שוב', 'mp.start': 'התחל משימה',
  'mp.warn': 'התחלה תנטוש את המשימה הנוכחית', 'mp.scoreHint': 'ניקוד = נקודות יעדים + בונוס זמן + בונוס בלי פגיעה + סטייל (קומבו, זמן באוויר). דירוג S ≥ ‏85% · A ≥ ‏70% · B ≥ ‏50%.',
  'mp.foot': '{a}/{b} הושלמו · ניקוד כולל {s}',
  'ap.hiddenDesc': 'הישג נסתר — המשך לשחק כדי לחשוף אותו.', 'ap.unlockedOn': 'נפתח · {d}', 'ap.min': ' דק׳', 'ap.cap': 'ארון הגביעים', 'ap.records': 'שיאים',
  'ap.progress': 'התקדמות', 'ap.sumLine': '{p}% הושלם · {h} נסתרים', 'ap.foot': '{a}/{b} נפתחו',
  'rec.longestAir': 'הזמן הארוך באוויר', 'rec.sec': '{n} שנ׳', 'rec.topSpeed': 'מהירות שיא', 'rec.speed': '{a} מ׳/שנ׳ · {b} קמ״ש', 'rec.combo': 'הקומבו הארוך', 'rec.distance': 'מרחק סווינג',
  'rec.airTime': 'סה״כ זמן באוויר', 'rec.crimes': 'פשעים שנעצרו', 'rec.enemies': 'אויבים שהובסו', 'rec.playTime': 'זמן משחק', 'rec.race': 'מרוץ · {m}',
  'sp.cap': 'בחירת חליפה', 'sp.rotate': 'גרור כדי לסובב', 'sp.equippedTag': 'לבוש', 'sp.lvl': 'רמה {n}', 'sp.equipped': 'לבוש עכשיו', 'sp.available': 'זמינה',
  'sp.unlocksAt': 'נפתחת ברמה {n}', 'sp.equip': 'לבש', 'sp.foot': '{a}/{b} חליפות פתוחות',
  'sk.unlocked': 'נפתחה', 'sk.available': 'זמינה', 'sk.needPoint': 'צריך נקודת מיומנות — עלה רמה', 'sk.requires': 'דורשת: {r}', 'sk.traversal': 'תנועה בעיר', 'sk.next': 'זמינות עכשיו',
  'sk.unlockBtn': 'פתח · נקודה 1', 'sk.toast': 'מיומנות נפתחה', 'sk.foot': ({ n }) => (n === 1 ? 'נקודת מיומנות אחת זמינה' : `${n} נקודות מיומנות זמינות`),
  'sk.stat.swingSpeed': 'מהירות סווינג', 'sk.stat.swingReleaseBoost': 'בוסט שחרור', 'sk.stat.webRange': 'טווח קורים', 'sk.stat.zipSpeed': 'זינוק קורים', 'sk.stat.pointLaunch': 'שיגור מנקודה',
  'sk.stat.jump': 'קפיצה', 'sk.stat.wallRunSpeed': 'ריצת קיר', 'sk.stat.diveSpeed': 'צלילה',
  'cp.backpack': 'תרמילים', 'cp.backpack.cap': 'הזיכרונות של פיטר', 'cp.landmark': 'ציוני דרך', 'cp.landmark.cap': 'צלם את העיר', 'cp.photo': 'תמונות סודיות',
  'cp.photo.cap': 'מצא איפה הן צולמו', 'cp.tower': 'מגדלי מחקר', 'cp.tower.cap': 'סורקי הרבעים', 'cp.crime': 'פשעים', 'cp.crime.cap': 'צדק ברחובות',
  'cp.stopped': 'נעצרו', 'cp.leftOnMap': 'נשארו {n} — מסומנים במפה', 'cp.lockedTower': 'נעול — הפעל את מגדל המחקר של הרובע', 'cp.photographed': 'צולם',
  'cp.frameIt': 'הכנס אותו לפריים ולחץ [F], או צלם אותו במצב צילום.', 'cp.locked': 'נעול', 'cp.matchedStamp': 'זוהתה', 'cp.matched': 'זוהתה', 'cp.where': 'איפה זה צולם?',
  'cp.activated': 'הופעל · נסיעה מהירה נפתחה', 'cp.notActivated': 'עוד לא הופעל', 'cp.crimeType': 'סוג פשע', 'cp.type.mugging': 'שודים ברחוב', 'cp.type.bankAlarm': 'שודי בנקים',
  'cp.type.carChase': 'מרדפי מכוניות', 'cp.crimesStopped': ({ n }) => (n === 1 ? 'פשע אחד נעצר' : `${n} פשעים נעצרו`), 'cp.foot': '{a}/{b} נאספו',
  'map.cat.tower': 'מגדלי מחקר', 'map.cat.station': 'נסיעה מהירה', 'map.cat.backpack': 'תרמילים', 'map.cat.landmark': 'ציוני דרך', 'map.cat.photo': 'תמונות סודיות', 'map.cat.crime': 'פשעים',
  'map.h.zoom': 'גלגלת / + - &nbsp;זום', 'map.h.pan': 'גרירה / WASD &nbsp;הזזה', 'map.h.click': 'קליק &nbsp;שיגור / נקודת ציון', 'map.h.rclick': 'קליק ימני &nbsp;מחיקת נקודת ציון', 'map.h.center': 'C &nbsp;מרכוז על ספיידר-מן',
  'map.eastRiver': 'האיסט ריבר', 'map.hudson': 'נהר ההדסון',
  'map.tw.done': 'הופעל', 'map.tw.cap': 'מגדל מחקר', 'map.tw.doneText': 'הרובע נסרק. פריטי האספנות נחשפו.', 'map.tw.text': 'הגע לגג והחזק [F] כדי להפעיל. חושף את הרובע.',
  'map.st.cap': 'נסיעה מהירה', 'map.st.locked': 'תחנת רכבת תחתית — נעולה', 'map.st.text': 'קח את הרכבת התחתית כדי להגיע לכאן מיד.', 'map.st.lockedText': 'הפעל את מגדל המחקר של הרובע כדי לפתוח נסיעה מהירה.',
  'map.bp.title': 'תרמיל', 'map.bp.got': 'נאסף', 'map.bp.roof': 'על גג', 'map.bp.wall': 'מודבק לקיר בקורים', 'map.bp.ground': 'בגובה הרחוב', 'map.bp.text': 'אחד התרמילים הישנים של פיטר, מודבק בקורים כבר שנים.',
  'map.lm.got': 'צולם', 'map.lm.cap': 'ציון דרך', 'map.lm.text': 'הכנס אותו לפריים ולחץ [F] (או השתמש במצב צילום).', 'map.sp.title': 'תמונה סודית', 'map.sp.around': 'איפשהו כאן באזור',
  'map.crimeCap': 'פשע בהתרחשות', 'map.scrambled': 'האות משובש · מצא את מגדל המחקר', 'map.pct': '{n}% הושלם', 'map.distPct': 'רובע · {n}% הושלם', 'map.distLocked': 'רובע · נעול',
  'map.c.backpacks': 'תרמילים', 'map.c.landmark': 'ציון דרך', 'map.c.photo': 'תמונה', 'map.c.crimes': 'פשעים', 'map.btn.ft': 'נסיעה מהירה', 'map.btn.tp': 'שגר אותי לכאן', 'map.btn.wp': 'קבע נקודת ציון',
  'map.loc.cap': 'מיקום במפה', 'map.loc.title': 'נחיתה כאן', 'map.loc.text': 'השתגר וצלול מהשמיים מעל הנקודה הזו, או סמן אותה בנקודת ציון.', 'map.foot': '{a}/{b} רבעים פתוחים',
  'ph.title': 'מצב צילום', 'ph.tab.cam': 'מצלמה', 'ph.tab.filter': 'פילטר', 'ph.tab.frame': 'מסגרת', 'ph.tab.pose': 'פוזה', 'ph.tab.sticker': 'מדבקות',
  'ph.capture': 'צלם', 'ph.reset': 'איפוס', 'ph.exit': 'יציאה', 'ph.saved': 'נשמר בהורדות', 'ph.saving': 'שומר…', 'ph.savedItems': '{x} — נשמר', 'ph.inFrame': 'בפריים: {x}',
  'ph.k.drag': 'גרירה', 'ph.k.wheel': 'גלגלת', 'ph.h.move': 'תזוזה', 'ph.h.updown': 'למטה / למעלה', 'ph.h.look': 'מבט', 'ph.h.zoom': 'זום', 'ph.h.af': 'פוקוס אוטומטי', 'ph.h.hide': 'הסתר ממשק',
  'ph.fov': 'שדה ראייה', 'ph.roll': 'הטיית מצלמה', 'ph.focus': 'מרחק מיקוד', 'ph.dof': 'עומק שדה', 'ph.exposure': 'חשיפה', 'ph.hideHero': 'הסתר את ספיידי', 'ph.grid': 'רשת עזר',
  'ph.pose': 'פוזה של ספיידר-מן', 'ph.stickers': 'מדבקות', 'ph.stickersOn': '{n} פעילות', 'ph.stickerHelp': 'גרור מדבקה כדי להזיז · גלגלת לשינוי גודל · Q / E לסיבוב · Del מוחק',
  'set.cat.graphics': 'גרפיקה', 'set.cat.camera': 'מצלמה', 'set.cat.controls': 'שליטה', 'set.cat.audio': 'שמע', 'set.cat.interface': 'ממשק', 'set.cat.gameplay': 'משחקיות',
  'set.opt.on': 'פועל', 'set.opt.off': 'כבוי', 'set.opt.low': 'נמוכה', 'set.opt.medium': 'בינונית', 'set.opt.high': 'גבוהה', 'set.opt.veryHigh': 'גבוהה מאוד', 'set.opt.day': 'יום',
  'set.opt.morning': 'בוקר', 'set.opt.sunrise': 'זריחה', 'set.opt.sunset': 'שקיעה', 'set.opt.dusk': 'בין ערביים', 'set.opt.night': 'לילה', 'set.opt.overcast': 'מעונן',
  'set.opt.midday': 'צהריים', 'set.opt.lateMorning': 'סוף הבוקר', 'set.opt.afternoon': 'אחר הצהריים',
  'set.quality': 'רמת איכות', 'set.quality.sub': 'צללים, AO, עננים ודגימות עומק שדה. השינוי טוען את המשחק מחדש (כרגע: {q}).',
  'set.renderScale': 'רזולוציית רינדור', 'set.renderScale.sub': 'קנה מידה פנימי של הרזולוציה. הורד בשביל יותר FPS.', 'set.tod': 'שעה ביום', 'set.tod.sub': 'תאורה מכוונת ביד לכל שעה',
  'set.daySun': 'שמש היום', 'set.daySun.sub': 'כיוון השמש בתאורת היום (זווית הצללים)', 'set.puddles': 'שלוליות', 'set.puddles.sub': 'מים וכתמים רטובים על הקרקע במזג אוויר יבש (גשם תמיד מרטיב את הרחובות)',
  'set.fov': 'שדה ראייה', 'set.fov.sub': 'שדה הראייה הבסיסי של המצלמה (המהירות מרחיבה אותו)', 'set.motionBlur': 'טשטוש תנועה', 'set.motionBlur.sub': 'טשטוש מהירות, חזק יותר ככל שאתה מהיר יותר',
  'set.dof': 'עומק שדה', 'set.dof.sub': 'טשטוש מיקוד קולנועי בתפריטים ובקטעי מעבר (למצב צילום יש שליטה משלו)',
  'set.lang': 'שפה', 'set.lang.sub': 'שפת הממשק', 'set.minimalHud': 'HUD מינימלי', 'set.minimalHud.sub': 'הסתר את כל הממשק על המסך חוץ מהמיני-מפה',
  'set.hudScale': 'גודל HUD', 'set.hudScale.sub': 'מיני-מפה, יעד, XP והתראות', 'set.subtitles': 'כתוביות', 'set.subtitles.sub': 'קשר משטרתי ושיחות מוקד',
  'set.subtitleSize': 'גודל כתוביות', 'set.subtitleSize.sub': 'גודל הטקסט של הכתוביות', 'set.pins': 'סימונים בעולם', 'set.pins.sub': 'אייקונים על המסך למגדלים, פשעים ופריטי אספנות קרובים',
  'set.sens': 'רגישות מצלמה', 'set.sens.sub': 'מהירות המבט בעכבר / בסטיק הימני', 'set.invertY': 'היפוך ציר Y', 'set.invertY.sub': 'הפוך את המבט האנכי',
  'set.binds': 'מקשים', 'set.binds.action': 'פעולה', 'set.binds.kbm': 'מקלדת / עכבר', 'set.binds.pad': 'בקר',
  'set.master': 'עוצמה ראשית', 'set.master.sub': 'הכול', 'set.music': 'מוזיקה', 'set.music.sub': 'פסקול האווירה והדופק של הסווינג', 'set.sfx': 'אפקטים',
  'set.sfx.sub': 'יריות קורים, נחיתות, צעדים, קרבות, אזעקות', 'set.ambience': 'רעשי העיר', 'set.ambience.sub': 'צפירות וסירנות ברקע', 'set.ui': 'ממשק', 'set.ui.sub': 'תפריטים והתראות',
  'set.crimes': 'פשעים אקראיים', 'set.crimes.sub': 'פשעי רחוב מדווחים בזמן שאתה מסתובב בעיר', 'set.reset': 'איפוס התקדמות', 'set.reset.sub': 'מוחק XP, מיומנויות, חליפות, מגדלים ופריטי אספנות. ההגדרות נשמרות.',
  'set.reset.btn': 'איפוס', 'set.reset.confirm': 'לחץ שוב לאישור', 'set.foot.saved': 'ההתקדמות נשמרת אוטומטית', 'set.foot.test': 'סשן בדיקה — ההתקדמות לא נשמרת',
  'bind.move': 'תזוזה', 'bind.camera': 'מצלמה', 'bind.swing': 'סווינג בקורים (החזק)', 'bind.parkourWall': 'פארקור (קרקע) / ריצת קיר (קירות)', 'bind.parkour': 'פארקור (קרקע)',
  'bind.jump': 'קפיצה (החזק לטעינה)', 'bind.zip': 'זינוק קורים / שיגור מנקודה', 'bind.dive': 'צלילה / ירידה', 'bind.boost': 'בוסט קורים מהיר (באוויר)', 'bind.rope': 'חבל קורים (מנקודת תצפית)',
  'bind.sling': 'קלע קורים (קרקע)', 'bind.attack': 'התקפה / הקפצה (קרב)', 'bind.dodge': 'התחמקות (קרב)', 'bind.webStrike': 'יורה קורים / מכת קורים (קרב)',
  'bind.throw': 'זריקה / מכת גמר / ריפוי (קרב)', 'bind.interact': 'פעולה / צילום', 'bind.pause': 'תפריט השהיה', 'bind.map': 'מפה', 'bind.photo': 'מצב צילום', 'bind.help': 'עזרת שליטה',
  'bind.k.mouse': 'עכבר', 'bind.k.rmb': 'כפתור ימני', 'bind.k.eMmb': 'E / גלגלת', 'bind.k.tws': 'T, ואז W / S', 'bind.k.ctrlMouse': 'Ctrl + כפתור שמאלי / ימני',
  'bind.k.lmbHold': 'כפתור שמאלי (החזק)', 'bind.k.dodge': 'C / Ctrl · קפיצה ב-Space מתחמקת מאזהרה', 'bind.k.fHold': 'F (החזק)', 'bind.k.v': 'V (או תפריט השהיה)',
  'bind.pad.ls': 'סטיק שמאלי', 'bind.pad.rs': 'סטיק ימני', 'bind.pad.r2ground': 'R2 (קרקע)', 'bind.pad.interact': 'D-pad למעלה / X / ריבוע (החזק)', 'bind.pad.map': 'משטח מגע / View',
  'title.kick': 'מנהטן · עולם פתוח', 'title.by': 'משחק מאת {name}', 'title.author': 'גל אסולין', 'title.play': 'שחק',
  'title.hint': 'Enter / A לבחירה · ↑ ↓ לתזוזה', 'title.tod': 'שעה ומזג אוויר', 'title.tod.day': 'יום', 'title.tod.morning': 'בוקר', 'title.tod.sunset': 'שקיעה',
  'title.tod.dusk': 'בין ערביים', 'title.tod.night': 'לילה', 'title.tod.overcast': 'גשם', 'title.sound': 'סאונד', 'title.master': 'ראשי',
  'title.sndnote': 'הסאונד מתחיל עם הקליק או הלחיצה הראשונים. N משתיק במשחק.', 'title.soundOnBtn': 'סאונד פועל · לחץ להשתקה', 'title.soundOffBtn': 'סאונד מושתק · לחץ להפעלה',
  'title.soundOn': 'הסאונד פועל', 'title.soundOff': 'הסאונד הושתק', 'title.pressMute': 'N להשתקה', 'title.pressUnmute': 'N להפעלת הסאונד',
  'touch.tapSelect': 'הקש כדי לבחור', 'touch.back': 'חזרה ›', 'touch.rotate': 'סובב את המכשיר', 'touch.landscape': 'GalStrike משוחק לרוחב',
  'touch.swing': 'סווינג', 'touch.jump': 'קפיצה', 'touch.zip': 'זינוק', 'touch.boost': 'בוסט', 'touch.dive': 'צלילה', 'touch.parkour': 'פארקור', 'touch.rope': 'חבל', 'touch.use': 'פעולה',
  'touch.attack': 'התקפה', 'touch.dodge': 'התחמקות', 'touch.web': 'קורים', 'touch.strike': 'מכה', 'touch.throw': 'זריקה', 'touch.finish': 'גמר', 'touch.heal': 'ריפוי', 'touch.map': 'מפה', 'touch.pause': 'השהיה',
  'cmb.health': 'בריאות', 'cmb.combo': 'קומבו', 'cmb.perfectDodge': 'התחמקות מושלמת', 'cmb.healed': 'רופאת', 'cmb.defeated': 'הובסת', 'cmb.backUp': 'חזרת לעמוד על הרגליים', 'cmb.areaClear': 'האזור נקי',
  'cmb.k.holdLmb': 'החזק LMB', 'cmb.h.attack': 'התקפה', 'cmb.h.launch': 'הקפצה / הטחה', 'cmb.h.dodge': 'התחמקות', 'cmb.h.jump': 'קפיצה (מתחמקת)', 'cmb.h.strike': 'מכת קורים', 'cmb.h.web': 'קורים',
  'cmb.h.throw': 'זריקה', 'cmb.h.finisher': 'מכת גמר', 'cmb.h.heal': 'ריפוי',
  // combat deny messages (spidey.js passes the English text as the key suffix)
  'cmb.No target': 'אין מטרה', 'cmb.Need focus': 'צריך פוקוס', 'cmb.Brutes need 2 focus': 'ענקים דורשים 2 פוקוס', 'cmb.Not in the air': 'לא באוויר', 'cmb.Health full': 'הבריאות מלאה', 'cmb.Nothing to throw': 'אין מה לזרוק',
  'hud.help.title': 'שליטה', 'hud.help.k.mouse': 'עכבר', 'hud.help.k.rmouse': 'כפתור ימני', 'hud.help.k.emouse': 'E / גלגלת', 'hud.help.k.ewall': 'E על קיר', 'hud.help.k.ctrlmouse': 'Ctrl+עכבר',
  'hud.help.move': 'תזוזה (יחסית למצלמה)', 'hud.help.mouse': 'מצלמה (קליק לנעילת העכבר)',
  'hud.help.swing': 'החזק: סווינג בקורים · שחרר כדי לעזוב · לחץ שוב לשרשור · מהקרקע או מקיר: זינוק לסווינג · באמצע זינוק: מעבר לסווינג',
  'hud.help.shift': 'על הקרקע: ריצת פארקור · על קירות: ריצת קיר',
  'hud.help.space': 'קפיצה (החזק = קפיצה טעונה) · בסווינג: שחרור ושיגור · לחיצה כפולה באוויר: סלטה · בסוף זינוק: שיגור מהנקודה · קפיצת קיר · שיגור מנקודת תצפית',
  'hud.help.zip': 'זינוק קורים אל נקודת ◯ ונחיתה עליה · דאש קורים באוויר', 'hud.help.rope': 'מנקודת תצפית: חבל קורים אל נקודת ◯ · W / S הליכה על החבל · A / D התנדנדות · Space קפיצה',
  'hud.help.wallzip': 'זינוק קורים במעלה הקיר', 'hud.help.boost': 'בוסט קורים מהיר (באוויר)', 'hud.help.dive': 'החזק בנפילה: צלילה עם הראש קדימה',
  'hud.help.sling': 'על הקרקע, Ctrl + כפתור שמאלי / ימני: קלע קורים', 'hud.help.drop': 'צלילה (החזק באוויר) · ירידה מקיר / מנקודת תצפית', 'hud.help.toggle': 'הצג / הסתר את העזרה',

  // ------------------------------------------------------------------------------------------ data (localize())
  'district.uws.name': 'אפר ווסט סייד', 'district.park.name': 'סנטרל פארק', 'district.ues.name': 'אפר איסט סייד', 'district.hk.name': 'הלז קיצ׳ן', 'district.mid.name': 'מידטאון',
  'district.gv.name': 'גריניץ׳', 'district.ct.name': 'צ׳יינה טאון', 'district.fd.name': 'הרובע הפיננסי', 'district.harlem.name': 'הארלם',
  'district.uws.landmark': 'בניין בקסטר', 'district.park.landmark': 'שיפ מדו', 'district.ues.landmark': 'מגדל אוסקורפ', 'district.hk.landmark': 'מגדל פיסק', 'district.mid.landmark': 'מגדל הנוקמים',
  'district.gv.landmark': 'מטה אלכמקס', 'district.ct.landmark': 'הדיילי ביוגל', 'district.fd.landmark': 'מגדל רוקסון', 'district.harlem.landmark': 'תיאטרון אפולו',
  'district.uws.lmDesc': 'ביתה של משפחה פנטסטית מסוימת. המעבדה על הגג עדיין מזמזמת בלילות.',
  'district.park.lmDesc': 'שישה הקטרים של דשא באמצע מנהטן. מקום הפיקניק הכי טוב בעיר.',
  'district.ues.lmDesc': 'האנדרטה שנורמן אוסבורן הקים לעצמו. הארי נשבע שהנוף שווה את האגו.',
  'district.hk.lmDesc': 'מבצר הזכוכית של וילסון פיסק. עדיין עומד אחרי כל מה שקרה.',
  'district.mid.lmDesc': 'ה-A הגדולה כבר איננה, אבל התיירים עדיין מצביעים.',
  'district.gv.lmDesc': 'קונים בשקט חצי מהבלוק. אף אחד לא יודע מה הם מייצרים.',
  'district.ct.lmDesc': 'העיתון הישן של ג׳יי ג׳ונה. המכבשים עצרו, הכותרות לא.',
  'district.fd.lmDesc': 'כסף של נפט בקופסת זכוכית. האבטחה הדוקה יותר ממה שנראה.',
  'district.harlem.lmDesc': 'ערב הכישרונות הצעירים הזניק אלף קריירות. השלט עדיין מאיר את הרחוב.',
  'district.uws.photoHint': 'בתי אבן חומה ושדרה ארוכה שנמתחת צפונה. דודה מיי הייתה עושה כאן קניות.',
  'district.park.photoHint': 'איפה שהעיר נגמרת והעצים מתחילים.',
  'district.ues.photoHint': 'פארק מצד אחד, כסף מהצד השני.',
  'district.hk.photoHint': 'בלוק ארוך של בנייני דירות ישנים. הדיינר בפינה אף פעם לא סוגר.',
  'district.mid.photoHint': 'הצומת שפיטר חצה כל יום בדרך למעבדה.',
  'district.gv.photoHint': 'מחסנים ישנים שהפכו ללופטים. בית הקפה האהוב על MJ.',
  'district.ct.photoHint': 'פנסים אדומים ומדרכות הומות. F.E.A.S.T. ממש מעבר לפינה.',
  'district.fd.photoHint': 'מגדלים כל כך גבוהים שהרחוב אף פעם לא רואה שמש.',
  'district.harlem.photoHint': 'מדרגות כניסה של בתי אבן חומה ושלט שמאיר את כל הבלוק.',

  'item.0.item': 'סרט מיריד המדע', 'item.0.desc': 'מקום ראשון, תיכון מידטאון למדעים. הר הגעש היה הרעיון של הארי.',
  'item.1.item': 'כרטיס ספרייה', 'item.1.desc': 'באיחור מאז כיתה י׳. סליחה, גברת קמפר.',
  'item.2.item': 'קלטת מיקס', 'item.2.desc': 'צד א׳: ״שירים לסווינג״. צד ב׳: בעיקר רחש.',
  'item.3.item': 'יורה קורים שבור', 'item.3.desc': 'דגם 1. המחסנית נתקעה באמצע סווינג מעל השדרה החמישית.',
  'item.4.item': 'אסימון רכבת תחתית', 'item.4.desc': 'מהיום שבו הדוד בן לקח את פיטר לקוני איילנד.',
  'item.5.item': 'תעודת עיתונאי של הביוגל', 'item.5.desc': 'פג תוקף. רובי חתם עליה בכל זאת.',
  'item.6.item': 'פתק יציאה מקומט', 'item.6.desc': 'סיבה: ״מקרה חירום משפחתי״. זה היה שוד בנק.',
  'item.7.item': 'משקפי מעבדה', 'item.7.desc': 'שרוטים עד כדי חוסר תועלת. אין להם תחליף.',
  'item.8.item': 'קופון פיצה', 'item.8.desc': 'ג׳ו׳ס פיצה, אחת פלוס אחת. אף פעם לא מומש.',
  'item.9.item': 'פולרואיד ישן', 'item.9.desc': 'פיטר ו-MJ על המעבורת לסטטן איילנד.',
  'item.10.item': 'פלאייר של היאבקות', 'item.10.desc': '״3,000$ למי שיחזיק מעמד 3 דקות.״ פיטר החזיק שתיים.',
  'item.11.item': 'מחברת כימיה', 'item.11.desc': 'נוסחת נוזל קורים, גרסה 0.4. רובה מחוק.',
  'item.12.item': 'כרטיס יום הולדת', 'item.12.desc': 'ממיי. ״לאחיין האהוב עליי. תלבש מעיל.״',
  'item.13.item': 'עדשה רזרבית', 'item.13.desc': 'מלוטשת ביד, בעקמומיות קצת לא נכונה.',
  'item.14.item': 'עיפרון קצרצר', 'item.14.desc': 'לעוס. שימש לסקיצה של החליפה הראשונה.',
  'item.15.item': 'כרטיס מעבורת', 'item.15.desc': 'הלוך-חזור. רק חצי אחד נתלש.',
  'item.16.item': 'כובע של המטס', 'item.16.desc': 'חתום על ידי אף אחד מפורסם. נלבש בכל זאת.',
  'item.17.item': 'נייר משבצות', 'item.17.desc': 'מסלולי סווינג משורטטים ביד. פרבולות בכל מקום.',
  'item.18.item': 'ווקמן', 'item.18.desc': 'האוזניות עדיין עובדות. הסוללות לא.',
  'item.19.item': 'גביע פיזיקה', 'item.19.desc': 'מקום שני באליפות האזור. גוון ניצחה.',
  'item.20.item': 'צמיד חברות', 'item.20.desc': 'הוכן במחנה קיץ. להארי יש את השני.',
  'item.21.item': 'כדור גומיות', 'item.21.desc': 'חצי שנה של זמן מת במעבדה.',
  'item.22.item': 'תרמוס מעוך', 'item.22.desc': 'קפה שחור, קר. כל מארב אי פעם.',
  'item.23.item': 'אסימון ארקייד', 'item.23.desc': 'למכונה בפאן זון שבלעה כל אסימון אחר.',
  'item.24.item': 'המסכה הראשונה', 'item.24.desc': 'תפורה ביד. העיניים אף פעם לא יצאו ישרות.',
  'item.25.item': 'חוברת תשבצים', 'item.25.desc': 'כל הגדרה נפתרה בעט. חלקן לא נכון.',
  'item.26.item': 'כרטיס להופעה', 'item.26.desc': 'שורה ראשונה. הרעיון של MJ. היה שווה את זה.',
  'item.27.item': 'זכוכית מיקרוסקופ', 'item.27.desc': 'מסומנת ״עכביש #42 — לא לגעת״.',
  'item.28.item': 'מזלג עקום', 'item.28.desc': 'מלפני שפיטר למד להכיר את הכוח של עצמו.',
  'item.29.item': 'תפריט של דיינר', 'item.29.desc': 'מסומן בעיגול: פנקייקים. תמיד פנקייקים.',
  'item.30.item': 'עניבת פרפר', 'item.30.desc': 'נלבשה פעם אחת, לנשף הסיום. יצא מוקדם בגלל שוד.',
  'item.31.item': 'מלחם', 'item.31.desc': 'צרב סימן בצורת עכביש בשולחן העבודה.',
  'item.32.item': 'חוברת קומיקס', 'item.32.desc': 'גיליון #1 של משהו. בשקית מגן עם קרטון.',
  'item.33.item': 'כדור שלג', 'item.33.desc': 'האמפייר סטייט בילדינג, עם סדק בכיפה.',
  'item.34.item': 'שרבוט במחברת', 'item.34.desc': 'עכביש עם משקפי שמש. חתום ״פ.פ.״',
  'item.35.item': 'גלויה', 'item.35.desc': 'ממיי בפלורידה. ״הלוואי שהיית כאן!״',
  'item.36.item': 'קופסה של פלטה', 'item.36.desc': 'ריקה. איפה הפלטה? תעלומה לדורות.',
  'item.37.item': 'מפתח למנעול אופניים', 'item.37.desc': 'האופניים נגנבו לפני שנים. המפתח נשאר.',
  'item.38.item': 'פרח מיובש', 'item.38.desc': 'מהספסל בפארק שבו פיטר הזמין את MJ לדייט.',
  'item.39.item': 'מכתב בכתב יד', 'item.39.desc': 'מהדוד בן. פיטר אף פעם לא פותח אותו. הוא יודע אותו בעל פה.',

  'suit.advanced.name': 'חליפה מתקדמת', 'suit.advanced.desc': 'העיצוב של פיטר עצמו. קלה יותר, חזקה יותר, והסמל סוף סוף זוהר בלבן.',
  'suit.iron.desc': 'שריון ננו-טכנולוגי של סטארק בארגמן וזהב.',
  'suit.symbiote.name': 'חליפת סימביוט', 'suit.symbiote.desc': 'חליפה שחורה חיה שהתחברה לפיטר. חזקה יותר, מהירה יותר, זועמת יותר. היא רוצה עוד.',
  'suit.israel.name': 'חליפת ישראל', 'suit.israel.desc': 'לבן של הדגל, פאנלים בכחול עמוק ומגן דוד על החזה ועל הגב.',
  'suit.captain.name': 'חליפת Captain America', 'suit.captain.desc': 'חליפה טקטית מכוכבת: גוף בכחול כהה, פאנלים אדומים וכוכב לבן.',
  'suit.ironman.name': 'חליפת Iron Man', 'suit.ironman.desc': 'שריון באדום לוהט וזהב עם כור קשת זוהר.',
  'suit.galstrike.name': 'חליפת GalStrike', 'suit.galstrike.desc': 'חליפת הדגל. שחור מט, קווי רשת בטורקיז ניאון וברק זוהר.',
  'suit.classic.name': 'חליפה קלאסית', 'suit.classic.desc': 'המראה הנצחי: אדום בוהק וכחול מלכותי עם רשת שחורה נועזת.',
  'suit.stealth.name': 'חליפת התגנבות', 'suit.stealth.desc': 'גרפיט מט לעבודת לילה. העדשות זוהרות בירוק עמום.',
  'suit.scarlet.name': 'חליפת סקרלט', 'suit.scarlet.desc': 'ארגמן עמוק עם פאנלים שחורים וסמל שחור.',

  'tree.webslinger.name': 'אמן הקורים', 'tree.webslinger.desc': 'שליטה בתנועה. סווינג מהיר יותר, קפיצות גבוהות יותר, שיגורים חזקים יותר.',
  'tree.innovator.name': 'ממציא', 'tree.innovator.desc': 'הטכנולוגיה של פיטר. סורקים, גלאים וכלי שטח.',
  'skill.swing1.name': 'תנופת סווינג', 'skill.swing1.desc': 'דחיפה חזקה יותר בתחתית כל קשת.', 'skill.swing1.eff': 'מהירות סווינג ‎+8%',
  'skill.reach.name': 'קורים ארוכים', 'skill.reach.desc': 'הקורים מגיעים לעוגנים רחוקים יותר.', 'skill.reach.eff': 'טווח קורים ‎+15%',
  'skill.swing2.name': 'סווינג קלע', 'skill.swing2.desc': 'שחרר בשיא הקשת כדי להיזרק קדימה.', 'skill.swing2.eff': 'מהירות סווינג ‎+8% · בוסט שחרור ‎+15%',
  'skill.zip.name': 'זינוק מהיר', 'skill.zip.desc': 'זינוק קורים ודאש קורים באוויר בעוצמה רבה יותר.', 'skill.zip.eff': 'מהירות זינוק ודאש ‎+20%',
  'skill.jump.name': 'קפיצה טעונה', 'skill.jump.desc': 'אימוני הרגליים השתלמו. קפיצות טעונות גבוהות יותר.', 'skill.jump.eff': 'קפיצה ‎+12%',
  'skill.wallrun.name': 'ספרינט קיר', 'skill.wallrun.desc': 'ריצה מהירה יותר במעלה ולאורך קירות.', 'skill.wallrun.eff': 'מהירות ריצת קיר ‎+20%',
  'skill.tricks.name': 'טריקים באוויר', 'skill.tricks.desc': 'סטייל באוויר מזכה ב-XP. שרשר טריקים בין סווינגים.', 'skill.tricks.eff': 'טריקים באוויר נפתחו · XP על כל טריק',
  'skill.dive.name': 'צלילת הפצצה', 'skill.dive.desc': 'התקפל וצלול מהר יותר.', 'skill.dive.eff': 'תאוצת צלילה ומהירות מרבית ‎+15%',
  'skill.launch.name': 'שיגור מנקודה+', 'skill.launch.desc': 'זנק מנקודות תצפית עם שיגור חזק בהרבה.', 'skill.launch.eff': 'כוח שיגור מנקודה ‎+18%',
  'skill.scanner.name': 'סורק משטרתי', 'skill.scanner.desc': 'התחבר לקשר של NYPD. פשעים מדווחים לעתים קרובות יותר.', 'skill.scanner.eff': 'תדירות פשעים ‎+40%',
  'skill.detector.name': 'גלאי תרמילים', 'skill.detector.desc': 'מאתר תרמילים קרובים גם ברבעים שעוד לא נפתחו.', 'skill.detector.eff': 'תרמילים ברדיוס 200 מ׳ מופיעים במיני-מפה',
  'skill.cred.name': 'קרדיט ברחוב', 'skill.cred.desc': 'העיר שמה לב. הכול שווה קצת יותר.', 'skill.cred.eff': 'XP ‎+10%',
  'skill.photog.name': 'צלם עיתונות', 'skill.photog.desc': 'הביוגל משלם יותר על צילומים חדים.', 'skill.photog.eff': 'XP מצילום ‎+50% · טווח ציוני דרך ‎+40%',
  'skill.gps.name': 'GPS חכם', 'skill.gps.desc': 'תצוגת החליפה משרטטת את המסלול המהיר ביותר על הגגות.', 'skill.gps.eff': 'מסלול לנקודת הציון + מד מרחק',

  'ach.tower1.title': 'הגברת אות', 'ach.tower1.desc': 'הפעל את מגדל המחקר הראשון שלך.',
  'ach.towerAll.title': 'כיסוי מלא', 'ach.towerAll.desc': 'הפעל את כל מגדלי המחקר במנהטן.',
  'ach.crime1.title': 'השכן הידידותי', 'ach.crime1.desc': 'עצור את הפשע הראשון שלך.',
  'ach.crime10.title': 'משמר שכונתי', 'ach.crime10.desc': 'עצור 10 פשעים.',
  'ach.crime50.title': 'המגן של מנהטן', 'ach.crime50.desc': 'עצור 50 פשעים.',
  'ach.enemy25.title': 'אמן הנוקאאוט', 'ach.enemy25.desc': 'הבס 25 אויבים.',
  'ach.enemy100.title': 'צבא של איש אחד', 'ach.enemy100.desc': 'הבס 100 אויבים.',
  'ach.pack5.title': 'טיול נוסטלגי', 'ach.pack5.desc': 'מצא 5 מהתרמילים הישנים של פיטר.',
  'ach.packAll.title': 'שביל הזיכרונות', 'ach.packAll.desc': 'מצא את כל התרמילים בעיר.',
  'ach.mission1.title': 'יום ראשון בעבודה', 'ach.mission1.desc': 'השלם את משימת העלילה הראשונה שלך.',
  'ach.missionAll.title': 'האורות חוזרים', 'ach.missionAll.desc': 'השלם את כל משימות העלילה.',
  'ach.rankS.title': 'מרהיב', 'ach.rankS.desc': 'השג דירוג S במשימה כלשהי.',
  'ach.score20k.title': 'מלך הניקוד', 'ach.score20k.desc': 'הגע לניקוד משימות כולל של 20,000.',
  'ach.suits5.title': 'החלפת מלתחה', 'ach.suits5.desc': 'לבש 5 חליפות שונות.',
  'ach.israel.title': 'כחול לבן', 'ach.israel.desc': 'לבש את חליפת ישראל.',
  'ach.air10.title': 'נוסע מתמיד', 'ach.air10.desc': 'בלה 10 דקות באוויר.',
  'ach.level5.title': 'כוכב עולה', 'ach.level5.desc': 'הגע לרמה 5.',
  'ach.level10.title': 'גיבור ותיק', 'ach.level10.desc': 'הגע לרמה 10.',
  'ach.photo10.title': 'חובב צילום', 'ach.photo10.desc': 'צלם 10 תמונות במצב צילום.',
  'ach.travel1.title': 'זהירות, רווח', 'ach.travel1.desc': 'השתמש בנסיעה מהירה ברכבת התחתית.',
  'ach.play30.title': 'מסור', 'ach.play30.desc': 'שחק 30 דקות.',

  'mission.m1.title': 'האות אבד', 'mission.m1.blurb': 'כל מגדלי המחקר במנהטן כבו הרגע. תתחיל במקום הכי רועש בעיר.',
  'mission.m1.intro.0': 'כל מגדלי המחקר במנהטן כבו הרגע. מישהו משבש את הרשת.', 'mission.m1.intro.1': 'אז אני מתחיל במקום הכי רועש בעיר. מידטאון.',
  'mission.m2.title': 'ממסר על הגגות', 'mission.m2.blurb': 'פינגים של המשבש קופצים מבלוק לבלוק. תעקוף את האות דרך הלז קיצ׳ן.',
  'mission.m2.intro.0': 'פינגים של המשבש קופצים מבלוק לבלוק בהלז קיצ׳ן. עקוב אחרי טבעות הממסר.', 'mission.m2.intro.1': 'מהיר יותר מאות? תסתכלו עליי.',
  'mission.m3.title': 'כנופיית הסטטיק', 'mission.m3.blurb': 'כנופיה במעילים מחווטים סוחטת את השכונה. תראה להם את הדלת.',
  'mission.m3.intro.0': 'דיווחים על כמה תקיפות בהלז קיצ׳ן. החשודים לובשים מעילים מחווטים.', 'mission.m3.intro.1': 'כנופיית הסטטיק. אז עכשיו יש להם שם.',
  'mission.m4.title': 'עקבות על הנייר', 'mission.m4.blurb': 'הכנופיה החביאה חלקים גנובים בתרמילים ישנים. והעיתון רוצה תמונות.',
  'mission.m4.intro.0': 'הכנופיה החביאה חלקי משדר גנובים בתרמילים ישנים בכל העיר.', 'mission.m4.intro.1': 'והעיתון ירצה תמונות. שתי ציפורים בקור אחד.',
  'mission.m5.title': 'השתלטות מאפטאון', 'mission.m5.blurb': 'המגדל באפר איסט סייד משדר בתדר של הכנופיה. תחזיר אותו.',
  'mission.m5.intro.0': 'המגדל באפר איסט סייד משדר בתדר של הכנופיה.', 'mission.m5.intro.1': 'הגיע הזמן להחזיר אותו. ואז אני רוצה עין על המגדל ממול.',
  'mission.m6.title': 'מרדף בגריד', 'mission.m6.blurb': 'מכונית של הכנופיה דוהרת במרכז העיר. עצור אותה, ואז רדוף אחרי הממסר דרומה.',
  'mission.m6.intro.0': 'סדאן שחורה, בצבעי הכנופיה, דוהרת למרכז העיר!', 'mission.m6.intro.1': 'לא ברחובות שלי.',
  'mission.m7.title': 'פורצי הכספות', 'mission.m7.blurb': 'הכנופיה שודדת בנקים כדי לממן את המשבש. תסגור להם את החשבון.',
  'mission.m7.intro.0': 'אזעקות שקטות בכל הרובע הפיננסי. ייתכן שהחשודים חמושים.', 'mission.m7.intro.1': 'הם שודדים בנקים כדי לממן את המשבש. בוא נסגור להם את החשבון.',
  'mission.m8.title': 'כיבוי אורות', 'mission.m8.blurb': 'המשבש הראשי נע דרך הארלם. זה נגמר הלילה.',
  'mission.m8.intro.0': 'מצאתי אותו. המשבש הראשי נע דרך הארלם.', 'mission.m8.intro.1': 'אז זה נגמר הלילה. כל בלוק, כל גג.',
  'speaker.Lab': 'מעבדה', 'speaker.You': 'ספיידי', 'speaker.Dispatch': 'מוקד', 'speaker.Unit 12': 'ניידת 12', 'speaker.Unit 7': 'ניידת 7', 'speaker.Sergeant': 'סמל',

  'crime.mugging.title': 'שוד ברחוב', 'crime.mugging.text': 'אזרח נשדד', 'crime.bankAlarm.title': 'שוד בנק', 'crime.bankAlarm.text': 'אזעקה הופעלה בבנק',
  'crime.carChase.title': 'מרדף מכוניות', 'crime.carChase.text': 'חשודים חמושים בורחים מהמשטרה',
  'radio.mugging.0': 'דיווח על שוד ברחוב באזור {d}. יש ניידות בסביבה?', 'radio.mugging.1': 'קיבלתי, בדרך. שלוש דקות מהמקום.',
  'radio.bankAlarm.0': 'אזעקה שקטה הופעלה בבנק באזור {d}. ייתכן שהחשודים חמושים.', 'radio.bankAlarm.1': 'כל הניידות, להקים כיתור. אף אחד לא נכנס לבד.',
  'radio.carChase.0': 'אנחנו במרדף אחרי סדאן שחורה, דרך {d}!', 'radio.carChase.1': 'קיבלתי, ניידת 7. אל תאבדו את הרכב.',

  'photo.filter.none.name': 'ללא', 'photo.filter.vivid.name': 'חי', 'photo.filter.noir.name': 'נואר', 'photo.filter.vintage.name': 'וינטג׳', 'photo.filter.warm.name': 'זהוב',
  'photo.filter.cool.name': 'קר', 'photo.filter.bleach.name': 'מולבן', 'photo.filter.drama.name': 'דרמטי',
  'photo.frame.none.name': 'ללא', 'photo.frame.cinema.name': 'קולנוע', 'photo.frame.bugle.name': 'ביוגל', 'photo.frame.polaroid.name': 'פולרואיד', 'photo.frame.comic.name': 'קומיקס', 'photo.frame.film.name': 'פילם',
  'photo.pose.live.name': 'כמו שהוא', 'photo.pose.idle.name': 'עמידת גיבור', 'photo.pose.perch.name': 'תצפית', 'photo.pose.land.name': 'נחיתת גיבור', 'photo.pose.thwip.name': 'ת׳וויפ',
  'photo.pose.wall.name': 'היצמדות לקיר', 'photo.pose.guard.name': 'עמידת קרב', 'photo.pose.kick.name': 'בעיטה מסתובבת', 'photo.pose.flip.name': 'סלטה קדימה', 'photo.pose.dive.name': 'צלילת ברבור',
  'photo.sticker.thwip.name': 'ת׳וויפ!', 'photo.sticker.emblem.name': 'לוגו עכביש', 'photo.sticker.stamp.name': 'חותמת תאריך', 'photo.sticker.bugle.name': 'חותמת ביוגל',
  'photo.sticker.burst.name': 'פיצוץ פאו', 'photo.sticker.sig.name': 'חתימה',
};
