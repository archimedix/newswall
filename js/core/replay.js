/* Replay: the last few minutes of a program, always in memory, saved as MP4
   on request. It knows nothing about tiles or globes: it gets a canvas with
   a function that draws it, and an audio node that carries what you hear.

   MediaRecorder cannot do this: its chunks cannot be decoded on their own, so
   the oldest cannot be dropped. WebCodecs gives encoded chunks with explicit
   keyframes: the buffer is a ring of groups of pictures (GOP), each starting
   with one, and drops whole groups from the front. */

import { ArrayBufferTarget, Muxer, StreamTarget } from '../../assets/vendor/mp4-muxer-5.2.2.mjs';

const VIDEO = { codec: 'avc1.640028', width: 1920, height: 1080 };   // H.264 High, level 4.0
const AUDIO = { codec: 'mp4a.40.2', numberOfChannels: 2, bitrate: 128000 };   // AAC-LC
const KEY_EVERY = 2e6;   // µs between keyframes: how finely the start of a clip can be cut

/* Can this browser encode the program? Without it, the wall shows no Replay. */
export async function replaySupported(sampleRate = 48000) {
  if (!window.VideoEncoder || !window.AudioEncoder || !window.AudioWorkletNode) return false;
  try {
    const [v, a] = await Promise.all([
      VideoEncoder.isConfigSupported({ ...VIDEO, bitrate: 4e6, framerate: 25, latencyMode: 'realtime' }),
      AudioEncoder.isConfigSupported({ ...AUDIO, sampleRate }),
    ]);
    return v.supported && a.supported;
  } catch { return false; }
}

/* Starts buffering at once. `draw()` is called before every frame and must
   leave the picture in `canvas`; `input` is connected to the tap and never
   disconnected from anything else. */
export async function createReplay({ canvas, draw, context, input, seconds = 300, fps = 25, bitrate = 4e6, onError }) {
  await context.audioWorklet.addModule(new URL('./audio-tap.js', import.meta.url));

  const t0 = performance.now();
  const now = () => (performance.now() - t0) * 1000;   // µs since the start: the program's clock
  let failed = false;
  const fail = (e) => {
    if (failed) return;
    failed = true;
    destroy();
    onError?.(e);
  };

  // ---- video: one frame per tick, a keyframe every KEY_EVERY
  const gops = [];   // [{ t, chunks }], oldest first
  let videoConfig = null, lastKey = -Infinity;
  const venc = new VideoEncoder({
    output(chunk, meta) {
      if (meta?.decoderConfig) videoConfig = meta.decoderConfig;
      if (chunk.type === 'key') gops.push({ t: chunk.timestamp, chunks: [] });
      gops.at(-1)?.chunks.push(chunk);
      trim();
      if (rec) recVideo(chunk);
    },
    error: fail,
  });
  venc.configure({ ...VIDEO, bitrate, framerate: fps, latencyMode: 'realtime' });

  function frame() {
    if (failed || venc.state !== 'configured') return;
    // A slow machine skips frames instead of piling them up.
    if (venc.encodeQueueSize > 2) return;
    try {
      draw();
      const t = now();
      if (t - audioUntil > 500000 && aenc.state === 'configured') silence(t - 100000);
      const f = new VideoFrame(canvas, { timestamp: t, duration: 1e6 / fps });
      const keyFrame = t - lastKey >= KEY_EVERY;
      if (keyFrame) lastKey = t;
      venc.encode(f, { keyFrame });
      f.close();
    } catch (e) { fail(e); }
  }

  // The clock comes from a Worker: timers and requestAnimationFrame slow down
  // in a hidden tab, a Worker's do not.
  const tickUrl = URL.createObjectURL(new Blob(
    [`setInterval(() => postMessage(0), ${1000 / fps});`], { type: 'text/javascript' }));
  const ticker = new Worker(tickUrl);
  ticker.onmessage = frame;

  // ---- audio: PCM blocks from the tap, timestamped on the same clock
  const audio = [];   // EncodedAudioChunk, oldest first
  let audioConfig = null, lastAudio = -Infinity;
  const aenc = new AudioEncoder({
    output(chunk, meta) {
      if (meta?.decoderConfig) audioConfig = meta.decoderConfig;
      // After a jump in its input the encoder may hand back a chunk that steps
      // back in time (one 2048-frame block): the MP4 cannot take it, a 20 ms
      // gap in the sound is better than no clip.
      if (chunk.timestamp <= lastAudio) return;
      lastAudio = chunk.timestamp;
      audio.push(chunk);
      if (rec) recAudio(chunk);
    },
    error: fail,
  });
  aenc.configure({ ...AUDIO, sampleRate: context.sampleRate });

  // Context time -> program time. The anchor is kept while it agrees with a
  // fresh reading (so the blocks stay contiguous) and taken again after a
  // jump: the context may start suspended and run only after a gesture.
  let ref = null;
  const toProgram = (r, ct) => (r.performanceTime + (ct - r.contextTime) * 1000 - t0) * 1000;

  const tap = new AudioWorkletNode(context, 'replay-tap', {
    numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit',
  });
  tap.port.onmessage = ({ data }) => {
    if (failed || aenc.state !== 'configured') return;
    const fresh = context.getOutputTimestamp();
    if (!fresh.performanceTime) return;
    if (!ref || Math.abs(toProgram(ref, data.t) - toProgram(fresh, data.t)) > 50000) ref = fresh;
    let t = toProgram(ref, data.t);
    if (t > audioUntil + 50000) silence(t);   // the context was stopped: a hole
    t = Math.max(t, audioUntil);              // overlap: stay contiguous
    const pcm = new Float32Array(data.l.length * 2);
    pcm.set(data.l, 0);
    pcm.set(data.r, data.l.length);
    encodeAudio(pcm, data.l.length, t);
  };

  /* The audio track must have no holes: an MP4 without edit lists would play
     whatever follows a hole too early. While the context is suspended (no
     gesture yet) or stalled, silence fills in. */
  let audioUntil = 0;   // µs: end of the audio sent to the encoder
  function encodeAudio(pcm, frames, t) {
    const ad = new AudioData({
      format: 'f32-planar', sampleRate: context.sampleRate, numberOfFrames: frames,
      numberOfChannels: 2, timestamp: t, data: pcm,
    });
    try { aenc.encode(ad); } catch (e) { fail(e); }
    ad.close();
    audioUntil = t + (frames / context.sampleRate) * 1e6;
  }
  function silence(until) {
    const frames = Math.floor(((until - audioUntil) / 1e6) * context.sampleRate);
    if (frames > 0) encodeAudio(new Float32Array(frames * 2), frames, audioUntil);
  }
  input.connect(tap);
  tap.connect(context.destination);   // silent: it only keeps the tap running

  /* Keeps just enough GOPs to cover `seconds`, and the audio from the first one on.
     While held (the viewer is open) nothing is dropped: its marks stay inside. */
  let held = 0;
  function trim() {
    if (held) return;
    const newest = gops.at(-1)?.t ?? 0;
    while (gops.length > 1 && newest - gops[1].t >= seconds * 1e6) gops.shift();
    const from = gops[0]?.t ?? 0;
    while (audio.length && audio[0].timestamp < from) audio.shift();
  }

  /* Seconds in the buffer, from its first keyframe to now. */
  const length = () => (gops.length ? Math.max(0, (now() - gops[0].t) / 1e6) : 0);

  /* The `secs` seconds before `until` (from the keyframe just before) as an
     MP4 Blob, with `start` = the program time of its first frame. `until` = mark() taken when asked, so a slow save dialog does
     not shift the clip. The buffer keeps running meanwhile. */
  async function exportClip(secs, until = now()) {
    await Promise.all([venc.flush(), aenc.flush()]).catch(() => {});
    const from = until - secs * 1e6;
    const start = gops.findLastIndex((g) => g.t <= from);
    const take = gops.slice(Math.max(0, start)).filter((g) => g.t <= until)
      .map((g) => ({ t: g.t, chunks: g.chunks.filter((c) => c.timestamp <= until) }));
    if (!take.length || !videoConfig) return null;
    const base = take[0].t;

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: VIDEO.width, height: VIDEO.height },
      audio: audioConfig ? { codec: 'aac', numberOfChannels: 2, sampleRate: context.sampleRate } : undefined,
      fastStart: 'in-memory',
      // The video starts at 0 and is added first; the audio may start a few ms later.
      firstTimestampBehavior: 'cross-track-offset',
    });
    let first = true;
    for (const g of take) {
      for (const c of g.chunks) {
        muxer.addVideoChunk(c, first ? { decoderConfig: videoConfig } : undefined, c.timestamp - base);
        first = false;
      }
    }
    if (audioConfig) {
      let firstA = true;
      for (const c of audio) {
        if (c.timestamp < base || c.timestamp > until) continue;
        muxer.addAudioChunk(c, firstA ? { decoderConfig: audioConfig } : undefined, c.timestamp - base);
        firstA = false;
      }
    }
    muxer.finalize();
    const last = take.at(-1).chunks.at(-1);
    return {
      blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }),
      seconds: (last.timestamp + (last.duration || 0) - base) / 1e6,
      start: base,
    };
  }

  /* ---- REC: from now until stopped, with no time limit. The same chunks
     also go, as they come, to a muxer of their own whose bytes pile up in
     small Blobs: the browser may keep those on disk, not in the page. It
     starts at the next frame, forced to be a keyframe. */
  let rec = null;

  function startRec() {
    if (rec) return;
    const out = blobTarget();
    rec = {
      from: now(), base: null, until: Infinity, last: 0, pending: [], error: null, out,
      muxer: new Muxer({
        target: out.target,
        video: { codec: 'avc', width: VIDEO.width, height: VIDEO.height },
        audio: { codec: 'aac', numberOfChannels: 2, sampleRate: context.sampleRate },
        fastStart: false,
        firstTimestampBehavior: 'cross-track-offset',
      }),
    };
    lastKey = -Infinity;
  }

  function recVideo(c) {
    if (rec.base === null) {
      if (c.type !== 'key' || c.timestamp < rec.from) return;
      rec.base = c.timestamp;
    }
    if (c.timestamp > rec.until || rec.error) return;
    try {
      rec.muxer.addVideoChunk(c, rec.last ? undefined : { decoderConfig: videoConfig }, c.timestamp - rec.base);
      rec.last = c.timestamp + (c.duration || 0);
      // The audio that came before the first frame, from that frame on.
      for (const a of rec.pending.splice(0)) recAudio(a);
    } catch (e) { rec.error = e; }
  }

  function recAudio(c) {
    if (rec.base === null || !rec.last) {
      if (c.timestamp >= rec.from - 1e5) rec.pending.push(c);
      return;
    }
    if (c.timestamp < rec.base || c.timestamp > rec.until || rec.error) return;
    try {
      rec.muxer.addAudioChunk(c, rec.audioOn ? undefined : { decoderConfig: audioConfig }, c.timestamp - rec.base);
      rec.audioOn = true;
    } catch (e) { rec.error = e; }
  }

  /* Ends the recording at `until` (mark() taken when asked): the MP4 as a Blob. */
  async function stopRec(until = now()) {
    const r = rec;
    if (!r) return null;
    r.until = until;
    await Promise.all([venc.flush(), aenc.flush()]).catch(() => {});
    rec = null;
    if (r.error) throw r.error;
    if (!r.last) return null;
    r.muxer.finalize();
    return { blob: r.out.blob(), seconds: (r.last - r.base) / 1e6 };
  }

  function destroy() {
    rec = null;
    ticker.terminate();
    URL.revokeObjectURL(tickUrl);
    try { input.disconnect(tap); } catch {}
    tap.disconnect();
    tap.port.onmessage = null;
    for (const enc of [venc, aenc]) if (enc.state !== 'closed') enc.close();
    gops.length = 0;
    audio.length = 0;
  }

  return {
    get length() { return length(); },
    get seconds() { return seconds; },
    set seconds(s) { seconds = s; trim(); },
    mark: now,
    export: exportClip,
    rec: startRec,
    stopRec,
    /* Seconds recorded so far, null when not recording. */
    get recording() { return rec ? (now() - rec.from) / 1e6 : null; },
    /* Stops dropping the oldest minutes; the returned function lets go. */
    hold() {
      held++;
      let done = false;
      return () => { if (!done) { done = true; held--; trim(); } };
    },
    destroy,
  };
}

/* A muxer target whose bytes become Blobs as they come. Writes are in order,
   except the size of the media box, patched at the end into bytes already
   written. */
function blobTarget() {
  const parts = [];   // [{ at, blob }]
  let end = 0;
  const target = new StreamTarget({
    onData(data, pos) {
      if (pos >= end) {
        if (pos > end) parts.push({ at: end, blob: new Blob([new Uint8Array(pos - end)]) });
        parts.push({ at: pos, blob: new Blob([data]) });
        end = pos + data.byteLength;
        return;
      }
      const p = parts.findLast((x) => x.at <= pos);
      const o = pos - p.at;
      p.blob = new Blob([p.blob.slice(0, o), data, p.blob.slice(o + data.byteLength)]);
    },
  });
  return { target, blob: () => new Blob(parts.map((p) => p.blob), { type: 'video/mp4' }) };
}
