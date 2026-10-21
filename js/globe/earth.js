/* The Earth: a near-black graphite globe lit by the real sun, its relief
   shaded by it, city lights on the night side, a thin atmosphere on the rim,
   country outlines, discreet stars. */

import * as THREE from 'three';
import { toVec } from './geo.js';

const EARTH_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vNormal = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

/* One texture, three maps (scripts/build-earth.py): R = the land's brightness
   (0 on water), G = elevation, B = city lights. Day: graphite land, its
   relief shaded by the real sun, near-black seas with a faint glint where
   the sun reflects. Night: warm city lights. A soft twilight band between. */
const EARTH_FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec2 texel;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 tex = texture2D(map, vUv).rgb;
    float landness = smoothstep(0.05, 0.11, tex.r);
    float lum = clamp((tex.r - 0.063) / 0.937, 0.0, 1.0);

    // Relief: the elevation's slope tilts the normal east/west and north/south.
    // Mountains are exaggerated: at true scale they would not show at all.
    float cosLat = max(sqrt(1.0 - n.y * n.y), 0.08);
    float hE = texture2D(map, vUv + vec2(texel.x, 0.0)).g;
    float hW = texture2D(map, vUv - vec2(texel.x, 0.0)).g;
    float hN = texture2D(map, vUv + vec2(0.0, texel.y)).g;
    float hS = texture2D(map, vUv - vec2(0.0, texel.y)).g;
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-5, 0.0, 0.0));
    vec3 north = cross(n, east);
    vec2 slope = vec2((hE - hW) / cosLat, hN - hS) * 2.2 / (texel.y * 2048.0);
    vec3 nr = normalize(n - (east * slope.x + north * slope.y) * landness);

    float sd = dot(n, sunDir);
    float day = smoothstep(-0.12, 0.18, sd);
    float lit = clamp(dot(nr, sunDir), 0.0, 1.0);

    vec3 land = mix(vec3(0.045, 0.055, 0.07), vec3(0.22, 0.24, 0.27), smoothstep(0.03, 0.62, lum));
    land *= 0.42 + 0.95 * lit;
    vec3 ocean = vec3(0.012, 0.022, 0.04) * (0.5 + 0.8 * clamp(sd, 0.0, 1.0));
    float glint = pow(max(dot(reflect(-sunDir, n), vView), 0.0), 70.0) * (1.0 - landness);
    ocean += vec3(0.32, 0.42, 0.55) * glint * 0.55;
    vec3 dayCol = mix(ocean, land, landness);

    float city = smoothstep(0.04, 0.75, tex.b);
    vec3 nightCol = mix(vec3(0.007, 0.012, 0.022), vec3(0.028, 0.032, 0.042), landness)
                  + city * vec3(1.0, 0.7, 0.4) * (0.35 + 0.65 * city);

    vec3 col = mix(nightCol, dayCol, day);
    col += vec3(0.20, 0.09, 0.04) * (1.0 - abs(sd) * 6.0) * step(abs(sd), 0.16) * 0.35;

    float rim = pow(1.0 - max(dot(n, vView), 0.0), 3.0);
    col += vec3(0.25, 0.42, 0.65) * rim * (0.1 + 0.35 * day);
    gl_FragColor = vec4(col, 1.0);
  }`;

/* The halo: a slightly larger back-facing shell, bright on the edge, cold by
   day and almost gone at night. */
const ATMO_FRAG = /* glsl */`
  uniform vec3 sunDir;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    // Back faces: n·v is 0 on the shell's outline and grows negative inwards,
    // so the glow fades out towards the outline and peaks near the ground.
    float edge = pow(smoothstep(0.0, 0.32, -dot(n, vView)), 2.2);
    float lit = smoothstep(-0.35, 0.4, dot(n, sunDir));
    gl_FragColor = vec4(vec3(0.35, 0.58, 0.95) * edge * (0.04 + 0.42 * lit), 1.0);
  }`;

export const RADIUS = 1;

/* The assets, with progress: the ground is the heavy one (8K on desktops,
   4K on phones and small GPUs). `progress(done, total)` counts its bytes. */
export async function loadEarth({ hi, anisotropy, progress }) {
  const file = `assets/earth/earth-${hi ? 8 : 4}k.jpg`;
  const [blob, borders] = await Promise.all([
    fetchWithProgress(file, progress),
    fetch('assets/earth/borders.json').then((r) => r.json()),
  ]);
  const url = URL.createObjectURL(blob);
  const ground = await new THREE.TextureLoader().loadAsync(url);
  URL.revokeObjectURL(url);
  ground.colorSpace = THREE.NoColorSpace;   // three maps, not a picture: the shader reads the numbers
  ground.anisotropy = anisotropy;
  return { ground, borders };
}

async function fetchWithProgress(url, progress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !total) return r.blob();
  const reader = r.body.getReader();
  const parts = [];
  let done = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    parts.push(value);
    done += value.length;
    progress?.(done, total);
  }
  return new Blob(parts, { type: r.headers.get('content-type') || 'image/jpeg' });
}


/* `ground` is the texture from loadEarth(); `borders` the outlines by country. */
export function createEarth({ ground, borders }) {
  const sunDir = new THREE.Vector3(1, 0, 0);
  const group = new THREE.Group();

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 192, 128),
    new THREE.ShaderMaterial({
      uniforms: {
        map: { value: ground },
        texel: { value: new THREE.Vector2(1 / ground.image.width, 1 / ground.image.height) },
        sunDir: { value: sunDir },
      },
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
    }),
  );
  group.add(earth);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 1.05, 64, 48),
    new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: sunDir } },
      vertexShader: EARTH_VERT,
      fragmentShader: ATMO_FRAG,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(atmo);

  const outlines = new THREE.LineSegments(
    outlineGeometry(Object.values(borders).flat()),
    new THREE.LineBasicMaterial({ color: 0x8fa3b8, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  group.add(outlines);

  // The country of the selected screen lights up: its outline drawn again, brighter.
  const highlight = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xe9eef4, transparent: true, opacity: 0.75, depthWrite: false }),
  );
  group.add(highlight);

  group.add(stars());

  return {
    group,
    earth,
    sunDir,
    setSun(lat, lon) { toVec(lat, lon, sunDir); },
    highlight(cc) {
      highlight.geometry.dispose();
      highlight.geometry = outlineGeometry(borders[cc] || [], 1.0025);
    },
  };
}

/* Flat [lon, lat, lon, lat…] rings → pairs of points slightly above the ground. */
function outlineGeometry(rings, lift = 1.0015) {
  const pos = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const r of rings) {
    for (let i = 0; i + 3 < r.length; i += 2) {
      toVec(r[i + 1], r[i], a).multiplyScalar(RADIUS * lift);
      toVec(r[i + 3], r[i + 2], b).multiplyScalar(RADIUS * lift);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/* Discreet: a backdrop, not a planetarium. Three magnitudes, and a faint
   band where the stars crowd, like the Milky Way seen from a dark site. */
function stars() {
  const group = new THREE.Group();
  const band = new THREE.Vector3(0.35, 0.86, -0.37).normalize();   // the band's pole
  const v = new THREE.Vector3();
  const layer = (n, inBand, size, opacity, color) => {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      v.randomDirection();
      // Pull part of them towards the band's great circle, with a soft spread.
      if (i < n * inBand) v.addScaledVector(band, -v.dot(band) * (1 - Math.abs(gauss()) * 0.16)).normalize();
      v.multiplyScalar(60 + Math.random() * 30);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    group.add(new THREE.Points(g, new THREE.PointsMaterial({
      color, size, sizeAttenuation: false, transparent: true, opacity, depthWrite: false,
    })));
  };
  layer(5200, 0.7, 0.9, 0.28, 0x8fa3bd);
  layer(1300, 0.35, 1.3, 0.55, 0xb7c6d8);
  layer(140, 0.2, 2.1, 0.8, 0xe4ecf6);
  return group;
}

function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}
