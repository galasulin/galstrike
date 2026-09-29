// (GalStrike) On-screen touch controls for tablets / phones. createTouch(sys) -> { update(dt), active }
// Inert on desktop: it only switches on once a finger actually touches a touch-capable screen, or with ?touch.
// Then (flow mode 'play' only):
//   left half   floating virtual stick (appears under the thumb)  -> input.touch.move (analog)
//   right half  drag = camera look                                -> input.touch.lookDx / lookDy
//   buttons     traversal: SWING (hold, RMB) JUMP (hold = charge, Space) ZIP (E) DIVE (C) PARKOUR / wall-run (toggle, Shift)
//               BOOST (Q) + contextual INTERACT (hold F, while a prompt is up) and ROPE (T, while perched)
//               combat (swapped in while fighting): ATTACK (hold = launcher) DODGE WEB STRIKE THROW FINISHER HEAL + JUMP
//   top right   PAUSE / MAP; in the pause menu a BACK button (= Esc)
// Menus: taps are plain clicks; one-finger drags inside the menus are re-sent as mouse events (map pan, suit spin, photo
// orbit) and a two-finger pinch as wheel events (map / photo zoom). Traversal buttons go through input.press/release
// (the automation hooks), combat ones through the combat input's trigger / attackDown / attackUp.

const CSS = `
body.touch-ui, body.touch-ui #sys-root { touch-action: manipulation; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent; }
body.touch-ui canvas, body.touch-ui #sys-root canvas, body.touch-ui .sys-photo .catch { touch-action: none; }
body.touch-ui .sys-suits { touch-action: pan-y; }
body.touch-ui #hud .help { display: none !important; }
body.touch-ui #hud .mm-wrap { top: calc(env(safe-area-inset-top, 0px) + 66px); bottom: auto; right: calc(env(safe-area-inset-right, 0px) + 16px);
  width: clamp(120px, 17vw, 190px); min-width: 0; }
body.touch-ui #hud .mm { transform-origin: 100% 0; }
@media (max-height: 480px) { body.touch-ui #hud .mm-wrap { width: 108px; top: calc(env(safe-area-inset-top, 0px) + 62px); } }
body.touch-ui #sys-root .sys-crime { right: auto; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 10px); width: min(300px, 44vw); }
body.touch-ui #sys-root .sys-prompt .ring b { font-size: 0; }

#touch-ui { --b: clamp(54px, 10.5vmin, 76px); --bb: calc(var(--b) * 1.4); --g: 12px;
  --mr: calc(env(safe-area-inset-right, 0px) + 22px); --mb: calc(env(safe-area-inset-bottom, 0px) + 20px);
  position: fixed; inset: 0; z-index: 28; pointer-events: none; display: none; touch-action: none;
  font-family: var(--sys-head, 'Spiderbench Condensed', 'Arial Narrow', sans-serif); color: #fff; user-select: none; -webkit-user-select: none; }
#touch-ui.on { display: block; }
#touch-ui .zone { position: absolute; top: 0; bottom: 0; pointer-events: auto; touch-action: none; }
#touch-ui .zone.l { left: 0; width: 50%; }
#touch-ui .zone.r { right: 0; width: 50%; }
#touch-ui .stick { position: absolute; width: 132px; height: 132px; margin: -66px 0 0 -66px; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(9,17,42,.18) 0 55%, rgba(9,17,42,.42) 56% 100%); box-shadow: inset 0 0 0 2px rgba(185,198,230,.45);
  opacity: 0; transition: opacity .15s; }
#touch-ui .stick.on { opacity: 1; }
#touch-ui .stick i { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px; border-radius: 50%;
  background: rgba(244,246,251,.82); box-shadow: 0 0 0 3px rgba(227,38,47,.85), 0 4px 14px rgba(0,0,0,.4); }
#touch-ui .btn { position: absolute; width: var(--b); height: var(--b); border-radius: 50%; pointer-events: auto; touch-action: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  background: rgba(9,17,42,.5); box-shadow: inset 0 0 0 2px rgba(185,198,230,.5), 0 3px 12px rgba(0,0,0,.28);
  font: 800 calc(var(--b) * .19)/1 var(--sys-head, 'Spiderbench Condensed', sans-serif); letter-spacing: .08em; text-transform: uppercase;
  transition: transform .08s, background .08s, opacity .2s; backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
#touch-ui .btn svg { width: 44%; height: 44%; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
#touch-ui .btn.big { width: var(--bb); height: var(--bb); font-size: calc(var(--b) * .22); background: rgba(227,38,47,.42);
  box-shadow: inset 0 0 0 2.5px rgba(255,160,165,.75), 0 4px 16px rgba(0,0,0,.3); }
#touch-ui .btn.down { transform: scale(.9); background: rgba(227,38,47,.78); }
#touch-ui .btn.toggled { background: rgba(227,38,47,.6); box-shadow: inset 0 0 0 2.5px #fff, 0 0 14px rgba(227,38,47,.7); }
#touch-ui .btn.dim { opacity: .45; }
#touch-ui .btn.gold { box-shadow: inset 0 0 0 2.5px var(--sys-gold, #f5b82e), 0 0 12px rgba(245,184,46,.45); }
#touch-ui .btn[hidden] { display: none; }
#touch-ui .s0 { right: var(--mr); bottom: var(--mb); }
#touch-ui .s1 { right: calc(var(--mr) + var(--bb) + var(--g)); bottom: var(--mb); }
#touch-ui .s2 { right: calc(var(--mr) + (var(--bb) - var(--b)) / 2); bottom: calc(var(--mb) + var(--bb) + var(--g)); }
#touch-ui .s3 { right: calc(var(--mr) + var(--bb) + var(--g) * .6); bottom: calc(var(--mb) + var(--bb) + var(--g) * .6); }
#touch-ui .s4 { right: calc(var(--mr) + var(--bb) + var(--b) + var(--g) * 2); bottom: var(--mb); }
#touch-ui .s5 { right: calc(var(--mr) + (var(--bb) - var(--b)) / 2); bottom: calc(var(--mb) + var(--bb) + var(--b) + var(--g) * 2); }
#touch-ui .s6 { right: calc(var(--mr) + var(--bb) + var(--g) * .6); bottom: calc(var(--mb) + var(--bb) + var(--b) + var(--g) * 1.6); }
#touch-ui .s7 { right: calc(var(--mr) + var(--bb) + var(--b) + var(--g) * 2); bottom: calc(var(--mb) + var(--b) + var(--g)); }
#touch-ui .top { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 10px); right: calc(env(safe-area-inset-right, 0px) + 16px); display: flex; gap: 10px; }
#touch-ui .top .btn, #touch-back { position: relative; width: 48px; height: 48px; border-radius: 10px; font-size: 11px; }
#touch-back { position: fixed; z-index: 45; top: calc(env(safe-area-inset-top, 0px) + 10px); right: calc(env(safe-area-inset-right, 0px) + 16px);
  display: none; align-items: center; justify-content: center; gap: 6px; width: auto; padding: 0 14px; pointer-events: auto; touch-action: none; color: #fff;
  background: rgba(9,17,42,.7); box-shadow: inset 0 0 0 2px rgba(185,198,230,.55); font: 800 14px/1 var(--sys-head, sans-serif); letter-spacing: .14em; }
#touch-back.on { display: flex; }
#touch-back.down { background: rgba(227,38,47,.78); }
#touch-rotate { position: fixed; inset: 0; z-index: 2000; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  background: #040509; color: #f4f6fb; font: 800 22px/1.2 var(--sys-head, 'Spiderbench Condensed', sans-serif); letter-spacing: .12em; text-transform: uppercase; text-align: center; padding: 24px; }
#touch-rotate svg { width: 72px; height: 72px; fill: none; stroke: #e3262f; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; animation: touchRot 2.2s ease-in-out infinite; }
#touch-rotate small { font: 500 14px/1.4 var(--sys-body, sans-serif); letter-spacing: .04em; text-transform: none; color: #b9c6e6; }
@keyframes touchRot { 0%, 25% { transform: rotate(0) } 55%, 100% { transform: rotate(-90deg) } }
@media (orientation: portrait) and (max-width: 600px) { body.touch-ui #touch-rotate { display: flex; } }
`;

const I = {
  swing: '<path d="M4 20 C8 10 14 6 20 4"/><path d="M20 4 L20 10 M20 4 L14 4"/>',
  jump: '<path d="M12 20 V5 M6 11 L12 5 L18 11"/>',
  zip: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>',
  dive: '<path d="M12 4 V19 M6 13 L12 19 L18 13"/>',
  run: '<path d="M5 6 L11 12 L5 18 M12 6 L18 12 L12 18"/>',
  boost: '<path d="M4 12 H16 M12 7 L17 12 L12 17 M19 6 V18"/>',
  hand: '<path d="M8 13 V6 a1.5 1.5 0 0 1 3 0 V11 M11 10 V4.5 a1.5 1.5 0 0 1 3 0 V11 M14 10 V6 a1.5 1.5 0 0 1 3 0 V14 c0 4 -3 6 -6 6 c-3 0 -4 -2 -6 -5 l-1.5 -3 a1.4 1.4 0 0 1 2.4 -1.4 L8 13"/>',
  rope: '<path d="M3 16 L21 8"/><circle cx="3" cy="16" r="1.5"/><circle cx="21" cy="8" r="1.5"/>',
  fist: '<path d="M6 10 h11 a3 3 0 0 1 0 6 h-11 z M9 10 V7 M12 10 V7 M15 10 V7"/>',
  dodge: '<path d="M5 17 C9 17 9 7 13 7 H19 M16 4 L19 7 L16 10"/>',
  web: '<path d="M12 3 V21 M3 12 H21 M5.6 5.6 L18.4 18.4 M18.4 5.6 L5.6 18.4"/><circle cx="12" cy="12" r="5"/>',
  strike: '<path d="M13 3 L6 13 H11 L10 21 L18 10 H13 Z"/>',
  throw: '<path d="M4 19 C8 9 14 6 20 6 M15 3 L20 6 L16 10"/><rect x="3" y="15" width="5" height="5" rx="1"/>',
  fin: '<path d="M12 3 L14.5 9.5 L21 10 L16 14 L17.5 21 L12 17.5 L6.5 21 L8 14 L3 10 L9.5 9.5 Z"/>',
  heal: '<path d="M12 6 V18 M6 12 H18"/>',
  pause: '<path d="M9 6 V18 M15 6 V18"/>',
  map: '<path d="M4 6 L9 4 L15 6 L20 4 V18 L15 20 L9 18 L4 20 Z M9 4 V18 M15 6 V20"/>',
};
const svg = k => `<svg viewBox="0 0 24 24">${I[k]}</svg>`;

export function createTouch(sys) {
  const { ctx, flow, ui } = sys;
  const input = ctx.input;
  const q = new URLSearchParams(location.search);
  const capable = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  const api = { active: false, update() {} };
  if (!input?.touch || q.has('shot')) return api;
  if (!q.has('touch') && !capable) return api; // plain desktop: nothing is installed at all

  let built = null;
  const enable = () => {
    if (api.active) return;
    api.active = true; built = build();
    api.update = built.update;
  };
  if (q.has('touch')) enable();
  else {
    const first = e => {
      if (e.type === 'pointerdown' && e.pointerType !== 'touch') return;
      removeEventListener('pointerdown', first, true); removeEventListener('touchstart', first, true); enable();
    };
    addEventListener('pointerdown', first, true); addEventListener('touchstart', first, { capture: true, passive: true });
  }
  return api;

  function build() {
    const style = document.createElement('style'); style.id = 'touch-css'; style.textContent = CSS; document.head.appendChild(style);
    document.body.classList.add('touch-ui');
    try { document.exitPointerLock?.(); } catch {}
    const hint = document.querySelector('.gs-title .hint'); if (hint) hint.textContent = 'Tap to select';

    const root = document.createElement('div'); root.id = 'touch-ui';
    const B = (cls, key, label, extra = '') => `<div class="btn ${cls} ${extra}" data-k="${key}">${svg(I[key] ? key : 'zip')}<span>${label}</span></div>`;
    root.innerHTML = `<div class="zone l"></div><div class="zone r"></div><div class="stick"><i></i></div>
      <div class="set trav">
        ${B('s0 big', 'swing', 'Swing')}${B('s1', 'jump', 'Jump')}${B('s2', 'zip', 'Zip')}${B('s3', 'boost', 'Boost')}
        ${B('s4', 'dive', 'Dive')}${B('s5', 'run', 'Parkour')}${B('s6', 'rope', 'Rope')}${B('s7', 'hand', 'Use', 'gold')}
      </div>
      <div class="set cmb" hidden>
        ${B('s0 big', 'fist', 'Attack')}${B('s1', 'jump', 'Jump')}${B('s2', 'dodge', 'Dodge')}${B('s3', 'web', 'Web')}
        ${B('s4', 'strike', 'Strike')}${B('s5', 'throw', 'Throw')}${B('s6', 'fin', 'Finish')}${B('s7', 'heal', 'Heal')}
      </div>
      <div class="top">${B('', 'map', 'Map')}${B('', 'pause', 'Pause')}</div>`;
    document.body.appendChild(root);
    const back = document.createElement('div'); back.id = 'touch-back'; back.textContent = '‹ Back'; document.body.appendChild(back);
    const rot = document.createElement('div'); rot.id = 'touch-rotate';
    rot.innerHTML = `<svg viewBox="0 0 48 48"><rect x="15" y="6" width="18" height="36" rx="3"/><path d="M21 37 H27"/></svg>Rotate your device<small>GalStrike plays in landscape</small>`;
    document.body.appendChild(rot);

    const $ = s => root.querySelector(s);
    const trav = $('.set.trav'), cmb = $('.set.cmb'), stick = $('.stick'), knob = stick.firstElementChild;
    const useBtn = trav.querySelector('[data-k=hand]'), ropeBtn = trav.querySelector('[data-k=rope]'), runBtn = trav.querySelector('[data-k=run]');
    const finBtn = cmb.querySelector('[data-k=fin]'), healBtn = cmb.querySelector('[data-k=heal]');
    useBtn.hidden = true; ropeBtn.hidden = true;

    // ------------------------------------------------ synthetic key holds (a quick tap survives until a poll has seen it)
    const pressedAt = new Map(), pendingUp = new Set();
    const keyDown = code => { pendingUp.delete(code); input.press(code); pressedAt.set(code, input.pollN); };
    const keyUp = code => { if (input.pollN > (pressedAt.get(code) ?? -1)) input.release(code); else pendingUp.add(code); };
    // F (interact) is read from real key events by the systems layer: dispatch them
    const fKey = type => (type === 'keydown' ? document : window).dispatchEvent(new KeyboardEvent(type, { code: 'KeyF', key: 'f', bubbles: true }));
    const cin = () => ctx.combat?.input;
    let parkour = false;

    const ACT = {
      swing: { down: () => keyDown('MouseRight'), up: () => keyUp('MouseRight') },
      jump: { down: () => keyDown('Space'), up: () => keyUp('Space') },
      zip: { down: () => keyDown('KeyE'), up: () => keyUp('KeyE') },
      boost: { down: () => keyDown('KeyQ'), up: () => keyUp('KeyQ') },
      dive: { down: () => keyDown('KeyC'), up: () => keyUp('KeyC') },
      rope: { down: () => keyDown('KeyT'), up: () => keyUp('KeyT') },
      run: { down: () => { parkour = !parkour; runBtn.classList.toggle('toggled', parkour); if (parkour) keyDown('ShiftLeft'); else keyUp('ShiftLeft'); } },
      hand: { down: () => fKey('keydown'), up: () => fKey('keyup') },
      fist: { down: () => cin()?.attackDown?.(), up: () => cin()?.attackUp?.() },
      dodge: { down: () => cin()?.trigger?.('dodge') },
      web: { down: () => cin()?.trigger?.('web') },
      strike: { down: () => cin()?.trigger?.('strike') },
      throw: { down: () => cin()?.trigger?.('throw') },
      fin: { down: () => cin()?.trigger?.('finisher') },
      heal: { down: () => cin()?.trigger?.('heal') },
      // pause / map fire on release, so the lifting finger never lands on the menu underneath
      pause: { up: () => sys.pause.show() },
      map: { up: () => sys.pause.show('map') },
    };

    // ------------------------------------------------ buttons (pointer capture: each finger keeps its own button)
    const held = new Map(); // pointerId -> { el, act }
    const release = id => {
      const h = held.get(id); if (!h) return; held.delete(id);
      h.el.classList.remove('down'); h.act.up?.();
    };
    for (const el of root.querySelectorAll('.btn')) {
      const act = ACT[el.dataset.k]; if (!act) continue;
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch {}
        release(e.pointerId);
        held.set(e.pointerId, { el, act }); el.classList.add('down'); act.down?.();
        if (e.isTrusted) try { navigator.vibrate?.(8); } catch {}
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, e => release(e.pointerId));
    }

    // ------------------------------------------------ left: floating stick
    const R = 58; let stickId = null, sx = 0, sy = 0;
    const zl = $('.zone.l'), zr = $('.zone.r');
    const setMove = (x, y) => { input.touch.move.x = x; input.touch.move.y = y; };
    zl.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (stickId !== null) return;
      stickId = e.pointerId; try { zl.setPointerCapture(e.pointerId); } catch {}
      sx = e.clientX; sy = e.clientY;
      stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; stick.classList.add('on');
      knob.style.transform = ''; setMove(0, 0);
    });
    zl.addEventListener('pointermove', e => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - sx, dy = e.clientY - sy; const d = Math.hypot(dx, dy);
      // the base follows a thumb that slides past the rim (no dead feel when it drifts)
      if (d > R * 1.35) { const k = (d - R * 1.35) / d; sx += dx * k; sy += dy * k; stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; dx = e.clientX - sx; dy = e.clientY - sy; }
      const dd = Math.hypot(dx, dy), c = Math.min(1, dd / R);
      const kx = dd ? dx / dd * c * R : 0, ky = dd ? dy / dd * c * R : 0;
      knob.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;
      const DZ = 0.12, m = c < DZ ? 0 : (c - DZ) / (1 - DZ);
      setMove(dd ? dx / dd * m : 0, dd ? -dy / dd * m : 0);
    });
    const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; setMove(0, 0); knob.style.transform = ''; stick.classList.remove('on'); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zl.addEventListener(ev, stickEnd);

    // ------------------------------------------------ right: camera drag
    let lookId = null, lx = 0, ly = 0;
    const lookGain = () => 1.5 * Math.min(1.8, Math.max(1, 1000 / Math.max(320, innerWidth)));
    zr.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (lookId !== null) return;
      lookId = e.pointerId; try { zr.setPointerCapture(e.pointerId); } catch {}
      lx = e.clientX; ly = e.clientY;
    });
    zr.addEventListener('pointermove', e => {
      if (e.pointerId !== lookId) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      if (Math.abs(dx) > 160 || Math.abs(dy) > 160) return; // a lost / re-routed touch jumping across the screen, never a real swipe
      const g = lookGain(); input.touch.lookDx += dx * g; input.touch.lookDy += dy * g;
    });
    const lookEnd = e => { if (e.pointerId === lookId) lookId = null; };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zr.addEventListener(ev, lookEnd);

    // ------------------------------------------------ back button in the pause menu (= Esc: page back, then resume)
    back.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); back.classList.add('down'); try { back.setPointerCapture(e.pointerId); } catch {} });
    back.addEventListener('pointerup', e => {
      e.stopPropagation(); back.classList.remove('down');
      if (flow.mode !== 'menu') return; // (Esc in play would open the menu again)
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }));
    });
    back.addEventListener('pointercancel', () => back.classList.remove('down'));

    // ------------------------------------------------ browser gestures: no pinch-zoom / double-tap zoom / long-press menu
    const noZoom = e => e.preventDefault();
    document.addEventListener('gesturestart', noZoom, { passive: false }); // iOS Safari (ignores user-scalable=no)
    document.addEventListener('gesturechange', noZoom, { passive: false });
    document.addEventListener('touchmove', e => { if (e.touches.length > 1 || flow.mode === 'play') e.preventDefault(); }, { passive: false });
    let lastEnd = 0;
    document.addEventListener('touchend', e => { // double-tap zoom (older iOS), outside form controls
      const now = performance.now();
      if (now - lastEnd < 320 && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '')) e.preventDefault();
      lastEnd = now;
    }, { passive: false });

    // ------------------------------------------------ menus: finger drags -> mouse events, pinch -> wheel
    // compatibility mouse events the browser synthesizes after a tap are dropped (the bridge already sent them); click stays
    let touchT = -1e9;
    const menuTouch = () => flow.mode !== 'play' && flow.mode !== 'title';
    for (const ev of ['mousedown', 'mouseup', 'mousemove']) {
      addEventListener(ev, e => { if (e.isTrusted && performance.now() - touchT < 900) e.stopImmediatePropagation(); }, true);
    }
    const fingers = new Map(); let primary = null, pinchD = 0;
    const isForm = t => /^(INPUT|SELECT|TEXTAREA)$/.test(t?.tagName || '');
    const mouseEv = (type, e, target, extra = {}) => target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
      button: 0, buttons: type === 'mouseup' ? 0 : 1, ...extra }));
    document.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      touchT = performance.now();
      if (!menuTouch() || isForm(e.target) || !e.target.closest?.('#sys-root')) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, target: e.target });
      if (fingers.size === 1) { primary = e.pointerId; mouseEv('mousedown', e, e.target); }
      else if (fingers.size === 2) { const [a, b] = [...fingers.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
    }, true);
    document.addEventListener('pointermove', e => {
      const f = fingers.get(e.pointerId); if (!f) return;
      touchT = performance.now();
      const mx = e.clientX - f.x, my = e.clientY - f.y; f.x = e.clientX; f.y = e.clientY;
      if (fingers.size >= 2) {
        const [a, b] = [...fingers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, t = document.elementFromPoint(cx, cy);
        if (t && pinchD) t.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: (pinchD - d) * 2.5, deltaMode: 0 }));
        pinchD = d; return;
      }
      if (e.pointerId === primary) mouseEv('mousemove', e, f.target, { movementX: mx, movementY: my });
    }, true);
    const fingerUp = e => {
      const f = fingers.get(e.pointerId); if (!f) return;
      touchT = performance.now(); fingers.delete(e.pointerId);
      if (e.pointerId === primary) { primary = null; mouseEv('mouseup', e, f.target); }
      if (fingers.size < 2) pinchD = 0;
    };
    document.addEventListener('pointerup', fingerUp, true);
    document.addEventListener('pointercancel', fingerUp, true);

    // ------------------------------------------------ per frame
    let shown = false, combatSet = false;
    const releaseAll = () => {
      for (const id of [...held.keys()]) release(id);
      stickId = null; lookId = null; setMove(0, 0); input.touch.lookDx = input.touch.lookDy = 0;
      stick.classList.remove('on'); knob.style.transform = '';
      if (parkour) { parkour = false; runBtn.classList.remove('toggled'); }
      for (const c of ['MouseRight', 'Space', 'KeyE', 'KeyQ', 'KeyC', 'KeyT', 'ShiftLeft']) input.release(c);
      pendingUp.clear();
    };
    const promptEl = ui.root.querySelector('.sys-prompt');
    function update() {
      for (const c of pendingUp) if (input.pollN > (pressedAt.get(c) ?? -1)) { input.release(c); pendingUp.delete(c); }
      const play = flow.mode === 'play';
      if (play !== shown) { shown = play; root.classList.toggle('on', play); if (!play) releaseAll(); }
      back.classList.toggle('on', flow.mode === 'menu');
      if (!play) return;
      if (parkour) input.press('ShiftLeft'); // flow.clearInput() (mode changes) wipes synthetic keys
      const fight = !!(sys.inCombat?.() || ctx.combat?.engaged);
      if (fight !== combatSet) {
        for (const id of [...held.keys()]) release(id);
        combatSet = fight; trav.hidden = fight; cmb.hidden = !fight;
        if (fight && parkour) { parkour = false; runBtn.classList.remove('toggled'); input.release('ShiftLeft'); }
      }
      if (fight) {
        const me = ctx.combat?.spidey, focus = me?.focus ?? 1;
        finBtn.classList.toggle('dim', focus < 1); healBtn.classList.toggle('dim', focus < 1 || (me && me.hp >= me.maxHp));
      } else {
        const prompt = !!promptEl?.classList.contains('on');
        if (useBtn.hidden === prompt) { useBtn.hidden = !prompt; if (!prompt) for (const [id, h] of held) if (h.el === useBtn) release(id); }
        const m = ctx.player.anim?.mode || ctx.player.mode;
        const perch = m === 'perch' || m === 'rope';
        if (ropeBtn.hidden === perch) { ropeBtn.hidden = !perch; if (!perch) for (const [id, h] of held) if (h.el === ropeBtn) release(id); }
      }
      if (stickId === null) stick.classList.remove('on');
    }
    return { update };
  }
}
