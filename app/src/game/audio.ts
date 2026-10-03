// Synthesized sound — no assets. In a game where you can't see, sound is the tension.
// Pings are panned by their direction relative to where you're aiming.

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  private hum: { osc: OscillatorNode; gain: GainNode } | null = null;

  private ensure() {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  unlock() {
    const c = this.ensure();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  private noise(dur: number) {
    const c = this.ctx!;
    const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private out(pan = 0, vol = 1) {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = vol;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.master!);
    return g;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, pan = 0, slideTo?: number, delay = 0) {
    const c = this.ensure();
    if (!c || this.muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.out(pan, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, q: number, vol: number, pan = 0, type: BiquadFilterType = "bandpass") {
    const c = this.ensure();
    if (!c || this.muted) return;
    const t = c.currentTime;
    const n = this.noise(dur);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.out(pan, 0);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g);
    n.start(t);
    n.stop(t + dur + 0.02);
  }

  shoot(weapon: number) {
    if (weapon === 2) {
      this.burst(0.28, 900, 0.7, 0.9);
      this.tone(90, 0.2, "sine", 0.6, 0, 40);
    } else if (weapon === 1) {
      this.burst(0.07, 2400, 1.2, 0.5);
      this.tone(160, 0.06, "square", 0.12, 0, 90);
    } else {
      this.burst(0.12, 1600, 0.9, 0.7);
      this.tone(140, 0.1, "triangle", 0.4, 0, 60);
    }
  }

  /** A sound from something you cannot see. angle/aim in 0..65535. */
  ping(kind: number, angle: number, dist: number, aim: number) {
    let rel = ((angle - aim + 65536 + 32768) % 65536) - 32768; // -32768..32768, 0 = ahead
    const pan = Math.sin((rel / 65536) * Math.PI * 2);
    const vol = Math.max(0.08, 1 - dist / 26);
    const behind = Math.abs(rel) > 16384;
    if (kind === 1) {
      // footstep: low thud, muffled if behind
      this.burst(0.09, behind ? 220 : 340, 1.5, 0.55 * vol, pan, "lowpass");
    } else if (kind === 2) {
      // distant gunshot: filtered crack + rumble
      this.burst(0.25, 700, 0.6, 0.65 * vol, pan, "lowpass");
      this.tone(70, 0.3, "sine", 0.3 * vol, pan, 40);
    } else if (kind === 3) {
      this.tone(880, 0.15, "sine", 0.25 * vol, pan, 1320);
    } else if (kind === 4) {
      this.burst(0.05, 3000, 3, 0.35 * vol, pan);
      this.burst(0.05, 2600, 3, 0.35 * vol, pan);
    }
    void rel;
  }

  hurt() {
    this.tone(220, 0.18, "sawtooth", 0.25, 0, 90);
    this.burst(0.1, 500, 1, 0.4);
  }

  kill() {
    this.tone(660, 0.12, "square", 0.18);
    this.tone(990, 0.2, "square", 0.18, 0, undefined, 0.09);
  }

  death() {
    this.tone(300, 1.2, "sawtooth", 0.3, 0, 40);
    this.burst(0.8, 200, 0.5, 0.4, 0, "lowpass");
  }

  pickup() {
    this.tone(520, 0.08, "triangle", 0.25);
    this.tone(780, 0.12, "triangle", 0.25, 0, undefined, 0.07);
  }

  reload() {
    this.burst(0.04, 3200, 4, 0.3);
    this.burst(0.05, 2500, 4, 0.3);
  }

  flare() {
    this.burst(1.2, 4000, 0.3, 0.3, 0, "highpass");
    this.tone(1200, 1.0, "sine", 0.1, 0, 300);
  }

  countdown() {
    [0, 1, 2].forEach((i) => this.tone(440, 0.15, "sine", 0.25, 0, undefined, i));
  }

  go() {
    this.tone(880, 0.4, "sine", 0.3);
  }

  end() {
    this.tone(330, 0.6, "triangle", 0.25);
    this.tone(495, 0.8, "triangle", 0.25, 0, undefined, 0.2);
  }

  lightsOn() {
    this.burst(0.6, 120, 0.4, 0.8, 0, "lowpass");
    this.tone(55, 1.5, "sine", 0.6, 0, 50);
    this.tone(1760, 0.08, "square", 0.05, 0, undefined, 0.05);
  }

  /** Low hum that rises while you're outside the zone. */
  setZoneDanger(level: number) {
    const c = this.ensure();
    if (!c) return;
    if (!this.hum) {
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 48;
      const gain = c.createGain();
      gain.gain.value = 0;
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 300;
      osc.connect(f).connect(gain).connect(this.master!);
      osc.start();
      this.hum = { osc, gain };
    }
    this.hum.gain.gain.setTargetAtTime(this.muted ? 0 : level * 0.12, c.currentTime, 0.2);
  }
}

export const audio = new Audio();
