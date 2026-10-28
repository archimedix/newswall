/* The wall's program feed, like the output of a control room: the grid as it
   is on screen, drawn into a 1920x1080 canvas, and the sound you hear. What
   you do on the wall is the directing: the channel on air, the enlarged tile,
   the order. The bar, panels and hover controls are never drawn.

   The sound: once Replay is on, every tile's video goes through one
   AudioContext into `bus`, and from there to the speakers and to the
   recorder. The videos stay muted and unmuted by setOnAir() as always: a
   muted element sends silence. A video, once wired, stays wired: the browser
   offers no way back. */

import { createReplay } from '../core/replay.js';
import { grid } from './state.js';

const W = 1920, H = 1080;
const canvas = document.createElement('canvas');
canvas.width = W;
canvas.height = H;
const g = canvas.getContext('2d', { alpha: false });

let ctx = null, bus = null;
const wired = new Map();   // <video> -> MediaElementAudioSourceNode

/* A tile got a new video: if the program is listening, its sound joins. */
export function programWire(video) {
  if (!ctx || wired.has(video)) return;
  try {
    const node = ctx.createMediaElementSource(video);
    node.connect(bus);
    wired.set(video, node);
  } catch {}
}

export function programUnwire(video) {
  wired.get(video)?.disconnect();
  wired.delete(video);
}

/* The context needs a gesture to run: the click that brings the audio is one. */
export function programResume() {
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
}

/* Starts the buffer; resolves to the replay handle (core/replay.js). */
export async function startProgram({ seconds, onError }) {
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: 48000 });
    bus = ctx.createGain();
    bus.connect(ctx.destination);
  }
  programResume();
  grid.querySelectorAll('.tile video').forEach(programWire);
  readTheme();
  return createReplay({ canvas, draw, context: ctx, input: bus, seconds, onError });
}

/* ------------------------------------------------------------- drawing */

let theme = {};
function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  theme = { tally: v('--tally'), warn: v('--warn'), ink: v('--ink'), sans: v('--sans'), mono: v('--mono') };
}

/* The grid as it is laid out now, letterboxed into 16:9. */
function draw() {
  g.fillStyle = theme.ink || '#05070a';
  g.fillRect(0, 0, W, H);
  const box = grid.getBoundingClientRect();
  if (box.width && box.height) {
    const s = Math.min(W / box.width, H / box.height);
    const ox = (W - box.width * s) / 2, oy = (H - box.height * s) / 2;
    for (const tile of grid.querySelectorAll('.tile')) {
      const r = tile.getBoundingClientRect();
      if (!r.width) continue;   // hidden while another tile is enlarged
      drawTile(tile, ox + (r.left - box.left) * s, oy + (r.top - box.top) * s, r.width * s, r.height * s, s);
    }
  }
  drawStamp();
}

function drawTile(tile, x, y, w, h, s) {
  const radius = 12 * s;
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, radius);
  g.clip();
  g.fillStyle = '#000';
  g.fillRect(x, y, w, h);

  const video = tile.querySelector('video');
  const live = video && video.readyState >= 2 && video.videoWidth && !tile.classList.contains('dead');
  if (live) {
    // object-fit: cover, as on screen
    const k = Math.max(w / video.videoWidth, h / video.videoHeight);
    const sw = w / k, sh = h / k;
    g.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, x, y, w, h);
  } else {
    const dead = tile.classList.contains('dead');
    const why = dead ? (tile.querySelector('.dead-msg .why')?.textContent || 'not available') : 'connecting…';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#e9eef4';
    g.font = `600 ${15 * s}px ${theme.sans}`;
    g.fillText(text(tile, '.name'), x + w / 2, y + h / 2 - 10 * s, w - 20 * s);
    g.fillStyle = dead ? theme.warn : '#8d98a5';
    g.font = `${11 * s}px ${theme.mono}`;
    g.fillText(why, x + w / 2, y + h / 2 + 12 * s, w - 20 * s);
  }

  drawLabel(tile, x, y, w, s);
  g.restore();

  // The tally: only the channel that talks.
  if (tile.classList.contains('audio-on')) {
    g.save();
    g.beginPath();
    g.roundRect(x + 1.5 * s, y + 1.5 * s, w - 3 * s, h - 3 * s, radius);
    g.lineWidth = 2 * s;
    g.strokeStyle = theme.tally;
    g.shadowColor = theme.tally;
    g.shadowBlur = 18 * s;
    g.stroke();
    g.restore();
  }
}

/* Flag, name and local clock, on the same dark veil as the tile's label. */
function drawLabel(tile, x, y, w, s) {
  const veil = g.createLinearGradient(0, y, 0, y + 44 * s);
  veil.addColorStop(0, 'rgba(0,0,0,.78)');
  veil.addColorStop(0.45, 'rgba(0,0,0,.35)');
  veil.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = veil;
  g.fillRect(x, y, w, 44 * s);

  const base = y + 17 * s;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.shadowColor = 'rgba(0,0,0,.9)';
  g.shadowBlur = 4 * s;
  g.font = `${15 * s}px ${theme.sans}`;
  const flag = text(tile, '.flag');
  g.fillText(flag, x + 11 * s, base);
  const nx = x + 11 * s + (flag ? g.measureText(flag).width + 8 * s : 0);

  g.textAlign = 'right';
  g.fillStyle = '#d3dde7';
  g.font = `${11 * s}px ${theme.mono}`;
  const clock = text(tile, '.clock');
  g.fillText(clock, x + w - 11 * s, base);
  const cw = clock ? g.measureText(clock).width + 12 * s : 0;

  g.textAlign = 'left';
  g.fillStyle = '#e9eef4';
  g.font = `600 ${13 * s}px ${theme.sans}`;
  g.fillText(text(tile, '.name'), nx, base, Math.max(0, x + w - 11 * s - cw - nx));
  g.shadowBlur = 0;
}

/* Date and UTC time in a corner: months later, the clip still says when it aired. */
function drawStamp() {
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  g.font = `500 17px ${theme.mono}`;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  const tw = g.measureText(t).width;
  g.fillStyle = 'rgba(5,7,10,.62)';
  g.beginPath();
  g.roundRect(W - tw - 40, H - 46, tw + 24, 30, 7);
  g.fill();
  g.fillStyle = 'rgba(233,238,244,.85)';
  g.fillText(t, W - 28, H - 31);
}

const text = (tile, sel) => tile.querySelector(sel)?.textContent || '';
