/* Mouse, touch, keyboard and gamepad, all turned into the same abstract
   commands: rotate, zoom, next, select, pick, hover, front, audio, basket,
   mode, back, openWall. The phone remote (phase 3) will speak the same language.

   `cmd` is an object with one method per command; `update(dt)` runs every
   frame for the drag inertia, held keys and the gamepad. */

const DRAG_CLICK_PX = 5;
const MAX_FLING = 1800;          // px/s: a flick turns the globe, it does not spin it
const clampV = (v) => Math.max(-MAX_FLING, Math.min(MAX_FLING, v));

export function createControls(el, cmd) {
  let drag = null;               // { x, y, moved }
  const vel = { x: 0, y: 0 };    // inertia, in pixels per second
  const held = new Set();
  const pointers = new Map();
  let pinch = 0;

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { pinch = spread(); drag = null; return; }
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), moved: false };
    vel.x = vel.y = 0;
  });

  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') cmd.hover(e.clientX, e.clientY);
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const d = spread();
      if (pinch) cmd.zoom(pinch / d);
      pinch = d;
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const now = performance.now(), dt = Math.max(1, now - drag.t) / 1000;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > DRAG_CLICK_PX) drag.moved = true;
    if (drag.moved) {
      cmd.rotate(dx, dy);
      vel.x = clampV(vel.x * 0.6 + (dx / dt) * 0.4);
      vel.y = clampV(vel.y * 0.6 + (dy / dt) * 0.4);
    }
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (!drag) return;
    if (!drag.moved) { vel.x = vel.y = 0; cmd.pick(e.clientX, e.clientY); }
    else if (performance.now() - drag.t > 80) vel.x = vel.y = 0;   // stopped before letting go
    drag = null;
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', () => cmd.hover(null));
  el.addEventListener('dblclick', (e) => cmd.front(e.clientX, e.clientY));

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    cmd.zoom(Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
  }, { passive: false });

  function spread() {
    const [a, b] = [...pointers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D', '+', '=', '-', '_'].includes(k)) {
      held.add(k.toLowerCase());
      e.preventDefault();
      return;
    }
    if (k === 'Tab') { e.preventDefault(); return cmd.next(e.shiftKey ? -1 : 1); }
    if (k === 'Enter') { e.preventDefault(); return e.shiftKey ? cmd.openWall() : cmd.select(); }
    if (k === ' ') { e.preventDefault(); return cmd.audio(); }
    if (k === 'b' || k === 'B') return cmd.basket();
    if (k === 'f' || k === 'F') return cmd.front();
    if (k === 'Escape') return cmd.back();
    if (k >= '1' && k <= '9') return cmd.mode(Number(k) - 1);
  });
  addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  addEventListener('blur', () => held.clear());

  /* Gamepad: buttons fire on the press, sticks are read every frame. Layout
     is the "standard" mapping: A B X Y, LB RB, LT RT, Back Start, sticks, pad. */
  const pad = { prev: [], repeat: 0 };
  function gamepad(dt) {
    const gp = [...(navigator.getGamepads?.() || [])].find((g) => g && g.mapping === 'standard');
    if (!gp) return;
    const b = gp.buttons.map((x) => x.pressed);
    const hit = (i) => b[i] && !pad.prev[i];
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);

    const lx = dz(gp.axes[0]), ly = dz(gp.axes[1]);
    if (lx || ly) cmd.rotate(-lx * 900 * dt, -ly * 900 * dt);
    const zoom = (gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0);
    if (Math.abs(zoom) > 0.05) cmd.zoom(Math.exp(-zoom * 1.6 * dt));

    // Right stick or pad: next screen, repeating while held.
    const rx = dz(gp.axes[2]), ry = dz(gp.axes[3]);
    const dir = b[15] || b[13] || rx > 0.5 || ry > 0.5 ? 1 : b[14] || b[12] || rx < -0.5 || ry < -0.5 ? -1 : 0;
    pad.repeat -= dt;
    if (!dir) pad.repeat = 0;
    else if (pad.repeat <= 0) { cmd.next(dir); pad.repeat = 0.32; }

    if (hit(0)) cmd.select();
    if (hit(1)) cmd.back();
    if (hit(2)) cmd.audio();
    if (hit(3)) cmd.basket();
    if (hit(4)) cmd.mode(-1, true);
    if (hit(5)) cmd.mode(1, true);
    if (hit(9)) cmd.openWall();
    pad.prev = b;
  }

  return {
    /* True when the controls moved the camera this frame. */
    update(dt) {
      let moved = false;
      if (!drag && (Math.abs(vel.x) > 4 || Math.abs(vel.y) > 4)) {
        cmd.rotate(vel.x * dt, vel.y * dt);
        const f = Math.exp(-dt * 4.5);
        vel.x *= f; vel.y *= f;
        moved = true;
      }
      const kx = (held.has('arrowright') || held.has('d') ? 1 : 0) - (held.has('arrowleft') || held.has('a') ? 1 : 0);
      const ky = (held.has('arrowdown') || held.has('s') ? 1 : 0) - (held.has('arrowup') || held.has('w') ? 1 : 0);
      if (kx || ky) { cmd.rotate(-kx * 600 * dt, -ky * 600 * dt); moved = true; }
      const kz = (held.has('-') || held.has('_') ? 1 : 0) - (held.has('+') || held.has('=') ? 1 : 0);
      if (kz) { cmd.zoom(Math.exp(kz * 1.4 * dt)); moved = true; }
      gamepad(dt);
      return moved || !!drag?.moved;
    },
  };
}
