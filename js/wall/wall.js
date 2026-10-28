/* Newswall — a wall of live streams, news first, sport, markets and weather beside it.
   No backend, no server-side state: the configuration lives in the URL
   (so a wall can be shared with a link) and in localStorage for convenience. */

import {
  byId, catalog, countryName, escapeHtml, firstStream, flag, langName, liveState,
  loadCatalog, ORIGIN_LABEL, originText, passes, wallFor,
} from '../core/data.js';
import { filterLabel } from '../core/filter.js';
import { createHlsPlayer } from '../core/hls-player.js';
import { FILTER_KEY, readFilter, readLinkWall, readStoredFilter, saveView } from '../core/url.js';
import {
  activeWall, addWall, FIRST_NAME, findWall, loadWalls, setActive, setWallIds, WALLS_KEY,
} from '../core/walls.js';
import {
  buildPanel, initPanel, listSources, openPalette, pal, palMove, palPick, palRender, togglePanel,
} from './panel.js';
import { initPicker, renderPicker, togglePicker } from './picker.js';
import { programResume, programUnwire, programWire } from './program.js';
import { initReplay, saveReplay, toggleReplay } from './replay-menu.js';
import { $, grid, LOW_QUALITY_CAP, MAX_TILES, state, tileEl, toast } from './state.js';

/* ---------------------------------------------------------------- boot */

async function boot() {
  await loadCatalog();
  openWall();
  initPanel(toggleSource, setFilter);
  initPicker({ show, adopt, save });
  applyFilter(readFilter());
  syncGrid();
  save();
  renderPicker();
  initReplay();
}

/* Which wall to open. A link that carries one of your walls opens it; one
   that carries someone else's shows it without saving it (it becomes yours
   at the first change, or with "Save"), unless this is a first visit: then it
   simply is your first wall. No link: the wall you used last. */
function openWall() {
  const book = loadWalls();
  const link = readLinkWall();
  if (!link) return put(activeWall(book));
  const ids = wallFor(link.ids);
  const mine = findWall(book, ids, link.name);
  if (mine) return put(setActive(mine.id));
  if (book.fresh) return put(addWall(link.name || FIRST_NAME, ids, book.active));
  state.wall = { id: null, name: link.name || 'Shared wall' };
  state.active = ids;
}

const put = (w) => { state.wall = { id: w.id, name: w.name }; state.active = [...w.ids]; };

/* Puts one of your walls on screen: the tiles both walls share keep playing. */
function show(w) {
  put(w);
  commit();
}

/* The shared wall on screen becomes one of yours. */
function adopt() {
  if (state.wall.id) return;
  const w = addWall(state.wall.name, state.active);
  state.wall = { id: w.id, name: w.name };
  toast(`“${w.name}” is now one of your walls`);
  renderPicker();
}

/* The address bar is the link to this wall; the globe reads the same filter
   and the same walls from localStorage. */
function save() {
  saveView(state.active, state.filter, state.wall.name);
  if (state.wall.id) setWallIds(state.wall.id, state.active);
}

function renderCount() {
  const n = (st) => state.sources.filter((s) => liveState(s.id) === st).length;
  const unverified = n('unverified');
  const when = catalog.generated
    ? new Date(catalog.generated).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
  $('#live-count').textContent = `${n('ok')}/${state.sources.length} live`
    + (unverified ? ` · ${unverified} unverified` : '') + ` · updated ${when}`;
}

/* ------------------------------------------------------------- filter */

/* The filter picks what the catalog shows, not what is on the wall: the
   tiles are yours, whatever their category. */
function applyFilter(filter) {
  state.filter = filter;
  state.sources = catalog.all.filter((s) => passes(s, filter));
  const badge = $('#sources-filter');
  badge.hidden = !filter.length;
  badge.textContent = filterLabel(filter);
  renderCount();
  buildPanel();
}

function setFilter(filter) {
  applyFilter(filter);
  save();
}

/* ------------------------------------------------------- grid layout */

/* Picks the rows and columns that make the 16:9 tiles as large as possible
   in the available space: with 5 sources on a wide screen, 3x2 beats 2x3. */
function bestGrid(n, W, H) {
  let best = { cols: 1, size: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = (W - (cols + 1) * 5) / cols;
    const h = (H - (rows + 1) * 5) / rows;
    const size = Math.min(w, h * (16 / 9));       // effective width at 16:9
    if (size > best.size) best = { cols, size };
  }
  return best.cols;
}

function layout() {
  const n = state.focused ? 1 : Math.max(1, state.active.length);
  const cols = bestGrid(n, grid.clientWidth, grid.clientHeight);
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.dataset.cols = cols;

  // The "+" slot takes a leftover cell. If the grid comes out exact, no row is
  // opened just for it: that would shrink every video for an invitation.
  const free = cols * Math.ceil(n / cols) - state.active.length;
  const slot = grid.querySelector('.add-slot');
  if (slot) slot.hidden = !!state.focused || (free < 1 && state.active.length > 0);
}

/* ---------------------------------------------------------------- tiles */

const ICON = {
  sound: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8.4 2.3 5 5.1H2.4v5.8H5l3.4 2.8z"/><path d="M10.7 5.4a3.5 3.5 0 0 1 0 5.2m2-7.4a6.4 6.4 0 0 1 0 9.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  grow: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M6 2.2H2.2V6M10 2.2h3.8V6M6 13.8H2.2V10M10 13.8h3.8V10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  kill: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

/* Reconciles the grid with state.active without tearing down what already works:
   adding a channel must not restart the other eleven. */
function syncGrid() {
  for (const t of [...grid.querySelectorAll('.tile')]) {
    if (!state.active.includes(t.dataset.id)) dropTile(t);
  }
  state.active.forEach((id) => { if (!tileEl(id)) grid.appendChild(makeTile(id)); });

  let slot = grid.querySelector('.add-slot');
  if (state.active.length < MAX_TILES) {
    if (!slot) grid.appendChild(makeSlot());
  } else slot?.remove();

  orderTiles();
  layout();
  tickClocks();
}

/* Visual order is set by the CSS grid, not the DOM: moving a <video> node
   restarts its playback. */
function orderTiles() {
  state.active.forEach((id, i) => {
    const t = tileEl(id);
    if (!t) return;
    t.style.order = i;
    t.querySelector('.num').textContent = i < 9 ? i + 1 : '';
  });
  const slot = grid.querySelector('.add-slot');
  if (slot) slot.style.order = state.active.length;
}

function makeTile(id) {
  const src = byId(id);
  const info = catalog.live[id] || {};
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.id = id;
  tile.draggable = true;

  tile.innerHTML = `
    <div class="label">
      <span class="flag" title="${escapeHtml(countryName(src.country))}">${flag(src.country)}</span>
      <span class="name">${escapeHtml(src.name)}</span>
      <span class="cc" title="${escapeHtml(countryName(src.country))}">${escapeHtml(src.country)}</span>
      <span class="cc lang" title="In ${escapeHtml(langName(src.lang))}">${escapeHtml((src.lang || '').toUpperCase())}</span>
      <span class="clock" data-tz="${escapeHtml(src.tz || 'UTC')}"></span>
    </div>
    <div class="ops">
      <button class="alt" data-op="alt" hidden></button>
      <button class="sound" data-op="sound" title="Audio to this channel">${ICON.sound}</button>
      <button data-op="grow" title="Enlarge (double click)">${ICON.grow}</button>
      <button class="kill" data-op="kill" title="Remove from the wall">${ICON.kill}</button>
    </div>
    <div class="foot">
      <span class="origin"></span>
      <span class="num"></span>
    </div>
    <div class="wait"><span class="bar"></span>connecting…</div>`;

  if (info.state === 'dead') markDead(tile, src, info.reason);
  else attach(tile, src, firstStream(src));
  return tile;
}

function makeSlot() {
  const slot = document.createElement('div');
  slot.className = 'add-slot';
  slot.innerHTML = `<span class="plus">+</span>
    <span class="txt">Add a channel <kbd>⌘K</kbd></span>`;
  slot.onclick = () => openPalette(true);
  return slot;
}

function dropTile(tile) {
  const id = tile.dataset.id;
  stopPlayer(id);
  if (state.audioOn === id) setOnAir(null);
  if (state.focused === id) { state.focused = null; document.body.classList.remove('focus'); }
  tile.remove();
}

function markDead(tile, src, why) {
  tile.classList.add('dead');
  tile.classList.remove('waiting');
  tile.querySelector('.dead-msg')?.remove();
  tile.insertAdjacentHTML('beforeend', `
    <div class="dead-msg">
      <span>${escapeHtml(src.name)}</span>
      <span class="why">${escapeHtml(why || 'not available')}</span>
      <button class="retry" data-op="retry">retry</button>
    </div>`);
}

/* Mounts stream number `idx`. If it does not start, falls back to the next one:
   a channel with several sources stays on air even when a CDN gives up. */
function attach(tile, src, idx) {
  const stream = src.streams[idx];
  if (!stream) return markDead(tile, src, 'no source available');

  // Watchdogs and error handlers can fire seconds later: if the tile has been
  // removed from the wall in the meantime, reattaching a stream would keep it
  // downloading forever with no video attached.
  const alive = () => tile.isConnected;
  const next = () => {
    if (!alive()) return;
    detach(tile, src.id);
    attach(tile, src, idx + 1);
  };

  tile.classList.remove('dead');
  tile.querySelector('.dead-msg')?.remove();
  tile.classList.add('waiting');
  tile.dataset.stream = idx;

  const o = stream.origin || {};
  const origin = tile.querySelector('.origin');
  origin.className = `origin ${o.kind || ''}`;
  origin.innerHTML = `<b>${escapeHtml(o.label || o.host || '?')}</b> ${escapeHtml(ORIGIN_LABEL[o.kind] || '')}`;
  origin.title = originText(stream);

  // The source switcher only shows up where there really is an alternative source.
  const alt = tile.querySelector('.alt');
  alt.hidden = src.streams.length < 2;
  alt.textContent = `${idx + 1}/${src.streams.length}`;
  alt.title = 'Switch source';

  const player = createHlsPlayer(stream.url, {
    muted: state.audioOn !== src.id,
    onReady: () => tile.classList.remove('waiting'),
    onFail: next,
  });
  tile.appendChild(player.video);
  state.players.set(src.id, player);
  programWire(player.video);

  // Muted autoplay needs no gesture; the first click on a tile brings the sound.
  player.play();
}

function stopPlayer(id) {
  const p = state.players.get(id);
  if (p) { programUnwire(p.video); p.destroy(); }
  state.players.delete(id);
}

function detach(tile, id) {
  stopPlayer(id);
  tile.querySelector('video')?.remove();
}

/* Manually switch to the next source: useful when the CDN is up but stutters. */
function cycleStream(id) {
  const tile = tileEl(id), src = byId(id);
  if (!tile || src.streams.length < 2) return;
  const idx = (Number(tile.dataset.stream || 0) + 1) % src.streams.length;
  detach(tile, id);
  attach(tile, src, idx);
  const o = src.streams[idx].origin || {};
  toast(`${src.name}: source ${idx + 1} of ${src.streams.length} — ${o.label || o.host || '?'}`);
}

/* --------------------------------------------------------------- audio */

/* Only one channel talks. Clicking the same one again mutes it. */
function setAudio(id) {
  setOnAir(state.audioOn === id ? null : id);
}

function setOnAir(id) {
  state.audioOn = id;
  if (id) programResume();
  for (const [sid, p] of state.players) {
    const on = sid === state.audioOn;
    tileEl(sid)?.classList.toggle('audio-on', on);
    p.video.muted = !on;
    if (on) p.play();
  }
  const box = $('#onair');
  box.hidden = !id;
  if (id) box.querySelector('.who').textContent = byId(id).name;
  $('[data-act="mute-all"]').classList.toggle('idle', state.audioOn === null);
}

/* --------------------------------------------------------------- focus */

function setFocus(id) {
  state.focused = state.focused === id ? null : id;
  document.body.classList.toggle('focus', !!state.focused);
  grid.querySelectorAll('.tile').forEach((t) => {
    t.classList.toggle('is-focus', t.dataset.id === state.focused);
  });
  // The enlarged tile can afford full quality.
  for (const [sid, p] of state.players) {
    p.setCap(sid === state.focused ? null : LOW_QUALITY_CAP);
  }
  layout();
  if (state.focused && state.audioOn !== state.focused) setAudio(state.focused);
}

/* ------------------------------------------------------ add / remove */

function addSource(id) {
  if (state.active.includes(id)) return;
  if (state.active.length >= MAX_TILES) return toast(`The wall is full: ${MAX_TILES} tiles max`);
  state.active.push(id);
  adopt();
  commit();
  const src = byId(id);
  toast({
    ok: `${flag(src.country)} ${src.name} on air`,
    unverified: `${flag(src.country)} ${src.name}: the last check could not verify it, trying`,
    dead: `${src.name}: the last check did not find it live`,
  }[liveState(id)]);
}

function removeSource(id) {
  const i = state.active.indexOf(id);
  if (i < 0) return;
  state.active.splice(i, 1);
  adopt();
  commit();
  toast(`${byId(id).name} removed from the wall`);
}

const toggleSource = (id) => (state.active.includes(id) ? removeSource(id) : addSource(id));

/* Another tab changed the walls: the globe starred a channel of this one
   (its favourites are these tiles), or another wall was picked or renamed.
   A shared wall on screen stays there until you leave it. */
addEventListener('storage', (e) => {
  if (!catalog.all.length) return;
  if (e.key === WALLS_KEY) {
    const w = activeWall(loadWalls());
    if (state.wall.id && (w.id !== state.wall.id || w.name !== state.wall.name
      || w.ids.join() !== state.active.join())) show(w);
    else renderPicker();
  }
  if (e.key === FILTER_KEY) setFilter(readStoredFilter());
});

/* The one place where the wall changes: redraw, save, resync everything. */
function commit() {
  syncGrid();
  save();
  listSources();
  renderPicker();
  if (pal.open) palRender();
}

/* --------------------------------------------------------------- clocks */

function tickClocks() {
  grid.querySelectorAll('.clock').forEach((c) => {
    try {
      c.textContent = new Date().toLocaleTimeString('en-GB',
        { timeZone: c.dataset.tz, hour: '2-digit', minute: '2-digit' });
    } catch { c.textContent = ''; }
  });
}
setInterval(tickClocks, 10000);

/* ---------------------------------------------------------- interaction */

grid.addEventListener('click', (e) => {
  const op = e.target.closest('[data-op]');
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const id = tile.dataset.id;
  if (op) {
    e.stopPropagation();
    if (op.dataset.op === 'kill') return removeSource(id);
    if (op.dataset.op === 'alt') return cycleStream(id);
    if (op.dataset.op === 'grow') return setFocus(id);
    if (op.dataset.op === 'sound') return setAudio(id);
    if (op.dataset.op === 'retry') { detach(tile, id); return attach(tile, byId(id), 0); }
  }
  if (!tile.classList.contains('dead')) setAudio(id);
});

grid.addEventListener('dblclick', (e) => {
  const t = e.target.closest('.tile');
  if (t && !e.target.closest('.ops') && !t.classList.contains('dead')) setFocus(t.dataset.id);
});

/* Reordering: drag the tile. */
grid.addEventListener('dragstart', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  state.drag = t.dataset.id;
  t.classList.add('dragging');
  document.body.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', state.drag);
});
grid.addEventListener('dragover', (e) => {
  if (!state.drag) return;
  e.preventDefault();
  const t = e.target.closest('.tile');
  grid.querySelectorAll('.drop-here').forEach((x) => x.classList.remove('drop-here'));
  if (t && t.dataset.id !== state.drag) t.classList.add('drop-here');
});
grid.addEventListener('drop', (e) => {
  const t = e.target.closest('.tile');
  if (!state.drag || !t || t.dataset.id === state.drag) return;
  e.preventDefault();
  const from = state.active.indexOf(state.drag);
  const to = state.active.indexOf(t.dataset.id);
  state.active.splice(to, 0, state.active.splice(from, 1)[0]);
  adopt();
  orderTiles();
  save();
});
grid.addEventListener('dragend', () => {
  state.drag = null;
  document.body.classList.remove('dragging');
  grid.querySelectorAll('.dragging, .drop-here').forEach((x) => x.classList.remove('dragging', 'drop-here'));
});

$('#logo').onclick = () => togglePanel();

$('#controls').addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'palette') openPalette();
  if (act === 'sources') togglePanel();
  if (act === 'mute-all') setOnAir(null);
  if (act === 'fullscreen') toggleFullscreen();
  if (act === 'keys') toggleKeys();
});

$('#keys').addEventListener('mousedown', (e) => { if (e.target.id === 'keys') toggleKeys(false); });
$('#keys-close').onclick = () => toggleKeys(false);

addEventListener('keydown', (e) => {
  const typing = !!e.target.closest?.('input, textarea, select');

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(true); }

  if (pal.open) {
    if (e.key === 'ArrowDown') { e.preventDefault(); return palMove(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); return palMove(-1); }
    if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      return palPick();
    }
    if (e.key === 'Escape') return openPalette(false);
    return;
  }
  if (typing) {
    if (e.key !== 'Escape') return;
    e.target.blur();
    if (e.target.id === 'panel-search') togglePanel(false);
    return;
  }

  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= Math.min(9, state.active.length)) return setAudio(state.active[n - 1]);

  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (!$('#keys').hidden) return toggleKeys(false);
    if (!$('#walls').hidden) return togglePicker(false);
    if (!$('#replay').hidden) return toggleReplay(false);
    if (state.focused) return setFocus(state.focused);
    return togglePanel(false);
  }
  if (e.key === '/') { e.preventDefault(); return openPalette(true); }
  if (e.key === '?') { e.preventDefault(); return toggleKeys(); }
  if (k === 's') { e.preventDefault(); return togglePanel(); }
  if (k === 'w') { e.preventDefault(); return togglePicker(); }
  if (k === 'm') { e.preventDefault(); return setOnAir(null); }
  if (k === 'f') { e.preventDefault(); return toggleFullscreen(); }
  if (k === 'r' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); return e.shiftKey ? saveReplay() : toggleReplay(); }
  if (k === 'g') { e.preventDefault(); location.href = $('#to-globe').href; }
});

addEventListener('resize', layout);

function toggleKeys(force) {
  const k = $('#keys');
  k.hidden = force === undefined ? !k.hidden : !force;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

boot();
