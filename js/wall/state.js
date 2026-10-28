/* What the wall modules share: the state of the wall and a few DOM helpers. */

import { MAX_WALL } from '../core/data.js';
import { toast } from '../core/toast.js';

export const LOW_QUALITY_CAP = 480;   // max height for tiles that are not enlarged
export const MAX_TILES = MAX_WALL;

export const state = {
  filter: [],           // categories on screen, none = all (core/filter.js)
  sources: [],          // the catalog that passes the filter
  wall: { id: null, name: '' },   // the wall on screen (core/walls.js); id null = a shared one, not saved here
  active: [],           // ids on the wall, in order
  players: new Map(),   // id -> createHlsPlayer() handle
  audioOn: null,        // one audio at a time: house rule
  focused: null,
  drag: null,           // id of the tile being dragged
};

export const $ = (sel) => document.querySelector(sel);
export const grid = $('#grid');
export const tileEl = (id) => [...grid.children].find((t) => t.dataset.id === id);

export { toast };

/* The address bar is always the link to the wall on screen: copying it is sharing it. */
export async function copyLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    toast(`Link to “${state.wall.name}” copied: whoever opens it sees this wall`);
  } catch {
    toast('Copy the address from the browser bar: it is the link to this wall');
  }
}
