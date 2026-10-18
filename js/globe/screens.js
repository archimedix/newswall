/* The screens hanging over the countries: a 16:9 panel in a glass bezel,
   with a soft shadow behind it, a glow when it is targeted or talking, a
   label underneath, a thread down to the ground and a pulsing marker there.
   Neighbours push each other apart (Europe is crowded) but the thread always
   goes back to the true place. */

import * as THREE from 'three';
import { countryName, flag, langName } from '../core/data.js';
import { RADIUS } from './earth.js';
import { ANCHOR, toVec } from './geo.js';
import { hlsOrder } from './livepool.js';

export const W = 0.078, H = W * 9 / 16;
const ALT = 0.07;             // height of the screens above the ground
const GAP = 0.092;            // minimum angle between two screens, in radians
const LABEL_H = W * 0.15;

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

  SHARED = { mask: plain(mask), bezel: plain(bezel), soft: plain(soft) };
  return SHARED;
}

export function createScreens(sources) {
  const group = new THREE.Group();
  const list = [];

  for (const src of sources) {
    const at = ANCHOR[src.country];
    if (!at) { console.warn(`globe: no anchor for ${src.country} (${src.id})`); continue; }
    list.push(makeScreen(src, toVec(at[0], at[1], new THREE.Vector3())));
  }
  relax(list);
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

  return {
    group,
    list,
    meshes: list.flatMap((s) => [s.face, s.frame]),
    lift: ALT,

    /* Orientation, size, visibility and colour, every frame. */
    update(camera, sunDir, time) {
      const dist = camera.position.length();
      const zoomScale = THREE.MathUtils.clamp(dist / 2.6, 0.75, 1.5);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        toCam.copy(camera.position).normalize();
        s.facing = s.dir.dot(toCam);
        s.group.visible = s.facing > -0.1;

        const big = s.selected ? 2 : s.hover ? 1.16 : 1;
        s.scale += (big * zoomScale - s.scale) * 0.16;
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
        const glow = s.onAir ? 0.55 + 0.25 * Math.sin(time * 3.2) : s.selected ? 0.4 : s.candidate || s.hover ? 0.3 : 0;
        s.glow.material.opacity += (glow - s.glow.material.opacity) * 0.15;
        s.glow.material.color.copy(s.onAir ? COLOR.onAir : COLOR.candidate);
        s.glow.visible = s.glow.material.opacity > 0.01;
        s.shadow.material.opacity = 0.3 + 0.25 * night;

        // The thread: from the ground to the bottom edge of the screen.
        tmp.set(0, -(H / 2 + 0.004), 0).applyQuaternion(s.group.quaternion).multiplyScalar(s.scale).add(s.group.position);
        threadPos.set([s.anchor.x * 1.002, s.anchor.y * 1.002, s.anchor.z * 1.002, tmp.x, tmp.y, tmp.z], i * 6);
      }
      threads.geometry.attributes.position.needsUpdate = true;
      markers.material.opacity = 0.45 + 0.35 * Math.sin(time * 2.4);
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
      drawIdle(s.idleCanvas, s.src, true);
      s.idleTex.needsUpdate = true;
    },

    /* Local times on the labels: once a minute is enough. */
    tickClocks() {
      for (const s of list) {
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
      threads.geometry.dispose();
      markers.geometry.dispose();
    },
  };
}

function makeScreen(src, anchor) {
  const group = new THREE.Group();

  const idleCanvas = canvas(512, 288);
  drawIdle(idleCanvas, src, false);
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
    src, id: src.id, anchor, dir: anchor.clone(), group, face, frame, label, shadow, glow,
    idleCanvas, idleTex, labelCanvas, labelTex, videoTex: null,
    scale: 1, facing: 0, live: false, dead: false, selected: false, candidate: false, onAir: false, hover: false,
  };
  face.userData.screen = frame.userData.screen = s;
  return s;
}

/* Spread the screens so that none covers another: a few rounds of pushing
   apart on the sphere, with a spring that keeps each near its country.
   Starting positions are a small golden-angle spiral, so it is deterministic. */
function relax(list) {
  const byPlace = new Map();
  for (const s of list) {
    const k = byPlace.get(s.src.country) || 0;
    byPlace.set(s.src.country, k + 1);
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

/* The still image of a screen that is not live: flag, name, country. The
   logos come in phase 2; until then, a clean title card. */
function drawIdle(c, src, dead) {
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, c.height);
  grd.addColorStop(0, '#111925');
  grd.addColorStop(1, '#070a0f');
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(255,255,255,.035)';
  g.lineWidth = 1;
  for (let x = 32; x < c.width; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
  for (let y = 32; y < c.height; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }

  g.textBaseline = 'middle';
  g.font = `64px ${SANS}`;
  g.fillText(flag(src.country), 34, 70);
  g.fillStyle = '#e9eef4';
  g.font = `700 42px ${SANS}`;
  fit(g, src.name, 34, 160, c.width - 68);
  g.fillStyle = '#8d98a5';
  g.font = `400 22px ${MONO}`;
  g.fillText(`${countryName(src.country)} · ${langName(src.lang)}`.toUpperCase(), 34, 214, c.width - 68);
  if (dead) {
    g.fillStyle = 'rgba(5,7,10,.55)';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#8d98a5';
    g.font = `500 24px ${MONO}`;
    g.fillText('OFF AIR', 34, 256);
  }
}

/* Under the screen: flag, name, local time. Orange dot for a rebroadcast. */
function drawLabel(c, src) {
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

  let time = '';
  try {
    time = new Date().toLocaleTimeString('en-GB', { timeZone: src.tz || 'UTC', hour: '2-digit', minute: '2-digit' });
  } catch { /* unknown zone */ }
  g.font = `500 28px ${MONO}`;
  const tw = g.measureText(time).width;
  g.fillStyle = '#8d98a5';
  g.fillText(time, c.width - 14 - tw, y);

  let x = 14;
  if (src.streams[hlsOrder(src)[0]]?.origin?.kind === 'rebroadcast') {
    g.fillStyle = REBROADCAST;
    g.beginPath(); g.arc(c.width - 30 - tw, y, 6, 0, Math.PI * 2); g.fill();
  }
  g.font = `34px ${SANS}`;
  g.fillText(flag(src.country), x, y);
  x += 52;
  g.fillStyle = '#e9eef4';
  g.font = `600 32px ${SANS}`;
  fit(g, src.name, x, y, c.width - x - tw - 50);
}

function fit(g, text, x, y, max) {
  let t = text;
  while (t.length > 3 && g.measureText(t).width > max) t = t.slice(0, -2);
  g.fillText(t === text ? t : `${t.trimEnd()}…`, x, y);
}
