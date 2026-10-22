# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Newswall: a static page showing a wall of live HLS channels, one with audio
at a time, to compare how different countries tell the same event. `globe.html` is a second
view of the same catalog: a three.js globe with the channels' screens over their countries. One wall; News, Sport,
Markets, Weather are iptv-org category ids used as a shared filter (none = every channel). No backend, no build step,
no package manager, no tests. Vanilla JS as native ES modules in `js/` (no bundler), plus
`index.html` and `styles.css`; runtime dependencies are vendored in `assets/vendor/` (hls.js;
three.js 0.170.0, loaded only by the globe through an import map). Fonts are vendored in
`assets/fonts/` on purpose: the page must make **no third-party requests** to render (do not add
CDN links). The README is the design document — read it before non-trivial changes. Its "Possible improvements" section is the backlog: add ideas there, remove them once done.

## Commands

```bash
./start.sh [port]                                   # scripts/serve.py on 127.0.0.1:8080 (file:// breaks ES modules;
                                                    # serve.py adds Cache-Control: no-cache, or stale ES modules survive reloads)
python3 scripts/build-borders.py                    # Natural Earth 1:50m outlines -> assets/earth/borders.json (rarely needed)
python3 scripts/build-earth.py DIR                  # NASA maps in DIR -> assets/earth/{earth,day}-{8k,4k}.jpg (one-off;
                                                    # the one script that needs Pillow + numpy, never run by the Action)
python3 scripts/fetch-logos.py [--write] [--refresh]  # iptv-org logos -> assets/logos/ + logos.json (no resizing: picks a small variant)
python3 scripts/refresh-live.py                     # check every stream, rewrite live.json
python3 scripts/annotate-origin.py [--write]        # (re)compute each stream's `origin`
python3 scripts/harvest-iptv.py [--category sports] [--write] [--cache DIR]
                                                    # candidates from iptv-org; --write adds only ids in scripts/curated/<category>.txt
python3 scripts/harvest-iptv.py --alternatives --write   # add fallback streams to existing channels
python3 scripts/harvest-iptv.py --source free-tv [...]  # same, from the Free-TV/IPTV playlist
```

Python scripts use the standard library only — keep it that way (they run bare in a GitHub Action).
The exception is `build-earth.py`, a one-off asset build run by hand.

## Data flow

- **`sources.json`** — curated catalog, edited by hand or by the scripts. Each source has
  `id, name, lang, country, tz, tags, categories, streams[]`. `lang` is ISO 639-1, or the
  ISO 639-3 code when there is no two-letter one; the UI names both via `Intl.DisplayNames`. `categories` holds iptv-org
  category ids, what the category filter matches (`news`, `sports`, `business`, `weather`). `streams` is an ordered preference list of
  `{kind: "hls", url, page?}`, each with an `origin`
  (`host, kind, label, via`), filled in by `annotate-origin.py`. `via` (`curated` / `iptv-org` / `free-tv`)
  comes from the source's top-level `via`, overridden by a stream-level `via` (fallbacks added by
  `--alternatives` carry their own).
- **`live.json`** — generated, never edit by hand. `refresh-live.py` writes per-source
  `{state, use, streams[], reason}`, `state` being `ok` / `unverified` / `dead`. Each stream is
  checked down to the first variant, the segment hls.js starts from (live edge − 3) and a
  playlist that moves (re-read after a target duration, up to 3 times). Only faults that
  hit every viewer are `dead` (no CORS, http, 404…); geoblock-like answers (403/451), 5xx and
  timeouts are `unverified` and the client still tries them. Hysteresis: a `dead` fault counts
  only after 24 h of failing (`failing_since`, kept by stream position; plain http is
  immediate); before that it is `unverified`. One success clears it. `use` is the first `ok` stream, else
  the first `unverified`; `ok` entries carry the variant `heights`. The file is rewritten only
  when a verdict changes, not for a new reason alone (`generated` = last change). `.github/workflows/refresh.yml` runs it hourly and commits `live.json` as
  `newswall-bot` whenever a verdict changed — pull before editing `live.json`-adjacent work, and on a
  `live.json` conflict keep either side and rerun the script.
- **`origin` honesty rule** (`annotate-origin.py`): never invent a broadcaster label. Only label it
  when the domain makes it obvious, or when the stream has a `page` (the broadcaster's own page
  that publishes the URL: the label is that page's domain); otherwise `cdn` / `unknown`. Relays/personal hosts
  (`github.io`, `workers.dev`, …) are `rebroadcast` and shown in orange in the UI.
- **`scripts/curated/<category>.txt`** — the hand-picked iptv-org ids per category (one per line,
  reason in a comment); `harvest-iptv.py --write` only adds candidates listed there, and an id
  already in `sources.json` just gets that category appended. Selection criterion: legitimate
  origin (broadcaster, club/league, official FAST feed), no rebroadcasts or pay channels via proxies. Selection criterion: national/international broadcasters that represent a national
  narrative; no local TV, radio, duplicates.

## JS architecture

Native ES modules, loaded as they are (`<script type="module">`). Two layers:

- **`js/core/`** — shared by every view (the wall today, the globe planned in
  `docs/globe-plan.md`). `data.js`: `loadCatalog()` fills `catalog` (`all`, `live`,
  `generated`); `CATEGORIES`, `byId`, `inCategory(s, c)`, `passes(s, filter)`, `wallFor(ids)`, `liveState`,
  `isPlayable` (not dead), `firstStream`, `wallFor(ids)` (null = the default wall, `[]` stays empty), `flag`, `countryName`, `langName`, `originText`, `escapeHtml`.
  `url.js`: URL hash (`#c=…&n=<name>&s=…`, `readLinkWall()`, `viewHash(filter, ids, name)`,
  `saveView`) and `FILTER_KEY` = `newswall:filter`.
  `walls.js`: your named walls in localStorage, `WALLS_KEY` = `newswall:walls` =
  `{active, walls: [{id, name, ids}]}`, never empty (the old single-wall key `newswall` is
  migrated on first read). Every write re-reads first (`change()`): another tab may have
  written. `loadWalls`, `activeWall`, `findWall(book, ids, name)`, `setActive`, `setWallIds`,
  `addWall(name, ids, replace?)`, `renameWall`, `removeWall` (never the last), `freeName`.
  `filter.js`: `mountFilter(el, onChange)` draws the category keys (both views), `toggleCategory`,
  `filterLabel`.
  `hls-player.js`: `createHlsPlayer(url, {muted, cap, onReady, onFail})` → `{video, hls, play,
  setCap(height|null), destroy}` — one stream, retries + 15 s watchdog, then `onFail`; after
  `destroy()` no callback fires. hls.js stays a classic global script.
- **`js/wall/`** — `wall.js` is the entry point; `panel.js` (catalog + quick search; gets
  `toggleSource` via `initPanel`), `picker.js` (the walls button and menu; gets `show`,
  `adopt`, `save` via `initPicker`), `state.js` (wall `state`, `$`, `toast`, `copyLink`).
- **`js/globe/`** — `globe.js` is the entry point (see "Globe" below).

Wall behaviour:

- **Category filter**: `state.filter` = the lit categories in `CATEGORIES` order, `[]` = all
  (`cleanFilter` turns all four into `[]`). It picks what the catalog shows, never what is on
  the wall: one wall, `wallFor(ids)` falls back to `DEFAULT_WALL`. `state.sources` = the
  filtered catalog (panel list, empty quick search); a typed quick search looks in
  `catalog.all`. The keys live in the Sources panel (`#panel-cats`), the bar only shows a
  badge on the Sources button. URL `#c=news,sports&s=…` (old `#c=sports` links = a filter of
  one), localStorage `newswall:filter`; both views follow each other via the `storage` event.
- `state` (`wall` = `{id, name}`, `active` ids in order, `players` Map id →
  `createHlsPlayer()` handle, `audioOn`, `focused`, `filter`). **Named walls**: `openWall()`
  picks the wall: a link (`#n=…&s=…`) matching one of yours (`findWall`) opens it; on a
  first visit (`book.fresh`) it replaces the default wall; otherwise it is shown as a
  *shared* wall (`state.wall.id === null`), never saved until `adopt()` (Save, or any
  change: add/remove/reorder). No link: the active wall. `save()` writes the hash and,
  for your own wall, its ids; `show(w)` puts a wall on screen through `commit()`.
  The `storage` event on `WALLS_KEY` follows the other tab, except while a shared wall
  is on screen. Max `MAX_TILES` = 12.
- **Reconcile, don't rebuild**: `syncGrid()` only adds/removes changed tiles, and visual order is
  CSS `order` (`orderTiles()`), never DOM moves — moving a `<video>` node restarts it. Preserve
  this in any grid/reorder change.
- **Stream fallback**: `attach(tile, src, idx)` mounts stream `idx` (starting from `live.use` via
  `firstStream`); the player's `onFail` `detach`es and tries `idx + 1`,
  ending in `markDead`. Async callbacks must check `tile.isConnected` before reattaching.
- **Quality**: HLS tiles are capped at `LOW_QUALITY_CAP` (480p) via `player.setCap()`; only
  the focused tile (`setFocus`) gets full resolution.
- **HLS only**: YouTube was dropped in October 2026 (iframes ignore quality, swallow mouse
  events, can't be globe textures, and live videoIds churn). Don't reintroduce non-HLS kinds.
- One audio at a time (`setAudio`/`setOnAir`); red is reserved for the on-air tile.
- No start screen: muted autoplay needs no gesture, so tiles `play()` as soon as they mount;
  the first click on a tile (a gesture) unmutes it. Same on the globe.
- Country codes are ISO 3166 (`GB`, not iptv-org's `UK`: `harvest-iptv.py` maps it).

## Globe

- Earth-fixed frame: the globe never rotates, the camera orbits it (`view = {lat, lon, dist}`,
  `flyTo()` animates it). `geo.js` `toVec(lat, lon)` matches three's `SphereGeometry` UVs;
  the sun direction comes from `sun.js` `subsolar()` and drives the day/night shader.
- `screens.js`: one group per channel passing the filter (all by default; a new filter
  rebuilds them in `setFilter()`, a pane opened by `#filter-btn` holds the keys),
  placed by `relax()` (repulsion + spring to `geo.js` `ANCHOR[country]`); a country missing
  from `ANCHOR` gets no screen. Each frame `update()` sets `facing` (dot with the camera
  direction), orientation, scale, colours; idle cards and labels are canvas textures.
- **Piles**: a country with ≥2 channels is a `pile` (`members`, `rep`, `dir`). `relax()` runs
  twice: every screen alone → `s.fan`, one node per pile → `s.packed`; each frame
  `s.dir` = lerp by `fold` (camera distance, `FAN.near`…`FAN.far`). Non-rep members of a
  folded pile are `hidden`: not pickable, not candidates, not in the live pool. `rep` =
  selected › on air › first not dead. `pileOf(s)` in `globe.js` = the pile when it is folded
  and `s` is not selected: then click/Enter call `openPile()` instead of `select()`.
- **Stills**: `livepool` calls `onIdle` *before* `destroy()`, so `screens.capture(s)` can draw
  the video's last frame (MSE video does not taint the canvas). `drawIdle(s)` = still, else
  title card with `s.logo` (lazy-loaded on first visibility, cropped, plate by brightness).
- `livepool.js`: plays the top K by `facing` (4; 3 touch; 2 phones) plus `pinned` (selected, on air), keeps them
  until they leave the top K+2, starts new ones only after 400 ms of still camera, 2 at a
  time; `hlsOrder(src)` = streams from `live.use`, skipping those `live.json` marks dead.
  Players use `createHlsPlayer(…, {native: false})` — Safari's native HLS can't be a texture.
- Controls only emit commands (`rotate, zoom, pick, hover, front, next, select, audio, fav,
  filter, back, openWall`; `filter(0)` = all, `1`–`4` toggle, relative = gamepad shoulders): the phase 3 phone remote is meant to send the same ones.
- **Ground**: `*-8k.jpg` (desktops) / `*-4k.jpg` (touch, or `maxTextureSize` < 8192).
  `day-*` = the Blue Marble's colours, used on the lit side; `earth-*` = R = land brightness (0 = water), G = elevation, B = city lights, 4:4:4
  chroma so channels don't bleed. The shader tilts the normal by the elevation's slope for
  relief lit by `sunDir`. `boot()` loads both behind `#boot` (`hud.boot()`: progress by bytes,
  a log line per asset) and uploads them with `renderer.initTexture` before the first flight.
- **Card** (`hud.renderCard`): compact (`.target`) for the screen under the pointer
  (`g.pointed`, "click select"), else the one in the crosshair; selected, it shows the
  logo plate (`g.logos`, dark plate when `s.logoLight`) and `.cfacts` (language + its own
  name, local time + UTC offset, best `heights` from live.json, origin, walls); icon-only
  actions, the last one ✕. A click on the globe beside the screens, ✕ or Esc lets go. On a large screen (`roomy` media query) `dockCard()` in `globe.js` makes it the
  screen itself: `s.lifted` hides the 3D face, frame, label (not the thread), the card
  takes the screen's `<video>` into `.cmedia` (`fillMedia`/`releaseMedia`, the same
  restart-after-removal trick as full screen) and every frame `placeCard()` centres the
  video on the screen's projected place, upright (`translate`). `liftOff()` flies it in
  from `rectOf()`. Full screen flies from `.cmedia` and gives the video back on close.
- **Favourites** (★, `g.favs`) *are* the active wall (`g.wall`, `readFavs()` from
  `core/walls.js`), written back with `setWallIds` (localStorage only, the globe keeps its
  URL), at most `MAX_WALL`. `#favs-wall` in the Favourites pane picks the active wall
  (`pickWall`). The wall's Sources panel shows its tiles with the same star; each view follows
  the other's tab via the `storage` event on `WALLS_KEY`. `openWall()` opens that wall (with its name). Gold (`--star`) is theirs only, like red
  for on air.
- `frontrow.js` (user-facing name: **Full screen**; closed by the `.front-close` X, Esc or the veil): FLIP animation (stage laid out at its final rect, a transform starts it from
  `rectOf(screen)` = the projected face corners). It borrows the screen's own `<video>`; a
  video removed from the document gets paused by the browser after the task, so `empty()`
  restarts it with a short timeout. While open, a capture-phase keydown in `globe.js` takes
  Esc/F/arrows/Space/B before the globe controls.
- Same house rules as the wall: one audio at a time, red only for the one talking, orange
  for rebroadcasts, `backdrop-filter` only on HUD surfaces seen one at a time.

## UI conventions

Dark "control room" look: frosted glass over video. `backdrop-filter` is expensive — use it only
on surfaces visible one at a time (bar, panels, tile controls), not on per-tile labels (those use
gradients). Typefaces: Schibsted Grotesk + Spline Sans Mono (clocks, codes, origins).
