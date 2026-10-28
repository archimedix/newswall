/* Replay in the bar: the button that turns it on, the ring that fills up to
   the chosen length, and the menu that saves the last minutes. Off by
   default: it costs CPU and memory. The choice is remembered here. */

import { replaySupported } from '../core/replay.js';
import { startProgram } from './program.js';
import { closeViewer, openViewer } from './replay-view.js';
import { $, state, toast } from './state.js';

const KEY = 'newswall:replay';
const touch = matchMedia('(pointer: coarse)').matches;
const LENGTHS = touch ? [60, 120] : [120, 300, 600];   // phones: less memory
const CLIPS = [60, 120, 300];

let replay = null, starting = false, timer = 0;
let prefs = { on: false, seconds: touch ? 120 : 300 };

const btn = $('#replay-btn'), menu = $('#replay');

export async function initReplay() {
  if (!(await replaySupported())) return;   // no WebCodecs here: no button
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY)) || {}); } catch {}
  if (!LENGTHS.includes(prefs.seconds)) prefs.seconds = LENGTHS.at(-1);
  btn.hidden = false;
  if (prefs.on) start();
  render();
}

function store() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
}

async function start() {
  if (replay || starting) return;
  starting = true;
  try {
    replay = await startProgram({
      seconds: prefs.seconds,
      onError: (e) => {
        console.error('replay', e);
        stop();
        toast('Replay stopped: this browser could not keep encoding');
      },
    });
    prefs.on = true;
    store();
    timer = setInterval(render, 1000);
  } catch (e) {
    console.error('replay', e);
    toast('Replay could not start in this browser');
  } finally {
    starting = false;
    render();
  }
}

function stop() {
  closeViewer();
  replay?.destroy();
  replay = null;
  clearInterval(timer);
  prefs.on = false;
  store();
  toggleReplay(false);
  render();
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function render() {
  const len = replay?.length || 0;
  btn.classList.toggle('rec', !!replay);
  btn.style.setProperty('--p', replay ? Math.min(1, len / prefs.seconds) : 0);
  btn.querySelector('.rp-time').textContent = replay ? clock(Math.min(len, prefs.seconds)) : '';
  btn.title = replay
    ? `Replay: the last ${clock(Math.min(len, prefs.seconds))} are kept (R)`
    : 'Replay: keep the last minutes of the wall, to see them again and save them (R)';
  if (menu.hidden) return;

  $('#replay-kept').textContent = replay ? `${clock(Math.min(len, prefs.seconds))} kept of ${clock(prefs.seconds)}` : '';
  const clips = CLIPS.filter((c) => c < prefs.seconds);
  $('#replay-clips').innerHTML = clips.map((c) => `
    <button data-rop="save" data-s="${c}" ${len < c ? 'disabled' : ''}>Last ${c / 60} min</button>`).join('')
    + `<button data-rop="save" data-s="${prefs.seconds}" class="all">All · ${clock(Math.min(len, prefs.seconds))}</button>`;
  $('#replay-len').innerHTML = LENGTHS.map((s) => `
    <button data-rop="len" data-s="${s}" aria-pressed="${s === prefs.seconds}">${s / 60} min</button>`).join('');
}

export function toggleReplay(force) {
  const open = force === undefined ? menu.hidden : force;
  if (open && !replay) return start();   // the first press turns it on
  menu.hidden = !open;
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open);
  if (!open) return;
  const r = btn.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
  render();
}

/* Saves the `secs` seconds before now. The end is marked before the "Save as"
   dialog opens: the time spent choosing a folder is not in the clip. */
export function saveReplay(secs = prefs.seconds) {
  if (replay) return saveRange(secs, replay.mark());
}

/* Opens what is kept in the viewer, to watch it and trim it before saving. */
export function watchReplay() {
  if (!replay) return toast('Replay is off: R turns it on');
  toggleReplay(false);
  openViewer(replay, saveRange);
}

/* The `secs` seconds before `until` (program time): the "Save as" dialog on
   Chrome and Edge, a download elsewhere. Resolves true once saved. */
async function saveRange(secs, until) {
  if (!replay) return false;
  const name = fileName(new Date(Date.now() - (replay.mark() - until) / 1000));
  let handle = null;
  if (window.showSaveFilePicker) {
    try {
      handle = await showSaveFilePicker({
        suggestedName: name,
        startIn: 'downloads',
        types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
      });
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  toggleReplay(false);
  toast('Preparing the clip…');
  let clip;
  try {
    clip = await replay?.export(secs, until);
    if (clip && handle) {
      const out = await handle.createWritable();
      await out.write(clip.blob);
      await out.close();
    }
  } catch (e) {
    console.error('replay', e);
    toast('The clip could not be saved');
    return false;
  }
  if (!clip) { toast('Nothing to save yet'); return false; }
  if (!handle) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(clip.blob);
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);   // Firefox ignores a click on a detached link
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 600000);
  }
  // The "Save as" dialog shows no download bar: the name says where to look.
  toast(`Saved ${handle?.name || name} · ${clock(clip.seconds)} · ${(clip.blob.size / 1e6).toFixed(0)} MB`);
  return true;
}

/* newswall-<wall name>-2026-10-28-1432.mp4, local time of the clip's end. */
function fileName(d) {
  const p = (n) => String(n).padStart(2, '0');
  const slug = state.wall.name.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wall';
  return `newswall-${slug}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.mp4`;
}

btn.onclick = () => toggleReplay();

menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rop]');
  if (!b || b.disabled) return;
  const op = b.dataset.rop;
  if (op === 'save') return saveReplay(Number(b.dataset.s));
  if (op === 'watch') return watchReplay();
  if (op === 'off') return stop();
  if (op === 'len') {
    prefs.seconds = Number(b.dataset.s);
    if (replay) replay.seconds = prefs.seconds;
    store();
    render();
  }
});

addEventListener('mousedown', (e) => {
  if (!menu.hidden && !e.target.closest('#replay, #replay-btn')) toggleReplay(false);
});
