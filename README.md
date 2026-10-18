# Newswall

Several live news channels on the same screen. Only one talks, you keep an eye on the
others. The point is to see **how the same event is told by different countries**, at the
same moment.

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

### Building the wall

Three ways, depending on what you already know:

- **Quick search** (`⌘K`) — type and press enter. It searches the name, the country (also
  spelled out: *germany* → DW, DW Español, RT DE), the language, the tags and the initials
  (*aje* → Al Jazeera English). With an empty query it puts the channels already on the
  wall at the top, so removing one is a single enter.
- **On the tile** — hovering shows the controls: audio, enlarge, **switch source** (when
  the channel has more than one) and **✕ to remove it**. The dashed `+` slot takes the
  grid's leftover cell and opens the search.
- **Catalog** (`S`) — for browsing. Filter by **country** (a menu with country names and
  the number of channels per country), by **area**, and with free-text search. The three
  filters combine. Every channel carries its flag, on the tile and in the list.

Adding or removing a channel **does not stop the others**: the grid reconciles itself with
what is already there, and visual order is set by the CSS grid's `order`, not the DOM
(moving a node would reload the YouTube iframes).

The wall's layout ends up in the URL: **the link is the configuration**, shareable as is.
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
Three files: `index.html`, `styles.css`, `app.js`.

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
own, without the tile going dark. There are currently **167 streams for 107 channels**:
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
| `broadcaster` | the domain belongs to the broadcaster itself |
| `cdn` | technical delivery (Akamai, CloudFront, Amagi…): it tells how it arrives, not who publishes it |
| `rebroadcast` | a third party putting someone else's feed back on air — highlighted in orange |
| `youtube` | the broadcaster's official YouTube channel |
| `unknown` | a host that fits none of the cases above |

Labels are never made up: host and the way the stream was found are hard facts and are
always recorded; the broadcaster name only appears when the domain makes it obvious. The
rest stays `cdn` or `unknown`, which is honest information rather than a guess.

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

**107 sources from 56 countries, in 21 languages**, 71 of them fished out of
[iptv-org](https://github.com/iptv-org/iptv) and hand-picked. The criterion is the point
of the project — comparing national narratives — so national and international
broadcasters are in; local TV, radio and duplicates are out.

In practice, that means putting IRINN (Iranian state TV) and Iran International (the
opposition, based in London) on the same screen; Al-Manar and Makan 33; CCTV, Telesur and
RT in four languages.

Of RT in English only the Indian feed is left: `rt-glb.rttv.com`, the global one, answers
**403** from the very same server that serves `rt-india` without complaint — RT closed the
endpoint, not someone along the way.

### Fishing from the public catalog

```bash
python3 scripts/harvest-iptv.py              # preview the candidates
python3 scripts/harvest-iptv.py --write      # add them to sources.json
```

It downloads the iptv-org catalog, keeps only `news` channels that pass the technical
check (HTTPS + CORS + manifest, and no mandatory referrer or user-agent: those would not
work from a browser), drops radio and niche channels, and caps the number of channels per
country — without that cap the 219 Indian broadcasters would take over the whole wall.

Out of 858 candidates, **577 turned out to be usable (67%)**. The final selection lives
in [`scripts/curated-iptv.txt`](scripts/curated-iptv.txt), one id per line with the
reason next to it: that is where things get added or removed.

With `--alternatives` it adds no new channels: instead it looks for **other sources for
the ones already there**, and queues them as fallbacks.

```bash
python3 scripts/harvest-iptv.py --alternatives --write
```

## Adding a source by hand

One entry in `sources.json`, then a PR:

```json
{ "id": "channel-name", "name": "Channel Name", "lang": "en", "country": "XX",
  "tz": "Area/City", "kind": "hls", "url": "https://.../playlist.m3u8",
  "tags": ["world"] }
```

For YouTube, `"kind": "youtube"` and `"channelId": "UC..."` instead of `url`.
Run `refresh-live.py` to check that it holds up before opening the PR.

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

## License

MIT. The project neither hosts nor rebroadcasts anything: it only points to streams the
broadcasters already publish.
