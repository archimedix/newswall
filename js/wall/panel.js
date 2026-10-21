/* The catalog panel and the quick search: the two ways to add or remove a channel. */

import {
  byId, catalog, countryName, escapeHtml, firstStream, flag, inCategory, isPlayable, langName, originText,
} from '../core/data.js';
import { mountFilter } from '../core/filter.js';
import { saveWall } from '../core/url.js';
import { $, MAX_TILES, state } from './state.js';

/* Adding or removing a channel, and changing the category filter, belong to
   the wall: it hands its functions here. */
let toggleSource = () => {};
let renderCats = () => {};
export function initPanel(toggle, setFilter) {
  toggleSource = toggle;
  renderCats = mountFilter($('#panel-cats'), setFilter);
}

/* ---------------------------------------------------------------- panel */

/* The narrower filters inside the categories: they survive a change of
   category as long as what they point at is still there. */
const filters = { tag: '', country: '', lang: '', q: '' };
const STAR = 'M8 1.7l1.93 3.98 4.37.6-3.18 3.05.78 4.35L8 11.6l-3.9 2.08.78-4.35L1.7 6.28l4.37-.6z';

function buildCountrySelect() {
  const counts = {};
  for (const s of state.sources) counts[s.country] = (counts[s.country] || 0) + 1;
  const list = Object.keys(counts).sort((a, b) =>
    countryName(a).localeCompare(countryName(b), 'en'));
  $('#panel-country').innerHTML =
    `<option value="">🌍 All (${list.length})</option>` +
    list.map((c) => `<option value="${c}">${flag(c)} ${escapeHtml(countryName(c))} · ${counts[c]}</option>`).join('');
}

function buildLangSelect() {
  const counts = {};
  for (const s of state.sources) counts[s.lang] = (counts[s.lang] || 0) + 1;
  const list = Object.keys(counts).sort((a, b) =>
    langName(a).localeCompare(langName(b), 'en'));
  $('#panel-lang').innerHTML =
    `<option value="">💬 All languages (${list.length})</option>` +
    list.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(langName(l))} · ${counts[l]}</option>`).join('');
}

export function buildPanel() {
  renderCats(state.filter, (c) => (c ? catalog.all.filter((s) => inCategory(s, c)).length : catalog.all.length));

  const tags = [...new Set(state.sources.flatMap((s) => s.tags || []))].sort();
  if (!tags.includes(filters.tag)) filters.tag = '';
  $('#panel-filters').innerHTML =
    `<button data-tag="" class="${filters.tag ? '' : 'on'}">everywhere</button>` +
    tags.map((t) => `<button data-tag="${t}" class="${t === filters.tag ? 'on' : ''}">${t}</button>`).join('');

  $('#panel-filters').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('#panel-filters').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    filters.tag = b.dataset.tag;
    listSources();
  };

  buildCountrySelect();
  buildLangSelect();
  // Keep the country and language picked, if this catalog still has them.
  for (const [k, sel] of [['country', '#panel-country'], ['lang', '#panel-lang']]) {
    const el = $(sel);
    el.value = filters[k];
    if (el.value !== filters[k]) filters[k] = el.value = '';
  }
  $('#panel-country').onchange = (e) => { filters.country = e.target.value; listSources(); };
  $('#panel-lang').onchange = (e) => { filters.lang = e.target.value; listSources(); };
  $('#panel-search').oninput = (e) => { filters.q = e.target.value.trim().toLowerCase(); listSources(); };

  listSources();
}

export function listSources() {
  const { tag, country, lang, q } = filters;
  const list = state.sources.filter((s) => {
    if (tag && !(s.tags || []).includes(tag)) return false;
    if (country && s.country !== country) return false;
    if (lang && s.lang !== lang) return false;
    if (!q) return true;
    // Search also matches the full country and language names: "germany" finds
    // DW, "arabic" finds every channel in Arabic.
    const hay = `${s.name} ${s.country} ${countryName(s.country)} ${s.lang} ${langName(s.lang)} ${(s.tags || []).join(' ')}`;
    return hay.toLowerCase().includes(q);
  });

  // On the wall = a favourite (★) on the globe: the same list.
  const row = (s) => {
    const on = state.active.includes(s.id);
    const dead = !isPlayable(s.id);
    const stream = s.streams[firstStream(s)] || s.streams[0];
    const alt = s.streams.length > 1 ? ` · ${s.streams.length} sources` : '';
    return `<div class="row ${on ? 'on' : ''} ${dead ? 'off-air' : ''}" data-id="${s.id}"
                 title="${on ? 'Remove from the wall (and the globe\'s favourites)' : 'Add to the wall (★ on the globe too)'}">
      <span class="tick"><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path class="star" d="${STAR}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></span>
      <span class="rflag" title="${escapeHtml(countryName(s.country))}">${flag(s.country)}</span>
      <span class="rtext">
        <span class="rname">${escapeHtml(s.name)}</span>
        <span class="rorigin ${stream.origin?.kind || ''}">${escapeHtml(originText(stream))}${alt}</span>
      </span>
      <span class="rmeta">${dead ? 'off air' : `${escapeHtml(countryName(s.country))} · ${escapeHtml(langName(s.lang))}`}</span>
    </div>`;
  };
  $('#panel-list').innerHTML = list.length ? list.map(row).join('')
    : `<div class="empty">No channels match these filters.</div>`;

  const shown = list.length, tot = state.sources.length;
  $('#panel-count').textContent = shown === tot
    ? `${state.active.length}/${MAX_TILES} on the wall`
    : `${shown} of ${tot} · ${state.active.length}/${MAX_TILES} on the wall`;
}

export function togglePanel(force) {
  const p = $('#panel');
  p.hidden = force === undefined ? !p.hidden : !force;
  $('[data-act="sources"]').classList.toggle('on', !p.hidden);
  if (!p.hidden) $('#panel-search').focus();
}

$('#panel-list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (row) toggleSource(row.dataset.id);
});
$('#panel-close').onclick = () => togglePanel(false);

$('#share').onclick = async () => {
  saveWall(state.active, state.filter);
  try {
    await navigator.clipboard.writeText(location.href);
    $('#share-msg').textContent = 'Link copied: it contains your sources.';
  } catch {
    $('#share-msg').textContent = 'Copy the URL from the browser bar.';
  }
  setTimeout(() => { $('#share-msg').textContent = ''; }, 3500);
};

/* --------------------------------------------------------- quick search */

export const pal = { open: false, sel: 0, list: [] };

export function openPalette(v) {
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
  if (t.length > 2 && langName(s.lang).toLowerCase().startsWith(t)) return 45;
  if ((s.tags || []).some((x) => x.includes(t))) return 35;
  return 0;
}

export function palRender() {
  const t = $('#pal-q').value.trim().toLowerCase();
  let list;
  if (!t) {
    // Empty query: what is already on the wall comes first, so removing is
    // instant; then the catalog the filter shows.
    const inWall = state.active.map(byId).filter(Boolean);
    const rest = state.sources.filter((s) => !state.active.includes(s.id));
    list = [...inWall, ...rest];
  } else {
    // A name typed is a channel wanted: the search looks past the filter.
    list = catalog.all
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
        <span class="psub">${escapeHtml(countryName(s.country))} · ${escapeHtml(langName(s.lang))} · ${escapeHtml(originText(stream))}</span>
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

export function palMove(d) {
  if (!pal.list.length) return;
  palSelect(pal.sel + d);
  $('#pal-list').children[pal.sel]?.scrollIntoView({ block: 'nearest' });
}

/* Enter in the quick search: add or remove the highlighted channel. */
export function palPick() {
  const s = pal.list[pal.sel];
  if (s) toggleSource(s.id);
}

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
