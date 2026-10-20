/* Who is live. Decoding dozens of streams is impossible, so only the screens
   nearest the centre of the view play: the first K, plus the selected one.
   A live screen stays live until it leaves the first K+2 or the visible side
   (hysteresis: a stream takes 2-5 s to start, and without it turning the
   globe would show nothing but loading). New players start only once the
   camera has been still for a moment, two at a time. */

import { catalog, firstStream } from '../core/data.js';
import { createHlsPlayer } from '../core/hls-player.js';

const SETTLE_MS = 400;
const PARALLEL = 2;
export const LIVE_CAP = 360;          // height for live screens; the selected one gets full quality

/* The source's streams in the order to try them: from the one the last
   check found working, skipping the ones it found dead. */
export function hlsOrder(src) {
  const n = src.streams.length, from = firstStream(src);
  const info = catalog.live[src.id]?.streams || [];
  const out = [];
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    if (info[i]?.state !== 'dead') out.push(i);
  }
  return out;
}

export function createLivePool({ k = 4, onLive, onIdle, onDead }) {
  const starting = new Set();
  const playing = new Set();     // starting or live
  let lastMove = 0;

  function stop(s) {
    s.player?.destroy();
    s.player = null;
    starting.delete(s);
    playing.delete(s);
    onIdle(s);
  }

  function start(s, order = hlsOrder(s.src), at = 0) {
    const idx = order[at];
    if (idx === undefined) {
      playing.delete(s);
      starting.delete(s);
      return onDead(s);
    }
    starting.add(s);
    playing.add(s);
    s.stream = idx;
    const player = createHlsPlayer(s.src.streams[idx].url, {
      cap: s.selected ? null : LIVE_CAP,
      native: false,
      onReady: () => {
        starting.delete(s);
        onLive(s);
      },
      onFail: () => {
        if (s.player !== player) return;
        s.player = null;
        start(s, order, at + 1);
      },
    });
    s.player = player;
    player.play();
  }

  return {
    get k() { return k; },
    /* Called every frame. `pinned`: screens that stay live wherever they are
       (the selected one, the one talking). `moving`: the camera moved this frame. */
    update(screens, pinned, moving, now) {
      const visible = screens.filter((s) => !s.dead && s.facing > 0.2)
        .sort((a, b) => b.facing - a.facing);
      const keep = new Set(visible.slice(0, k + 2));
      for (const s of [...playing]) {
        if (!pinned.includes(s) && (!keep.has(s) || s.facing < 0.05)) stop(s);
      }

      if (moving) lastMove = now;
      if (now - lastMove < SETTLE_MS) return;

      const want = [...new Set([...pinned, ...visible.slice(0, k)])].filter((s) => s && !s.dead);
      for (const s of want) {
        if (playing.has(s)) continue;
        if (starting.size >= PARALLEL) break;
        start(s);
      }
    },
    stopAll() { for (const s of [...playing]) stop(s); },
    get liveCount() { return playing.size - starting.size; },
  };
}
