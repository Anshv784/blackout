// Horror sound design — all synthesized, no assets.
// Everything runs through a shared reverb so the Yard feels huge and empty.
// Directional cues are panned relative to where you're aiming.

import { prefs, setPref } from "./prefs";

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private verb: ConvolverNode | null = null;
  muted = (() => {
    try {
      return localStorage.getItem("bo-muted") === "1";
    } catch {
      return false;
    }
  })();
  private listeners = new Set<(m: boolean) => void>();
  onMute(f: (m: boolean) => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  /** Master volume from the settings menu (0..1). */
  setVolume(v: number) {
    setPref("volume", v);
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx!.currentTime, 0.05);
  }
  toggleMute() {
    this.setMuted(!this.muted);
  }
  private hum: { gain: GainNode } | null = null;
  private ambience: { gain: GainNode; stop: () => void } | null = null;
  private heart: { timer: number | null; bpm: number; level: number } = { timer: null, bpm: 0, level: 0 };
  private nextHowl = 0;
  private nextCreak = 0;

  private ensure() {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const c = new Ctx();
      this.ctx = c;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : prefs.volume;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.dry = c.createGain();
      this.dry.gain.value = 0.85;
      this.wet = c.createGain();
      this.wet.gain.value = 0.55;
      this.verb = c.createConvolver();
      this.verb.buffer = this.impulse(3.8, 2.6);
      this.dry.connect(this.master);
      this.wet.connect(this.verb).connect(this.master);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Long dark hall: exponentially decaying stereo noise. */
  private impulse(seconds: number, decay: number) {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  unlock() {
    const c = this.ensure();
    if (c && c.state === "suspended" && !this.muted) c.resume().catch(() => {});
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : prefs.volume, this.ctx!.currentTime, 0.05);
    // hard stop: pause the whole audio graph (loops, heartbeat, hum) — not just the volume
    if (this.ctx) {
      if (m) setTimeout(() => this.muted && this.ctx?.suspend().catch(() => {}), 80);
      else this.ctx.resume().catch(() => {});
    }
    try {
      localStorage.setItem("bo-muted", m ? "1" : "0");
    } catch {
      /* ignore */
    }
    this.listeners.forEach((f) => f(m));
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

  /** Output bus: panned, with a send to the reverb. */
  private out(pan = 0, vol = 1, wet = 0.4) {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = vol;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    const d = c.createGain();
    d.gain.value = 1 - wet * 0.5;
    const w = c.createGain();
    w.gain.value = wet;
    p.connect(d).connect(this.dry!);
    p.connect(w).connect(this.wet!);
    return g;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, pan = 0, slideTo?: number, delay = 0, wet = 0.35) {
    const c = this.ensure();
    if (!c || this.muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.out(pan, 0, wet);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, q: number, vol: number, pan = 0, type: BiquadFilterType = "bandpass", wet = 0.4) {
    const c = this.ensure();
    if (!c || this.muted) return;
    const t = c.currentTime;
    const n = this.noise(dur);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.out(pan, 0, wet);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g);
    n.start(t);
    n.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------ ambience

  /** The bed: detuned sub drone, wind gusts, and a slow-breathing filter. */
  startAmbience(intensity = 1) {
    const c = this.ensure();
    if (!c || this.ambience) return;
    const bus = c.createGain();
    bus.gain.value = 0;
    bus.gain.linearRampToValueAtTime(0.5 * intensity, c.currentTime + 4);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    bus.connect(lp);
    const send = this.out(0, 1, 0.6);
    lp.connect(send);
    const nodes: AudioScheduledSourceNode[] = [];
    for (const [f, type, v] of [[41.2, "sawtooth", 0.18], [41.9, "sawtooth", 0.16], [61.7, "triangle", 0.1], [98, "sine", 0.03]] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = v;
      o.connect(g).connect(bus);
      o.start();
      nodes.push(o);
    }
    // wind: looping noise through a wandering bandpass
    const wind = this.noise(6);
    wind.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    bp.frequency.value = 500;
    const wg = c.createGain();
    wg.gain.value = 0.22;
    wind.connect(bp).connect(wg).connect(bus);
    wind.start();
    nodes.push(wind);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = c.createGain();
    lfoAmt.gain.value = 320;
    lfo.connect(lfoAmt).connect(bp.frequency);
    const lfo2 = c.createOscillator();
    lfo2.frequency.value = 0.11;
    const lfo2Amt = c.createGain();
    lfo2Amt.gain.value = 0.15;
    lfo2.connect(lfo2Amt).connect(wg.gain);
    lfo.start();
    lfo2.start();
    nodes.push(lfo, lfo2);
    this.ambience = {
      gain: bus,
      stop: () => {
        bus.gain.setTargetAtTime(0, c.currentTime, 0.6);
        setTimeout(() => nodes.forEach((n) => n.stop()), 3000);
      },
    };
    this.nextHowl = performance.now() + 6000 + Math.random() * 8000;
    this.nextCreak = performance.now() + 3000;
  }

  stopAmbience() {
    this.ambience?.stop();
    this.ambience = null;
  }

  /** Call often (every frame is fine): schedules howls and creaks at random. */
  ambientTick() {
    if (!this.ambience || this.muted) return;
    const now = performance.now();
    if (now > this.nextHowl) {
      this.howl(Math.random() * 1.6 - 0.8, 0.35 + Math.random() * 0.35);
      this.nextHowl = now + 18000 + Math.random() * 26000;
    }
    if (now > this.nextCreak) {
      this.creak(Math.random() * 1.6 - 0.8);
      this.nextCreak = now + 7000 + Math.random() * 12000;
    }
  }

  /** Distant wolf: formant-filtered saw with a rising-then-falling glide and wobble. */
  howl(pan = 0, vol = 0.5, delay = 0) {
    const c = this.ensure();
    if (!c || this.muted) return;
    const t = c.currentTime + delay;
    const dur = 2.6 + Math.random() * 1.2;
    const base = 380 + Math.random() * 90;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(base * 0.62, t);
    o.frequency.exponentialRampToValueAtTime(base, t + 0.55);
    o.frequency.setValueAtTime(base, t + dur * 0.55);
    o.frequency.exponentialRampToValueAtTime(base * 0.55, t + dur);
    const vib = c.createOscillator();
    vib.frequency.value = 5.2;
    const vibAmt = c.createGain();
    vibAmt.gain.value = 7;
    vib.connect(vibAmt).connect(o.frequency);
    const f1 = c.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.value = 700;
    f1.Q.value = 6;
    const f2 = c.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = 1150;
    f2.Q.value = 8;
    const mix = c.createGain();
    o.connect(f1).connect(mix);
    o.connect(f2).connect(mix);
    const far = c.createBiquadFilter();
    far.type = "lowpass";
    far.frequency.value = 1800;
    const g = this.out(pan, 0, 0.85);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.45);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    mix.connect(far).connect(g);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.1);
    vib.stop(t + dur + 0.1);
  }

  /** Metal groan from a container somewhere. */
  creak(pan = 0) {
    const c = this.ensure();
    if (!c || this.muted) return;
    const t = c.currentTime;
    const dur = 1.2 + Math.random();
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70 + Math.random() * 40, t);
    o.frequency.linearRampToValueAtTime(55 + Math.random() * 60, t + dur);
    const fm = c.createOscillator();
    fm.frequency.value = 23 + Math.random() * 14;
    const fmAmt = c.createGain();
    fmAmt.gain.value = 30;
    fm.connect(fmAmt).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 600;
    f.Q.value = 3;
    const g = this.out(pan, 0, 0.8);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g);
    o.start(t);
    fm.start(t);
    o.stop(t + dur + 0.1);
    fm.stop(t + dur + 0.1);
  }

  /** Low thump-thump. Faster/louder as danger rises (0..1). */
  setHeartbeat(level: number) {
    const lv = Math.max(0, Math.min(1, level));
    this.heart.level = lv;
    const bpm = lv < 0.05 ? 0 : 58 + lv * 82;
    if (Math.abs(bpm - this.heart.bpm) < 4 && (bpm > 0) === (this.heart.bpm > 0)) return;
    this.heart.bpm = bpm;
    if (this.heart.timer) clearInterval(this.heart.timer);
    this.heart.timer = null;
    if (!bpm) return;
    const beat = () => {
      const v = 0.25 + this.heart.level * 0.55;
      this.tone(52, 0.16, "sine", v, 0, 38, 0, 0.1);
      this.tone(48, 0.14, "sine", v * 0.7, 0, 36, 0.17, 0.1);
    };
    beat();
    this.heart.timer = window.setInterval(beat, 60000 / bpm);
  }

  /** Dissonant hit when someone steps into your light. */
  stinger() {
    const c = this.ensure();
    if (!c || this.muted) return;
    for (const f of [185, 196, 277]) this.tone(f, 1.4, "sawtooth", 0.07, 0, f * 0.97, 0, 0.7);
    this.burst(0.5, 3200, 0.6, 0.18, 0, "highpass", 0.8);
    this.tone(36, 0.9, "sine", 0.45, 0, 30, 0, 0.3);
  }

  /** Sub boom + reverse swell, for the intro and the lights-on reveal. */
  boom() {
    this.tone(42, 2.4, "sine", 0.7, 0, 28, 0, 0.6);
    this.burst(1.6, 160, 0.4, 0.5, 0, "lowpass", 0.8);
  }

  whisper(pan = 0) {
    for (let i = 0; i < 3; i++) setTimeout(() => this.burst(0.35 + Math.random() * 0.3, 2400 + Math.random() * 1600, 4, 0.08, pan, "bandpass", 0.9), i * 180);
  }

  // ------------------------------------------------------------ game sfx

  shoot(weapon: number) {
    if (weapon === 4) {
      // Kar98k: a crack that rolls across the Yard, then the bolt
      this.burst(0.5, 700, 0.5, 1.1, 0, "lowpass", 0.85);
      this.burst(0.06, 3800, 1.4, 0.7, 0, "bandpass", 0.3);
      this.tone(60, 0.6, "sine", 0.8, 0, 28, 0, 0.7);
      this.tone(900, 0.05, "square", 0.05, 0, 600, 0.55, 0.2);
      this.tone(700, 0.05, "square", 0.05, 0, 500, 0.75, 0.2);
      return;
    }
    if (weapon === 3) {
      // M416: tight, punchy
      this.burst(0.09, 1900, 1.1, 0.7, 0, "bandpass", 0.4);
      this.tone(110, 0.09, "square", 0.2, 0, 60, 0, 0.35);
      return;
    }
    if (weapon === 2) {
      this.burst(0.32, 900, 0.7, 1.0, 0, "bandpass", 0.5);
      this.tone(80, 0.25, "sine", 0.7, 0, 36, 0, 0.4);
    } else if (weapon === 1) {
      this.burst(0.08, 2400, 1.2, 0.55, 0, "bandpass", 0.35);
      this.tone(150, 0.07, "square", 0.12, 0, 80, 0, 0.3);
    } else {
      this.burst(0.14, 1500, 0.9, 0.8, 0, "bandpass", 0.5);
      this.tone(120, 0.12, "triangle", 0.45, 0, 55, 0, 0.4);
    }
  }

  /** A sound from something you cannot see. angle/aim in 0..65535. */
  ping(kind: number, angle: number, dist: number, aim: number) {
    const rel = ((angle - aim + 65536 + 32768) % 65536) - 32768;
    const pan = Math.sin((rel / 65536) * Math.PI * 2);
    const vol = Math.max(0.08, 1 - dist / 26);
    const behind = Math.abs(rel) > 16384;
    if (kind === 1) {
      // footsteps: two muffled thuds on gravel
      this.burst(0.1, behind ? 200 : 320, 1.6, 0.6 * vol, pan, "lowpass", 0.5);
      setTimeout(() => this.burst(0.09, behind ? 190 : 300, 1.6, 0.45 * vol, pan, "lowpass", 0.5), 260);
    } else if (kind === 2) {
      this.burst(0.35, 600, 0.6, 0.75 * vol, pan, "lowpass", 0.85);
      this.tone(60, 0.5, "sine", 0.35 * vol, pan, 34, 0, 0.8);
    } else if (kind === 3) {
      this.tone(660, 0.25, "sine", 0.18 * vol, pan, 990, 0, 0.8);
    } else if (kind === 4) {
      this.burst(0.05, 3000, 3, 0.35 * vol, pan, "bandpass", 0.6);
      setTimeout(() => this.burst(0.05, 2600, 3, 0.35 * vol, pan, "bandpass", 0.6), 120);
    }
  }

  hurt() {
    this.tone(200, 0.22, "sawtooth", 0.28, 0, 70, 0, 0.3);
    this.burst(0.12, 500, 1, 0.45, 0, "bandpass", 0.3);
  }

  kill() {
    this.tone(330, 0.5, "sawtooth", 0.12, 0, 160, 0, 0.7);
    this.tone(220, 0.7, "sawtooth", 0.12, 0, 110, 0.05, 0.7);
  }

  death() {
    this.tone(260, 2.2, "sawtooth", 0.3, 0, 30, 0, 0.8);
    this.burst(1.5, 180, 0.5, 0.5, 0, "lowpass", 0.9);
    this.howl(0.2, 0.5, 1.2);
  }

  pickup() {
    this.tone(440, 0.12, "triangle", 0.2, 0, undefined, 0, 0.5);
    this.tone(660, 0.18, "triangle", 0.18, 0, undefined, 0.08, 0.5);
  }

  reload() {
    this.burst(0.04, 3200, 4, 0.3, 0, "bandpass", 0.3);
    this.burst(0.05, 2500, 4, 0.3, 0, "bandpass", 0.3);
  }

  flare() {
    this.burst(1.4, 4000, 0.3, 0.3, 0, "highpass", 0.8);
    this.tone(1200, 1.2, "sine", 0.08, 0, 300, 0, 0.8);
  }

  countdown() {
    this.boom();
    [0, 1, 2].forEach((i) => this.tone(110, 0.5, "sine", 0.3, 0, 104, i, 0.7));
  }

  go() {
    this.howl(-0.4, 0.55);
  }

  end() {
    this.boom();
  }

  lightsOn() {
    this.burst(0.8, 120, 0.4, 0.8, 0, "lowpass", 0.6);
    this.tone(55, 1.8, "sine", 0.6, 0, 50, 0, 0.5);
    this.tone(1760, 0.08, "square", 0.05, 0, undefined, 0.05, 0.3);
  }

  /** Distant thunder, rolling in `delay` seconds after the flash. */
  thunder(delay = 1) {
    const c = this.ensure();
    if (!c || this.muted) return;
    setTimeout(() => {
      this.burst(2.6, 90, 0.4, 0.9, (Math.random() - 0.5) * 0.6, "lowpass", 0.9);
      this.burst(1.2, 220, 0.6, 0.35, 0, "lowpass", 0.8);
      this.tone(42, 2.4, "sine", 0.35, 0, 30, 0.05, 0.7);
    }, delay * 1000);
  }

  /** Steady rain bed (filtered noise), 0..1. */
  private rain: { gain: GainNode } | null = null;
  setRain(level: number) {
    const c = this.ensure();
    if (!c) return;
    if (!this.rain) {
      const len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 6500;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(hp).connect(lp).connect(gain).connect(this.dry!);
      src.start();
      this.rain = { gain };
    }
    this.rain.gain.gain.setTargetAtTime(this.muted ? 0 : level * 0.05, c.currentTime, 0.8);
  }

  /** Your bullet landed. */
  hitmark() {
    this.tone(1800, 0.05, "square", 0.05, 0, 1400, 0, 0.1);
  }

  /** Kill streak sting: higher for every extra kill. */
  streak(n: number) {
    const base = 220 * Math.pow(1.26, Math.min(n, 5));
    this.tone(base, 0.35, "triangle", 0.12, 0, base * 1.5, 0, 0.6);
    this.tone(base * 1.5, 0.45, "triangle", 0.08, 0, base * 2, 0.08, 0.6);
  }

  /** Low hum that rises while you're outside the zone. */
  setZoneDanger(level: number) {
    const c = this.ensure();
    if (!c) return;
    if (!this.hum) {
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 46;
      const gain = c.createGain();
      gain.gain.value = 0;
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 300;
      osc.connect(f).connect(gain).connect(this.dry!);
      osc.start();
      this.hum = { gain };
    }
    this.hum.gain.gain.setTargetAtTime(this.muted ? 0 : level * 0.14, c.currentTime, 0.2);
  }
}

// one engine per page, even across hot reloads (otherwise an old engine keeps playing unmuted)
const g = globalThis as any;
if (g.__boAudio?.ctx) g.__boAudio.ctx.close?.().catch?.(() => {});
export const audio: Audio = new Audio();
g.__boAudio = audio;
