# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Newswall: a static page showing a wall of live HLS channels, one with audio
at a time, to compare how different countries tell the same event. `globe.html` is a second
view of the same catalog: a three.js globe with the channels' screens over their countries. News is the main wall; the
others (Sport, Markets, Weather) are "modes" keyed by iptv-org category ids. No backend, no build step,
no package manager, no tests. Vanilla JS as native ES modules in `js/` (no bundler), plus
`index.html` and `styles.css`; runtime dependencies are vendored in `assets/vendor/` (hls.js;
three.js 0.170.0, loaded only by the globe through an import map). Fonts are vendored in
`assets/fonts/` on purpose: the page must make **no third-party requests** to render (do not add
CDN links). The README is the design document — read it before non-trivial changes. Its "Possible improvements" section is the backlog: add ideas there, remove them once done.

## Commands

```bash
./start.sh [port]                                   # scripts/serve.py on 127.0.0.1:8080 (file:// breaks ES modules;
                                                    # serve.py adds Cache-Control: no-cache, or stale ES modules survive reloads)
python3 scripts/build-borders.py                    # Natural Earth outlines -> assets/earth/borders.json (rarely needed)
python3 scripts/refresh-live.py                     # check every stream, rewrite live.json
python3 scripts/annotate-origin.py [--write]        # (re)compute each stream's `origin`
python3 scripts/harvest-iptv.py [--category sports] [--write] [--cache DIR]
                                                    # candidates from iptv-org; --write adds only ids in scripts/curated/<category>.txt
python3 scripts/harvest-iptv.py --alternatives --write   # add fallback streams to existing channels
python3 scripts/harvest-iptv.py --source free-tv [...]  # same, from the Free-TV/IPTV playlist
```

Python scripts use the standard library only — keep it that way (they run bare in a GitHub Action).

## Data flow

- **`sources.json`** — curated catalog, edited by hand or by the scripts. Each source has
  `id, name, lang, country, tz, tags, categories, streams[]`. `lang` is ISO 639-1, or the
  ISO 639-3 code when there is no two-letter one; the UI names both via `Intl.DisplayNames`. `categories` holds iptv-org
  category ids = the walls the source appears in (`news`, `sports`, `business`, `weather`). `streams` is an ordered preference list of
  `{kind: "hls", url, page?}`, each with an `origin`
  (`host, kind, label, via`), filled in by `annotate-origin.py`. `via` (`curated` / `iptv-org` / `free-tv`)
  comes from the source's top-level `via`, overridden by a stream-level `via` (fallbacks added by
  `--alternatives` carry their own).
- **`live.json`** — generated, never edit by hand. `refresh-live.py` writes per-source
  `{ok, use, streams[], reason}`: `use` is the index of the first working stream; stream entries
  carry the variant `heights`. `.github/workflows/refresh.yml` runs it hourly and commits `live.json` as
  `newswall-bot` — expect frequent bot commits upstream; pull before editing `live.json`-adjacent work.
- **`origin` honesty rule** (`annotate-origin.py`): never invent a broadcaster label. Only label it
  when the domain makes it obvious, or when the stream has a `page` (the broadcaster's own page
  that publishes the URL: the label is that page's domain); otherwise `cdn` / `unknown`. Relays/personal hosts
  (`github.io`, `workers.dev`, …) are `rebroadcast` and shown in orange in the UI.
- **`scripts/curated/<category>.txt`** — the hand-picked iptv-org ids per wall (one per line,
  reason in a comment); `harvest-iptv.py --write` only adds candidates listed there, and an id
  already in `sources.json` just gets that category appended. Selection criterion: legitimate
  origin (broadcaster, club/league, official FAST feed), no rebroadcasts or pay channels via proxies. Selection criterion: national/international broadcasters that represent a national
  narrative; no local TV, radio, duplicates.

## JS architecture

Native ES modules, loaded as they are (`<script type="module">`). Two layers:

- **`js/core/`** — shared by every view (the wall today, the globe planned in
  `docs/globe-plan.md`). `data.js`: `loadCatalog()` fills `catalog` (`all`, `live`,
  `generated`); `MODES`, `byId`, `inMode(s, mode)`, `isPlayable`, `firstStream`, `flag`,
  `countryName`, `langName`, `originText`, `escapeHtml`. `url.js`: URL hash and localStorage.
  `hls-player.js`: `createHlsPlayer(url, {muted, cap, onReady, onFail})` → `{video, hls, play,
  setCap(height|null), destroy}` — one stream, retries + 15 s watchdog, then `onFail`; after
  `destroy()` no callback fires. hls.js stays a classic global script.
- **`js/wall/`** — `wall.js` is the entry point; `panel.js` (catalog + quick search; gets
  `toggleSource` via `initPanel`), `state.js` (wall `state`, `$`, `toast`).
- **`js/globe/`** — `globe.js` is the entry point (see "Globe" below).

Wall behaviour:

- **Modes**: `MODES` maps category id → label and optional hand-picked default `wall` (else
  `wallFor()` picks the first live channels, one per country). `catalog.all` is the whole
  catalog, `state.sources` the current mode's subset (panel and search use it); `byId` looks in
  `catalog.all`. URL `#c=<mode>&s=…` (no `c` = news), localStorage `newswall` (news) /
  `newswall:<mode>` per wall, `newswall:mode` for the last mode. `setMode()` swaps the wall
  through `commit()`, so shared tiles keep playing.
- `state` (`active` ids in order, `players` Map id → `createHlsPlayer()` handle, `audioOn`,
  `focused`). Wall comes from URL hash `#s=a,b,c`, then localStorage, then the mode default.
  `saveWall()`/`commit()` write both back — the URL *is* the shareable configuration.
  Max `MAX_TILES` = 12.
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
- `screens.js`: one group per channel of the mode,
  placed by `relax()` (repulsion + spring to `geo.js` `ANCHOR[country]`); a country missing
  from `ANCHOR` gets no screen. Each frame `update()` sets `facing` (dot with the camera
  direction), orientation, scale, colours; idle cards and labels are canvas textures.
- `livepool.js`: plays the top K by `facing` plus `pinned` (selected, on air), keeps them
  until they leave the top K+2, starts new ones only after 400 ms of still camera, 2 at a
  time; `hlsOrder(src)` = streams from `live.use`, skipping those `live.json` marks dead.
  Players use `createHlsPlayer(…, {native: false})` — Safari's native HLS can't be a texture.
- Controls only emit commands (`rotate, zoom, pick, hover, front, next, select, audio, basket,
  mode, back, openWall`): the phase 3 phone remote is meant to send the same ones.
- `frontrow.js`: FLIP animation (stage laid out at its final rect, a transform starts it from
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
