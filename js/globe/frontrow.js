/* Full screen: one channel, as large as the window allows, over the blurred
   globe. It flies in from the screen's place on the globe and flies back
   there on close (a FLIP animation: the stage is laid out at its final size,
   and a transform makes it start from the screen's rectangle). The video
   element is the one already painting the globe's texture: no second player,
   no second download. */

import { countryName, flag, langName, originText } from '../core/data.js';
import { $ } from './hud.js';

const IN = { duration: 720, easing: 'cubic-bezier(.2,.9,.12,1)' };
const OUT = { duration: 520, easing: 'cubic-bezier(.5,0,.2,1)' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createFrontRow({ rectOf, onClose }) {
  const root = $('#front');
  const stage = root.querySelector('.front-stage');
  const media = root.querySelector('.front-media');
  const veil = root.querySelector('.front-veil');
  const bar = root.querySelector('.front-bar');
  let current = null;
  let closing = null;

  /* The largest 16:9 rectangle that leaves room for the bar underneath. */
  function target() {
    const barSpace = innerWidth < 820 ? 76 : 96;
    const w = Math.min(innerWidth - (innerWidth < 820 ? 16 : 64), (innerHeight - barSpace - 70) * 16 / 9);
    const h = w * 9 / 16;
    return { x: (innerWidth - w) / 2, y: Math.max(64, (innerHeight - barSpace - h) / 2 + 20), w, h };
  }

  function place() {
    const t = target();
    Object.assign(stage.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: `${t.h}px` });
    bar.style.top = `${t.y + t.h + 14}px`;
    return t;
  }
  addEventListener('resize', () => { if (current) place(); });

  /* Transform that puts the stage (laid out at `t`) over rectangle `r`. */
  const from = (r, t) => `translate(${r.x - t.x}px, ${r.y - t.y}px) scale(${r.w / t.w}, ${r.h / t.h})`;

  /* Empties the stage. A video taken out of the document is paused by the
     browser (HTML spec) once the current task is over, so it is restarted
     just after: it goes on painting the globe. */
  function empty() {
    const old = media.querySelector('video');
    media.replaceChildren();
    if (old) setTimeout(() => { if (!old.isConnected && old.src) old.play().catch(() => {}); }, 30);
  }

  function fill(s) {
    empty();
    const video = s.live && s.player?.video;
    if (video) {
      media.appendChild(video);
      video.play?.().catch(() => {});
    } else {
      // Not live yet: its still card, drawn again at full size, until the stream starts.
      const c = document.createElement('canvas');
      c.width = s.idleCanvas.width; c.height = s.idleCanvas.height;
      c.getContext('2d').drawImage(s.idleCanvas, 0, 0);
      media.appendChild(c);
    }
    root.classList.toggle('live', !!video);
  }

  return {
    get open() { return !!current && !closing; },
    get screen() { return current; },

    show(s) {
      if (current && !closing) return this.swap(s);
      closing?.cancel();
      closing = null;
      current = s;
      root.hidden = false;
      root.classList.remove('closing');
      document.body.classList.add('front');
      const t = place();
      fill(s);
      this.render(s);
      bar.classList.remove('out');
      bar.classList.add('in');
      if (reduceMotion) return;
      const r = rectOf(s);
      stage.animate([
        { transform: from(r, t), borderRadius: '6px', opacity: 0.6 },
        { opacity: 1, offset: 0.25 },
        { transform: 'none', borderRadius: '18px', opacity: 1 },
      ], IN);
      veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 480, easing: 'ease-out' });
    },

    /* Another channel while open: a quick cross-fade instead of a flight. */
    swap(s) {
      if (s === current) return;
      current = s;
      this.render(s);
      media.classList.add('out');
      setTimeout(() => {
        if (current !== s) return;
        fill(s);
        media.classList.remove('out');
      }, reduceMotion ? 0 : 180);
    },

    /* The screen went live (or changed stream): show the video. */
    refresh(s) {
      if (s !== current || closing) return;
      if (s.live && !media.querySelector('video')) fill(s);
      this.render(s);
    },

    render(s, { onAir = false, inBasket = false } = this.flags?.(s) || {}) {
      if (s !== current) return;
      const src = s.src;
      const stream = src.streams[s.stream ?? 0];
      let time = '';
      try { time = new Date().toLocaleTimeString('en-GB', { timeZone: src.tz || 'UTC', hour: '2-digit', minute: '2-digit' }); } catch { /* unknown zone */ }
      bar.querySelector('.fflag').textContent = flag(src.country);
      bar.querySelector('.fname').textContent = src.name;
      const sub = bar.querySelector('.fsub');
      sub.textContent = `${countryName(src.country)} · ${langName(src.lang)} · ${time} · `;
      const o = document.createElement('span');
      o.className = stream.origin?.kind || '';
      o.textContent = originText(stream);
      sub.appendChild(o);
      root.classList.toggle('air', onAir);
      bar.querySelector('[data-fop="audio"]').classList.toggle('on', onAir);
      const b = bar.querySelector('[data-fop="basket"]');
      b.classList.toggle('in', inBasket);
      b.textContent = inBasket ? '✓ Basket' : '+ Basket';
    },

    /* Back to the globe: the stage shrinks onto the screen it came from. */
    close() {
      if (!current || closing) return;
      const s = current;
      const done = () => {
        closing = null;
        current = null;
        root.hidden = true;
        empty();
        root.classList.remove('air', 'live', 'closing');
        document.body.classList.remove('front');
        onClose?.(s);
      };
      bar.classList.remove('in');
      bar.classList.add('out');
      root.classList.add('closing');
      if (reduceMotion) return done();
      const t = target();
      const r = rectOf(s);
      document.body.classList.remove('front');
      closing = stage.animate([
        { transform: 'none', borderRadius: '18px', opacity: 1 },
        { opacity: 1, offset: 0.8 },
        { transform: from(r, t), borderRadius: '6px', opacity: 0 },
      ], OUT);
      veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OUT.duration, easing: 'ease-in', fill: 'forwards' })
        .finished.then(() => veil.getAnimations().forEach((a) => a.cancel())).catch(() => {});
      closing.onfinish = done;
      closing.oncancel = () => { closing = null; };
    },
  };
}
