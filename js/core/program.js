/* A program feed, like the output of a control room: a canvas that a view
   draws as it is on screen, and the sound you hear. Each view (the wall, the
   globe) draws its own picture; the sound works the same in both.

   Once Replay is on, every playing video goes through one AudioContext into
   `bus`, and from there to the speakers and to the recorder; `monitor` sits
   before the speakers only, so the replay viewer can hush the live sound
   while the recorder keeps it. The videos stay muted and unmuted by the view
   as always: a muted element sends silence. A video, once wired, stays wired:
   the browser offers no way back. */

import { createReplay } from './replay.js';

let ctx = null, bus = null, monitor = null;
const wired = new Map();   // <video> -> MediaElementAudioSourceNode

/* A new video: if the program is listening, its sound joins. */
export function programWire(video) {
  if (!ctx || !video || wired.has(video)) return;
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

/* The replay viewer talks: the view goes quiet in the speakers, not in the recording. */
export function programHush(on) {
  monitor?.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.04);
}

/* Starts the buffer on `canvas`, drawn by `draw()`; `videos` are the ones
   already playing. Resolves to the replay handle (core/replay.js). */
export async function startProgram({ canvas, draw, videos = [], seconds, onError }) {
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: 48000 });
    bus = ctx.createGain();
    monitor = ctx.createGain();
    bus.connect(monitor).connect(ctx.destination);
  }
  programResume();
  videos.forEach(programWire);
  return createReplay({ canvas, draw, context: ctx, input: bus, seconds, onError });
}
