/* YouTube tiles: the iframe is cross-origin, so it is driven by postMessage.
   Only the wall uses them; the globe needs streams it can turn into textures. */

import { state } from './state.js';

export function yt(frame, func, args = []) {
  frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}

/* Unmutes at full volume, or mutes. */
export function ytAudio(frame, on) {
  yt(frame, on ? 'unMute' : 'mute');
  if (on) yt(frame, 'setVolume', [100]);
}

export function createYoutubeFrame(videoId) {
  const frame = document.createElement('iframe');
  const params = new URLSearchParams({
    autoplay: '1', mute: '1', enablejsapi: '1', playsinline: '1',
    rel: '0', modestbranding: '1',
  });
  frame.src = `https://www.youtube.com/embed/${videoId}?${params}`;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture';
  frame.allowFullscreen = true;
  return frame;
}

/* The YouTube player drops commands until the "widget" channel has been
   opened: without this handshake the first unMute is lost and the tile stays
   silent even when selected. Keep knocking until it answers. */
export function ytHello(id) {
  const p = state.players.get(id);
  if (!p || p.kind !== 'yt') return;
  clearInterval(p.hello);
  const knock = () => p.el.contentWindow?.postMessage(
    JSON.stringify({ event: 'listening', id, channel: 'widget' }), '*');
  knock();
  p.hello = setInterval(knock, 700);
  setTimeout(() => clearInterval(p.hello), 20000);
}

/* When the player answers, stop knocking and sync its audio: the click on
   the tile may have arrived before it was ready. */
window.addEventListener('message', (e) => {
  let host;
  try { host = new URL(e.origin).hostname; } catch { return; }
  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host)) return;
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }
  if (msg?.event !== 'onReady' && msg?.event !== 'initialDelivery') return;
  for (const [sid, p] of state.players) {
    if (p.kind !== 'yt' || p.el.contentWindow !== e.source) continue;
    clearInterval(p.hello);
    ytAudio(p.el, sid === state.audioOn);
    yt(p.el, 'playVideo');
  }
});
