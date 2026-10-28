/* The globe's program feed: what the window shows, drawn into a 1920x1080
   canvas (the sound is core/program.js). The scene as you fly it, cropped to
   16:9; on top, the channel you hold: the selected one in its card, lifted
   off the globe, or the one in full screen. The bar, panes, card text,
   crosshair and toasts are never drawn.

   A WebGL canvas can only be read in the task that rendered it (its buffer
   is cleared once shown), so the frame loop composes right after rendering,
   when the encoder has asked for a frame; the encoder takes the last one.
   In a hidden tab there is no frame loop: the program renders by itself. */

import { startProgram } from '../core/program.js';

const W = 1920, H = 1080;

/* `scene`: the WebGL canvas; `render()` draws it now; `held()` → the video
   on top and its channel `{video, el, flag, name, onAir, full}`, or null;
   `videos()`: the ones playing. */
export function createGlobeProgram({ scene, render, held, videos }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { alpha: false });
  let want = false, theme = {};

  function compose() {
    g.fillStyle = theme.ink || '#05070a';
    g.fillRect(0, 0, W, H);
    const r = scene.getBoundingClientRect();
    if (!r.width || !r.height) return drawStamp();
    // cover: the window's middle, as large as 16:9 allows
    const s = Math.max(W / r.width, H / r.height);
    const ox = (W - r.width * s) / 2, oy = (H - r.height * s) / 2;
    g.drawImage(scene, ox, oy, r.width * s, r.height * s);

    const h = held();
    if (h) {
      if (h.full) {
        g.fillStyle = 'rgba(5,7,10,.86)';   // the veil of full screen
        g.fillRect(0, 0, W, H);
      }
      const b = h.el.getBoundingClientRect();
      if (b.width && b.height) drawHeld(h, ox + (b.left - r.left) * s, oy + (b.top - r.top) * s, b.width * s, b.height * s, s);
    }
    drawStamp();
  }

  /* The video contained in its box, as on screen, with its name and the
     tally when it talks. */
  function drawHeld(h, x, y, w, hh, s) {
    const radius = (h.full ? 6 : 10) * s;
    g.save();
    g.beginPath();
    g.roundRect(x, y, w, hh, radius);
    g.clip();
    g.fillStyle = '#000';
    g.fillRect(x, y, w, hh);
    const v = h.video;
    if (v.readyState >= 2 && v.videoWidth) {
      const k = Math.min(w / v.videoWidth, hh / v.videoHeight);
      const vw = v.videoWidth * k, vh = v.videoHeight * k;
      g.drawImage(v, x + (w - vw) / 2, y + (hh - vh) / 2, vw, vh);
    }

    // Flag and name, on the same dark veil as the wall's tiles.
    const lh = 44 * s;
    const veil = g.createLinearGradient(0, y, 0, y + lh);
    veil.addColorStop(0, 'rgba(0,0,0,.78)');
    veil.addColorStop(0.45, 'rgba(0,0,0,.35)');
    veil.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = veil;
    g.fillRect(x, y, w, lh);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.shadowColor = 'rgba(0,0,0,.9)';
    g.shadowBlur = 4 * s;
    g.fillStyle = '#e9eef4';
    g.font = `${15 * s}px ${theme.sans}`;
    g.fillText(h.flag, x + 11 * s, y + 17 * s);
    const nx = x + 11 * s + (h.flag ? g.measureText(h.flag).width + 8 * s : 0);
    g.font = `600 ${13 * s}px ${theme.sans}`;
    g.fillText(h.name, nx, y + 17 * s, Math.max(0, x + w - 11 * s - nx));
    g.restore();

    if (h.onAir) {
      g.save();
      g.beginPath();
      g.roundRect(x + 1.5, y + 1.5, w - 3, hh - 3, radius);
      g.lineWidth = 3;
      g.strokeStyle = theme.tally;
      g.shadowColor = theme.tally;
      g.shadowBlur = 18;
      g.stroke();
      g.restore();
    }
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

  /* The encoder asks for a frame: the next render composes it. */
  function draw() {
    if (!document.hidden) { want = true; return; }
    render();
    compose();
  }

  return {
    start({ seconds, onError }) {
      const css = getComputedStyle(document.documentElement);
      const v = (name) => css.getPropertyValue(name).trim();
      theme = { tally: v('--tally'), ink: v('--ink'), sans: v('--sans'), mono: v('--mono') };
      return startProgram({ canvas, draw, videos: videos(), seconds, onError });
    },
    /* Right after the frame loop rendered the scene. */
    frame() {
      if (!want) return;
      want = false;
      compose();
    },
  };
}
