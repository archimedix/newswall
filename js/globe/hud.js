/* The HTML over the globe: bar, channel card, favourites, on-air chip, toasts.
   Frosted glass only on surfaces seen one at a time, as on the wall. */

import { MODES, catalog, countryName, escapeHtml, flag, langName, originText } from '../core/data.js';

export const $ = (sel) => document.querySelector(sel);

/* The loading screen: the ring fills with the ground's bytes, the log ticks
   off what is ready. done() lets the globe show through as the flight starts. */
export function boot(groundSize) {
  const root = $('#boot');
  const ring = root.querySelector('.boot-ring .arc');
  const line = (k) => root.querySelector(`[data-k="${k}"]`);
  line('ground').querySelector('b').textContent = groundSize;
  const set = (f) => { ring.style.strokeDashoffset = String(1 - f); };
  set(0);
  return {
    bytes(done, total) {
      set(done / total);
      line('ground').querySelector('i').textContent = `${(done / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`;
    },
    step(k, text) {
      const li = line(k);
      li.classList.add('ok');
      if (text) li.querySelector('i').textContent = text;
      if (k === 'ground') set(1);
    },
    done() {
      set(1);
      root.classList.add('out');
      setTimeout(() => root.remove(), 900);
      return new Promise((ok) => setTimeout(ok, 120));
    },
    fail(err) {
      root.classList.add('failed');
      root.querySelector('.boot-note').textContent = `Could not load the globe: ${err.message || err}. Reload to try again.`;
    },
  };
}

export function renderModes(current, count) {
  $('#modes').innerHTML = Object.entries(MODES).map(([m, { label }], i) =>
    `<button data-mode="${m}" class="${m === current ? 'on' : ''}"
       title="${label} · ${count(m)} channels on the globe (${i + 1})">${label}</button>`).join('');
}

/* The selected channel, or — compact, without actions — the one in the crosshair. */
let shown = null;
export function renderCard(s, { target = false, onAir = false, isFav = false, pile = null, logo = null } = {}) {
  const card = $('#card');
  card.hidden = !s;
  $('#reticle').classList.toggle('lock', !!s && target);
  if (!s) { shown = null; return; }
  const key = `${pile ? `pile:${pile.country}` : s.id}:${target}`;
  if (shown !== key) {
    // A new channel, or the same one selected: replay the entrance, so the change is felt.
    card.classList.remove('swap');
    void card.offsetWidth;
    card.classList.add('swap');
    shown = key;
  }
  card.querySelector('.chint').innerHTML = pile
    ? '<kbd>↵</kbd> come closer · <kbd>Tab</kbd> next'
    : '<kbd>↵</kbd> select · <kbd>Tab</kbd> next';
  if (pile) return renderPile(card, pile);
  const src = s.src;
  const stream = src.streams[s.stream ?? 0];
  card.classList.toggle('target', target);
  card.classList.toggle('air', onAir && !target);

  // Selected, with a logo: the broadcaster's logo on its plate, the flag moves next to the country.
  const plate = card.querySelector('.clogo');
  const withLogo = !target && !!logo;
  plate.hidden = !withLogo;
  card.querySelector('.cflag').hidden = withLogo;
  if (withLogo) {
    const img = plate.querySelector('img');
    if (img.getAttribute('src') !== `assets/logos/${logo}`) img.src = `assets/logos/${logo}`;
    plate.classList.toggle('dark', !!s.logoLight);
  }
  card.querySelector('.cflag').textContent = flag(src.country);
  card.querySelector('.cname').textContent = src.name;
  card.querySelector('.cplace').textContent = target
    ? `${countryName(src.country)} · ${langName(src.lang)}`
    : `${withLogo ? `${flag(src.country)} ` : ''}${countryName(src.country)}`;
  const state = card.querySelector('.cstate');
  state.className = `cstate ${onAir ? 'air' : s.live ? 'live' : ''}`;
  state.querySelector('b').textContent = onAir ? 'on air' : s.dead ? 'off air' : s.live ? 'live' : 'still';
  if (!target) renderFacts(card, s, src, stream);
  card.querySelector('[data-op="audio"]').classList.toggle('on', onAir);
  const fav = card.querySelector('[data-op="fav"]');
  fav.classList.toggle('in', isFav);
  fav.setAttribute('aria-pressed', isFav);
  fav.title = isFav ? 'Favourite, on the wall: remove (B)' : 'Favourite: add to the wall (B)';
}

/* What the catalog and the last check know: language (also in itself), the
   time where it is broadcast, the picture's best height, where the stream
   comes from, and the walls it belongs to. */
function renderFacts(card, s, src, stream) {
  const fact = (cls, text, title = text) => {
    const dd = card.querySelector(cls);
    dd.textContent = text;
    dd.title = title;
    dd.parentElement.hidden = !text;
    return dd;
  };
  const own = nativeLang(src.lang);
  const lang = langName(src.lang);
  fact('.f-lang', own && own.toLowerCase() !== lang.toLowerCase() ? `${lang} · ${own}` : lang);

  let time = '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: src.tz, hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' })
      .formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value || '';
    time = `${get('hour')}:${get('minute')} · ${get('timeZoneName').replace('GMT', 'UTC')}`;
  } catch { /* unknown zone */ }
  fact('.f-time', time);

  const heights = catalog.live[src.id]?.streams?.[s.stream ?? 0]?.heights || [];
  const n = src.streams.length;
  const best = heights.length ? `up to ${Math.max(...heights)}p` : '';
  fact('.f-pic', [best, n > 1 ? `${n} streams` : ''].filter(Boolean).join(' · '));

  fact('.f-origin', originText(stream)).className = `f-origin ${stream.origin?.kind || ''}`;
  fact('.f-walls', (src.categories || ['news']).map((c) => MODES[c]?.label).filter(Boolean).join(' · '));
}

const nativeLang = (l) => {
  try { return new Intl.DisplayNames([l], { type: 'language' }).of(l); } catch { return ''; }
};

/* A folded pile in the crosshair: the country and how many channels it holds. */
function renderPile(card, pile) {
  card.classList.add('target');
  card.classList.remove('air');
  card.querySelector('.clogo').hidden = true;
  card.querySelector('.cflag').hidden = false;
  card.querySelector('.cflag').textContent = flag(pile.country);
  card.querySelector('.cname').textContent = countryName(pile.country);
  const langs = [...new Set(pile.members.map((m) => langName(m.src.lang)))];
  card.querySelector('.cplace').textContent = `${pile.members.length} channels · ${langs.join(', ')}`;
  const state = card.querySelector('.cstate');
  state.className = 'cstate pile';
  state.querySelector('b').textContent = `×${pile.members.length}`;
}

/* Where the camera looks from, how high, and where the sun is overhead. */
export const latLon = (lat, lon) =>
  `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

export function renderTelemetry(view, sun, live, total) {
  const lon = ((view.lon % 360) + 540) % 360 - 180;
  $('#t-view').textContent = latLon(view.lat, lon);
  $('#t-alt').textContent = `${Math.round((view.dist - 1) * 6371).toLocaleString('en-GB')} km`;
  $('#t-sun').textContent = latLon(sun[0], sun[1]);
  $('#t-live').textContent = `${live} / ${total}`;
}

export function renderFavs(sources, wall, bump = false) {
  $('#favs-n').textContent = sources.length;
  const btn = $('#favs-btn');
  btn.classList.toggle('has', sources.length > 0);
  if (bump) {
    btn.classList.remove('bump');
    void btn.offsetWidth;
    btn.classList.add('bump');
  }
  $('#favs-count').textContent = `the ${wall} wall · ${sources.length}/12`;
  $('#favs-list').innerHTML = sources.length
    ? sources.map((s) => `<li data-id="${s.id}" title="Off the wall"><span>${flag(s.country)}</span>
        <span>${escapeHtml(s.name)}</span><span class="x">✕</span></li>`).join('')
    : '<li class="empty">Select a screen and press ★ (or B): it goes on the wall too.</li>';
}

export function renderOnAir(src) {
  const box = $('#onair');
  box.hidden = !src;
  if (src) box.querySelector('.who').textContent = src.name;
}

export function tickUtc() {
  $('#utc').textContent = `${new Date().toISOString().slice(11, 16)} UTC`;
}

export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2400);
}

export function toggle(sel, force) {
  const el = $(sel);
  el.hidden = force === undefined ? !el.hidden : !force;
  return !el.hidden;
}
