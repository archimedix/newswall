# Newswall Globe — plan

> Status: **approved on 2026-10-18**. Phases 0, 1 and 2 done; 3 remains. When a phase is
> done, it gets described in the README and only a note stays here.

## 1. Vision

Newswall becomes two experiences on top of the same catalog:

- **The wall** (`index.html`) — today's page. You project it, you watch it for hours. It stays
  technical, minimal, light: up to 12 screens in a grid, one audio at a time. It never loads
  anything 3D.
- **The globe** (`globe.html`) — the exploration mode. You enter a 3D world: the Earth turns
  beneath you, with real day and night, and above each country float the screens of its
  channels. You spin the globe, move closer, choose. It is driven by mouse, keyboard, gamepad,
  and (phase 3) by a smartphone as a remote, paired by scanning a QR code.

The two pages are linked through the URL: on the globe you collect channels and **send them to
the wall** (`index.html#c=<categories>&s=a,b,c`); a *Wall / Globe* switch in both bars says which
view you are in and leads to the other.

The project's principle does not change: **no third-party requests to render**, no accounts, no
data collected. The only exception, optional and isolated, is the remote's relay (§7).

## 2. Decisions taken

| Decision | Why |
|---|---|
| Globe as a **separate page** | The wall stays light: only the globe loads three.js (~600 KB). |
| **No YouTube on the globe** | A YouTube iframe cannot become a WebGL texture: it would need a second renderer (CSS3D) on top. Without it, every screen is a real texture, touched by lights and day/night. In October 2026 YouTube was then dropped from the wall too: the whole catalog is HLS. |
| **Only 4–6 live screens** at a time | Decoding dozens of streams is impossible; the others show a logo or their last frame. |
| **No build, no Astro** | Astro is for content sites; here it's almost all real-time JS. What's needed is **modularity**, and native ES modules + `importmap` provide it. ES module code moves to Vite almost unchanged the day it's needed (TypeScript, many dependencies, complex shaders): a cheap, reversible choice. The opposite is not. |
| Dependencies **vendored** in `assets/vendor/` | Like hls.js: exact version, no CDN. |

## 3. File architecture

```
index.html            wall (type="module")
globe.html            globe (type="module", importmap for three)
remote.html           smartphone remote (phase 3)
js/
  core/
    data.js           loads sources.json + live.json, byId, inCategory, passes, CATEGORIES,
                      flag, countryName, langName, originText, firstStream
    hls-player.js     creates/destroys an HLS <video> with stream fallback,
                      watchdog, quality cap — knowing nothing about grid or globe
    url.js            reads/writes #c= and #s=, localStorage
  wall/
    wall.js           wall boot, grid, tiles, audio, focus
    panel.js          catalog and quick search
  globe/
    globe.js          boot, scene, render loop
    earth.js          sphere, day/night shader, atmosphere, borders
    sun.js            sun position from UTC time
    screens.js        floating screens, clusters, labels
    livepool.js       who is live, hysteresis, starting/stopping players
    controls.js       mouse, touch, keyboard, gamepad → abstract commands
    hud.js            bar, channel card, favourites (★)
    geo.js            ISO2 → [lat, lon] (capital / media hub)
  remote/             (phase 3)
assets/
  vendor/             hls.min.js, three.module.min.js, qrcode.js (phase 3)
  earth/              textures and borders (public domain)
  logos/              channel logos, downloaded once by a script
relay/                (phase 3) Cloudflare Worker + Durable Object
```

The key piece is `hls-player.js` (done in phase 0): an API the globe can use with a `<video>`
outside the DOM:

```js
const p = createHlsPlayer(url, { cap: 360, onReady, onFail });
p.video        // <video> to use as a texture
p.setCap(null) // full quality when the screen gets selected
p.destroy()
```

The player handles **one** stream: moving on to the source's next stream is up to the
caller, on the globe `livepool.js`.

## 4. Phases

### Phase 0 — Foundations ✅ (2026-10-18)

Done: `js/core/*` and `js/wall/*` modules, `createHlsPlayer()`, `GB` instead of `UK`. Described
in the README ("How it's built") and in CLAUDE.md.

### Phase 1 — The globe ✅ (2026-10-18)

Done: `globe.html` and `js/globe/*`, described in the README ("The globe") and in CLAUDE.md.
Choices made along the way:

- **Solid land**, not dots: the Blue Marble in its own colours by day (graphite at first,
  changed because day and night looked too much alike), dark at night.
- Screens of neighbouring countries **repel each other** (relaxation on the sphere with a spring
  towards the country) and the wire always goes back to the true point: Europe stays crowded
  until clusters arrive.
- Hysteresis as in §6, so up to K+2 players at once (6 on desktop, 5 on touch).
- The basket became **favourites (★)**, and the favourites are the wall itself: one list
  (one, no longer per mode), the same localStorage key, starred on the globe = a tile on the wall.
- **No start screen**, neither on the globe nor on the wall: everything starts muted (muted
  autoplay needs no gesture) and the first click on a channel turns its audio on.
- Added on request: **full screen** (first called "front row": the channel flies from the globe to full window and back to
  its place), glass screens with shadow and glow, glass HUD with reticle and telemetry.
- `scripts/serve.py` instead of `http.server`: without `no-cache` the browser keeps stale
  modules even on reload.

### Phase 2 — Polish ✅ (2026-10-21)

Done, described in the README ("The globe") and in CLAUDE.md. Choices made along the way:

- **Piles per country**, not spatial clusters: a pile is always one country (two channels are
  enough), so its thread still goes to one capital and its label can say "France ×6". Fanning
  depends on the camera's distance only (folded beyond 2.65, open within 2.05), so the
  whole globe changes together. Clicking a folded pile flies in until it opens; the selected
  or talking channel becomes the pile's face when it folds again.
- **Last frame** in the viewer's time ("seen at"), not the channel's: it says when *you* saw it.
- Long flights **climb** on the way and come down at the end; their duration grows with the
  arc. With `prefers-reduced-motion`, no flights (already so), no breathing glow, no pulsing
  markers, no easing on the screens' size.
- **Phones**: 2 live screens (3 on larger touch devices), 240p, pixel ratio that steps down
  when the frame rate stays under 40 fps; on every device a hidden tab keeps only the
  channel talking.
- **Logos** are not resized (the standard library cannot): `fetch-logos.py` picks the variant
  that is already small from the sizes in iptv-org's `logos.json`. The page crops their
  transparent margins and picks a light or dark plate from their brightness. Fetched only
  when their screen first comes into view. 165 of 194 sources have one.

### Phase 3 — Smartphone remote

See §7.

## 5. Visual idea

**Tone**: the wall's same "control room", but seen from space. Nocturnal, precise, quiet. No
cartoon video-game effects: more mission control centre.

**The Earth**
- Near-black, blue-graphite ocean. Land in dark matte grey, or as a **dot grid** (more
  "instrument", less photograph) — to be decided on a prototype.
- Thin **borders**, just a little lighter; the country of the selected screen lights up.
- **Real day and night**: the sun position is computed from UTC time (declination + equation
  of time, a short formula). The shader blends between the lit and the dark side with a soft
  twilight band.
- **City lights** (NASA Black Marble) that only appear on the night side: it shows at a glance
  where it is night and the newscasts are reruns.
- **Atmosphere**: a thin halo on the rim (Fresnel effect), cold by day, nearly absent by night.
- Sparse stars in the background, very discreet.

Assets, all public domain: NASA Blue Marble, GEBCO elevation and Black Marble in two
8K maps, day colours plus a packed one (8 MB; 4K, 2.3 MB, on phones) behind a loading screen; Natural Earth 1:50m borders.

**The floating screens**
- 16:9 panels at some height above the country, facing outwards and slightly towards the
  camera, so they stay readable near the edge of the globe.
- A **thin wire** links the screen to its point on the ground, where a small marker pulses.
- Thin monitor-like frame; underneath, a Spline Sans Mono label: flag, name, local time (from
  the source's `tz`).
- **States**:
  - *live*: full colours, light frame;
  - *still*: logo or last frame, desaturated and darker;
  - *selected*: larger, full quality;
  - *on air* (has the audio): **red**, the same rule as the wall: red is only for the one
    talking;
  - *rebroadcast* (`origin.kind = rebroadcast`): orange detail, as on the wall.
- The night side touches the screens too: those in the dark have a dimmer frame.

**HUD** (frosted glass, only on surfaces seen one at a time, as per the wall's rules)
- Top: logo, category filter, live count, UTC time, favourites `★ 3 → Open in wall`.
- Centre: a discreet **reticle**: the screen closest to it is the selection candidate
  (essential for the gamepad).
- Bottom: the selected channel's card — name, country, language, stream origin with the same
  honesty rule as the wall.

## 6. Behaviour

**Who is live (`livepool.js`)**
- Score = angular distance of the screen from the centre of the view; only those on the
  visible hemisphere count.
- The top K are live (default 4, max 6; 3 on mobile).
- **Hysteresis**: a live screen stays live until it leaves the top K+2 or the visible
  hemisphere. A stream takes 2–5 s to start: without hysteresis, rotating would show only
  loading screens.
- **Waiting**: new players start only when the camera has been almost still for ~400 ms, at
  most 2 starts in parallel.
- Quality: 360p for live screens, full for the selected one.
- Safari: force hls.js (MediaSource) even where native HLS exists, otherwise the video can't
  be used as a texture.
- Textures update only on a new frame (`requestVideoFrameCallback`); rendering stops when the
  tab is hidden.

**Controls** — all translated into abstract commands (`rotate`, `zoom`, `next`, `select`,
`audio`, `fav`, `filter`, `back`), so the remote and the gamepad use the same channel.

| Action | Mouse / touch | Keyboard | Gamepad |
|---|---|---|---|
| rotate | drag (with inertia) | arrows / WASD | left stick |
| zoom | wheel / pinch | `+` `-` | triggers |
| nearby screen | — | `Tab` / `Shift-Tab` | right stick / d-pad |
| select | click | `Enter` | A |
| audio | click on the selected one | `Space` | X |
| favourite ★ | button | `B` | Y |
| category filter | bar | `1`–`4`, `0` | shoulder buttons |
| back | `Esc` | `Esc` | B |
| open in wall | button | `Shift-Enter` | Start |

## 7. The remote (phase 3)

**Experience.** On the globe, the "Remote" button shows a QR code. You scan it with your
phone, and `remote.html` opens already paired. On the phone:

- at the top, the selected channel's card (name, country, live/still);
- in the middle a **trackpad**: drag to rotate, pinch to zoom;
- below, the list of **channels near** the reticle: tap to select;
- large buttons: Audio · Favourite ★ · Open in wall · categories;
- vibration when the selection changes (Android);
- optional: **gyroscope mode**, tilt the phone and the globe turns.

Later the same remote can drive **the wall** (who has the audio, full screen): exactly the
"projected" use where no keyboard is at hand.

**Why a relay is needed.** Phone and screen have to find each other, and a static page can't
do that on its own. Options considered:

1. **Minimal relay on Cloudflare (Worker + Durable Object)** — *recommended*.
2. **Deno Deploy** — a valid alternative: free, WebSockets supported; instances are separate,
   so phone and globe talk through `BroadcastChannel`.
3. A self-hosted relay (a small Node/Python container): zero cost and no third party, but it
   has to be maintained and ties Newswall to that machine.
4. Public services (PeerJS cloud) or BaaS (Supabase Realtime, Firebase): a third party sees who
   connects, accounts and keys in the page. Against the spirit of the project.
5. WebRTC with a manual exchange of two QR codes: serverless, but clunky.

Ruled out: **Vercel** and **Netlify** (functions live for one request, no persistent
WebSockets); **Render** free (sleeps after ~15 min, 30–60 s wake-up); **Fly.io** and
**Railway** (no real free plan any more).

**How the relay works**
- The globe generates a random `room` (128 bits) and a key `k`. The QR code contains
  `https://tv.archimedix.net/remote.html#r=<room>&k=<key>`: everything in the **fragment**,
  which the browser never sends to the server.
- Both open a WebSocket to the room's Durable Object; the relay forwards messages from one to
  the other and does nothing else.
- **End-to-end encryption**: messages are encrypted with AES-GCM (WebCrypto) using `k`. The
  relay only sees the `room` and encrypted bytes.
- No WebRTC: these are few small messages, the latency via Cloudflare's edge (20–50 ms) is
  enough for a remote, and NAT, ICE and TURN are avoided.
- The Durable Object uses the **WebSocket Hibernation API** (`state.acceptWebSocket`), not
  `accept()`: when idle it consumes no duration. No storage (SQLite class, the only one on the
  Free plan, but never written to).
- The room dies when both disconnect, or after 2 hours. No persistent logs.
- One remote at a time: the second one to pair takes control.
- If the relay doesn't answer, the "Remote" button doesn't appear: the globe works the same.

**Protocol** (JSON, before encryption)

```
phone → globe      {t:"rotate", dx, dy}   (max 30/s)
                   {t:"zoom", d}
                   {t:"select", id} | {t:"next", dir}
                   {t:"audio"} | {t:"fav", id} | {t:"filter", c:[…]} | {t:"open-wall"}
globe → phone      {t:"state", filter, selected, near:[{id,name,cc,live}], favs:[…]}
```

**Repo and deploy**: a `relay/` folder with the Worker (`wrangler.toml`), deployed by hand with
`wrangler` or by a separate Action. Domain, for example `relay.archimedix.net`. QR code
generated in the browser by a vendored library (qrcode-generator, MIT, ~20 KB).

## 8. Risks and open questions

- **Weight**: three.js + the 8K ground + borders ≈ 10 MB on the globe's first load on a
  desktop (≈ 4 MB on phones), behind a loading screen. Acceptable for an exploration mode,
  to keep an eye on.
- **Modest hardware**: 4–6 video decoders + WebGL on an old laptop or a phone. K and pixel
  ratio need tuning in phase 2.
- **CORS**: streams hls.js can't load because of CORS don't appear on the globe either (same
  limit as the wall, e.g. IRIB).
- **Cloudflare** — verified on 2026-10-18
  ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
  [limits](https://developers.cloudflare.com/durable-objects/platform/limits/)): Durable
  Objects are on the **Free** plan (SQLite backend only). Daily limits: 100,000 requests,
  13,000 GB-s of duration, reset at 00:00 UTC; beyond that, an error and no charge. An open
  WebSocket = 1 request, incoming messages count 1 per 20, outgoing ones are free. Worst case,
  30 msg/s of continuous dragging ≈ 1.5 requests/s → ~18 hours a day: ample margin. To be
  rechecked only if the terms change.
- **Dotted or solid land?** To be decided on a phase 1 prototype.
- **Sources without a precise country** (international, pan-Arab channels): anchored to their
  headquarters (current `country`). A per-source `geo` override only if needed.

## 9. What to approve before starting

1. The general approach (two pages, ES modules, no build).
2. The order of the phases: 0 → 1 → 2 → 3.
3. The Cloudflare relay for the remote (feasible and free, see §8; to be decided before
   phase 3).
