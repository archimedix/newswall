/* The screens hanging over the countries: a 16:9 panel in a glass bezel,
   with a soft shadow behind it, a glow when it is targeted or talking, a
   label underneath, a thread down to the ground and a pulsing marker there.
   Neighbours push each other apart (Europe is crowded) but the thread always
   goes back to the true place.

   A country with several channels is a pile from afar: one screen, two
   cards peeking out behind it and "×6" on its label. Coming closer fans the
   pile out. Both layouts are computed once, and each frame blends between
   them by the camera's distance. */

import * as THREE from 'three';
import { countryName, flag, langName } from '../core/data.js';
import { RADIUS } from './earth.js';
import { ANCHOR, toVec } from './geo.js';
import { hlsOrder } from './livepool.js';

export const W = 0.078, H = W * 9 / 16;
const ALT = 0.07;             // height of the screens above the ground
const GAP = 0.092;            // minimum angle between two screens, in radians
const LABEL_H = W * 0.15;
const PILE_MIN = 2;           // channels of one country that make a pile
/* Camera distances: folded beyond `far`, fanned out within `near`. */
export const FAN = { near: 2.05, far: 2.65 };
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* The tally red is the only warm colour that means "talking"; the orange
   detail marks a rebroadcast, as on the wall. */
const COLOR = {
  idle: new THREE.Color(0x313a46),
  live: new THREE.Color(0x8796a8),
  candidate: new THREE.Color(0xe9eef4),
  onAir: new THREE.Color(0xff4b2b),
};
const REBROADCAST = '#e0a45c';

/* Textures every screen shares, drawn once: the rounded mask of the picture,
   the glass bezel, and one soft shape for both the shadow and the glow. */
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const mask = canvas(256, 144);
  let g = mask.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 144);
  g.fillStyle = '#fff'; round(g, 0, 0, 256, 144, 7); g.fill();

  // Bezel: frosted, brighter along the top edge, as glass catches the light.
  const bezel = canvas(256, 152);
  g = bezel.getContext('2d');
  const body = g.createLinearGradient(0, 0, 0, 152);
  body.addColorStop(0, 'rgba(255,255,255,.95)');
  body.addColorStop(0.08, 'rgba(255,255,255,.62)');
  body.addColorStop(1, 'rgba(255,255,255,.42)');
  g.fillStyle = body; round(g, 1, 1, 254, 150, 11); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000'; round(g, 5, 5, 246, 142, 8); g.fill();

  const soft = canvas(128, 96);
  g = soft.getContext('2d');
  g.filter = 'blur(9px)';
  g.fillStyle = '#fff'; round(g, 22, 22, 84, 52, 10); g.fill();

  // The cards behind a pile: dark glass with a lit edge.
  const ghost = canvas(256, 152);
  g = ghost.getContext('2d');
  const edge = g.createLinearGradient(0, 0, 0, 152);
  edge.addColorStop(0, '#aab6c4');
  edge.addColorStop(0.1, '#5d6875');
  edge.addColorStop(1, '#3a434e');
  g.fillStyle = edge; round(g, 1, 1, 254, 150, 11); g.fill();
  const glass = g.createLinearGradient(0, 0, 0, 152);
  glass.addColorStop(0, '#1c2530');
  glass.addColorStop(1, '#0c1117');
  g.fillStyle = glass; round(g, 5, 5, 246, 142, 8); g.fill();

  SHARED = { mask: plain(mask), bezel: plain(bezel), soft: plain(soft), ghost: texture(ghost) };
  return SHARED;
}

export function createScreens(sources, logos = {}) {
  const group = new THREE.Group();
  const list = [];

  for (const src of sources) {
    const at = ANCHOR[src.country];
    if (!at) { console.warn(`globe: no anchor for ${src.country} (${src.id})`); continue; }
    list.push(makeScreen(src, toVec(at[0], at[1], new THREE.Vector3()), logos[src.id]));
  }

  // The piles: one per country with several channels.
  const byCountry = new Map();
  for (const s of list) byCountry.set(s.place, [...(byCountry.get(s.place) || []), s]);
  const piles = [...byCountry.values()].filter((m) => m.length >= PILE_MIN).map((members) => {
    const p = { country: members[0].place, members, rep: members[0], dir: null, ghosts: makeGhosts() };
    for (const s of members) s.pile = p;
    group.add(p.ghosts);
    return p;
  });

  // Fanned out: every screen on its own. Folded: one node per pile.
  relax(list);
  for (const s of list) s.fan = s.dir.clone();
  const nodes = [
    ...list.filter((s) => !s.pile).map((s) => ({ place: s.place, anchor: s.anchor, dir: s.anchor.clone(), set: (d) => { s.packed = d; } })),
    ...piles.map((p) => ({ place: p.country, anchor: p.rep.anchor, dir: p.rep.anchor.clone(), set: (d) => { p.dir = d; for (const s of p.members) s.packed = d; } })),
  ];
  relax(nodes);
  for (const n of nodes) n.set(n.dir);

  for (const s of list) group.add(s.group);

  // All threads in one geometry, rewritten each frame: one draw call.
  const threadPos = new Float32Array(list.length * 6);
  const threads = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(threadPos, 3)),
    new THREE.LineBasicMaterial({ color: 0x9fb2c8, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  threads.frustumCulled = false;
  group.add(threads);

  // One marker per place on the ground, however many screens hang over it.
  const places = [...new Map(list.map((s) => [s.src.country, s.anchor])).values()];
  const markerPos = new Float32Array(places.length * 3);
  places.forEach((v, i) => markerPos.set(v.clone().multiplyScalar(RADIUS * 1.002).toArray(), i * 3));
  const markers = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(markerPos, 3)),
    new THREE.PointsMaterial({ color: 0xcfe0f2, size: 4, sizeAttenuation: false, transparent: true, depthWrite: false }),
  );
  group.add(markers);

  const tmp = new THREE.Vector3(), toCam = new THREE.Vector3(), look = new THREE.Vector3();
  let fold = 1;

  return {
    group,
    list,
    piles,
    meshes: list.flatMap((s) => [s.face, s.frame]),
    lift: ALT,
    /* True while the piles are (mostly) closed. */
    get folded() { return fold > 0.5; },

    /* Orientation, size, visibility and colour, every frame. */
    update(camera, sunDir, time) {
      const dist = camera.position.length();
      const zoomScale = THREE.MathUtils.clamp(dist / 2.6, 0.75, 1.5);
      fold = THREE.MathUtils.smoothstep(dist, FAN.near, FAN.far);
      const spread = 1 - fold;

      // Who stands for each pile: the selected one, the one talking, or the first that plays.
      for (const p of piles) {
        p.rep = p.members.find((s) => s.selected) || p.members.find((s) => s.onAir)
          || p.members.find((s) => !s.dead) || p.members[0];
        for (const s of p.members) {
          const asPile = s === p.rep && fold > 0.5;
          if (s.asPile !== asPile) {
            s.asPile = asPile;
            drawLabel(s.labelCanvas, s.src, asPile ? p : null);
            s.labelTex.needsUpdate = true;
          }
        }
      }

      toCam.copy(camera.position).normalize();
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const lead = !s.pile || s === s.pile.rep;
        s.dir.copy(s.packed).lerp(s.fan, spread).normalize();
        s.hidden = !lead && spread < 0.5;
        s.facing = s.dir.dot(toCam);
        s.group.visible = s.facing > -0.1 && (lead || spread > 0.02);
        if (s.logoFile && s.group.visible) loadLogo(s);

        // The others in a pile grow out of it as it fans out.
        const big = (s.selected ? 2 : s.hover ? 1.16 : 1) * (lead ? 1 : spread);
        s.scale = calm ? big * zoomScale : s.scale + (big * zoomScale - s.scale) * 0.16;
        const lift = s.selected ? ALT * 1.9 : ALT;
        s.group.position.copy(s.dir).multiplyScalar(RADIUS + lift * Math.max(1, s.scale * 0.8));
        s.group.scale.setScalar(s.scale);

        // Outwards, and turned most of the way towards the camera so that
        // screens near the edge of the globe stay readable.
        tmp.copy(camera.position).sub(s.group.position).normalize();
        look.copy(s.dir).lerp(tmp, 0.7).normalize().add(s.group.position);
        s.group.up.copy(camera.up);
        s.group.lookAt(look);

        // The night side dims the frames too.
        const lit = THREE.MathUtils.smoothstep(s.anchor.dot(sunDir), -0.15, 0.25);
        const night = 0.5 + 0.5 * lit;
        const lit3 = s.onAir || s.candidate || s.selected || s.hover;
        const c = s.onAir ? COLOR.onAir : lit3 ? COLOR.candidate : s.live ? COLOR.live : COLOR.idle;
        s.frame.material.color.copy(c).multiplyScalar(lit3 ? 1 : night);
        s.face.material.color.setScalar((s.live ? 1 : 0.62) * (s.live ? 0.75 + 0.25 * lit : night));
        s.label.material.opacity = 0.35 + 0.65 * night;

        // The glow: red and breathing for the one talking, cold for the target.
        const glow = s.onAir ? 0.55 + (calm ? 0.1 : 0.25 * Math.sin(time * 3.2)) : s.selected ? 0.4 : s.candidate || s.hover ? 0.3 : 0;
        s.glow.material.opacity += (glow - s.glow.material.opacity) * 0.15;
        s.glow.material.color.copy(s.onAir ? COLOR.onAir : COLOR.candidate);
        s.glow.visible = s.glow.material.opacity > 0.01;
        s.shadow.material.opacity = 0.3 + 0.25 * night;

        // The thread: from the ground to the bottom edge of the screen.
        if (s.group.visible || lead) {
          tmp.set(0, -(H / 2 + 0.004), 0).applyQuaternion(s.group.quaternion).multiplyScalar(s.scale).add(s.group.position);
        } else tmp.copy(s.anchor);
        threadPos.set([s.anchor.x * 1.002, s.anchor.y * 1.002, s.anchor.z * 1.002, tmp.x, tmp.y, tmp.z], i * 6);
      }
      threads.geometry.attributes.position.needsUpdate = true;
      markers.material.opacity = calm ? 0.65 : 0.45 + 0.35 * Math.sin(time * 2.4);

      // The cards behind a pile slide out from behind its screen as it folds.
      for (const p of piles) {
        const r = p.rep.group;
        p.ghosts.visible = r.visible && fold > 0.02;
        if (!p.ghosts.visible) continue;
        p.ghosts.position.copy(r.position);
        p.ghosts.quaternion.copy(r.quaternion);
        p.ghosts.scale.copy(r.scale);
        p.ghosts.children.forEach((m, k) => m.position.set((k + 1) * 0.0034 * fold, (k + 1) * 0.0034 * fold, -0.0009 * (k + 1)));
      }
    },

    /* The last frame of a screen that stops playing becomes its still image. */
    capture(s) {
      const v = s.player?.video;
      if (!s.live || !v || v.readyState < 2 || !v.videoWidth) return;
      const c = s.still || (s.still = canvas(512, 288));
      const k = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
      const w = v.videoWidth * k, h = v.videoHeight * k;
      c.getContext('2d').drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
      s.stillAt = new Date();
      drawIdle(s);
      s.idleTex.needsUpdate = true;
    },

    setVideo(s, video) {
      s.videoTex?.dispose();
      s.videoTex = null;
      if (video) {
        s.videoTex = new THREE.VideoTexture(video);
        s.videoTex.colorSpace = THREE.SRGBColorSpace;
      }
      s.live = !!video;
      s.face.material.map = s.videoTex || s.idleTex;
      s.face.material.needsUpdate = true;
    },

    markDead(s) {
      s.dead = true;
      drawIdle(s);
      s.idleTex.needsUpdate = true;
    },

    /* Local times on the labels: once a minute is enough. */
    tickClocks() {
      for (const s of list) {
        if (s.asPile) continue;
        drawLabel(s.labelCanvas, s.src);
        s.labelTex.needsUpdate = true;
      }
    },

    dispose() {
      for (const s of list) {
        s.videoTex?.dispose();
        for (const m of [s.face, s.frame, s.label, s.shadow, s.glow]) { m.geometry.dispose(); m.material.dispose(); }
        s.idleTex.dispose();
        s.labelTex.dispose();
      }
      for (const p of piles) for (const m of p.ghosts.children) m.geometry.dispose();
      threads.geometry.dispose();
      markers.geometry.dispose();
    },
  };
}

function makeScreen(src, anchor, logoFile) {
  const group = new THREE.Group();

  const idleCanvas = canvas(512, 288);
  const idleTex = texture(idleCanvas);
  const { mask, bezel, soft } = shared();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ map: idleTex, alphaMap: mask, alphaTest: 0.5 }));
  face.position.z = 0.0008;

  const B = 0.0042;           // bezel width
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(W + B, H + B),
    new THREE.MeshBasicMaterial({ map: bezel, color: COLOR.idle, transparent: true, depthWrite: false }));
  frame.position.z = 0.0012;

  // A soft shadow, a little below and behind: the screen floats.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.55, H * 1.8),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: soft, transparent: true, depthWrite: false }));
  shadow.position.set(0.002, -0.006, -0.004);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.9, H * 2.1),
    new THREE.MeshBasicMaterial({ map: soft, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.z = -0.002;

  const labelCanvas = canvas(512, 76);
  drawLabel(labelCanvas, src);
  const labelTex = texture(labelCanvas);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(W, LABEL_H),
    new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false }),
  );
  label.position.set(0, -(H / 2 + 0.0048 + LABEL_H / 2), 0.0012);

  group.add(shadow, glow, face, frame, label);
  const s = {
    src, id: src.id, place: src.country, anchor, dir: anchor.clone(), fan: null, packed: null, pile: null,
    group, face, frame, label, shadow, glow,
    idleCanvas, idleTex, labelCanvas, labelTex, videoTex: null, still: null, stillAt: null,
    logo: null, logoFile: null, logoLight: false, logoCrop: null,
    scale: 1, facing: 0, live: false, dead: false, hidden: false, asPile: false,
    selected: false, candidate: false, onAir: false, hover: false,
  };
  face.userData.screen = frame.userData.screen = s;
  s.logoFile = logoFile;
  drawIdle(s);
  return s;
}

/* The logo is fetched the first time its screen comes round to the visible
   side: a mode holds a hundred, the camera sees a dozen. */
function loadLogo(s) {
  const file = s.logoFile;
  s.logoFile = null;
  const img = new Image();
  img.onload = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    s.logo = img;
    Object.assign(s, inspect(img));
    drawIdle(s);
    s.idleTex.needsUpdate = true;
  };
  img.src = `assets/logos/${file}`;
}

/* Most logos are drawn for a white background, some are white themselves:
   the average brightness of the opaque pixels picks a light or a dark plate.
   Many come with wide transparent margins, which are cropped away. */
function inspect(img) {
  const k = Math.min(1, 128 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = canvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let sum = 0, n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) continue;
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const crop = x1 < 0 ? [0, 0, img.naturalWidth, img.naturalHeight]
    : [x0 / k, y0 / k, (x1 - x0 + 1) / k, (y1 - y0 + 1) / k];
  return { logoCrop: crop, logoLight: n > 0 && sum / n > 200 && n < w * h * 0.9 };
}

/* Two cards behind a pile's screen, hidden behind it until the pile folds. */
function makeGhosts() {
  const g = new THREE.Group();
  const B = 0.0042;
  for (let k = 0; k < 2; k++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W + B, H + B),
      new THREE.MeshBasicMaterial({ map: shared().ghost, color: new THREE.Color().setScalar(1 - k * 0.3), alphaTest: 0.5 }));
    g.add(m);
  }
  g.visible = false;
  return g;
}

/* Spread the screens so that none covers another: a few rounds of pushing
   apart on the sphere, with a spring that keeps each near its country.
   Starting positions are a small golden-angle spiral, so it is deterministic. */
function relax(list) {
  const byPlace = new Map();
  for (const s of list) {
    const k = byPlace.get(s.place) || 0;
    byPlace.set(s.place, k + 1);
    if (!k) continue;
    const t = tangent(s.anchor);
    const a = k * 2.39996, r = 0.05 * Math.sqrt(k);
    s.dir.addScaledVector(t.u, Math.cos(a) * r).addScaledVector(t.v, Math.sin(a) * r).normalize();
  }
  const push = new THREE.Vector3();
  for (let round = 0; round < 160; round++) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].dir, b = list[j].dir;
        const ang = a.angleTo(b);
        if (ang >= GAP) continue;
        push.subVectors(a, b);
        if (push.lengthSq() < 1e-10) push.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        push.normalize().multiplyScalar((GAP - ang) * 0.5);
        a.add(push).normalize();
        b.sub(push).normalize();
      }
    }
    for (const s of list) s.dir.lerp(s.anchor, 0.02).normalize();
  }
}

function tangent(n) {
  const u = new THREE.Vector3(0, 1, 0).cross(n);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize();
  return { u, v: n.clone().cross(u).normalize() };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function round(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/* A data texture: linear, no colour management. */
function plain(c) {
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const SANS = "'Schibsted Grotesk', ui-sans-serif, sans-serif";
const MONO = "'Spline Sans Mono', ui-monospace, monospace";

/* The still image of a screen that is not live: its last frame, desaturated,
   with the time it was seen; before it ever played, a title card with the
   logo (on a light plate: most logos are drawn for white backgrounds), the
   name and the country. */
function drawIdle(s) {
  const c = s.idleCanvas, src = s.src;
  const g = c.getContext('2d');
  g.textBaseline = 'middle';
  let seen = 0;
  if (s.still) {
    g.filter = 'grayscale(.9) brightness(.6) contrast(1.08)';
    g.drawImage(s.still, 0, 0, c.width, c.height);
    g.filter = 'none';
    const veil = g.createLinearGradient(0, c.height * 0.55, 0, c.height);
    veil.addColorStop(0, 'rgba(5,7,10,0)');
    veil.addColorStop(1, 'rgba(5,7,10,.8)');
    g.fillStyle = veil;
    g.fillRect(0, 0, c.width, c.height);
    const at = s.stillAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    seen = chip(g, `SEEN AT ${at}`, 26, c.height - 40) + 10;
  } else {
    const grd = g.createLinearGradient(0, 0, 0, c.height);
    grd.addColorStop(0, '#111925');
    grd.addColorStop(1, '#070a0f');
    g.fillStyle = grd;
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(255,255,255,.035)';
    g.lineWidth = 1;
    for (let x = 32; x < c.width; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
    for (let y = 32; y < c.height; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }

    if (s.logo) {
      const ph = 92, pad = 12;
      const [sx, sy, sw, sh] = s.logoCrop;
      const k = Math.min((ph - pad * 2) / sh, (c.width * 0.6 - pad * 2) / sw);
      const lw = sw * k, lh = sh * k;
      g.fillStyle = s.logoLight ? '#1b232d' : '#e9eef4';
      round(g, 34, 26, lw + pad * 2, ph, 14); g.fill();
      g.drawImage(s.logo, sx, sy, sw, sh, 34 + pad, 26 + (ph - lh) / 2, lw, lh);
    } else {
      g.font = `64px ${SANS}`;
      g.fillText(flag(src.country), 34, 70);
    }
    g.fillStyle = '#e9eef4';
    g.font = `700 42px ${SANS}`;
    fit(g, src.name, 34, 166, c.width - 68);
    g.fillStyle = '#8d98a5';
    g.font = `400 22px ${MONO}`;
    const place = `${countryName(src.country)} · ${langName(src.lang)}`.toUpperCase();
    g.fillText(s.logo ? `${flag(src.country)} ${place}` : place, 34, 218, c.width - 68);
  }
  if (s.dead) {
    g.fillStyle = 'rgba(5,7,10,.55)';
    g.fillRect(0, 0, c.width, c.height);
    chip(g, 'OFF AIR', 26 + seen, c.height - 40);
  }
}

/* A small mono tag on the picture. */
function chip(g, text, x, y) {
  g.font = `500 21px ${MONO}`;
  const w = g.measureText(text).width + 24;
  g.fillStyle = 'rgba(5,7,10,.62)';
  round(g, x, y - 18, w, 36, 9); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.14)';
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = '#c9d3de';
  g.fillText(text, x + 12, y + 1);
  return w;
}

/* Under the screen: flag, name, local time; orange dot for a rebroadcast.
   A folded pile says its country and how many channels it holds instead. */
function drawLabel(c, src, pile = null) {
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const grd = g.createLinearGradient(0, 0, 0, c.height);
  grd.addColorStop(0, 'rgba(14,19,27,.88)');
  grd.addColorStop(1, 'rgba(6,9,13,.72)');
  g.fillStyle = grd;
  round(g, 0, 4, c.width, c.height - 6, 14); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.16)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(14, 5); g.lineTo(c.width - 14, 5); g.stroke();
  g.textBaseline = 'middle';
  const y = c.height / 2 + 2;

  let right = `×${pile?.members.length}`;
  if (!pile) {
    right = '';
    try {
      right = new Date().toLocaleTimeString('en-GB', { timeZone: src.tz || 'UTC', hour: '2-digit', minute: '2-digit' });
    } catch { /* unknown zone */ }
  }
  g.font = `500 28px ${MONO}`;
  const tw = g.measureText(right).width;
  g.fillStyle = pile ? '#e9eef4' : '#8d98a5';
  g.fillText(right, c.width - 14 - tw, y);

  let x = 14;
  if (!pile && src.streams[hlsOrder(src)[0]]?.origin?.kind === 'rebroadcast') {
    g.fillStyle = REBROADCAST;
    g.beginPath(); g.arc(c.width - 30 - tw, y, 6, 0, Math.PI * 2); g.fill();
  }
  g.font = `34px ${SANS}`;
  g.fillText(flag(src.country), x, y);
  x += 52;
  g.fillStyle = '#e9eef4';
  g.font = `600 32px ${SANS}`;
  fit(g, pile ? countryName(pile.country) : src.name, x, y, c.width - x - tw - 50);
}

function fit(g, text, x, y, max) {
  let t = text;
  while (t.length > 3 && g.measureText(t).width > max) t = t.slice(0, -2);
  g.fillText(t === text ? t : `${t.trimEnd()}…`, x, y);
}
