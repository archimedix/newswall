/* AudioWorklet processor for Replay: copies the program's audio out of the
   audio thread in blocks of BLOCK frames, two channels, with the context time
   of their first frame. It outputs nothing: what you hear goes its own way. */

const BLOCK = 2048;

class ReplayTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.l = new Float32Array(BLOCK);
    this.r = new Float32Array(BLOCK);
    this.n = 0;
    this.t = 0;
  }

  process(inputs) {
    const ch = inputs[0];
    const frames = ch[0]?.length || 128;
    if (this.n === 0) this.t = currentTime;
    // No input connected = silence: the program keeps its clock going.
    if (ch.length) {
      this.l.set(ch[0], this.n);
      this.r.set(ch[1] || ch[0], this.n);
    } else {
      this.l.fill(0, this.n, this.n + frames);
      this.r.fill(0, this.n, this.n + frames);
    }
    this.n += frames;
    if (this.n >= BLOCK) {
      this.port.postMessage({ t: this.t, l: this.l, r: this.r }, [this.l.buffer, this.r.buffer]);
      this.l = new Float32Array(BLOCK);
      this.r = new Float32Array(BLOCK);
      this.n = 0;
    }
    return true;
  }
}

registerProcessor('replay-tap', ReplayTap);
