// (GalStrike) Title / start screen. Shown once per page load after the loading screen: the city stays frozen behind
// it while the camera slowly orbits the player. Play (Enter / Space / click / gamepad A or Start) drops into the game.
// Uses its own flow mode ('title') so the pause menu and gameplay input ignore it. ?notitle skips it.
import * as THREE from 'three';

const CSS = `
.gs-title { position: fixed; inset: 0; z-index: 40; pointer-events: auto; display: flex; flex-direction: column; justify-content: flex-end;
  padding: 0 7vw 9vh; background: linear-gradient(90deg, rgba(4,8,20,.88) 0%, rgba(4,8,20,.55) 38%, rgba(4,8,20,0) 70%);
  color: #fff; font-family: var(--sys-body, 'Spiderbench Sans', sans-serif); opacity: 0; transition: opacity .6s ease; }
.gs-title.on { opacity: 1; }
.gs-title .kick { font: 700 13px/1 var(--sys-body, sans-serif); letter-spacing: .42em; color: #9fb4e0; text-transform: uppercase; margin-bottom: 14px; }
.gs-title h1 { margin: 0; font: 800 clamp(64px, 10vw, 148px)/.86 'Spiderbench Condensed', 'Arial Narrow', sans-serif; letter-spacing: .01em; text-transform: uppercase; }
.gs-title h1 i { color: #e3262f; font-style: normal; }
.gs-title .by { margin: 14px 0 34px; font-size: 18px; color: #d7def0; letter-spacing: .06em; }
.gs-title .by b { color: #fff; }
.gs-title nav { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.gs-title button { all: unset; cursor: pointer; font: 800 26px/1 'Spiderbench Condensed', 'Arial Narrow', sans-serif; letter-spacing: .08em;
  text-transform: uppercase; color: #aeb9d4; padding: 8px 18px 8px 14px; border-left: 3px solid transparent; transition: color .15s, border-color .15s, background .15s; }
.gs-title button.sel { color: #fff; border-left-color: #e3262f; background: linear-gradient(90deg, rgba(227,38,47,.28), rgba(227,38,47,0)); }
.gs-title .he { font-family: system-ui, sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0; color: #8f9bb8; margin-inline-start: 12px; }
.gs-title .hint { margin-top: 30px; font-size: 13px; letter-spacing: .2em; color: #7d89a8; text-transform: uppercase; }
/* quick setup panel: time & weather + sound, bottom right */
.gs-title .panel { position: absolute; right: 5vw; bottom: 9vh; width: min(380px, 40vw); padding: 18px 20px; background: rgba(6,12,28,.72);
  border: 1px solid rgba(160,180,230,.18); backdrop-filter: blur(6px); }
.gs-title .panel h4 { margin: 0 0 10px; font: 700 12px/1 var(--sys-body, sans-serif); letter-spacing: .3em; color: #9fb4e0; text-transform: uppercase; }
.gs-title .panel h4 + * { margin-bottom: 16px; }
.gs-title .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.gs-title .chips button { font: 700 13px/1 var(--sys-body, sans-serif); letter-spacing: .08em; padding: 8px 11px; border: 1px solid rgba(160,180,230,.25);
  color: #c9d3ea; background: rgba(255,255,255,.03); text-transform: none; }
.gs-title .chips button.on { background: #e3262f; border-color: #e3262f; color: #fff; }
.gs-title .snd { display: grid; grid-template-columns: 64px 1fr 38px; align-items: center; gap: 8px 10px; font-size: 13px; color: #c9d3ea; }
.gs-title .snd input { width: 100%; accent-color: #e3262f; }
.gs-title .snd output { text-align: right; color: #fff; font-variant-numeric: tabular-nums; }
.gs-title .mute { margin-top: 12px; font: 700 13px/1 var(--sys-body, sans-serif) !important; letter-spacing: .1em !important; padding: 9px 12px !important;
  border: 1px solid rgba(160,180,230,.25) !important; color: #fff !important; }
.gs-title .mute.on { background: #e3262f; border-color: #e3262f !important; }
.gs-title .sndnote { margin-top: 8px; font-size: 12px; color: #7d89a8; }
@media (max-width: 900px), (max-height: 560px) { .gs-title .panel { right: 3vw; bottom: 3vh; width: min(300px, 44vw); padding: 12px 14px; } }
`;

const TODS = [['day', 'Day'], ['morning', 'Morning'], ['sunset', 'Sunset'], ['dusk', 'Dusk'], ['night', 'Night'], ['overcast', 'Rain']];

// time & weather chips + volume sliders + mute, all writing the same settings the pause menu uses
function setupPanel(sys, el) {
  const { save, audio } = sys, S = () => save.state.settings;
  const apply = () => { save.markDirty(); sys.applySettings?.(); sys.events?.emit?.('settings:changed', {}); };
  const tods = [...el.querySelectorAll('.tod button')];
  const markTod = () => tods.forEach(b => b.classList.toggle('on', b.dataset.v === (S().timeOfDay || 'day')));
  tods.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S().timeOfDay = b.dataset.v; apply(); markTod(); audio?.sfx?.select?.(); }));
  markTod();
  const ranges = [...el.querySelectorAll('.snd input')];
  const show = () => ranges.forEach(r => { r.value = S()[r.dataset.k] ?? 0.8; r.nextElementSibling.textContent = Math.round(r.value * 100) + '%'; });
  ranges.forEach(r => r.addEventListener('input', () => { S()[r.dataset.k] = +r.value; if (S().muted) S().muted = false; apply(); show(); markMute(); }));
  const mute = el.querySelector('.mute');
  const markMute = () => { mute.textContent = S().muted ? 'Sound off · click to unmute' : 'Sound on · click to mute'; mute.classList.toggle('on', !!S().muted); };
  mute.addEventListener('click', e => { e.stopPropagation(); toggleMute(sys); markMute(); });
  for (const ev of ['pointerdown', 'mousedown', 'click']) el.querySelector('.panel').addEventListener(ev, e => e.stopPropagation());
  show(); markMute();
}

// mute keeps the chosen volumes: it only zeroes the master bus (audio.setVolumes reads masterVolume)
export function toggleMute(sys) {
  const s = sys.save.state.settings; s.muted = !s.muted; sys.save.markDirty(); sys.applySettings?.();
  sys.ui?.toast?.({ title: s.muted ? 'Sound off' : 'Sound on', text: s.muted ? 'Press N to unmute' : 'Press N to mute', ms: 1800 });
}

export function createTitle(sys) {
  const { ctx, flow, audio } = sys;
  const q = new URLSearchParams(location.search);
  flow.onKey((e, mode) => { if (mode === 'play' && e.code === 'KeyN' && !e.repeat) { toggleMute(sys); return true; } return false; });
  if (q.has('notitle') || q.has('playtest')) return { update() {} };

  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const el = document.createElement('div'); el.className = 'gs-title';
  el.innerHTML = `<div class="kick">Manhattan · Open World</div>
    <h1>GalStrike<i>.</i></h1>
    <div class="by">A game by <b>Gal Asulin</b> · <span dir="rtl">משחק מאת גל אסולין</span></div>
    <nav>
      <button data-a="play">Play<span class="he">שחק</span></button>
      <button data-a="missions">Missions<span class="he">משימות</span></button>
      <button data-a="suits">Suits<span class="he">חליפות</span></button>
      <button data-a="settings">Settings<span class="he">הגדרות</span></button>
    </nav>
    <div class="hint">Enter / A to select · ↑ ↓ to move</div>
    <div class="panel interactive">
      <h4>Time &amp; weather</h4>
      <div class="chips tod">${TODS.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>
      <h4>Sound</h4>
      <div class="snd">
        <span>Master</span><input type="range" min="0" max="1" step="0.05" data-k="masterVolume"><output></output>
        <span>Music</span><input type="range" min="0" max="1" step="0.05" data-k="musicVolume"><output></output>
        <span>Effects</span><input type="range" min="0" max="1" step="0.05" data-k="sfxVolume"><output></output>
      </div>
      <button class="mute"></button>
      <div class="sndnote">Sound starts with your first click or key press. Press N in game to mute.</div>
    </div>`;
  document.body.appendChild(el);
  const btns = [...el.querySelectorAll('nav button')];
  setupPanel(sys, el);
  let sel = 0, active = true;
  const mark = () => btns.forEach((b, i) => b.classList.toggle('sel', i === sel));
  mark();

  function run(a) {
    if (!active) return;
    audio?.sfx?.select?.();
    hide();
    if (a === 'play') { flow.setMode('play'); try { const c = ctx.renderer.domElement; c.__lock ? c.__lock() : c.requestPointerLock?.(); } catch {} }
    else { flow.setMode('play'); sys.pause.show(a); }
  }
  function hide() { active = false; el.classList.remove('on'); setTimeout(() => el.remove(), 650); }
  btns.forEach((b, i) => {
    b.addEventListener('click', e => { e.stopPropagation(); run(b.dataset.a); });
    b.addEventListener('mouseenter', () => { if (sel !== i) { sel = i; mark(); audio?.sfx?.hover?.(); } });
  });
  const move = d => { sel = (sel + d + btns.length) % btns.length; mark(); audio?.sfx?.move?.(); };
  flow.onKey((e, mode) => {
    if (mode !== 'title' || !active) return false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') move(1);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') move(-1);
    else if (e.code === 'Enter' || e.code === 'Space') run(btns[sel].dataset.a);
    return true;
  });

  // slow cinematic orbit around the frozen player
  let yaw = null; const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  flow.setMode('title');
  flow.setCameraHook(dt => {
    const P = ctx.player.position, cam = ctx.camera;
    if (yaw === null) { cam.getWorldDirection(_d); yaw = Math.atan2(-_d.x, -_d.z); }
    yaw += dt * 0.12;
    _o.set(P.x, P.y + 0.6, P.z); _d.set(Math.sin(yaw), 0.18, Math.cos(yaw)).normalize();
    let r = 5.5; const h = ctx.world.raycast?.(_o, _d, r + 0.5); if (h) r = Math.max(1.6, h.distance - 0.5);
    cam.position.copy(_o).addScaledVector(_d, r);
    cam.lookAt(P.x, P.y + 0.7, P.z);
  });
  requestAnimationFrame(() => el.classList.add('on'));

  const padPrev = {};
  return {
    update() {
      if (!active) return;
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (!pad || pad.mapping !== 'standard') continue;
        const edge = i => { const v = !!pad.buttons[i]?.pressed; const was = padPrev[i]; padPrev[i] = v; return v && !was; };
        const a = edge(0), up = edge(12), down = edge(13); // not Start: the pause menu reads Start on the same frame
        const ay = pad.axes[1] || 0, stick = ay > 0.6 ? 1 : ay < -0.6 ? -1 : 0;
        if (stick !== (padPrev.stick || 0) && stick) move(stick); padPrev.stick = stick;
        if (up) move(-1); else if (down) move(1);
        if (a) run(btns[sel].dataset.a);
        break;
      }
    },
  };
}
