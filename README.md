# Newswall

Several live news channels on the same screen. Only one talks, you keep an eye on the
others. The point is to see **how the same event is told by different countries**, at the
same moment.

News comes first, not alone: the catalog also holds **Sport**, **Markets** and **Weather**
channels, with the same rule — many countries, one screen. Every channel is there to pick;
the category keys narrow it down to one or more of them.

Beside the wall there is **the globe** (`globe.html`): the same channels as screens hanging
over their countries, on an Earth with the real day and night. It is for exploring; the
wall is for watching.

A static page: no backend, no account, no cookies, no data collected. Every channel is an
HLS stream that goes straight from the broadcaster to your browser.

## Try it locally

```bash
./start.sh
```

Opens <http://localhost:8080>. A real HTTP server is needed: from `file://` the browser
refuses ES modules and the JSON catalogs. `start.sh` runs `scripts/serve.py`, a plain static
server that adds `Cache-Control: no-cache`: without it the browser keeps old JS modules
after an edit, even on reload.

## Controls

| | |
|---|---|
| click a tile | gives it the audio (and takes it from all the others) |
| double click | enlarges it to full screen |
| drag | reorders the tiles |
| `⌘K` / `Ctrl-K` / `/` | quick search: add and remove channels |
| `1`–`9` | quick audio on the n-th tile |
| `S` | catalog · `M` mute everything · `F` full screen |
| `Esc` | back to the grid · `?` shortcuts |
| News · Sport · Markets · Weather | category keys, in the catalog: none lit = every channel |
| `G` · Globe | opens the globe, with the same categories |

### Building the wall

Three ways, depending on what you already know:

- **Quick search** (`⌘K`) — type and press enter. It searches the name, the country (also
  spelled out: *germany* → DW, DW Español, RT DE), the language (code or name: *pashto* →
  TOLOnews), the tags and the initials
  (*aje* → Al Jazeera English), across the whole catalog, whatever the category filter.
  With an empty query it puts the channels already on the wall at the top, so removing
  one is a single enter.
- **On the tile** — hovering shows the controls: audio, enlarge, **switch source** (when
  the channel has more than one) and **✕ to remove it**. The dashed `+` slot takes the
  grid's leftover cell and opens the search.
- **Catalog** (`S`) — for browsing. On top, the **category** keys (see below); then filter
  by **country** and by **language** (menus with
  the names and the number of channels for each), by **area**, and with free-text search.
  The filters combine. Every channel carries its flag and its language, on the tile and in
  the list.

Adding or removing a channel **does not stop the others**: the grid reconciles itself with
what is already there, and visual order is set by the CSS grid's `order`, not the DOM
(moving a `<video>` node would restart it).

The wall's layout ends up in the URL: **the link is the configuration**, shareable as is
(`#c=news,sports&s=…`). It is also kept in `localStorage` for convenience.

### Categories

Every source carries one or more [iptv-org categories](https://iptv-org.github.io/api/categories.json)
in `categories`: `news`, `sports` (Sport), `business` (Markets), `weather` (CNBC is both
news and markets). They are a **filter, not separate walls**: with no key lit you see every
channel; light one and only that category is left, light more and they add up. The keys
sit at the top of the Sources panel, in the look of a vision mixer's bus (a white lamp on
each lit key: red stays the tally's), and the Sources button names the filter when one is set.

The filter chooses what the catalog shows, **not what is on the wall**: there is one wall,
and its tiles stay whatever their category. It is shared with the globe like the
favourites (`localStorage`, and `c` in the URL: the old one-wall links, `#c=sports`, open
as a filter of one), and an open tab of one view follows the other.

## The globe

`globe.html` is the exploration view; a *Wall / Globe* switch next to the logo, on both
pages, says which view you are in and leads to the other. The Earth has its true colours by day,
its mountains shaded by the real sun, with a faint glint where the sun meets the sea, and
dark at night, with the city lights (NASA's Black Marble) showing only on the night side:
at a glance you see where it is night and the news is on reruns. The terminator is
computed from the UTC time. The ground is in 8192×4096 maps (4096×2048 on phones and small
GPUs), sharp up close, so the page opens on a short loading screen that shows what is
ready.

Every channel is a screen hanging over its country (all of them, unless the category
filter says otherwise: the *All channels* button in the bar opens the same keys as the
wall's catalog, and changing them in one view changes the other), with a thread down
to the place it broadcasts from (the capital, or the city its newsrooms work in). Crowded
regions push their screens apart, but the thread always goes back to the real place.

- **Piles**: from afar, a country with several channels is a single screen with two cards
  peeking out behind it and its count on the label (*France ×6*). Coming closer fans the
  pile out, each screen growing out of it to its own place. Clicking a folded pile (or
  `Enter` on it) flies in until it opens. The channel selected or talking is the face of
  its pile when it folds again.
- **Only the screens in front of you play**: the 4 nearest the centre of the view (3 on
  touch devices, 2 on phones), at 360p (240p on touch). Decoding dozens of streams is
  impossible. A live screen stays live until it drops out of the first 6, so turning
  the globe a little does not restart everything, and new streams start only once the
  camera has stopped.
- **Still screens** show the **last frame** they played, desaturated, with the time it was
  seen; one that has not played yet shows a title card with the channel's logo. A hidden
  tab stops every stream except the one talking, and each leaves its last frame behind.
- **Flights** last as long as the trip: a short hop is quick, a flight across the world
  climbs on the way and comes down at the end. With *reduce motion* set in the system, the
  camera jumps instead, and nothing breathes or pulses.
- **Selecting** a screen (click, or `Enter` on the one in the crosshair) flies to it,
  enlarges it, gives it full quality and the audio: its frame turns red, the only red on
  the globe, as on the wall. Its country lights up, and its card shows what the catalog
  knows: the broadcaster's logo, the language (also in itself), the local time and its
  UTC offset, the best picture the last check saw, where the stream comes from, its
  categories; then three icons: full screen, audio, favourite (★). On a large screen
  the selected screen comes off the globe, straightens and grows into the card, video
  and all: an upright monitor with its facts underneath, which follows the channel's
  place as the globe turns (the thread to the ground stays). On phones and small windows
  the card stays in the corner and the video on the globe.
- **Full screen** (`F`, a double click, or the card's button) brings the channel to the
  front, as large as the window allows: it flies in from its place on the globe, which
  stays blurred behind it, and flies back there with the X in the corner, `Esc`, or a
  click outside it. `←` `→` change channel without leaving it. It is the same `<video>` that paints
  the screen on the globe: no second player, no second download.
- **The look**: screens in glass bezels with a soft shadow, a glow on the one targeted
  (red and breathing on the one talking), frosted-glass panes with a faint grain, a
  viewfinder whose crosshair locks onto the screen in the middle, and a telemetry pane
  (view, altitude, where the sun is overhead, how many are live). The page opens with
  the camera flying in from far out.
- **Favourites (★) are the wall's channels**: one list, up to 12. Starring a
  screen puts it on the wall, a channel added on the wall is starred on the globe
  (the Sources panel shows the same gold star), and an open tab of one view follows the
  other. *Open the wall* (`⇧Enter`) goes there, through the same URL a shared link uses.
- **Always hls.js.** A video becomes a WebGL texture only through MediaSource, so the
  globe always uses hls.js, never Safari's native HLS.
- **On a slow device** the globe lowers its own resolution: when the frame rate stays under
  40 fps, the pixel ratio steps down (never below 1, never back up).

| | mouse / touch | keyboard | gamepad |
|---|---|---|---|
| turn | drag (with inertia) | arrows / WASD | left stick |
| zoom | wheel / pinch | `+` `-` | triggers |
| next screen | — | `Tab` / `⇧Tab` | right stick / pad |
| select, and listen (or open a pile) | click | `Enter` | A |
| full screen, and back | double click / *Full screen*, X | `F` | A again / B |
| audio on / off | click the selected one | `Space` | X |
| favourite | ★ | `B` | Y |
| categories | *All channels* in the bar | `1`–`4` toggle one, `0` all | LB / RB step through |
| back | — | `Esc` | B |
| open the wall (the favourites) | *Open the wall* | `⇧Enter` | Start |

The plan for what comes next (a phone as a remote) is in
[`docs/globe-plan.md`](docs/globe-plan.md).

## The interface

A control room at night: the video is the content, everything else is frosted glass
floating on top of it (`backdrop-filter` with saturation, so the video's colours seep
through the UI). Cool greys everywhere except **one thing**: red is the tally light and
marks the only tile that has the floor — on the tile's border and in the top bar, which
always says who is talking.

Real glass is expensive: blurring twelve surfaces at 60fps over twelve videos is not an
option. So the tile labels use a gradient (which costs nothing) and `backdrop-filter` is
kept for the bar, the panels and the tile controls, which are visible one at a time.

Typefaces: **Schibsted Grotesk** (designed for a news publishing group) and **Spline Sans
Mono** for clocks, codes and origins. They live in the repo, not on a CDN: the page makes
**no** third-party requests to render.

## How it's built

Vanilla JS, no build step. Runtime dependencies are vendored in `assets/vendor/`:
[hls.js](https://github.com/video-dev/hls.js), and [three.js](https://threejs.org) 0.170.0
for the globe only (the wall never loads it). The globe's Earth is in `assets/earth/`: NASA
Blue Marble, GEBCO elevation and Black Marble (public domain) packed by
`scripts/build-earth.py` into two JPEGs per size (8192×4096 and 4096×2048): the
day colours, and the three maps packed one per colour channel; and Natural Earth 1:50m outlines (public domain) turned into a compact JSON by
`scripts/build-borders.py`.
Channel logos are in `assets/logos/`, fetched from iptv-org by `scripts/fetch-logos.py` (they
are the broadcasters' trademarks, there only to tell the channels apart).
`index.html`, `styles.css`, and native ES modules in `js/` (no bundler: the browser loads
them as they are):

- `js/core/` — what any view of the catalog needs: `data.js` (load `sources.json` and
  `live.json`, categories, names, flags, origins), `url.js` (the wall and the category
  filter in the URL and in localStorage), `filter.js` (the category keys, drawn the same
  in both views), `hls-player.js` (one HLS stream in a `<video>`, with retries, watchdog and
  quality cap, knowing nothing about tiles).
- `js/wall/` — the wall: `wall.js` (entry point: grid, tiles, audio, focus, keys),
  `panel.js` (catalog and quick search), `state.js` (what they share).
- `js/globe/` — the globe, loaded by `globe.html` with an import map for three:
  `globe.js` (entry point: loading, scene, camera, selection, audio, favourites), `earth.js`
  (ground texture, shaders, atmosphere, outlines, stars), `sun.js` (subsolar point), `geo.js` (where each country's
  screens hang), `screens.js` (screens, threads, markers), `livepool.js` (who is live),
  `controls.js` (mouse, touch, keyboard, gamepad → commands), `hud.js` (the HTML on top),
  `frontrow.js` (full screen and its flight in and out).

Every stream is **HLS** (`kind: "hls"`), played in a native `<video>`. The app decides the
quality, so small tiles download a small variant (`capLevelToPlayerSize`) and only the
enlarged one goes to full resolution; nothing from a third party sits on top of the video,
and the wall and the globe show the same channels.

YouTube was supported until October 2026 and then dropped: an iframe ignores quality
requests, swallows mouse events, needs its own postMessage protocol, cannot be a texture
on the globe, and its live `videoId`s change all the time, so the catalog was never stable.
It cost 11 channels, none of them the only voice of its country.

### Several sources per channel

Each source lists **one or more streams in order of preference**. If the first one does
not start — dead CDN, geoblocking, stream ended — the app falls back to the next one on its
own, without the tile going dark. There are currently **234 streams for 177 channels**:
forty-one have at least one fallback.

```json
{ "id": "aljazeera-en", "name": "Al Jazeera English", ...,
  "streams": [
    { "kind": "hls", "url": "https://live-hls-apps-aje-fa.getaj.net/AJE/index.m3u8",
      "origin": { "host": "live-hls-apps-aje-fa.getaj.net", "kind": "broadcaster",
                  "label": "Al Jazeera", "via": "curated" } },
    { "kind": "hls", "url": "https://...", "via": "iptv-org", "origin": { ... } }
  ] }
```

### Where every stream comes from, always stated

Every stream carries an `origin` field that the interface shows next to the channel name,
on the tile and in the panel. It tells you whether you are watching the broadcaster or
someone else rebroadcasting it:

| `kind` | meaning |
|---|---|
| `broadcaster` | the domain belongs to the broadcaster itself, or the broadcaster's own page publishes the URL |
| `cdn` | technical delivery (Akamai, CloudFront, Amagi…): it tells how it arrives, not who publishes it |
| `rebroadcast` | a third party putting someone else's feed back on air — highlighted in orange |
| `unknown` | a host that fits none of the cases above |

Labels are never made up: host and the way the stream was found are hard facts and are
always recorded; the broadcaster name only appears when the domain makes it obvious. The
rest stays `cdn` or `unknown`, which is honest information rather than a guess.

The other proof is a stream's `page`: the broadcaster's own live page where that URL was
found (`https://news.sky.com/watch-live`, `https://www.dw.com/en/live-tv/channel-english`…).
A stream published there is the broadcaster's whatever CDN delivers it, and its label is the
page's domain. Such official URLs go first in the preference list; third-party copies stay
behind them as fallbacks.

```bash
python3 scripts/annotate-origin.py --write
```

That is how it turned out that TVP World was coming from a private individual's GitHub
Pages: it stays in the catalog, but its tile says so in orange.

### The catalog maintains itself

`sources.json` is the curated catalog. `scripts/refresh-live.py` checks every stream and
writes `live.json`:

```bash
python3 scripts/refresh-live.py
```

For every stream it checks HTTPS, reachability, CORS and that the answer is a real HLS
manifest, the way the browser would in its first seconds:

- CORS must allow `*` or the page's own origin, on every redirect too;
- the first variant playlist must load (some CDNs open the master playlist to everyone and
  keep the variants for their own site);
- the segment hls.js starts from, three before the live edge, must load;
- the playlist must move: it is read again after one target duration, up to three times
  (some servers add segments in bursts). A stuck playlist answers but plays nothing.

A check takes about a minute, most of it waiting for playlists to move. Standard library
only, no API key.

The verdict has three states, because the checker sees the streams from one place only:

| state | when | the page |
| --- | --- | --- |
| `ok` | a real manifest, with CORS | plays it first |
| `unverified` | 401/403/451 (often a geoblock), 429, 5xx, timeouts, refused connections | tries it anyway |
| `dead` | plain http, no CORS, not a manifest, 400/404/405/410 (segments included), unknown host, bad certificate, stuck playlist | hides it |

A fault turns a stream `dead` only after it has lasted 24 hours (plain http excepted: the
URL says so already). Until then the stream is `unverified`, with `failing_since`, so a CDN
that answers 404 for ten minutes does not take a channel off the wall. One working check
makes it `ok` again.

The bot advises, the browser decides: an unverified channel that does not play from where
the viewer is falls back to its next stream and then shows as off air, as any other failure.

`.github/workflows/refresh.yml` runs it every hour. `live.json` is rewritten only when a
state changes, so a quiet catalog makes no commit, and `generated` is when the status last
changed. A new reason for the same failure (a timeout, then a 503) is not a change. That is why the project needs no server.

## The catalog

**177 sources from 76 countries**, 152 of them fished out of
[iptv-org](https://github.com/iptv-org/iptv) and hand-picked:

| category | channels | countries |
|---|---|---|
| News | 114 | 65 |
| Sport | 35 | 25 |
| Markets | 21 | 17 |
| Weather | 9 | 5 |

The criterion is the point of the project — comparing national narratives — so national
and international broadcasters are in; local TV, radio and duplicates are out.

In practice, that means putting IRINN (Iranian state TV), Press TV (its English voice
abroad) and Iran International (the opposition, based in London) on the same screen;
Al-Manar and Makan 33; CCTV, Telesur and RT in four languages.

The other categories follow the same idea. **Sport** is national sport channels (Iran's Varzesh
next to Romania's TVR Sport and Kazakhstan's QazSport), clubs and leagues on their own
channels, and the official free channels: live matches are almost never free, and pay
channels that only turn up through anonymous proxies (Eurosport, ESPN, beIN…) are out.
**Markets** is one financial channel per market, so the same session reads differently in
Mumbai, Dubai, Frankfurt and New York.

Of RT in English only the Indian feed is left: `rt-glb.rttv.com`, the global one, answers
**403** from the very same server that serves `rt-india` without complaint — RT closed the
endpoint, not someone along the way.

### Fishing from the public catalog

```bash
python3 scripts/harvest-iptv.py                     # preview the news candidates
python3 scripts/harvest-iptv.py --category sports   # …or those of another wall
python3 scripts/harvest-iptv.py --write             # add the curated ones to sources.json
```

It downloads the iptv-org catalog, keeps only the channels of that category that pass the technical
check (HTTPS + CORS + manifest, and no mandatory referrer or user-agent: those would not
work from a browser), drops radio and niche channels, and caps the number of channels per
country — without that cap the 219 Indian broadcasters would take over the whole wall.

Out of 858 news candidates, **577 turned out to be usable (67%)**. The final selection
lives in [`scripts/curated/`](scripts/curated), one file per wall (`news.txt`,
`sports.txt`…), one id per line with the reason next to it: that is where things get
added or removed. `--write` only adds the candidates listed there (marked `*` in the
preview); the others are just shown. An id that is already in the catalog simply joins
that wall too. Each channel gets its first stream that works: iptv-org often lists dead
mirrors first.

With `--alternatives` it adds no new channels: instead it looks for **other sources for
the ones already there**, and queues them as fallbacks.

```bash
python3 scripts/harvest-iptv.py --alternatives --write
```

#### Free-TV as a second catalog

```bash
python3 scripts/harvest-iptv.py --source free-tv                  # preview
python3 scripts/harvest-iptv.py --source free-tv --alternatives   # fallbacks for existing channels
```

[Free-TV/IPTV](https://github.com/Free-TV/IPTV) is much smaller than iptv-org (~1,800
channels) but stricter, and closer to this project's criterion: only channels officially free
to everyone, one URL per channel, no paid channels or alternate feeds. Its `tvg-id` uses
iptv-org's channel ids, so most entries borrow iptv-org's categories, language and time zone,
and keep the same source id: the same `scripts/curated/<category>.txt` works for both catalogs.
Channels iptv-org does not know take language and time zone from their country, and get a
category only from Free-TV's own "News" / "Business" / "Weather" groups; otherwise they are in
only if curated. Geo-blocked (`Ⓖ`), VOD, YouTube, Twitch and Dailymotion entries are
skipped. What it adds carries `via: "free-tv"`.

### Logos

```bash
python3 scripts/fetch-logos.py            # preview
python3 scripts/fetch-logos.py --write    # download into assets/logos/
```

The globe's title cards use the channels' logos, taken from iptv-org's `logos.json`. A
source is matched to an iptv-org channel by country and name (a few by hand, in the
script's `MANUAL`). Nothing is resized, since the standard library cannot: of the variants
iptv-org lists, the script takes the smallest that is at least 160 px wide and under
120 KB, and checks that the file is what it claims to be. `assets/logos/logos.json` maps
each source to its file; sources without one keep the flag. Run it again after adding
channels: it only fetches what is missing.

## Adding a source by hand

One entry in `sources.json`, then a PR:

```json
{ "id": "channel-name", "name": "Channel Name", "lang": "en", "country": "XX",
  "tz": "Area/City", "tags": ["world"], "categories": ["news"],
  "streams": [
    { "kind": "hls", "url": "https://.../playlist.m3u8", "page": "https://broadcaster/live" },
    { "kind": "hls", "url": "https://.../fallback.m3u8" }
  ] }
```

One or more streams, in order of preference; `page` (optional) is the official page that
publishes the URL. Then fill in the `origin` fields and
check that it holds up before opening the PR:

```bash
python3 scripts/annotate-origin.py --write
python3 scripts/refresh-live.py
```

Rejects are almost all plain `http://` (blocked as mixed content) and dead streams.
CORS, against all expectations, is not the problem: 1 in 70.

## Known limitations

- **Load.** Every tile is a real video. Quality adapts to the tile size, but beyond 6-8
  tiles you will hear the fans.
- **Geoblocking.** Some broadcasters serve the manifest to anyone but the segments only in
  their own country. The check sees the 403, but cannot tell a geoblock from a refusal, so
  the channel stays `unverified` and is tried: from outside the country the tile notices
  on its own after a few seconds and says so, instead of staying black.
- **Autoplay.** Browsers allow automatic playback only without sound: the wall and the
  globe open straight away, muted, and the first click on a channel brings its audio.
- **Sources come and go.** Daily breakages are normal: the Action detects them, and the
  tile says what happened.
- **A crowded globe.** Piles fold each country into one screen, but Europe and the Middle
  East have many countries close together: from afar their screens still touch.

## Possible improvements

Ideas collected along the way, not yet done. The globe's own next steps are in
[`docs/globe-plan.md`](docs/globe-plan.md).

- **Stream URLs that update themselves.** Broadcasters change CDN and a curated channel
  dies even when iptv-org already lists its new address. Today that is recovered only by
  running `harvest-iptv.py --alternatives` by hand: a daily step in the Action could do it,
  adding new working streams of channels *already in the catalog* as fallbacks and
  committing them. The selection stays hand-made; only the addresses stay fresh.
  (Loading the iptv-org list straight from the page was considered and set aside: ~12 MB
  per visit, hundreds of streams to test from every browser, no curation, and shared
  links would break when iptv-org ids change.)
- **Honour iptv-org's `blocklist.json`.** Channels removed after DMCA notices or for being
  NSFW are listed there: `harvest-iptv.py` could skip them, instead of relying on the
  curated lists alone.
- **An "explore iptv-org" view.** Opt-in, loaded only on request, clearly labelled as
  unverified and not hand-picked: for browsing beyond the curated catalog, kept apart from
  them.
- **A parliaments category.** iptv-org's `legislative` category has ~100 usable channels from
  24 countries (Camera dei Deputati, Congreso, Tweede Kamer, Sansad TV…): one more
  `scripts/curated/legislative.txt` and an entry in `CATEGORIES`.
- **Where a channel can be watched.** A per-source `geo` (e.g. `["ES"]` for Teledeporte)
  would let the wall say "only in Spain" instead of a generic failure, and let the check
  treat a 403 from elsewhere as expected. Today ESport3, Teledeporte, CBS Sports Golazo
  and Willow answer 403 on their segments, both to the check and to a browser.
- **Alternative streams for IRINN 2 and Varzesh.** Telewebion opens the master playlist to
  everyone but allows the variants only to `telewebion.net`: the check now marks them dead.
- **More official URLs.** Scraping the broadcasters' live pages found usable URLs for Sky News,
  ABC Australia, DW, Current Time, TRT, RT DE, Asharq and Press TV. The rest do not yield one
  to a plain HTTP request: the player is behind a consent wall that blocks it until cookies
  are accepted (GB News, France 24, Euronews, CNA, Africanews), the URL is signed with a token
  that expires within minutes (Euronews `hdnea`, Rai's relinker), or the page refuses
  scripts (WION, NDTV, TOLOnews, Kan: 403). Tokenised URLs could only work through a
  resolver at refresh time, and expire well before the next refresh: not worth it.
- **Free-TV in the hourly Action.** `--source free-tv --alternatives` could join the
  "stream URLs that update themselves" step above: Free-TV fixes broken URLs by hand,
  often sooner than iptv-org.
- **Browser full screen on the globe.** The globe's *Full screen* fills the window, not the
  display: it could also ask for the Fullscreen API, as the wall's button does, with the
  first `Esc` leaving both at once.
- **Older fallbacks without their real `via`.** Fallbacks added before `via` was recorded
  per stream show up as `curated` even when they came from iptv-org.

## License

MIT. The project neither hosts nor rebroadcasts anything: it only points to streams the
broadcasters already publish.
