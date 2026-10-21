/* Newswall Globe — the exploration view. The Earth turns under the camera
   with the real day and night; over each country hang its channels' screens.
   Turn it, come closer, pick one and listen; collect channels in the basket
   and send them to the wall, which opens them from its URL. */

import * as THREE from 'three';
import { MODES, byId, catalog, inMode, isPlayable, loadCatalog } from '../core/data.js';
import { readModeFromStorage, readModeFromUrl, wallHash } from '../core/url.js';
import { createControls } from './controls.js';
import { createEarth } from './earth.js';
import { createFrontRow } from './frontrow.js';
import { toLatLon, toVec } from './geo.js';
import * as hud from './hud.js';
import { $ } from './hud.js';
import { createLivePool, hlsOrder, LIVE_CAP } from './livepool.js';
import { createScreens, FAN, H, W } from './screens.js';
import { subsolar } from './sun.js';

const MAX_BASKET = 12;
const DIST = { min: 1.3, max: 5.5, home: 2.9, select: 1.8 };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
/* A phone, or a small or modest device: fewer screens play at once. */
const modest = coarse && (Math.min(screen.width, screen.height) < 500 || (navigator.hardwareConcurrency || 8) <= 4);

/* ------------------------------------------------------------- scene */

const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
let pixelRatio = Math.min(devicePixelRatio, coarse ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);

/* The camera orbits the globe: where it looks from, and how far. It starts
   far out over the Atlantic and comes in: the page opens with a flight. */
const HOME = { lat: 28, lon: 12, dist: DIST.home };
const view = { lat: 12, lon: -62, dist: DIST.max + 1.5 };
let fly = null;

const g = {
  mode: 'news',
  earth: null,
  screens: null,
  pool: createLivePool({ k: modest ? 2 : coarse ? 3 : 4, onLive, onIdle, onDead }),
  selected: null,
  candidate: null,
  audioOn: null,      // id of the screen that talks: one at a time, as on the wall
  basket: [],
  hover: null,
  sun: [0, 0],
  logos: {},          // source id -> file in assets/logos/, from scripts/fetch-logos.py
};

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/* ---------------------------------------------------------------- boot */

async function boot() {
  resize();
  const [, earth, logos] = await Promise.all([loadCatalog(), createEarth(),
    fetch('assets/logos/logos.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})), document.fonts.ready]);
  g.logos = logos;
  g.earth = earth;
  scene.add(earth.group);
  updateSun();

  const m = readModeFromUrl() || readModeFromStorage();
  setMode(MODES[m] ? m : 'news', true);
  hud.renderBasket([], MAX_BASKET);
  hud.tickUtc();

  // No welcome screen: muted video needs no gesture, and the first click on a
  // screen brings the sound.
  flyTo(HOME, { dur: 2600, ease: easeInOut, hop: false });
  requestAnimationFrame(frame);
}

/* What the globe can show: streams the last check did not find dead. */
const onGlobe = (s, mode) => inMode(s, mode) && isPlayable(s.id) && hlsOrder(s).length > 0;

function setMode(m, first = false) {
  if (!MODES[m] || (m === g.mode && !first)) return;
  g.mode = m;
  g.pool.stopAll();
  if (g.screens) {
    g.earth.group.remove(g.screens.group);
    g.screens.dispose();
  }
  select(null);
  g.screens = createScreens(catalog.all.filter((s) => onGlobe(s, m)), g.logos);
  g.earth.group.add(g.screens.group);
  g.candidate = null;
  history.replaceState(null, '', m === 'news' ? location.pathname : `#c=${m}`);
  $('#to-wall').href = `index.html${m === 'news' ? '' : `#c=${m}`}`;
  hud.renderModes(m, (x) => catalog.all.filter((s) => onGlobe(s, x)).length);
  if (!first) hud.toast(`${MODES[m].label} · ${g.screens.list.length} channels on the globe`);
}

/* ---------------------------------------------------------------- loop */

let last = performance.now(), lastSun = 0, lastClock = 0, folded = null;
const prev = { lat: 0, lon: 0, dist: 0 };
const perf = { t0: performance.now() + 4000, frames: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  adapt(now, (now - last) / 1000);
  last = now;

  const steered = controls.update(dt);
  if (fly) flyStep(now);
  if (!fly) view.dist = THREE.MathUtils.clamp(view.dist, DIST.min, DIST.max);
  view.lat = THREE.MathUtils.clamp(view.lat, -72, 72);
  toVec(view.lat, view.lon, camera.position).multiplyScalar(view.dist);
  camera.lookAt(0, 0, 0);

  const moving = steered || !!fly || Math.abs(view.lat - prev.lat) + Math.abs(view.lon - prev.lon) > 0.01
    || Math.abs(view.dist - prev.dist) > 0.002;
  Object.assign(prev, view);

  if (now - lastSun > 30000) { updateSun(); lastSun = now; }
  if (now - lastClock > 30000) { g.screens.tickClocks(); hud.tickUtc(); lastClock = now; }

  g.screens.update(camera, g.earth.sunDir, now / 1000);
  if (g.screens.folded !== folded) { folded = g.screens.folded; renderCard(); }
  updateCandidate();
  updateHover();
  const pinned = [g.selected, g.screens.list.find((s) => s.id === g.audioOn)].filter(Boolean);
  g.pool.update(g.screens.list, pinned, moving, now);
  if (now - lastHud > 200) {
    hud.renderTelemetry(view, g.sun, g.pool.liveCount, g.screens.list.length);
    lastHud = now;
  }

  renderer.render(scene, camera);
}
let lastHud = 0;

/* A device that cannot keep up gets fewer pixels: below ~40 fps over two
   seconds, the pixel ratio steps down (never below 1, never back up, so it
   does not oscillate). The first seconds, busy loading, do not count. */
function adapt(now, dt) {
  if (now < perf.t0 || pixelRatio <= 1 || document.hidden || dt > 0.5) return;
  perf.frames++;
  if (now - perf.t0 < 2000) return;
  const fps = perf.frames / ((now - perf.t0) / 1000);
  perf.t0 = now;
  perf.frames = 0;
  if (fps >= 40) return;
  pixelRatio = Math.max(1, pixelRatio - 0.25);
  renderer.setPixelRatio(pixelRatio);
  resize();
}

/* Nobody watches a hidden tab: only the channel talking keeps playing. The
   others leave their last frame and start again on return. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) g.pool.rest(g.screens.list.filter((s) => s.id === g.audioOn));
  else perf.t0 = performance.now() + 1500;
});

function updateSun() {
  g.sun = subsolar();
  g.earth.setSun(...g.sun);
}

/* ------------------------------------------------------------- camera */

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* Fly to {lat, lon, dist}, the short way round. The longer the trip over
   the globe, the longer the flight; a long one also rises on the way and
   comes down at the end, as a plane does, so the Earth never smears past. */
const va = new THREE.Vector3(), vb = new THREE.Vector3();
function flyTo({ lat, lon, dist }, { dur, ease, hop = true } = {}) {
  const to = { lat, lon: view.lon + ((((lon - view.lon) % 360) + 540) % 360 - 180), dist };
  if (reduceMotion) { Object.assign(view, to); fly = null; return; }
  const arc = toVec(view.lat, view.lon, va).angleTo(toVec(lat, lon, vb));
  const climb = hop && arc > 0.5 ? Math.min(1.3, (arc - 0.35) * 0.85) : 0;
  fly = {
    from: { ...view }, to, t0: performance.now(), climb,
    dur: dur ?? Math.min(2200, 650 + arc * 750 + Math.abs(dist - view.dist) * 180),
    ease: ease ?? (climb ? easeInOut : easeOut),
  };
}

/* Fly to look straight at `dir` from `dist`. */
function flyToward(dir, dist) {
  const [lat, lon] = toLatLon(dir);
  flyTo({ lat, lon, dist });
}

function flyStep(now) {
  const t = Math.min(1, (now - fly.t0) / fly.dur);
  const e = fly.ease(t);
  for (const k of ['lat', 'lon', 'dist']) view[k] = fly.from[k] + (fly.to[k] - fly.from[k]) * e;
  view.dist += fly.climb * Math.sin(Math.PI * e);
  if (t >= 1) fly = null;
}

/* ------------------------------------------------------ the crosshair */

/* The screen nearest the centre of the view is the candidate: what Enter or
   the A button selects. While one is selected, the crosshair rests. */
function updateCandidate() {
  let best = null;
  if (!g.selected) {
    for (const s of g.screens.list) {
      if (s.facing > 0.9 && !s.hidden && (!best || s.facing > best.facing)) best = s;
    }
  }
  if (best === g.candidate) return;
  if (g.candidate) g.candidate.candidate = false;
  g.candidate = best;
  if (best) best.candidate = true;
  renderCard();
}

function renderCard() {
  const s = g.selected || g.candidate;
  hud.renderCard(s, {
    target: !g.selected,
    pile: pileOf(s),
    onAir: !!s && s.id === g.audioOn,
    inBasket: !!s && g.basket.includes(s.id),
  });
}

/* A folded pile in the crosshair (or under the pointer) is a country, not a channel. */
function pileOf(s) {
  return s && s !== g.selected && s.pile && g.screens.folded ? s.pile : null;
}

/* Opening a pile: come close enough over it that it fans out. */
function openPile(p) {
  flyToward(p.dir, Math.min(view.dist, FAN.near - 0.15));
}

/* Tab and the right stick: the next screen to the right (or left) of the
   current one, as seen on screen. */
function next(dir) {
  const from = g.selected || g.candidate;
  const seen = g.screens.list.filter((s) => s.facing > 0.35 && !s.dead && !s.hidden);
  if (!seen.length) return;
  const x = (s) => s.group.position.clone().project(camera).x;
  seen.sort((a, b) => x(a) - x(b));
  const i = from ? seen.indexOf(from) : -1;
  const s = seen[(i + dir + seen.length) % seen.length] || seen[0];
  if (g.selected) {
    select(s);
    if (front.open) openFront(s);
  } else flyToward(s.dir, view.dist);
}

/* The screen under the mouse grows a little and lights up: it is clickable. */
function updateHover() {
  let s = null;
  if (g.hover && !front.open) {
    raycaster.setFromCamera(g.hover, camera);
    s = raycaster.intersectObjects(pickable(), false)[0]?.object.userData.screen || null;
  }
  const old = g.screens.list.find((x) => x.hover);
  if (old === s) return;
  if (old) old.hover = false;
  if (s) s.hover = true;
  canvas.classList.toggle('hover', !!s);
}

/* Where a screen is on the page right now: the box of its four projected
   corners. The front row flies in from there and back to it. */
function rectOf(s) {
  const xs = [], ys = [];
  const v = new THREE.Vector3();
  for (const [x, y] of [[-W / 2, -H / 2], [W / 2, -H / 2], [-W / 2, H / 2], [W / 2, H / 2]]) {
    s.face.localToWorld(v.set(x, y, 0)).project(camera);
    xs.push((v.x + 1) / 2 * innerWidth);
    ys.push((1 - v.y) / 2 * innerHeight);
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(8, Math.max(...xs) - x), h: Math.max(4.5, Math.max(...ys) - y) };
}

/* ---------------------------------------------------------- selection */

function select(s) {
  const old = g.selected;
  if (old === s) return;
  if (old) {
    old.selected = false;
    old.player?.setCap(LIVE_CAP);
  }
  g.selected = s || null;
  g.earth?.highlight(s ? s.src.country : null);
  document.body.classList.toggle('selected', !!s);
  if (s) {
    s.selected = true;
    s.player?.setCap(null);       // the selected screen gets full quality
    flyToward(s.fan, Math.min(view.dist, DIST.select));
    if (g.audioOn !== s.id) setAudio(s.id);
  }
  renderCard();
}

function back() {
  if (front.open) return front.close();
  if (!$('#keys').hidden) return hud.toggle('#keys', false);
  if (!$('#basket').hidden) return hud.toggle('#basket', false);
  if (g.selected) {
    const s = g.selected;
    select(null);
    flyToward(s.dir, DIST.home);
  }
}

/* ---------------------------------------------------------- front row */

const front = createFrontRow({ rectOf });
front.flags = (s) => ({ onAir: s.id === g.audioOn, inBasket: g.basket.includes(s.id) });

/* One channel to the front: it is selected, it talks, and it fills the window. */
function openFront(s) {
  if (!s) return;
  if (g.selected !== s) select(s);
  if (g.audioOn !== s.id) setAudio(s.id);
  front.show(s);
}

/* ------------------------------------------------------------- audio */

function setAudio(id) {
  g.audioOn = g.audioOn === id ? null : id;
  for (const s of g.screens.list) {
    s.onAir = s.id === g.audioOn;
    if (s.player) {
      s.player.video.muted = !s.onAir;
      if (s.onAir) s.player.play();
    }
  }
  hud.renderOnAir(g.audioOn ? byId(g.audioOn) : null);
  renderCard();
  if (front.screen) front.render(front.screen);
}

/* ------------------------------------------------------- live screens */

function onLive(s) {
  g.screens.setVideo(s, s.player.video);
  s.player.video.muted = s.id !== g.audioOn;
  if (s.selected) s.player.setCap(null);
  if (s === g.selected || s === g.candidate) renderCard();
  front.refresh(s);
}

function onIdle(s) {
  g.screens.capture(s);
  g.screens.setVideo(s, null);
  if (s.id === g.audioOn) setAudio(s.id);    // its voice goes with it
}

function onDead(s) {
  g.screens.markDead(s);
  if (s === g.selected) hud.toast(`${s.src.name}: no stream answers right now`);
  if (s === g.selected || s === g.candidate) renderCard();
}

/* ------------------------------------------------------------- basket */

function toggleBasket(id) {
  const i = g.basket.indexOf(id);
  if (i >= 0) g.basket.splice(i, 1);
  else if (g.basket.length >= MAX_BASKET) return hud.toast(`The basket is full: the wall holds ${MAX_BASKET}`);
  else {
    g.basket.push(id);
    hud.toast(`${byId(id).name} in the basket · ${g.basket.length}/${MAX_BASKET}`);
  }
  hud.renderBasket(g.basket.map(byId), MAX_BASKET, i < 0);
  renderCard();
  if (front.screen) front.render(front.screen);
}

function openWall() {
  location.href = `index.html${wallHash(g.mode, g.basket)}`;
}

/* ---------------------------------------------------------- controls */

const raycaster = new THREE.Raycaster();

const ndc = (x, y) => new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);

function screenAt(x, y) {
  raycaster.setFromCamera(ndc(x, y), camera);
  return raycaster.intersectObjects(pickable(), false)[0]?.object.userData.screen;
}

const pickable = () => g.screens.meshes.filter((m) => m.parent.visible && !m.userData.screen.hidden);

/* A click on the selected screen toggles its audio, but a double click means
   "front row": the audio waits a moment to see whether a second click comes. */
let pendingAudio = 0;

const controls = createControls(canvas, {
  rotate(dx, dy) {
    if (front.open) return;
    fly = null;
    const k = ((view.dist - 1) * 1.1 / innerHeight) * (180 / Math.PI);
    view.lon -= dx * k / Math.max(0.35, Math.cos(view.lat * Math.PI / 180));
    view.lat += dy * k;
  },
  zoom(f) {
    if (front.open) return;
    fly = null;
    view.dist = THREE.MathUtils.clamp(1 + (view.dist - 1) * f, DIST.min, DIST.max);
  },
  pick(x, y) {
    const s = screenAt(x, y);
    if (!s) return;
    if (pileOf(s)) return openPile(s.pile);
    if (s !== g.selected) return select(s);
    clearTimeout(pendingAudio);
    pendingAudio = setTimeout(() => setAudio(s.id), 260);
  },
  hover(x, y) { g.hover = x == null ? null : ndc(x, y); },
  front(x, y) {
    clearTimeout(pendingAudio);
    if (front.open) return front.close();
    openFront((x != null && screenAt(x, y)) || g.selected || g.candidate);
  },
  next,
  select() {
    if (front.open) return;
    if (pileOf(g.candidate)) openPile(g.candidate.pile);
    else if (g.candidate) select(g.candidate);
    else if (g.selected) openFront(g.selected);     // A again: front row
  },
  audio() { const s = g.selected || g.candidate; if (s && !pileOf(s)) setAudio(s.id); },
  basket() { const s = g.selected || g.candidate; if (s && !pileOf(s)) toggleBasket(s.id); },
  mode(n, relative = false) {
    if (front.open) return;
    const keys = Object.keys(MODES);
    const i = relative ? (keys.indexOf(g.mode) + n + keys.length) % keys.length : n;
    if (keys[i]) setMode(keys[i]);
  },
  back,
  openWall,
});

/* In the front row the keyboard speaks to it first: arrows change channel
   instead of turning a globe that is out of sight. */
addEventListener('keydown', (e) => {
  if (!front.open || e.metaKey || e.ctrlKey || e.altKey) return;
  const act = {
    Escape: back, f: back, F: back,
    ArrowRight: () => next(1), ArrowLeft: () => next(-1), Tab: () => next(e.shiftKey ? -1 : 1),
    ' ': () => setAudio(front.screen.id), b: () => toggleBasket(front.screen.id), B: () => toggleBasket(front.screen.id),
  }[e.key];
  if (!act) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  act();
}, true);

/* ----------------------------------------------------------------- HUD */

$('#modes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) setMode(b.dataset.mode);
});
$('#card').addEventListener('click', (e) => {
  const op = e.target.closest('[data-op]')?.dataset.op;
  const s = g.selected;
  if (!s) return;
  if (op === 'front') openFront(s);
  if (op === 'audio') setAudio(s.id);
  if (op === 'basket') toggleBasket(s.id);
});
$('#front').addEventListener('click', (e) => {
  if (e.target.classList.contains('front-veil')) return front.close();
  const op = e.target.closest('[data-fop]')?.dataset.fop;
  const s = front.screen;
  if (!op || !s) return;
  if (op === 'back') front.close();
  if (op === 'prev') next(-1);
  if (op === 'next') next(1);
  if (op === 'audio') setAudio(s.id);
  if (op === 'basket') toggleBasket(s.id);
});
$('#basket-btn').onclick = () => hud.toggle('#basket');
$('#basket-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) toggleBasket(li.dataset.id);
});
$('#basket-clear').onclick = () => {
  g.basket.length = 0;
  hud.renderBasket([], MAX_BASKET);
  renderCard();
};
$('#basket-open').onclick = openWall;
$('[data-act="keys"]').onclick = () => hud.toggle('#keys');
$('#keys-close').onclick = () => hud.toggle('#keys', false);
$('#keys').addEventListener('mousedown', (e) => { if (e.target.id === 'keys') hud.toggle('#keys', false); });
addEventListener('keydown', (e) => { if (e.key === '?') hud.toggle('#keys'); });

/* A clicked button must not keep the focus: Space and Enter belong to the globe. */
addEventListener('click', (e) => { if (e.detail) e.target.closest('button')?.blur(); });

setInterval(hud.tickUtc, 10000);

boot();
