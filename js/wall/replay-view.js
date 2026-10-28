/* The replay viewer: what Replay keeps, in a player, before saving it. Marks
   in and out keep only the moment that matters. While it is open the live
   sound is hushed (one audio at a time, here too) and the wall keeps
   buffering behind it; the buffer stops dropping its oldest minutes until it
   closes, so the marks stay inside it. */

import { programHush } from './program.js';
import { $, toast } from './state.js';

const view = $('#rview'), video = $('#rv-video'), track = $('#rv-track');
const playBtn = $('#rv-play');

let s = null;   // { replay, clip, url, release, save, t0 (ms, wall clock of 0), a, b (s) }
let raf = 0;

/* `save(secs, until)` is the menu's: dialog, export, write; true once written. */
export async function openViewer(replay, save) {
  if (s || !replay) return;
  const release = replay.hold();
  const until = replay.mark();
  let clip = null;
  try { clip = await replay.export(Infinity, until); } catch (e) { console.error('replay', e); }
  if (!clip) { release(); return toast('Nothing to watch yet'); }
  s = {
    replay, clip, release, save,
    url: URL.createObjectURL(clip.blob),
    t0: Date.now() - (replay.mark() - clip.start) / 1000,
    a: 0, b: clip.seconds,
  };
  programHush(true);
  view.hidden = false;
  video.src = s.url;
  video.addEventListener('loadedmetadata', () => {
    if (!s) return;
    if (Number.isFinite(video.duration)) s.b = video.duration;
    video.currentTime = Math.max(0, s.b - 30);   // what just happened, first
    video.play().catch(() => {});
  }, { once: true });
  raf = requestAnimationFrame(tick);
}

export function closeViewer() {
  if (!s) return;
  cancelAnimationFrame(raf);
  video.pause();
  video.removeAttribute('src');
  video.load();
  URL.revokeObjectURL(s.url);
  s.release();
  s = null;
  view.hidden = true;
  programHush(false);
}

const dur = () => (Number.isFinite(video.duration) ? video.duration : s.clip.seconds);
const clock = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
const at = (x) => new Date(s.t0 + x * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function tick() {
  if (!s) return;
  // Playing stops at the out mark, like an editor.
  if (!video.paused && video.currentTime >= s.b) {
    video.pause();
    video.currentTime = s.b;
  }
  paint();
  raf = requestAnimationFrame(tick);
}

function paint() {
  const d = dur() || 1;
  track.style.setProperty('--a', s.a / d);
  track.style.setProperty('--b', s.b / d);
  track.style.setProperty('--t', Math.min(1, video.currentTime / d));
  $('#rv-now').textContent = at(video.currentTime);
  $('#rv-sel').textContent = `${clock(s.b - s.a)} · ${at(s.a)} – ${at(s.b)}`;
  playBtn.textContent = video.paused ? '▶' : '❚❚';
  playBtn.title = video.paused ? 'Play (Space)' : 'Pause (Space)';
}

function play() {
  if (!video.paused) return video.pause();
  if (video.currentTime >= s.b - 0.05 || video.currentTime < s.a) video.currentTime = s.a;
  video.play().catch(() => {});
}

function seek(x) {
  video.currentTime = Math.max(0, Math.min(dur(), x));
}

function mark(which) {
  const t = video.currentTime;
  if (which === 'a') s.a = Math.min(t, s.b - 1);
  else s.b = Math.max(t, s.a + 1);
}

/* The start snaps to the keyframe just before the in mark (at most 2 s earlier). */
async function save() {
  if (!s || s.saving) return;
  s.saving = true;
  video.pause();
  const ok = await s.save(s.b - s.a, s.clip.start + s.b * 1e6);
  if (!s) return;
  s.saving = false;
  if (ok) closeViewer();
}

// ---- the track: drag to seek, drag a handle to move its mark
track.addEventListener('pointerdown', (e) => {
  if (!s) return;
  const handle = e.target.closest('.rv-in, .rv-out');
  const which = handle ? (handle.classList.contains('rv-in') ? 'a' : 'b') : null;
  const timeAt = (ev) => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * dur();
  };
  const move = (ev) => {
    const t = timeAt(ev);
    if (which === 'a') s.a = Math.max(0, Math.min(t, s.b - 1));
    else if (which === 'b') s.b = Math.min(dur(), Math.max(t, s.a + 1));
    seek(t);
  };
  track.setPointerCapture(e.pointerId);
  move(e);
  track.onpointermove = move;
  track.onpointerup = track.onpointercancel = () => { track.onpointermove = null; };
});

view.addEventListener('click', (e) => {
  if (!s) return;
  if (e.target === view || e.target.closest('#rv-close')) return closeViewer();
  if (e.target === video || e.target.closest('#rv-play')) return play();
  const op = e.target.closest('[data-vop]')?.dataset.vop;
  if (op === 'in') mark('a');
  if (op === 'out') mark('b');
  if (op === 'save') save();
});

/* While it is open, the wall's keys are its keys. Capture phase: the wall's
   own handler never sees them. */
addEventListener('keydown', (e) => {
  if (!s) return;
  e.stopImmediatePropagation();
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') closeViewer();
  else if (e.key === ' ' || k === 'k') play();
  else if (k === 'i') mark('a');
  else if (k === 'o') mark('b');
  else if (e.key === 'ArrowLeft') seek(video.currentTime - (e.shiftKey ? 1 : 5));
  else if (e.key === 'ArrowRight') seek(video.currentTime + (e.shiftKey ? 1 : 5));
  else if (e.key === 'Enter') save();
  else return;
  e.preventDefault();
}, true);
