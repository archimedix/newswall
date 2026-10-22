/* Your walls: the button in the bar says which one is on screen, its menu
   switches, names, adds and removes them (kept in core/walls.js). */

import { escapeHtml } from '../core/data.js';
import {
  addWall, cleanName, freeName, loadWalls, removeWall, renameWall, setActive,
} from '../core/walls.js';
import { openPalette } from './panel.js';
import { $, copyLink, MAX_TILES, state, toast } from './state.js';

/* Putting a wall on screen, keeping a shared one and saving belong to the
   wall: it hands its functions here. */
let show = () => {}, adopt = () => {}, save = () => {};
export function initPicker(fns) { ({ show, adopt, save } = fns); }

export function renderPicker() {
  const book = loadWalls();
  const shared = !state.wall.id;
  $('#walls-btn .wname').textContent = state.wall.name;
  $('#walls-btn').classList.toggle('shared', shared);
  $('#wall-save').hidden = !shared;

  const name = $('#wall-name');
  if (document.activeElement !== name) name.value = state.wall.name;
  $('#wall-n').textContent = `${state.active.length}/${MAX_TILES}`;
  $('#walls .walls-shared').hidden = !shared;
  $('#walls-list').innerHTML = book.walls.map((w) => `
    <li data-id="${escapeHtml(w.id)}" class="${w.id === state.wall.id ? 'on' : ''}">
      <span class="lamp"></span><span class="wn">${escapeHtml(w.name)}</span>
      <span class="meta">${w.ids.length}</span>
    </li>`).join('');
  $('[data-wop="dup"]').hidden = shared;
  $('[data-wop="del"]').hidden = shared || book.walls.length < 2;
  disarm();
}

export function togglePicker(force) {
  const menu = $('#walls');
  menu.hidden = force === undefined ? !menu.hidden : !force;
  $('#walls-btn').setAttribute('aria-expanded', !menu.hidden);
  $('#walls-btn').classList.toggle('on', !menu.hidden);
  if (menu.hidden) return;
  const r = $('#walls-btn').getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  renderPicker();
}

/* Deleting asks twice: the first click arms the button for a few seconds. */
let armed = 0;
function disarm() {
  clearTimeout(armed);
  armed = 0;
  const del = $('[data-wop="del"]');
  del.classList.remove('armed');
  del.textContent = 'Delete';
}

function pick(id) {
  if (id === state.wall.id) return togglePicker(false);
  show(setActive(id));
  togglePicker(false);
  toast(`“${state.wall.name}” on screen`);
}

$('#walls-btn').onclick = () => togglePicker();
$('#wall-save').onclick = () => adopt();

$('#walls-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) pick(li.dataset.id);
});

/* The name is saved when it is done: Enter or leaving the field. */
$('#wall-name').addEventListener('change', (e) => {
  if (state.wall.id) {
    state.wall.name = renameWall(state.wall.id, e.target.value).name;
  } else {
    state.wall.name = cleanName(e.target.value);
  }
  save();
  renderPicker();
});
$('#wall-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.target.blur();
  if (e.key === 'Escape') e.target.value = state.wall.name;
});

$('#walls .walls-foot').addEventListener('click', (e) => {
  const op = e.target.closest('[data-wop]')?.dataset.wop;
  if (!op) return;
  if (op === 'link') return copyLink();
  if (op === 'new') {
    show(addWall(freeName(loadWalls(), 'New wall'), []));
    togglePicker(false);
    toast(`“${state.wall.name}”: add its channels, and give it a name with W`);
    return openPalette(true);
  }
  if (op === 'dup') {
    show(addWall(freeName(loadWalls(), `${state.wall.name} (copy)`), state.active));
    return toast(`“${state.wall.name}” on screen: the same channels, a wall of its own`);
  }
  if (op === 'del') {
    const del = e.target.closest('button');
    if (!armed) {
      del.classList.add('armed');
      del.textContent = `Delete “${state.wall.name}”?`;
      armed = setTimeout(disarm, 3500);
      return;
    }
    const gone = state.wall.name;
    show(removeWall(state.wall.id));
    toast(`“${gone}” deleted · now “${state.wall.name}”`);
  }
});

addEventListener('mousedown', (e) => {
  if (!$('#walls').hidden && !e.target.closest('#walls, #walls-btn')) togglePicker(false);
});
