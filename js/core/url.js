/* The configuration lives in the URL (so a wall can be shared with a link)
   and in localStorage for convenience. #c=sports&s=a,b,c — no "c" means news,
   so the old links still work. */

const hash = () => new URLSearchParams(location.hash.slice(1));

export function readWallFromUrl() {
  const m = hash().get('s');
  return m ? m.split(',').filter(Boolean) : null;
}
export const readModeFromUrl = () => hash().get('c');

export function readModeFromStorage() {
  try { return localStorage.getItem('newswall:mode'); } catch { return null; }
}

/* Each mode remembers its own wall. The news one keeps the historic key. */
const storageKey = (mode) => (mode === 'news' ? 'newswall' : `newswall:${mode}`);

export function readWallFromStorage(mode) {
  try { return JSON.parse(localStorage.getItem(storageKey(mode)) || 'null'); } catch { return null; }
}

/* The hash of a wall: what saveWall writes, and what another page links to. */
export function wallHash(mode, ids) {
  const q = new URLSearchParams(mode === 'news' ? {} : { c: mode });
  q.set('s', ids.join(','));
  return '#' + q;
}

export function saveWall(mode, ids) {
  history.replaceState(null, '', wallHash(mode, ids));
  try {
    localStorage.setItem(storageKey(mode), JSON.stringify(ids));
    localStorage.setItem('newswall:mode', mode);
  } catch { /* private mode */ }
}

export function saveMode(mode) {
  try { localStorage.setItem('newswall:mode', mode); } catch { /* private mode */ }
}
