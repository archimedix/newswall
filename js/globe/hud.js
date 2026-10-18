/* The HTML over the globe: bar, channel card, basket, on-air chip, toasts.
   Frosted glass only on surfaces seen one at a time, as on the wall. */

import { MODES, countryName, escapeHtml, flag, langName, originText } from '../core/data.js';

export const $ = (sel) => document.querySelector(sel);

export function renderModes(current, count) {
  $('#modes').innerHTML = Object.entries(MODES).map(([m, { label }], i) =>
    `<button data-mode="${m}" class="${m === current ? 'on' : ''}"
       title="${label} · ${count(m)} channels on the globe (${i + 1})">${label}</button>`).join('');
}

/* The selected channel, or — compact, without actions — the one in the crosshair. */
let shown = null;
export function renderCard(s, { target = false, onAir = false, inBasket = false } = {}) {
  const card = $('#card');
  card.hidden = !s;
  $('#reticle').classList.toggle('lock', !!s && target);
  if (!s) { shown = null; return; }
  if (shown !== s.id) {
    // A new channel: replay the small entrance, so the change is felt.
    card.classList.remove('swap');
    void card.offsetWidth;
    card.classList.add('swap');
    shown = s.id;
  }
  const src = s.src;
  const stream = src.streams[s.stream ?? 0];
  card.classList.toggle('target', target);
  card.querySelector('.cflag').textContent = flag(src.country);
  card.querySelector('.cname').textContent = src.name;
  card.querySelector('.cplace').textContent = `${countryName(src.country)} · ${langName(src.lang)}`;
  const state = card.querySelector('.cstate');
  state.className = `cstate ${onAir ? 'air' : s.live ? 'live' : ''}`;
  state.querySelector('b').textContent = onAir ? 'on air' : s.dead ? 'off air' : s.live ? 'live' : 'still';
  let time = '';
  try { time = new Date().toLocaleTimeString('en-GB', { timeZone: src.tz || 'UTC', hour: '2-digit', minute: '2-digit' }); } catch { /* unknown zone */ }
  card.querySelector('.ctime').textContent = `${time} local`;
  const origin = card.querySelector('.corigin');
  origin.textContent = originText(stream);
  origin.title = originText(stream);
  origin.className = `chip corigin ${stream.origin?.kind || ''}`;
  card.querySelector('[data-op="audio"]').classList.toggle('on', onAir);
  const b = card.querySelector('[data-op="basket"]');
  b.classList.toggle('in', inBasket);
  b.querySelector('span').textContent = inBasket ? '✓ Basket' : '+ Basket';
}

/* Where the camera looks from, how high, and where the sun is overhead. */
export function renderTelemetry(view, sun, live, total) {
  const ll = (lat, lon) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  const lon = ((view.lon % 360) + 540) % 360 - 180;
  $('#t-view').textContent = ll(view.lat, lon);
  $('#t-alt').textContent = `${Math.round((view.dist - 1) * 6371).toLocaleString('en-GB')} km`;
  $('#t-sun').textContent = ll(sun[0], sun[1]);
  $('#t-live').textContent = `${live} / ${total}`;
}

export function renderBasket(sources, max, bump = false) {
  $('#basket-n').textContent = `${sources.length}/${max}`;
  if (bump) {
    const btn = $('#basket-btn');
    btn.classList.remove('bump');
    void btn.offsetWidth;
    btn.classList.add('bump');
  }
  $('#basket-btn').classList.toggle('full', sources.length >= max);
  $('#basket-count').textContent = `${sources.length}/${max}`;
  $('#basket-list').innerHTML = sources.length
    ? sources.map((s) => `<li data-id="${s.id}" title="Remove"><span>${flag(s.country)}</span>
        <span>${escapeHtml(s.name)}</span><span class="x">✕</span></li>`).join('')
    : '<li class="empty">Select a screen and press B (or + Basket) to collect channels for the wall.</li>';
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
