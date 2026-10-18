/* What the wall modules share: the state of the wall and a few DOM helpers. */

export const DEFAULT_TILES = 6;
export const LOW_QUALITY_CAP = 480;   // max height for tiles that are not enlarged
export const MAX_TILES = 12;

export const state = {
  mode: 'news',
  sources: [],          // the catalog of the current mode
  active: [],           // ids on the wall, in order
  players: new Map(),   // id -> { kind, el, player }
  audioOn: null,        // one audio at a time: house rule
  focused: null,
  started: false,
  drag: null,           // id of the tile being dragged
};

export const $ = (sel) => document.querySelector(sel);
export const grid = $('#grid');
export const tileEl = (id) => [...grid.children].find((t) => t.dataset.id === id);

/* A short message that then fades: it does not steal space from the video. */
export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2400);
}
