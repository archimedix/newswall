/* The category filter, the same keys in both views: a row of switcher keys,
   as on a vision mixer, each with its own lamp. None lit = every channel;
   lighting one shows only that category, more add up. */

import { CATEGORIES, escapeHtml } from './data.js';
import { cleanFilter } from './url.js';

/* What a press on key `c` makes of the filter ('' is "All"). */
export function toggleCategory(filter, c) {
  if (!c) return [];
  return cleanFilter(filter.includes(c) ? filter.filter((x) => x !== c) : [...filter, c]);
}

/* "All", or the lit categories by name. */
export const filterLabel = (filter) =>
  (filter.length ? filter.map((c) => CATEGORIES[c].label).join(' + ') : 'All');

/* Draws the keys into `el` and calls onChange(newFilter) on a press.
   render(filter, count) redraws them; count(c) is how many channels the key
   would show (count('') for all of them). */
export function mountFilter(el, onChange) {
  let current = [];
  el.classList.add('cats');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Categories');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cat]');
    if (b) onChange(toggleCategory(current, b.dataset.cat));
  });
  return function render(filter, count) {
    current = filter;
    const key = (c, label, on) => `<button data-cat="${c}" aria-pressed="${on}"
        title="${c ? (on ? `Hide ${label}` : `Show ${label}${filter.length ? ' too' : ' only'}`) : 'Every channel'}">
        <span class="cl">${escapeHtml(label)}</span><span class="cm"><span class="lamp"></span><span class="cn">${count(c)}</span></span></button>`;
    el.innerHTML = key('', 'All', !filter.length) + '<span class="cats-sep"></span>'
      + Object.entries(CATEGORIES).map(([c, { label }]) => key(c, label, filter.includes(c))).join('');
  };
}
