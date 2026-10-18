/* The Earth: a near-black graphite globe lit by the real sun, city lights on
   the night side, a thin atmosphere on the rim, country outlines, sparse stars. */

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

/* Day: the Blue Marble turned to graphite, the oceans almost black. Night:
   the Black Marble's city lights, warm. A soft twilight band between them. */
const EARTH_FRAG = /* glsl */`
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    float sd = dot(n, sunDir);
    float day = smoothstep(-0.12, 0.18, sd);

    vec3 tex = texture2D(dayMap, vUv).rgb;
    float lum = dot(tex, vec3(0.3, 0.59, 0.11));
    float water = smoothstep(0.02, 0.12, tex.b - max(tex.r, tex.g));
    vec3 land = mix(vec3(0.045, 0.055, 0.07), vec3(0.20, 0.22, 0.25), smoothstep(0.05, 0.6, lum));
    land = mix(land, tex * 0.32, 0.18);
    vec3 ocean = vec3(0.012, 0.022, 0.038);
    vec3 dayCol = mix(land, ocean, water) * (0.45 + 0.75 * clamp(sd, 0.0, 1.0));

    vec3 lights = texture2D(nightMap, vUv).rgb;
    float city = smoothstep(0.08, 0.6, dot(lights, vec3(0.33)));
    vec3 nightCol = mix(ocean * 0.6, vec3(0.03, 0.035, 0.045), 1.0 - water)
                  + city * vec3(1.0, 0.72, 0.42) * 0.9;

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

export async function createEarth() {
  const loader = new THREE.TextureLoader();
  const [day, night, borders] = await Promise.all([
    loader.loadAsync('assets/earth/day.jpg'),
    loader.loadAsync('assets/earth/night.jpg'),
    fetch('assets/earth/borders.json').then((r) => r.json()),
  ]);
  for (const t of [day, night]) {
    t.colorSpace = THREE.NoColorSpace;   // the shader grades them itself
    t.anisotropy = 4;
  }

  const sunDir = new THREE.Vector3(1, 0, 0);
  const group = new THREE.Group();

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 96, 64),
    new THREE.ShaderMaterial({
      uniforms: { dayMap: { value: day }, nightMap: { value: night }, sunDir: { value: sunDir } },
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

/* Sparse and discreet: a backdrop, not a planetarium. */
function stars(n = 1400) {
  const pos = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.randomDirection().multiplyScalar(60 + Math.random() * 30);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x9fb2c8, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false,
  }));
}
