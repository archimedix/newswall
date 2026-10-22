/* The walls: several named lists of channels, kept in this browser only (no
   account, no server). One of them is active: it is what the wall shows and
   what the globe's stars (★) add to. Both views read and write this key and
   hear each other through the `storage` event.

   { active: 'k3x9q2', walls: [{ id, name, ids }] } — always at least one wall. */

import { wallFor } from './data.js';

export const WALLS_KEY = 'newswall:walls';
const OLD_KEY = 'newswall';      // the one wall there was before: an array of ids
export const FIRST_NAME = 'My wall';

const newId = () => Math.random().toString(36).slice(2, 8);
let memory = null;               // when localStorage refuses: the walls live as long as the page

function store(book) {
  memory = book;
  try { localStorage.setItem(WALLS_KEY, JSON.stringify({ active: book.active, walls: book.walls })); } catch { /* private mode */ }
}

function parse() {
  try { return JSON.parse(localStorage.getItem(WALLS_KEY) || 'null'); } catch { return memory; }
}

/* The walls as stored, each one's ids checked against the catalog. The first
   time, the single wall of before becomes the first one (or the default
   wall, `fresh`: a shared link may then take its place). */
export function loadWalls() {
  const raw = parse();
  if (raw?.walls?.length) {
    const walls = raw.walls.map((w) => ({ id: String(w.id), name: cleanName(w.name), ids: wallFor(w.ids || []) }));
    const active = walls.some((w) => w.id === raw.active) ? raw.active : walls[0].id;
    return { active, walls };
  }
  let old = null;
  try { old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null'); } catch { /* none */ }
  const first = { id: newId(), name: FIRST_NAME, ids: wallFor(Array.isArray(old) ? old : null) };
  const book = { active: first.id, walls: [first] };
  store(book);
  return { ...book, fresh: !Array.isArray(old) };
}

export const activeWall = (book) => book.walls.find((w) => w.id === book.active) || book.walls[0];
export const wallById = (book, id) => book.walls.find((w) => w.id === id);

export const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40) || FIRST_NAME;

/* A wall with these very channels, in this order: the active one first, then
   one with the same name. How a link finds the wall it came from. */
export function findWall(book, ids, name) {
  const same = book.walls.filter((w) => w.ids.join() === ids.join());
  return same.find((w) => w.id === book.active) || same.find((w) => w.name === name) || same[0] || null;
}

/* Every change goes through here: read, change, write. Another tab may have
   written since this one last read. */
function change(fn) {
  const book = loadWalls();
  const out = fn(book);
  store(book);
  return out;
}

export const setActive = (id) => change((b) => { if (wallById(b, id)) b.active = id; return activeWall(b); });

export const setWallIds = (id, ids) => change((b) => { const w = wallById(b, id); if (w) w.ids = [...ids]; });

export const renameWall = (id, name) => change((b) => {
  const w = wallById(b, id);
  if (w) w.name = cleanName(name);
  return w;
});

/* A new wall, made active. `replace`: it takes the place of this wall (the
   default one, never touched, that a shared link replaces on a first visit). */
export const addWall = (name, ids, replace = null) => change((b) => {
  const w = { id: newId(), name: cleanName(name), ids: [...ids] };
  const i = b.walls.findIndex((x) => x.id === replace);
  if (i >= 0) b.walls[i] = w; else b.walls.push(w);
  b.active = w.id;
  return w;
});

/* Removes a wall, never the last one; the next one becomes active. */
export const removeWall = (id) => change((b) => {
  const i = b.walls.findIndex((w) => w.id === id);
  if (i < 0 || b.walls.length < 2) return activeWall(b);
  b.walls.splice(i, 1);
  if (b.active === id) b.active = b.walls[Math.min(i, b.walls.length - 1)].id;
  return activeWall(b);
});

/* A name not taken yet: "Wall 2", "Wall 3"… or "Europe (copy)". */
export function freeName(book, base) {
  const taken = new Set(book.walls.map((w) => w.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}
