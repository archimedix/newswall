# Newswall

Several live news channels on the same screen. Only one talks, you keep an eye on the
others. The point is to see **how the same event is told by different countries**, at the
same moment.

News is the main wall, not the only one: the switch in the top bar turns it into a
**Sport**, **Markets** or **Weather** wall, with the same rule — many countries, one screen.

A static page: no backend, no account, no cookies, no data collected. Streams go straight
from the broadcasters to your browser.

## Try it locally

```bash
./start.sh
```

Opens <http://localhost:8080>. A real HTTP server is needed: from `file://` YouTube embeds
get a `null` origin and are refused.

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
| News · Sport · Markets · Weather | switches wall (top bar) |

### Building the wall

Three ways, depending on what you already know:

- **Quick search** (`⌘K`) — type and press enter. It searches the name, the country (also
  spelled out: *germany* → DW, DW Español, RT DE), the language (code or name: *pashto* →
  TOLOnews), the tags and the initials
  (*aje* → Al Jazeera English). With an empty query it puts the channels already on the
  wall at the top, so removing one is a single enter.
- **On the tile** — hovering shows the controls: audio, enlarge, **switch source** (when
  the channel has more than one) and **✕ to remove it**. The dashed `+` slot takes the
  grid's leftover cell and opens the search.
- **Catalog** (`S`) — for browsing. Filter by **country** and by **language** (menus with
  the names and the number of channels for each), by **area**, and with free-text search.
  The filters combine. Every channel carries its flag and its language, on the tile and in
  the list.

Adding or removing a channel **does not stop the others**: the grid reconciles itself with
what is already there, and visual order is set by the CSS grid's `order`, not the DOM
(moving a node would reload the YouTube iframes).

The wall's layout ends up in the URL: **the link is the configuration**, shareable as is
(`#c=sports&s=…`; no `c` means news, so older links still work). Each wall remembers its
own channels.

### Walls

A wall is an [iptv-org category](https://iptv-org.github.io/api/categories.json): `news`,
`sports`, `business` (Markets), `weather`. Every source says which walls it belongs to in
`categories`, and can be in more than one (CNBC is both news and markets). Switching
wall keeps playing the channels the two walls share, for the same reason as above.
It is also kept in `localStorage` for convenience.

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

Vanilla JS, no build step, a single runtime dependency
([hls.js](https://github.com/video-dev/hls.js), vendored in `assets/vendor/`).
`index.html`, `styles.css`, and native ES modules in `js/` (no bundler: the browser loads
them as they are):

- `js/core/` — what any view of the catalog needs: `data.js` (load `sources.json` and
  `live.json`, modes, names, flags, origins), `url.js` (the wall in the URL and in
  localStorage), `hls-player.js` (one HLS stream in a `<video>`, with retries, watchdog and
  quality cap, knowing nothing about tiles).
- `js/wall/` — the wall: `wall.js` (entry point: grid, tiles, audio, focus, keys),
  `panel.js` (catalog and quick search), `youtube.js` (iframes driven by postMessage),
  `state.js` (what they share).

Two kinds of stream, and they are not equivalent:

- **HLS** (`kind: "hls"`) — a native `<video>`. The preferred route: the app decides the
  quality, so small tiles download a small variant (`capLevelToPlayerSize`) and only the
  enlarged one goes to full resolution. No third-party overlays on top of the video.
- **YouTube** (`kind: "youtube"`) — an iframe, for channels that only live there. It works,
  but the player ignores every quality request (six tiles stay at full resolution) and
  puts its own controls on top.

### Several sources per channel

Each source lists **one or more streams in order of preference**. If the first one does
not start — dead CDN, geoblocking, stream ended — the app falls back to the next one on its
own, without the tile going dark. There are currently **231 streams for 171 channels**:
thirty-eight have at least one fallback.

```json
{ "id": "aljazeera-en", "name": "Al Jazeera English", ...,
  "streams": [
    { "kind": "hls", "url": "https://live-hls-apps-aje-fa.getaj.net/AJE/index.m3u8",
      "origin": { "host": "live-hls-apps-aje-fa.getaj.net", "kind": "broadcaster",
                  "label": "Al Jazeera", "via": "curated" } },
    { "kind": "youtube", "channelId": "UCNye-wNBqNL5ZzHSJj3l8Bg", "origin": { ... } }
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
| `youtube` | the broadcaster's official YouTube channel |
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
Pages: the official YouTube channel now comes first, and that one stays as a fallback.

### The catalog maintains itself

`sources.json` is the curated catalog: the URL for HLS, **only the channelId** for YouTube.
Live videoIds change all the time, so they don't belong there.

`scripts/refresh-live.py` resolves the current state and writes `live.json`:

```bash
python3 scripts/refresh-live.py
```

For every YouTube channel it finds the current live stream, checks that it is **really
live** (a channel that is off air returns its latest upload) and that embedding is
allowed, by asking oEmbed. For every HLS stream it checks HTTPS, reachability and CORS.
Standard library only, no API key.

`.github/workflows/refresh.yml` runs it every hour and commits `live.json`. That is why the
project needs no server.

## The catalog

**171 sources from 68 countries**, 135 of them fished out of
[iptv-org](https://github.com/iptv-org/iptv) and hand-picked:

| wall | channels | countries |
|---|---|---|
| News | 108 | 56 |
| Sport | 35 | 25 |
| Markets | 22 | 17 |
| Weather | 9 | 5 |

The criterion is the point of the project — comparing national narratives — so national
and international broadcasters are in; local TV, radio and duplicates are out.

In practice, that means putting IRINN (Iranian state TV), Press TV (its English voice
abroad) and Iran International (the opposition, based in London) on the same screen;
Al-Manar and Makan 33; CCTV, Telesur and RT in four languages.

The other walls follow the same idea. **Sport** is national sport channels (Iran's Varzesh
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
only if curated. Geo-blocked (`Ⓖ`), VOD, Twitch and Dailymotion entries are skipped; YouTube
entries are resolved to their `channelId`. What it adds carries `via: "free-tv"`.

## Adding a source by hand

One entry in `sources.json`, then a PR:

```json
{ "id": "channel-name", "name": "Channel Name", "lang": "en", "country": "XX",
  "tz": "Area/City", "tags": ["world"], "categories": ["news"],
  "streams": [
    { "kind": "hls", "url": "https://.../playlist.m3u8", "page": "https://broadcaster/live" },
    { "kind": "youtube", "channelId": "UC..." }
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

- **Load.** Every tile is a real video. HLS quality adapts to the tile size, YouTube
  iframes don't. Beyond 6-8 tiles you will hear the fans.
- **Reordering over iframes.** Dragging starts from anywhere on an HLS tile, but events do
  not reach us over a YouTube iframe: there, use the `⠿` grip among the controls.
- **Geoblocking.** Some broadcasters serve the manifest to anyone but the segments only in
  their own country: the automatic check passes them and then the video does not start.
  The tile notices on its own after a few seconds and says so, instead of staying black.
- **Autoplay.** Browsers forbid automatic playback without a user gesture: that is what
  the start screen is for.
- **Sources come and go.** Daily breakages are normal: the Action detects them, and the
  tile says what happened.

## Possible improvements

Ideas collected along the way, not yet done.

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
- **An "explore iptv-org" mode.** Opt-in, loaded only on request, clearly labelled as
  unverified and not hand-picked: for browsing beyond the curated walls, kept apart from
  them.
- **A parliaments wall.** iptv-org's `legislative` category has ~100 usable channels from
  24 countries (Camera dei Deputati, Congreso, Tweede Kamer, Sansad TV…): one more
  `scripts/curated/legislative.txt` and an entry in `MODES`.
- **IRIB streams in the browser.** IRINN and Varzesh (`ncdn.telewebion.ir`) pass the hourly
  check but stay on "connecting…" in the browser, where the request is blocked by CORS:
  find out why the check and the browser disagree, and look for alternative streams.
- **More official URLs.** Scraping the broadcasters' live pages found usable URLs for Sky News,
  ABC Australia, DW, Current Time, TRT, RT DE, Asharq and Press TV. The rest do not yield one
  to a plain HTTP request: the player is behind a consent wall that blocks it until cookies
  are accepted (GB News, France 24, Euronews, CNA, Africanews), the URL is signed with a token
  that expires within minutes (Euronews `hdnea`, Rai's relinker), or the page refuses
  scripts (WION, NDTV, TOLOnews, Kan: 403). Tokenised URLs could only work through a
  resolver at refresh time, like YouTube's `videoId`, and expire well before the next
  refresh: not worth it.
- **Free-TV in the hourly Action.** `--source free-tv --alternatives` could join the
  "stream URLs that update themselves" step above: Free-TV fixes broken URLs by hand,
  often sooner than iptv-org.
- **Older fallbacks without their real `via`.** Fallbacks added before `via` was recorded
  per stream show up as `curated` even when they came from iptv-org.

## License

MIT. The project neither hosts nor rebroadcasts anything: it only points to streams the
broadcasters already publish.
