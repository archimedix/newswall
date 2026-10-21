/* Newswall Globe — the exploration view. The Earth turns under the camera
   with the real day and night; over each country hang its channels' screens.
   Turn it, come closer, pick one and listen; star your favourites (they are
   the wall's channels, the same list) and open them as the wall. */

import * as THREE from 'three';
import { CATEGORIES, MAX_WALL, byId, catalog, inCategory, isPlayable, loadCatalog, passes, wallFor } from '../core/data.js';
import { filterLabel, mountFilter, toggleCategory } from '../core/filter.js';
import {
  FILTER_KEY, readFilter, readStoredFilter, readWallFromStorage, storeFilter, storeWall, viewHash, WALL_KEY,
} from '../core/url.js';
import { createControls } from './controls.js';
import { createEarth, loadEarth } from './earth.js';
import { createFrontRow } from './frontrow.js';
import { toLatLon, toVec } from './geo.js';
import * as hud from './hud.js';
import { $, latLon } from './hud.js';
import { createLivePool, hlsOrder, LIVE_CAP } from './livepool.js';
import { createScreens, FAN, H, W } from './screens.js';
import { subsolar } from './sun.js';

const DIST = { min: 1.32, max: 5.5, home: 2.9, select: 1.8 };
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
  filter: null,       // categories on the globe, none = all (core/filter.js)
  earth: null,
  screens: null,
  pool: createLivePool({ k: modest ? 2 : coarse ? 3 : 4, onLive, onIdle, onDead }),
  selected: null,
  candidate: null,
  audioOn: null,      // id of the screen that talks: one at a time, as on the wall
  favs: [],           // ids: the wall, the same list (core/url.js WALL_KEY)
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
  // The 8K ground needs a GPU that takes it and memory to spare: phones get 4K.
  const hi = !coarse && renderer.capabilities.maxTextureSize >= 8192;
  const loading = hud.boot(hi ? '8192×4096' : '4096×2048');
  try {
    const [, assets, logos] = await Promise.all([
      loadCatalog().then((c) => loading.step('catalog', `${c.all.length} channels`)),
      loadEarth({ hi, anisotropy: renderer.capabilities.getMaxAnisotropy(), progress: loading.bytes })
        .then((a) => { loading.step('ground'); return a; }),
      fetch('assets/logos/logos.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      document.fonts.ready]);
    g.logos = logos;
    g.earth = createEarth(assets);
    scene.add(g.earth.group);
    updateSun();
    loading.step('sun', `overhead at ${latLon(...g.sun)}`);

    g.favs = wallFor(readWallFromStorage());
    setFilter(readFilter(), true);
    hud.tickUtc();

    // The ground goes to the GPU now, behind the loading screen, not on the
    // first frame of the flight.
    renderer.initTexture(assets.ground);
    renderer.initTexture(assets.day);
    renderer.compile(scene, camera);
  } catch (err) {
    console.error(err);
    return loading.fail(err);
  }
  await loading.done();

  // No welcome screen: muted video needs no gesture, and the first click on a
  // screen brings the sound.
  flyTo(HOME, { dur: 2600, ease: easeInOut, hop: false });
  requestAnimationFrame(frame);
}

/* What the globe can show: streams the last check did not find dead. */
const onGlobe = (s) => isPlayable(s.id) && hlsOrder(s).length > 0;

/* The globe opens on every channel; the filter, shared with the wall's
   catalog, narrows it. A new filter builds the screens anew. */
const renderCats = mountFilter($('#filter-cats'), (f) => setFilter(f));

function setFilter(filter, first = false) {
  if (!first && filter.join() === g.filter.join()) return;
  g.filter = filter;
  g.pool.stopAll();
  if (g.screens) {
    g.earth.group.remove(g.screens.group);
    g.screens.dispose();
  }
  select(null);
  g.screens = createScreens(catalog.all.filter((s) => onGlobe(s) && passes(s, filter)), g.logos);
  g.earth.group.add(g.screens.group);
  g.candidate = null;
  history.replaceState(null, '', location.pathname + viewHash(filter));
  storeFilter(filter);

  const playable = catalog.all.filter(onGlobe);
  renderCats(filter, (c) => (c ? playable.filter((s) => inCategory(s, c)).length : playable.length));
  $('#filter-count').textContent = `${g.screens.list.length} channels`;
  $('#filter-label').textContent = filter.length ? filterLabel(filter) : 'All channels';
  $('#filter-btn').classList.toggle('has', filter.length > 0);
  renderFavs();
  if (!first) hud.toast(`${filter.length ? filterLabel(filter) : 'Every channel'} · ${g.screens.list.length} on the globe`);
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
  dockCard();
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
    isFav: !!s && g.favs.includes(s.id),
    logo: s ? g.logos[s.id] : null,
  });
}

/* On a large screen the selected channel leaves the globe: its screen comes
   off, straightens and grows into the card, which takes the video along
   (the same <video> element: no second player) and follows the screen's
   place as the globe turns, upright. Elsewhere the card stays in the corner
   and the video on the globe. */
const roomy = matchMedia('(min-width: 900px) and (min-height: 600px) and (pointer: fine)');
let docked = null;
function dockCard() {
  const s = g.selected && roomy.matches ? g.selected : null;
  const card = $('#card');
  if (s !== docked) {
    const from = s && !reduceMotion ? rectOf(s) : null;
    if (docked) { docked.lifted = false; releaseMedia(); }
    card.classList.remove('docked');
    if (!s) card.style.width = card.style.translate = '';
    docked = s;
    if (s) {
      s.lifted = true;
      void card.offsetWidth;          // off and on again: the next one unfolds afresh
      card.classList.add('docked');
      fillMedia(s);
      placeCard(s);
      if (from) liftOff(card, from);
    }
  }
  if (s) placeCard(s);
}

/* As large as the window allows, its video centred where the screen is. */
function placeCard(s) {
  const card = $('#card');
  const r = rectOf(s);
  const media = card.querySelector('.cmedia');
  const pad = card.offsetWidth - media.offsetWidth;              // the frame around the video
  const h0 = card.offsetHeight - media.offsetHeight;             // and the rest of the card
  const w = Math.round(THREE.MathUtils.clamp(
    Math.min(innerWidth * 0.34, (innerHeight - 96 - h0) * 16 / 9 + pad), 380, 640));
  const vh = (w - pad) * 9 / 16, h = vh + h0;
  const x = THREE.MathUtils.clamp(r.x + r.w / 2 - w / 2, 16, innerWidth - w - 16);
  const y = THREE.MathUtils.clamp(r.y + r.h / 2 - vh / 2 - 8, 68, Math.max(68, innerHeight - h - 16));
  card.style.width = `${w}px`;
  card.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
}

/* The take-off: from the screen's own rectangle on the globe to the card's
   video, then what it knows unfolds underneath (CSS, .docked). */
function liftOff(card, r) {
  const m = card.querySelector('.cmedia').getBoundingClientRect();
  const k = Math.max(0.1, r.w / m.width);
  const ox = m.left + m.width / 2 - card.getBoundingClientRect().left;
  const oy = m.top + m.height / 2 - card.getBoundingClientRect().top;
  card.animate([
    { transformOrigin: `${ox}px ${oy}px`, transform: `translate(${r.x + r.w / 2 - (m.left + m.width / 2)}px, ${r.y + r.h / 2 - (m.top + m.height / 2)}px) scale(${k})`, opacity: 0.85 },
    { transformOrigin: `${ox}px ${oy}px`, transform: 'none', opacity: 1 },
  ], { duration: 640, easing: 'cubic-bezier(.2,.9,.12,1)' });
}

/* The video moves into the card; a still while there is none. A video taken
   out of the document is paused by the browser once the task is over, so
   the one leaving is restarted just after: it goes back to the globe. */
function fillMedia(s) {
  const media = $('#card .cmedia');
  const video = s.live && s.player?.video;
  if (video && front.screen === s) return;          // full screen has it for now
  releaseMedia();
  if (video) {
    media.appendChild(video);
    video.play?.().catch(() => {});
  } else {
    const c = document.createElement('canvas');
    c.width = s.idleCanvas.width; c.height = s.idleCanvas.height;
    c.getContext('2d').drawImage(s.idleCanvas, 0, 0);
    media.appendChild(c);
  }
  media.classList.toggle('live', !!video);
}

function releaseMedia() {
  const media = $('#card .cmedia');
  const old = media.querySelector('video');
  media.querySelectorAll('video, canvas').forEach((el) => el.remove());
  media.classList.remove('live');
  if (old) setTimeout(() => { if (!old.isConnected && old.src) old.play().catch(() => {}); }, 30);
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
   corners. The full screen view flies in from there and back to it. */
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
  if (!$('#favs').hidden) return hud.toggle('#favs', false);
  if (!$('#filter').hidden) return hud.toggle('#filter', false);
  if (g.selected) {
    const s = g.selected;
    select(null);
    flyToward(s.dir, DIST.home);
  }
}

/* ---------------------------------------------------------- full screen */

// Full screen flies from the card's video when the channel is lifted off the
// globe, else from its screen; on close the video goes back to the card.
const front = createFrontRow({
  rectOf: (s) => (docked === s ? $('#card .cmedia').getBoundingClientRect() : rectOf(s)),
  onClose: (s) => { if (docked === s) fillMedia(s); },
});
front.flags = (s) => ({ onAir: s.id === g.audioOn, isFav: g.favs.includes(s.id) });

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
  if (s === docked) fillMedia(s);
  front.refresh(s);
}

function onIdle(s) {
  g.screens.capture(s);
  g.screens.setVideo(s, null);
  if (s === docked) fillMedia(s);            // its last frame, in the card too
  if (s.id === g.audioOn) setAudio(s.id);    // its voice goes with it
}

function onDead(s) {
  g.screens.markDead(s);
  if (s === g.selected) hud.toast(`${s.src.name}: no stream answers right now`);
  if (s === g.selected || s === g.candidate) renderCard();
}

/* --------------------------------------------------------- favourites */

/* The favourites are the wall: starring a channel here puts it
   on the wall, a tile added on the wall is a star here. */
function toggleFav(id) {
  const name = byId(id).name;
  const i = g.favs.indexOf(id);
  if (i < 0 && g.favs.length >= MAX_WALL) return hud.toast(`The wall is full: ${MAX_WALL} channels max`);
  if (i >= 0) g.favs.splice(i, 1);
  else g.favs.push(id);
  storeWall(g.favs);
  hud.toast(i >= 0 ? `${name}: off the wall`
    : `★ ${name} · on the wall (${g.favs.length}/${MAX_WALL})`);
  renderFavs(i < 0);
}

function renderFavs(bump = false) {
  hud.renderFavs(g.favs.map(byId).filter(Boolean), bump);
  renderCard();
  if (front.screen) front.render(front.screen);
}

/* The wall changed in another tab: the same stars here. Its catalog changed
   category: the same channels here. */
addEventListener('storage', (e) => {
  if (!g.screens) return;
  if (e.key === WALL_KEY) {
    g.favs = wallFor(readWallFromStorage());
    renderFavs();
  }
  if (e.key === FILTER_KEY) setFilter(readStoredFilter());
});

const openWall = () => { location.href = `index.html${viewHash(g.filter, g.favs)}`; };

/* ---------------------------------------------------------- controls */

const raycaster = new THREE.Raycaster();

const ndc = (x, y) => new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);

function screenAt(x, y) {
  raycaster.setFromCamera(ndc(x, y), camera);
  return raycaster.intersectObjects(pickable(), false)[0]?.object.userData.screen;
}

const pickable = () => g.screens.meshes.filter((m) => m.parent.visible && !m.userData.screen.hidden);

/* A click on the selected screen toggles its audio, but a double click means
   "full screen": the audio waits a moment to see whether a second click comes. */
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
    else if (g.selected) openFront(g.selected);     // A again: full screen
  },
  audio() { const s = g.selected || g.candidate; if (s && !pileOf(s)) setAudio(s.id); },
  fav() { const s = g.selected || g.candidate; if (s && !pileOf(s)) toggleFav(s.id); },
  /* 0 = every channel, 1–4 toggle a category; relative (the gamepad's
     shoulders) steps through all, then one category at a time. */
  filter(n, relative = false) {
    if (front.open) return;
    const keys = Object.keys(CATEGORIES);
    if (!relative) {
      if (n === 0 || keys[n - 1]) setFilter(toggleCategory(g.filter, n ? keys[n - 1] : ''));
      return;
    }
    const steps = [[], ...keys.map((k) => [k])];
    const at = steps.findIndex((f) => f.join() === g.filter.join());
    setFilter(steps[(at + n + steps.length) % steps.length]);
  },
  back,
  openWall,
});

/* In full screen the keyboard speaks to it first: arrows change channel
   instead of turning a globe that is out of sight. */
addEventListener('keydown', (e) => {
  if (!front.open || e.metaKey || e.ctrlKey || e.altKey) return;
  const act = {
    Escape: back, f: back, F: back,
    ArrowRight: () => next(1), ArrowLeft: () => next(-1), Tab: () => next(e.shiftKey ? -1 : 1),
    ' ': () => setAudio(front.screen.id), b: () => toggleFav(front.screen.id), B: () => toggleFav(front.screen.id),
  }[e.key];
  if (!act) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  act();
}, true);

/* ----------------------------------------------------------------- HUD */

$('#card').addEventListener('click', (e) => {
  const op = e.target.closest('[data-op]')?.dataset.op;
  const s = g.selected;
  if (!s) return;
  if (op === 'front') openFront(s);
  if (op === 'audio') setAudio(s.id);
  if (op === 'fav') toggleFav(s.id);
});
$('#card .cmedia').addEventListener('dblclick', () => { if (g.selected) openFront(g.selected); });
$('#front').addEventListener('click', (e) => {
  if (e.target.classList.contains('front-veil')) return front.close();
  const op = e.target.closest('[data-fop]')?.dataset.fop;
  const s = front.screen;
  if (!op || !s) return;
  if (op === 'back') front.close();
  if (op === 'prev') next(-1);
  if (op === 'next') next(1);
  if (op === 'audio') setAudio(s.id);
  if (op === 'fav') toggleFav(s.id);
});
// The two panes share a corner: opening one closes the other.
$('#favs-btn').onclick = () => { hud.toggle('#filter', false); hud.toggle('#favs'); };
$('#filter-btn').onclick = () => { hud.toggle('#favs', false); hud.toggle('#filter'); };
$('#favs-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) toggleFav(li.dataset.id);
});
$('#favs-open').onclick = openWall;
$('[data-act="keys"]').onclick = () => hud.toggle('#keys');
$('#keys-close').onclick = () => hud.toggle('#keys', false);
$('#keys').addEventListener('mousedown', (e) => { if (e.target.id === 'keys') hud.toggle('#keys', false); });
addEventListener('keydown', (e) => { if (e.key === '?') hud.toggle('#keys'); });

/* A clicked button must not keep the focus: Space and Enter belong to the globe. */
addEventListener('click', (e) => { if (e.detail) e.target.closest('button')?.blur(); });

setInterval(hud.tickUtc, 10000);

boot();
