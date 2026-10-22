/* The configuration lives in the URL (so a wall can be shared with a link)
   and in localStorage for convenience. #c=news,sports&n=Europe&s=a,b,c —
   "c" is the category filter, no "c" means every channel; "n" the wall's
   name, "s" its channels (the walls themselves: core/walls.js). The old
   one-mode links (#c=sports) still work, as a filter of one. */

import { CATEGORIES } from './data.js';

const hash = () => new URLSearchParams(location.hash.slice(1));

/* The wall a link carries: its channels and, if it has one, its name. */
export function readLinkWall() {
  const h = hash();
  const m = h.get('s');
  return m ? { ids: m.split(',').filter(Boolean), name: h.get('n') || '' } : null;
}

/* The filter: the categories on screen, in CATEGORIES order, none = all.
   Shared like the wall: the same key for both views. */
export const FILTER_KEY = 'newswall:filter';

export function cleanFilter(list) {
  const keys = Object.keys(CATEGORIES);
  const ok = keys.filter((c) => (list || []).includes(c));
  return ok.length === keys.length ? [] : ok;     // all of them is no filter at all
}

export function readStoredFilter() {
  try { return cleanFilter(JSON.parse(localStorage.getItem(FILTER_KEY) || '[]')); } catch { return []; }
}

/* On load: a link's filter first, then the one last used. */
export function readFilter() {
  const c = hash().get('c');
  return c !== null ? cleanFilter(c.split(',')) : readStoredFilter();
}

export function storeFilter(list) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

/* The hash of a view: the filter, if any, and the wall, if given. */
export function viewHash(filter, ids, name) {
  const q = new URLSearchParams();
  if (filter.length) q.set('c', filter.join(','));
  if (ids && name) q.set('n', name);
  if (ids) q.set('s', ids.join(','));
  const s = q.toString().replace(/%2C/g, ',');
  return s ? '#' + s : '';
}

/* The wall's address bar: always the link to what is on screen. */
export function saveView(ids, filter, name) {
  history.replaceState(null, '', location.pathname + (viewHash(filter, ids, name) || '#'));
  storeFilter(filter);
}
