/* One HLS stream in a <video>, knowing nothing about tiles or globes: the wall
   puts the video in a tile, the globe will use it as a texture. It reports
   `onReady` at the first frame and `onFail` once it gives up, so the caller
   can move on to the source's next stream. hls.js is the global from
   assets/vendor/hls.min.js. */

const WATCHDOG_MS = 15000;

/* `native: false` refuses Safari's built-in HLS: that video cannot be drawn
   into WebGL, so the globe would get a black texture. */
export function createHlsPlayer(url, { muted = true, cap = null, native = true, onReady, onFail } = {}) {
  const video = document.createElement('video');
  video.muted = muted;
  video.playsInline = true;
  video.preload = 'auto';
  video.draggable = false;

  let hls = null, watchdog = null, done = false;
  const fail = () => {
    if (done) return;
    destroy();
    onFail?.();
  };

  const player = {
    video,
    get hls() { return hls; },
    play: () => video.play().catch(() => {}),
    /* Maximum height in pixels, or null for full quality. */
    setCap(height) {
      if (hls) hls.autoLevelCapping = height == null ? -1 : capIndex(hls, height);
    },
    destroy,
  };

  if (window.Hls && Hls.isSupported()) {
    // capLevelToPlayerSize: small players download a small variant, and
    // bandwidth stays reasonable.
    hls = new Hls({
      capLevelToPlayerSize: true,
      lowLatencyMode: true,
      maxBufferLength: 12,
      backBufferLength: 15,
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    if (cap != null) hls.on(Hls.Events.MANIFEST_PARSED, () => player.setCap(cap));
    // A reachable manifest does not guarantee reachable segments: some
    // broadcasters only serve them in their own country. Two retries, then give up.
    let retries = 0;
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal || done) return;
      if (retries++ >= 2) return fail();
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    });
    watchdog = setTimeout(() => { if (!video.videoWidth) fail(); }, WATCHDOG_MS);
    video.addEventListener('loadeddata', () => {
      clearTimeout(watchdog);
      if (!done) onReady?.();
    }, { once: true });
  } else if (native && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;                                // Safari plays HLS natively
    video.addEventListener('loadeddata', () => { if (!done) onReady?.(); }, { once: true });
  } else {
    // No way to play it here: fail on the next tick, once the caller has the player.
    queueMicrotask(fail);
  }

  /* Stops downloading for good. Watchdogs and error handlers can fire seconds
     later: after destroy they do nothing, so a removed player never comes back. */
  function destroy() {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    hls?.destroy();
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  return player;
}

/* The highest level not taller than `height`. */
function capIndex(hls, height) {
  const idx = hls.levels.findIndex((l) => l.height > height);
  return idx > 0 ? idx - 1 : -1;
}
