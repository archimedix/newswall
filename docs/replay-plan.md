# Newswall Replay — plan

> Status: **approved on 2026-10-28**. Phases 0–3 done, and the globe has it too; what is left is under *Later*. When a phase is
> done, it gets described in the README and only a note stays here.

## 1. Vision

You are watching the wall, something happens, and you want to see it again: what did they
just say, how did the other channels show the same moment? **Replay** keeps the last few
minutes of the wall in memory, all the time, and lets you rewatch them and save them as a
video file.

What gets recorded is **the wall as you direct it**, like the *program* output of a TV
control room: the tiles in their layout, the one that talks (its audio, its red tally), the
one you enlarge when you enlarge it. Changing the audio or focusing a channel *is* the
directing; nothing else to learn.

Later (phase 3) the same pipeline gets an explicit **REC**: start, stop, and the browser asks
where to save the file.

The project's principles do not change: everything happens in the browser, nothing is
uploaded, no third-party requests, no backend.

## 2. Decisions taken (to approve)

| Decision | Why |
|---|---|
| **Record the composed wall, not the single streams** | That is what you saw and directed. A switch of source, a fallback, a channel added or removed mid-replay are just what the program shows, without breaking the file. |
| **Compose in a canvas, encode with WebCodecs** | `MediaRecorder` cannot keep a rolling window: its chunks are not decodable on their own, so the oldest cannot be dropped. `VideoEncoder` gives chunks with explicit keyframes: the buffer drops whole groups of pictures (GOP) from the front. Hardware H.264, little CPU. |
| **MP4 (H.264 + AAC)** | Opens everywhere: QuickTime, Windows, phones, editors. WebM would not open in QuickTime. |
| **Off by default** | The buffer costs CPU (composition + encoding) and memory (~150 MB for 5 minutes). A button turns it on; the choice is remembered in localStorage. |
| **Audio = what you hear** | One audio at a time is already the house rule: the program's audio is the channel on air, silence when everything is muted. |
| **Wall only, for now** | The globe is another program (a WebGL canvas): it can reuse the same `core/replay.js` later, feeding its own canvas. |
| **A vendored muxer** | Writing MP4 boxes by hand is avoidable: `mp4-muxer` (MIT, ~30 KB, no dependencies) in `assets/vendor/`, like hls.js. Its successor `mediabunny` (MPL-2.0) is larger: not needed for H.264 + AAC. |

## 3. File architecture

```
js/core/replay.js          the rolling buffer: encoders, GOP ring, export to MP4.
                           Knows nothing about tiles: it gets a canvas and an audio node.
js/core/audio-tap.js       AudioWorklet processor: PCM of the program's audio -> AudioData
js/wall/program.js         the program feed of the wall: draws the grid into the canvas,
                           routes every tile's audio through one AudioContext
js/wall/replay-menu.js     the bar button, its ring and the save menu (phase 1)
js/wall/replay-view.js     the overlay to rewatch, trim and save (phase 2)
assets/vendor/mp4-muxer-<version>.mjs
```

Hooks in the existing code are few: `attach()` / `detach()` in `wall.js` tell `program.js`
that a video arrived or left (to wire its audio), a bar button and a key (`R`) toggle it.

## 4. How it works

### The picture (`program.js`)

- A 1920×1080 canvas, not in the page. At 25 fps it reads where every tile is
  (`getBoundingClientRect()` relative to `#grid`) and draws its `<video>` with the same
  `object-fit: cover` crop. The grid is letterboxed into 16:9 on black when its shape
  differs.
- Because it reads the real layout, focus, reorder, a new tile are recorded for free.
- On top of each tile, drawn in the canvas (not copied from the DOM): flag, name, local
  clock, the tally border on the channel on air. A *waiting* tile shows its name on black,
  a dead one the same with "not available".
- What is never drawn: the bar, panels, toasts, the controls on hover. The program is clean.
- One small burned-in corner: date and UTC time. Useful to know, months later, when a clip
  was aired. (To approve.)

### The sound

- One `AudioContext` for the wall. Every tile's video goes through
  `createMediaElementSource(video)` → speakers, so you hear exactly as today, and → the tap
  (`audio-tap.js`) that feeds `AudioEncoder` (AAC, 48 kHz, stereo, 128 kb/s).
- `setOnAir()` keeps working as it does: it mutes and unmutes the videos, and a muted
  element sends silence to its source node. Nothing in the audio rules changes.
- The context needs a gesture to start: the first click on a tile (which already brings the
  audio) or the Replay button itself.
- Wired only once Replay is on. A video, once wired, stays wired until its tile drops it
  (a new `attach()` makes a new video anyway).

### The buffer (`replay.js`)

- `VideoEncoder`: `avc1` (H.264 High), 1920×1080, 25 fps, ~4 Mb/s, `latencyMode: 'realtime'`,
  a keyframe every 2 s. `AudioEncoder` beside it.
- Encoded chunks are kept in a ring of GOPs; when the buffer exceeds the chosen length (2, 5
  or 10 minutes, default 5), the oldest GOP and the audio before it are dropped.
- `export(seconds)` muxes the last `seconds` (starting from a keyframe) into an MP4 `Blob`.
  The buffer keeps running meanwhile.
- API sketch: `createReplay({ canvas, audio, seconds, fps, bitrate })` →
  `{ start(), stop(), length, export(seconds), destroy() }`.

### Saving

- **Chrome, Edge**: `showSaveFilePicker()`, the real "Save as" dialog, with a suggested name
  `newswall-<wall name>-2026-10-28-1432.mp4`.
- **Safari, Firefox**: a download (`<a download>`) with the same name.

## 5. Interface

- **Bar**: a *Replay* button. Off: plain like the others. On: a small ring that fills up to
  the chosen length and the buffered time (`⟲ 4:12`). Key `R` toggles it.
- **Phase 1**: clicking the indicator offers *Save last 1 / 2 / 5 min* (up to what is
  buffered). Key `Shift+R` saves the default length at once.
- **Phase 2** — the replay viewer: an overlay (glass, one at a time, so `backdrop-filter`
  is allowed) with the last minutes in a `<video>`, a scrubber, *in* and *out* marks to
  keep only the moment that matters, and *Save*. While it plays, the live audio is muted
  and comes back when it closes: one audio at a time, also here. The wall keeps buffering
  behind it.
- **Colour**: red stays the tally's alone. The Replay indicator is white/ice; the REC of
  phase 3 a pulsing white dot, not red. (To approve: a red REC dot is the convention, but it
  would break the house rule.)
- Where WebCodecs or H.264 encoding is missing (`VideoEncoder.isConfigSupported()`), the
  button is not shown.

## 6. Phases

### Phase 0 — Spike ✅ (2026-10-28)

Chromium only (the desktop app's browser): 1080p H.264 and AAC encoders supported, six
videos drawn in ~0.6 ms a frame, ~4 Mb/s, a muted element gives exact silence through its
source node. **Safari and Firefox still to try.** Plan as it was:

A test page that proves the risky parts, in Chrome, Safari and Firefox:
1. drawing 6–12 hls.js videos into a 1080p canvas at 25 fps, with CPU measured;
2. `VideoEncoder` H.264 1080p in real time;
3. a muted element through `createMediaElementSource` gives silence, an unmuted one sound;
4. the AudioWorklet tap → `AudioEncoder` AAC (Safari support to check);
5. the muxed MP4 opens in QuickTime and on a phone.

Outcome: go, or a revised plan.

### Phase 1 — Always-on replay ✅ (2026-10-28)

Done as planned, in the README. Learned: the MP4 has no edit lists, so the audio track
must start with the video and have no holes; silence fills in while the AudioContext
waits for a gesture. Key `Shift+R` saves everything kept.


`core/replay.js`, `core/audio-tap.js`, `wall/program.js`, the bar button and indicator,
*Save last N min*, the vendored muxer, README section and limitation.

### Phase 2 — The replay viewer ✅ (2026-10-28)

Done, in the README. The viewer plays an MP4 of the whole buffer (exported when it opens),
the save re-exports the marked range from the buffer, which `hold()` keeps from trimming
meanwhile. The live sound is hushed by a gain before the speakers only, so the recording
keeps the channel on air. Learned: the AAC encoder may emit a chunk that steps back by one
block after a jump in its input; such chunks are dropped, or the muxer refuses the clip
(this also broke some phase 1 saves).

### Phase 3 — REC ✅ (2026-10-28)

Done, in the README. Changed from the plan: no file chosen at start. The recording's own
muxer writes as it goes into Blobs (which Chrome can page to disk), the "Save as" dialog
comes at stop, and cancelling it keeps recording. Cap: 60 min (20 on phones), saved by
itself, warned 5 minutes before; without a gesture the dialog is refused, so that save is a
download. Writing straight to a file chosen at start (File System Access) stays possible
if an hour turns out to be too short.

### The globe ✅ (2026-10-28)

Done, in the README. The menu, the viewer and the sound moved to `js/core/` (`program.js`,
`replay-menu.js`, `replay-view.js`); each view brings only its picture. The globe's
(`js/globe/program.js`) is the WebGL canvas cropped to 16:9 with the channel held drawn
on top (docked card or full screen: DOM videos, not in the canvas). Learned: a WebGL
canvas can only be read in the task that rendered it, so the frame loop composes right
after `render()` when the encoder asked for a frame; in a hidden tab the program renders
by itself.

### Later

A lighter 720p option for modest machines; Rec straight to a file chosen at start, for
recordings over an hour. Safari and Firefox are still untested.

## 7. Risks and open questions

- **Background tab**: `requestAnimationFrame` stops and timers slow down when the tab is
  hidden. The frame clock will come from a Worker timer; to verify in the spike that the
  videos keep drawing. If not: Replay pauses while the tab is hidden, and says so.
- **Load**: composition + encoding come on top of up to 12 decoders. Hardware encoding should
  keep it modest; the spike measures it. A 720p option if needed.
- **Memory**: ~30 MB per minute at 4 Mb/s. 10 minutes = 300 MB: acceptable on a desktop, not
  offered on phones (2 min max there).
- **Quality**: non-focused tiles are capped at 480p; in a 1080p program with few tiles they
  get slightly upscaled. Acceptable; the focused tile is full quality.
- **Safari's `AudioEncoder`**: to check in the spike; without it, Safari gets no Replay in v1
  rather than a silent one.
- **Rights**: the clips are for personal use. The README says it; the interface does not
  advertise sharing them. Nothing is ever uploaded by Newswall.

## 8. What to approve before starting

1. The approach: composed program in a canvas, WebCodecs, MP4, off by default.
2. The burned-in date/UTC corner.
3. No red for Replay/REC.
4. The vendored `mp4-muxer`.
5. The order of the phases: 0 → 1 → 2 → 3.
