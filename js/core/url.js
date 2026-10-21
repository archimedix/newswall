/* The configuration lives in the URL (so a wall can be shared with a link)
   and in localStorage for convenience. #c=news,sports&s=a,b,c — "c" is the
   category filter, no "c" means every channel; the old one-mode links
   (#c=sports) still work, as a filter of one. */

import { CATEGORIES } from './data.js';

const hash = () => new URLSearchParams(location.hash.slice(1));

export function readWallFromUrl() {
  const m = hash().get('s');
  return m ? m.split(',').filter(Boolean) : null;
}

/* One wall, under the historic key. Its channels are also the globe's
   favourites (★): both views read and write this key, and hear each other
   through the `storage` event. */
export const WALL_KEY = 'newswall';

export function readWallFromStorage() {
  try { return JSON.parse(localStorage.getItem(WALL_KEY) || 'null'); } catch { return null; }
}

/* The wall into the browser only: the globe keeps its own URL. */
export function storeWall(ids) {
  try { localStorage.setItem(WALL_KEY, JSON.stringify(ids)); } catch { /* private mode */ }
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
export function viewHash(filter, ids) {
  const q = new URLSearchParams();
  if (filter.length) q.set('c', filter.join(','));
  if (ids) q.set('s', ids.join(','));
  const s = q.toString().replace(/%2C/g, ',');
  return s ? '#' + s : '';
}

export function saveWall(ids, filter) {
  history.replaceState(null, '', location.pathname + (viewHash(filter, ids) || '#'));
  storeWall(ids);
  storeFilter(filter);
}
