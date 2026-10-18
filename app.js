/* Newswall — a wall of live news streams.
   No backend, no server-side state: the configuration lives in the URL
   (so a wall can be shared with a link) and in localStorage for convenience. */

const DEFAULT_WALL = ['aljazeera-en', 'france24-en', 'dw-news', 'rainews24', 'cgtn', 'trt-world'];
const LOW_QUALITY_CAP = 480;   // max height for tiles that are not enlarged
const MAX_TILES = 12;

const state = {
  sources: [],          // curated catalog
  live: {},             // result of the last refresh, by id
  active: [],           // ids on the wall, in order
  players: new Map(),   // id -> { kind, el, hls }
  audioOn: null,        // one audio at a time: house rule
  focused: null,
  started: false,
  drag: null,           // id of the tile being dragged
};

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');

/* ---------------------------------------------------------------- boot */

async function boot() {
  const [sources, live] = await Promise.all([
    fetch('sources.json').then((r) => r.json()),
    fetch('live.json').then((r) => r.json()).catch(() => ({ entries: {} })),
  ]);
  state.sources = sources.sources;
  state.live = live.entries || {};

  state.active = readWallFromUrl() || readWallFromStorage() || DEFAULT_WALL.slice();
  state.active = state.active.filter(byId).slice(0, MAX_TILES);
  if (!state.active.length) state.active = DEFAULT_WALL.slice();

  renderCount(live.generated);
  buildPanel();
  syncGrid();

  $('#gate-n').textContent = state.active.filter(isPlayable).length;
  $('#gate').hidden = false;
}

const byId = (id) => state.sources.find((s) => s.id === id);
const isPlayable = (id) => (state.live[id] ? state.live[id].ok !== false : true);
const tileEl = (id) => [...grid.children].find((t) => t.dataset.id === id);

/* Which stream to try first: the one the last check found working. */
function firstStream(src) {
  const use = state.live[src.id]?.use;
  return Number.isInteger(use) ? use : 0;
}

/* Flag from the ISO code: two letters -> two "regional indicators". */
function flag(cc) {
  if (!/^[A-Za-z]{2}$/.test(cc || '')) return '';
  const cp = [...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...cp);
}

/* The browser already knows country names: no list to keep up to date. */
const REGION = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
})();
const countryName = (cc) => {
  try { return REGION?.of(cc) || cc; } catch { return cc; }
};

const ORIGIN_LABEL = {
  broadcaster: 'from the broadcaster',
  cdn: 'via CDN',
  rebroadcast: 'rebroadcast by a third party',
  youtube: 'via YouTube',
  unknown: 'unidentified origin',
};

function originText(stream) {
  const o = stream.origin || {};
  const who = o.label || o.host || '?';
  return `${who} — ${ORIGIN_LABEL[o.kind] || o.kind || ''}`.trim();
}

function renderCount(generated) {
  const on = state.sources.filter((s) => isPlayable(s.id)).length;
  const when = generated
    ? new Date(generated).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
  $('#live-count').textContent = `${on}/${state.sources.length} live · checked ${when}`;
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
  grip: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><g fill="currentColor"><circle cx="6" cy="3.6" r="1.15"/><circle cx="10" cy="3.6" r="1.15"/><circle cx="6" cy="8" r="1.15"/><circle cx="10" cy="8" r="1.15"/><circle cx="6" cy="12.4" r="1.15"/><circle cx="10" cy="12.4" r="1.15"/></g></svg>',
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

/* Visual order is set by the CSS grid, not the DOM: moving a node would
   reload the YouTube iframe and stop the video. */
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
  const info = state.live[id] || {};
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.id = id;
  tile.draggable = true;

  tile.innerHTML = `
    <div class="label">
      <span class="flag" title="${escapeHtml(countryName(src.country))}">${flag(src.country)}</span>
      <span class="name">${escapeHtml(src.name)}</span>
      <span class="cc" title="${escapeHtml(countryName(src.country))}">${escapeHtml(src.country)}</span>
      <span class="clock" data-tz="${escapeHtml(src.tz || 'UTC')}"></span>
    </div>
    <div class="ops">
      <button class="grip" draggable="true" title="Drag to reorder">${ICON.grip}</button>
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

  if (info.ok === false) markDead(tile, src, info.reason);
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
  const p = state.players.get(id);
  if (p?.watchdog) clearTimeout(p.watchdog);
  if (p?.hello) clearInterval(p.hello);
  if (p?.hls) p.hls.destroy();
  if (p?.kind === 'hls') { p.el.pause(); p.el.removeAttribute('src'); p.el.load(); }
  state.players.delete(id);
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
  origin.innerHTML = `${stream.kind === 'hls' ? 'HLS' : 'YT'} · <b>${escapeHtml(o.label || o.host || '?')}</b> ${escapeHtml(ORIGIN_LABEL[o.kind] || '')}`;
  origin.title = originText(stream);

  // The source switcher only shows up where there really is an alternative source.
  const alt = tile.querySelector('.alt');
  alt.hidden = src.streams.length < 2;
  alt.textContent = `${idx + 1}/${src.streams.length}`;
  alt.title = 'Switch source';

  if (stream.kind === 'hls') {
    const video = document.createElement('video');
    video.muted = state.audioOn !== src.id;
    video.playsInline = true;
    video.preload = 'auto';
    video.draggable = false;
    tile.appendChild(video);

    if (window.Hls && Hls.isSupported()) {
      // capLevelToPlayerSize is the real advantage over the YouTube iframe: small
      // tiles download a small variant, and bandwidth stays reasonable.
      const hls = new Hls({
        capLevelToPlayerSize: true,
        lowLatencyMode: true,
        maxBufferLength: 12,
        backBufferLength: 15,
      });
      hls.loadSource(stream.url);
      hls.attachMedia(video);
      // A reachable manifest does not guarantee reachable segments: some
      // broadcasters only serve them in their own country. Two retries, then give up.
      let retries = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (!alive()) return hls.destroy();
        if (retries++ >= 2) { hls.destroy(); return next(); }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      });
      state.players.set(src.id, { kind: 'hls', el: video, hls });

      const watchdog = setTimeout(() => { if (!video.videoWidth) next(); }, 15000);
      // If the tile disappears first, the watchdog must not even try.
      state.players.get(src.id).watchdog = watchdog;
      video.addEventListener('loadeddata', () => {
        clearTimeout(watchdog);
        tile.classList.remove('waiting');
      }, { once: true });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = stream.url;                       // Safari plays HLS natively
      video.addEventListener('loadeddata', () => tile.classList.remove('waiting'), { once: true });
      state.players.set(src.id, { kind: 'hls', el: video });
    } else return next();
  } else {
    const info = state.live[src.id]?.streams?.[idx] || {};
    if (!info.videoId) return next();
    const frame = document.createElement('iframe');
    const params = new URLSearchParams({
      autoplay: '1', mute: '1', enablejsapi: '1', playsinline: '1',
      rel: '0', modestbranding: '1',
    });
    frame.src = `https://www.youtube.com/embed/${info.videoId}?${params}`;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    frame.allowFullscreen = true;
    // From outside there is no way to tell when a YouTube iframe actually has a
    // picture: allow one second after load, then lift the curtain.
    frame.addEventListener('load', () => {
      ytHello(src.id);
      setTimeout(() => { if (alive()) tile.classList.remove('waiting'); }, 1000);
    });
    tile.appendChild(frame);
    // The YouTube iframe is cross-origin: clicks inside it never bubble up to
    // us, so the tile never lit up (and double click did not enlarge it). A
    // transparent veil over the player gives the tile its gestures back; it
    // sits below the label, footer and controls (z-index 3), which stay
    // clickable. Nothing is needed from the YT player UI: play, mute and
    // volume already go through postMessage.
    const veil = document.createElement('div');
    veil.className = 'veil';
    tile.appendChild(veil);
    state.players.set(src.id, { kind: 'yt', el: frame });
  }

  if (state.started) play(state.players.get(src.id));
}

function detach(tile, id) {
  const p = state.players.get(id);
  if (p?.watchdog) clearTimeout(p.watchdog);
  if (p?.hello) clearInterval(p.hello);
  if (p?.hls) p.hls.destroy();
  state.players.delete(id);
  tile.querySelectorAll('video, iframe, .veil').forEach((x) => x.remove());
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

const play = (p) => {
  if (!p) return;
  if (p.kind === 'hls') p.el.play().catch(() => {});
  else yt(p.el, 'playVideo');
};

/* --------------------------------------------------------------- audio */

function yt(frame, func, args = []) {
  frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}

/* The YouTube player drops commands until the "widget" channel has been
   opened: without this handshake the first unMute is lost and the tile stays
   silent even when selected. Keep knocking until it answers. */
function ytHello(id) {
  const p = state.players.get(id);
  if (!p || p.kind !== 'yt') return;
  clearInterval(p.hello);
  const knock = () => p.el.contentWindow?.postMessage(
    JSON.stringify({ event: 'listening', id, channel: 'widget' }), '*');
  knock();
  p.hello = setInterval(knock, 700);
  setTimeout(() => clearInterval(p.hello), 20000);
}

/* When the player answers, stop knocking and sync its audio: the click on
   the tile may have arrived before it was ready. */
window.addEventListener('message', (e) => {
  let host;
  try { host = new URL(e.origin).hostname; } catch { return; }
  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host)) return;
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }
  if (msg?.event !== 'onReady' && msg?.event !== 'initialDelivery') return;
  for (const [sid, p] of state.players) {
    if (p.kind !== 'yt' || p.el.contentWindow !== e.source) continue;
    clearInterval(p.hello);
    const on = sid === state.audioOn;
    yt(p.el, on ? 'unMute' : 'mute');
    if (on) yt(p.el, 'setVolume', [100]);
    if (state.started) yt(p.el, 'playVideo');
  }
});

/* Only one channel talks. Clicking the same one again mutes it. */
function setAudio(id) {
  setOnAir(state.audioOn === id ? null : id);
}

function setOnAir(id) {
  state.audioOn = id;
  for (const [sid, p] of state.players) {
    const on = sid === state.audioOn;
    const tile = tileEl(sid);
    tile?.classList.toggle('audio-on', on);
    if (p.kind === 'yt') {
      yt(p.el, on ? 'unMute' : 'mute');
      if (on) yt(p.el, 'setVolume', [100]);
    } else {
      p.el.muted = !on;
      if (on) p.el.play().catch(() => {});
    }
  }
  const box = $('#onair');
  box.hidden = !id;
  if (id) box.querySelector('.who').textContent = byId(id).name;
  $('[data-act="mute-all"]').classList.toggle('idle', state.audioOn === null);
}

function startAll() { for (const p of state.players.values()) play(p); }

/* --------------------------------------------------------------- focus */

function setFocus(id) {
  state.focused = state.focused === id ? null : id;
  document.body.classList.toggle('focus', !!state.focused);
  grid.querySelectorAll('.tile').forEach((t) => {
    t.classList.toggle('is-focus', t.dataset.id === state.focused);
  });
  // The enlarged tile can afford full quality.
  for (const [sid, p] of state.players) {
    if (p.hls) p.hls.autoLevelCapping = (sid === state.focused) ? -1 : capFor(p.hls);
  }
  layout();
  if (state.focused && state.audioOn !== state.focused) setAudio(state.focused);
}

function capFor(hls) {
  const idx = hls.levels.findIndex((l) => l.height > LOW_QUALITY_CAP);
  return idx > 0 ? idx - 1 : -1;
}

/* ------------------------------------------------------ add / remove */

function addSource(id) {
  if (state.active.includes(id)) return;
  if (state.active.length >= MAX_TILES) return toast(`The wall is full: ${MAX_TILES} tiles max`);
  state.active.push(id);
  commit();
  const src = byId(id);
  toast(isPlayable(id)
    ? `${flag(src.country)} ${src.name} on air`
    : `${src.name}: the last check did not find it live`);
}

function removeSource(id) {
  const i = state.active.indexOf(id);
  if (i < 0) return;
  state.active.splice(i, 1);
  commit();
  toast(`${byId(id).name} removed from the wall`);
}

const toggleSource = (id) => (state.active.includes(id) ? removeSource(id) : addSource(id));

/* The one place where the wall changes: redraw, save, resync everything. */
function commit() {
  syncGrid();
  saveWall();
  listSources();
  if (pal.open) palRender();
}

/* ---------------------------------------------------------------- panel */

const filters = { tag: '', country: '', q: '' };

function buildCountrySelect() {
  const counts = {};
  for (const s of state.sources) counts[s.country] = (counts[s.country] || 0) + 1;
  const list = Object.keys(counts).sort((a, b) =>
    countryName(a).localeCompare(countryName(b), 'en'));
  $('#panel-country').innerHTML =
    `<option value="">🌍 All (${list.length})</option>` +
    list.map((c) => `<option value="${c}">${flag(c)} ${escapeHtml(countryName(c))} · ${counts[c]}</option>`).join('');
}

function buildPanel() {
  const tags = [...new Set(state.sources.flatMap((s) => s.tags || []))].sort();
  $('#panel-filters').innerHTML =
    `<button data-tag="" class="on">all</button>` +
    tags.map((t) => `<button data-tag="${t}">${t}</button>`).join('');

  $('#panel-filters').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('#panel-filters').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    filters.tag = b.dataset.tag;
    listSources();
  };

  buildCountrySelect();
  $('#panel-country').onchange = (e) => { filters.country = e.target.value; listSources(); };
  $('#panel-search').oninput = (e) => { filters.q = e.target.value.trim().toLowerCase(); listSources(); };

  listSources();
}

function listSources() {
  const { tag, country, q } = filters;
  const list = state.sources.filter((s) => {
    if (tag && !(s.tags || []).includes(tag)) return false;
    if (country && s.country !== country) return false;
    if (!q) return true;
    // Search also matches the full country name: "germany" finds DW.
    const hay = `${s.name} ${s.country} ${countryName(s.country)} ${s.lang} ${(s.tags || []).join(' ')}`;
    return hay.toLowerCase().includes(q);
  });

  $('#panel-list').innerHTML = list.length ? list.map((s) => {
    const on = state.active.includes(s.id);
    const dead = !isPlayable(s.id);
    const stream = s.streams[firstStream(s)] || s.streams[0];
    const alt = s.streams.length > 1 ? ` · ${s.streams.length} sources` : '';
    return `<div class="row ${on ? 'on' : ''} ${dead ? 'off-air' : ''}" data-id="${s.id}"
                 title="${on ? 'Remove from the wall' : 'Add to the wall'}">
      <span class="tick">${on ? '✓' : ''}</span>
      <span class="rflag" title="${escapeHtml(countryName(s.country))}">${flag(s.country)}</span>
      <span class="rtext">
        <span class="rname">${escapeHtml(s.name)}</span>
        <span class="rorigin ${stream.origin?.kind || ''}">${escapeHtml(originText(stream))}${alt}</span>
      </span>
      <span class="rmeta">${dead ? 'off air' : escapeHtml(countryName(s.country))}</span>
    </div>`;
  }).join('') : `<div class="empty">No channels match these filters.</div>`;

  const shown = list.length, tot = state.sources.length;
  $('#panel-count').textContent = shown === tot
    ? `${state.active.length}/${MAX_TILES} on the wall`
    : `${shown} of ${tot} · ${state.active.length}/${MAX_TILES} on the wall`;
}

/* --------------------------------------------------------- quick search */

const pal = { open: false, sel: 0, list: [] };

function openPalette(v) {
  pal.open = v === undefined ? !pal.open : v;
  $('#palette').hidden = !pal.open;
  $('[data-act="palette"]').classList.toggle('on', pal.open);
  if (pal.open) { $('#pal-q').value = ''; pal.sel = 0; palRender(); $('#pal-q').focus(); }
}

/* Crude but predictable scoring: name first, then country, then language.
   "aje" finds Al Jazeera English because initials are matched too. */
function palScore(s, t) {
  const name = s.name.toLowerCase();
  const cname = countryName(s.country).toLowerCase();
  const ini = name.split(/[\s-]+/).map((w) => w[0] || '').join('');
  if (name.startsWith(t)) return 100;
  if (ini.startsWith(t) && t.length > 1) return 90;
  if (name.includes(t)) return 80;
  if (s.country.toLowerCase() === t) return 70;
  if (cname.startsWith(t)) return 65;
  if (cname.includes(t)) return 55;
  if (s.lang.toLowerCase() === t) return 45;
  if ((s.tags || []).some((x) => x.includes(t))) return 35;
  return 0;
}

function palRender() {
  const t = $('#pal-q').value.trim().toLowerCase();
  let list;
  if (!t) {
    // Empty query: what is already on the wall comes first, so removing is instant.
    const inWall = state.active.map(byId).filter(Boolean);
    const rest = state.sources.filter((s) => !state.active.includes(s.id));
    list = [...inWall, ...rest];
  } else {
    list = state.sources
      .map((s) => ({ s, n: palScore(s, t) })).filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || a.s.name.localeCompare(b.s.name)).map((x) => x.s);
  }
  pal.list = list.slice(0, 80);
  pal.sel = Math.min(pal.sel, Math.max(0, pal.list.length - 1));

  $('#pal-count').textContent = list.length ? `${list.length} channels` : '';
  $('#pal-list').innerHTML = pal.list.length ? pal.list.map((s, i) => {
    const on = state.active.includes(s.id);
    const dead = !isPlayable(s.id);
    const stream = s.streams[firstStream(s)] || s.streams[0];
    return `<div class="pal-row ${i === pal.sel ? 'sel' : ''} ${on ? 'in' : ''} ${dead ? 'dead' : ''}" data-id="${s.id}">
      <span class="pflag">${flag(s.country)}</span>
      <span class="ptext">
        <span class="pname">${escapeHtml(s.name)}</span>
        <span class="psub">${escapeHtml(countryName(s.country))} · ${escapeHtml(s.lang)} · ${escapeHtml(originText(stream))}</span>
      </span>
      <span class="pact">${on ? 'remove' : 'add'}</span>
    </div>`;
  }).join('') : `<div class="empty">No channels found.</div>`;
}

function palSelect(i) {
  const rows = $('#pal-list').children;
  if (!rows.length) return;
  rows[pal.sel]?.classList.remove('sel');
  pal.sel = (i + rows.length) % rows.length;
  rows[pal.sel]?.classList.add('sel');
}

function palMove(d) {
  if (!pal.list.length) return;
  palSelect(pal.sel + d);
  $('#pal-list').children[pal.sel]?.scrollIntoView({ block: 'nearest' });
}

/* -------------------------------------------------------- state in URL */

function readWallFromUrl() {
  const m = new URLSearchParams(location.hash.slice(1)).get('s');
  return m ? m.split(',').filter(Boolean) : null;
}
function readWallFromStorage() {
  try { return JSON.parse(localStorage.getItem('newswall') || 'null'); } catch { return null; }
}
function saveWall() {
  const q = new URLSearchParams({ s: state.active.join(',') });
  history.replaceState(null, '', '#' + q);
  try { localStorage.setItem('newswall', JSON.stringify(state.active)); } catch { /* private mode */ }
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

/* Reordering: drag the tile (or the grip, which also works over YouTube
   iframes, which would otherwise swallow the events). */
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
  orderTiles();
  saveWall();
});
grid.addEventListener('dragend', () => {
  state.drag = null;
  document.body.classList.remove('dragging');
  grid.querySelectorAll('.dragging, .drop-here').forEach((x) => x.classList.remove('dragging', 'drop-here'));
});

$('#panel-list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (row) toggleSource(row.dataset.id);
});
$('#panel-close').onclick = () => togglePanel(false);
$('#logo').onclick = () => togglePanel();

$('#controls').addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'palette') openPalette();
  if (act === 'sources') togglePanel();
  if (act === 'mute-all') setOnAir(null);
  if (act === 'fullscreen') toggleFullscreen();
  if (act === 'keys') toggleKeys();
});

$('#pal-q').oninput = () => { pal.sel = 0; palRender(); };
$('#pal-list').addEventListener('click', (e) => {
  const row = e.target.closest('.pal-row');
  if (row) toggleSource(row.dataset.id);
});
$('#pal-list').addEventListener('mousemove', (e) => {
  const row = e.target.closest('.pal-row');
  if (!row) return;
  const i = [...row.parentNode.children].indexOf(row);
  if (i !== pal.sel) palSelect(i);
});
$('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') openPalette(false); });
$('#keys').addEventListener('mousedown', (e) => { if (e.target.id === 'keys') toggleKeys(false); });
$('#keys-close').onclick = () => toggleKeys(false);

$('#share').onclick = async () => {
  saveWall();
  try {
    await navigator.clipboard.writeText(location.href);
    $('#share-msg').textContent = 'Link copied: it contains your sources.';
  } catch {
    $('#share-msg').textContent = 'Copy the URL from the browser bar.';
  }
  setTimeout(() => { $('#share-msg').textContent = ''; }, 3500);
};

$('#gate-go').onclick = () => {
  state.started = true;
  const gate = $('#gate');
  gate.classList.add('leaving');
  setTimeout(() => { gate.hidden = true; gate.classList.remove('leaving'); }, 420);
  startAll();
  toast('Wall on. Click a tile to give it the audio.');
};

addEventListener('keydown', (e) => {
  const typing = !!e.target.closest?.('input, textarea, select');

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(true); }

  if (pal.open) {
    if (e.key === 'ArrowDown') { e.preventDefault(); return palMove(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); return palMove(-1); }
    if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      const s = pal.list[pal.sel];
      return s && toggleSource(s.id);
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
    if (state.focused) return setFocus(state.focused);
    return togglePanel(false);
  }
  if (e.key === '/') { e.preventDefault(); return openPalette(true); }
  if (e.key === '?') { e.preventDefault(); return toggleKeys(); }
  if (k === 's') { e.preventDefault(); return togglePanel(); }
  if (k === 'm') { e.preventDefault(); return setOnAir(null); }
  if (k === 'f') { e.preventDefault(); return toggleFullscreen(); }
});

addEventListener('resize', layout);

function togglePanel(force) {
  const p = $('#panel');
  p.hidden = force === undefined ? !p.hidden : !force;
  $('[data-act="sources"]').classList.toggle('on', !p.hidden);
  if (!p.hidden) $('#panel-search').focus();
}

function toggleKeys(force) {
  const k = $('#keys');
  k.hidden = force === undefined ? !k.hidden : !force;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

/* A short message that then fades: it does not steal space from the video. */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2400);
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

boot();
