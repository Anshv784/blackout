// Horror sound design — all synthesized, no assets.
// Everything runs through a shared reverb so the Yard feels huge and empty.
// Directional cues are panned relative to where you're aiming.

import { prefs, setPref } from "./prefs";

/** recorded horror hits (stingers, screams, slams), in public/sfx as hit_*.mp3 */
const HITS = ["hit_bass1", "hit_bass2", "hit_bass3", "hit_mid1", "hit_mid2", "hit_mid3", "hit_high1", "hit_high2"];
const pick = (kind: "bass" | "mid" | "high") => {
  const n = kind === "high" ? 2 : 3;
  return `hit_${kind}${1 + Math.floor(Math.random() * n)}`;
};

// each gun: [recording, pitch, loudness]. .308 for both rifles (the M416 a touch higher and lighter)
const GUN_SAMPLE: [string, number, number][] = [
  ["shot_9mm", 1.0, 0.42], // P92
  ["shot_9mm", 1.12, 0.36], // UMP
  ["shot_20g", 1.0, 0.5], // S12K
  ["shot_308", 1.14, 0.42], // M416
  ["shot_308", 0.94, 0.52], // KAR98K
];

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
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
  /** Master volume from the settings menu (0..1.5). */
  setVolume(v: number) {
    setPref("volume", v);
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx!.currentTime, 0.05);
  }
  /** Guns, steps, hits. */
  setSfxVolume(v: number) {
    setPref("sfxVol", v);
    if (this.sfx) this.sfx.gain.setTargetAtTime(v, this.ctx!.currentTime, 0.05);
  }
  /** The night's ambience and music. */
  setMusicVolume(v: number) {
    setPref("musicVol", v);
    if (this.music) this.music.gain.setTargetAtTime(v, this.ctx!.currentTime, 0.05);
  }
  toggleMute() {
    this.setMuted(!this.muted);
  }
  private hum: { gain: GainNode } | null = null;
  private ambience: { gain: GainNode; stop: () => void } | null = null;
  private heart: { timer: number | null; bpm: number; level: number } = { timer: null, bpm: 0, level: 0 };
  private nextHowl = 0;
  private nextCreak = 0;
  private nextSting = 0;

  private ensure() {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const c = new Ctx();
      this.ctx = c;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : prefs.volume;
      // no boost: the recordings are already full-scale. A soft safety limiter only catches
      // stacked peaks (a frag on top of gunfire); it shouldn't be working most of the time.
      const makeup = c.createGain();
      makeup.gain.value = 0.8;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -4;
      comp.knee.value = 8;
      comp.ratio.value = 6;
      comp.attack.value = 0.005;
      comp.release.value = 0.25;
      this.master.connect(makeup).connect(comp).connect(c.destination);
      this.sfx = c.createGain();
      this.sfx.gain.value = prefs.sfxVol;
      this.sfx.connect(this.master);
      this.music = c.createGain();
      this.music.gain.value = prefs.musicVol;
      this.music.connect(this.master);
      this.dry = c.createGain();
      this.dry.gain.value = 0.85;
      this.wet = c.createGain();
      this.wet.gain.value = 0.55;
      this.verb = c.createConvolver();
      this.verb.buffer = this.impulse(3.8, 2.6);
      this.dry.connect(this.sfx);
      this.wet.connect(this.verb).connect(this.sfx);
      this.preload();
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

  // ------------------------------------------------------------ recorded sounds
  // CC0: real gunshots and handling from Snake's Second Authentic Gun Sounds; horror beds and
  // hits from OpenGameArt (see public/sfx/CREDITS.txt). Synthesis fills in until they load.

  private bufs2 = new Map<string, AudioBuffer>();
  private loading = new Set<string>();
  private load(name: string) {
    const c = this.ctx;
    if (!c || this.bufs2.has(name) || this.loading.has(name)) return;
    this.loading.add(name);
    fetch(`/sfx/${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((a) => c.decodeAudioData(a))
      .then((b) => this.bufs2.set(name, b))
      .catch(() => {})
      .finally(() => this.loading.delete(name));
  }
  private preload() {
    for (const n of ["wolf", "shot_9mm", "shot_308", "shot_20g", "mag_out", "mag_in", "rack", "shell_load", "bolt_load", "dry_fire", ...HITS]) this.load(n);
  }
  has(name: string) {
    return this.bufs2.has(name);
  }

  /** Play a recorded sound through the effects bus. `lp` darkens it (distance), `rate` repitches. */
  play(name: string, o: { vol?: number; pan?: number; rate?: number; wet?: number; delay?: number; lp?: number } = {}) {
    const c = this.ensure();
    const b = this.bufs2.get(name);
    if (!c || this.muted || !b) return false;
    const t = c.currentTime + (o.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = o.rate ?? 1;
    const g = this.out(o.pan ?? 0, o.vol ?? 1, o.wet ?? 0.25);
    if (o.lp && o.lp < 18000) {
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.lp;
      src.connect(f).connect(g);
    } else src.connect(g);
    src.start(t);
    return true;
  }

  private loops = new Map<string, { gain: GainNode; src: AudioBufferSourceNode }>();
  /** A looping bed on the music bus, faded in. Waits for the file if it isn't loaded yet. */
  startLoop(name: string, vol: number, fade = 3) {
    const c = this.ensure();
    if (!c || this.loops.has(name)) return;
    this.load(name);
    const go = () => {
      const b = this.bufs2.get(name);
      if (!b) return void setTimeout(go, 300);
      if (this.loops.has(name) || !this.music) return;
      const src = c.createBufferSource();
      src.buffer = b;
      src.loop = true;
      const g = c.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(vol, c.currentTime + fade);
      src.connect(g).connect(this.music);
      src.start();
      this.loops.set(name, { gain: g, src });
    };
    go();
  }
  stopLoop(name: string, fade = 2) {
    const l = this.loops.get(name);
    const c = this.ctx;
    if (!l || !c) return;
    this.loops.delete(name);
    l.gain.gain.setTargetAtTime(0, c.currentTime, fade / 3);
    setTimeout(() => l.src.stop(), fade * 1000 + 200);
  }

  // ------------------------------------------------------------ ambience

  /** The bed: detuned sub drone, wind gusts, and a slow-breathing filter. */
  startAmbience(intensity = 1, story = false) {
    const c = this.ensure();
    if (!c || this.ambience) return;
    // the recorded dread: a cramped dark passage under a slow drone from somewhere below
    if (story) this.startLoop("amb_cryptid", 0.85 * intensity, 4);
    else {
      this.startLoop("amb_passage", 0.75 * intensity, 4);
      this.startLoop("amb_hell", 0.45 * intensity, 8);
    }
    const bus = c.createGain();
    bus.gain.value = 0;
    bus.gain.linearRampToValueAtTime(0.28 * intensity, c.currentTime + 4);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    bus.connect(lp);
    lp.connect(this.music!);
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
    for (const n of ["amb_cryptid", "amb_passage", "amb_hell"]) this.stopLoop(n);
    this.ambience?.stop();
    this.ambience = null;
  }

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

  /** picking something up, by loot kind: what your hands are actually doing */
  pickup(kind = 0) {
    // the grab itself: kit brushing against your vest
    this.hit({ kind: "pink", dur: 0.14, type: "bandpass", f: 900, q: 0.8, vol: 0.07, wet: 0.08 });
    if (kind === 1) {
      // medkit: unzip the pouch, rip the tape
      this.hit({ kind: "white", dur: 0.28, type: "bandpass", f: 2400, f2: 4200, q: 3, vol: 0.06, wet: 0.08, delay: 0.12, attack: 0.04 });
      this.hit({ kind: "white", dur: 0.16, type: "highpass", f: 2600, vol: 0.09, wet: 0.08, delay: 0.5, attack: 0.01 });
    } else if (kind === 2) {
      // armor: two velcro straps torn open and pressed shut
      for (const d of [0.12, 0.42]) this.hit({ kind: "white", dur: 0.2, type: "bandpass", f: 3200, q: 1.2, vol: 0.08, wet: 0.06, delay: d, attack: 0.01 });
      this.thump({ f0: 150, f1: 90, dur: 0.08, vol: 0.14, delay: 0.66, wet: 0.1 });
    } else if (kind === 3 || kind === 4 || kind === 6 || kind === 7 || kind === 8) {
      // a gun case: two latches, lid, then the weapon racked
      this.tick(3300, 0.1, 0.04);
      this.tick(3500, 0.1, 0.13);
      this.hit({ kind: "brown", dur: 0.1, type: "lowpass", f: 500, vol: 0.14, wet: 0.15, delay: 0.2 });
      if (!this.play("rack", { vol: 0.55, delay: 0.42, wet: 0.08, rate: 0.9 })) this.tick(2600, 0.12, 0.42);
    } else if (kind === 5) {
      // flare: the cap twisted off
      this.hit({ kind: "white", dur: 0.12, type: "bandpass", f: 1800, q: 4, vol: 0.06, wet: 0.08, delay: 0.1 });
      this.tick(2200, 0.08, 0.26);
    } else if (kind >= 9) {
      // a gadget clipped to the belt
      this.clink(0.8);
      this.tick(4100, 0.06, 0.18);
    } else {
      this.tone(440, 0.12, "triangle", 0.2, 0, undefined, 0, 0.5);
    }
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

  /** Supply drop: a plane overhead, then the thud of the crate. */
  airdrop() {
    this.tone(70, 3.2, "sawtooth", 0.12, -0.6, 90, 0, 0.8);
    this.tone(74, 3.2, "sawtooth", 0.1, 0.6, 95, 0.1, 0.8);
    setTimeout(() => this.boom(), 2600);
  }

  /** The lights die (and come back). */
  powerDown(on: boolean) {
    if (on) {
      this.horror("bass", 0.95, { wet: 0.6 });
      this.tone(220, 1.2, "sawtooth", 0.18, 0, 40, 0, 0.7);
      this.burst(0.4, 140, 0.6, 0.6, 0, "lowpass", 0.8);
    } else this.tone(80, 0.6, "sine", 0.2, 0, 240, 0, 0.5);
  }

  smoke() {
    this.burst(1.6, 2200, 0.4, 0.25, 0, "highpass", 0.4);
  }

  sensor() {
    this.tone(1320, 0.07, "square", 0.06, 0, undefined, 0, 0.2);
    this.tone(1760, 0.07, "square", 0.06, 0, undefined, 0.1, 0.2);
  }

  nvgOn() {
    this.tone(400, 0.5, "sine", 0.08, 0, 2400, 0, 0.3);
  }

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
  // ================================================================ sound design
  // Everything below is layered synthesis: transient + body + low end + room tail,
  // shaped per weapon/event, positioned (pan) and muffled with distance.

  private bufs: Record<string, AudioBuffer> = {};
  /** cached noise colours: white, pink, brown (2 s, looped/sliced as needed) */
  private nbuf(kind: "white" | "pink" | "brown") {
    const c = this.ctx!;
    if (this.bufs[kind]) return this.bufs[kind];
    const len = c.sampleRate * 2;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") d[i] = w;
      else if (kind === "pink") {
        b0 = 0.997 * b0 + w * 0.029591;
        b1 = 0.985 * b1 + w * 0.032534;
        b2 = 0.95 * b2 + w * 0.048056;
        d[i] = (b0 + b1 + b2 + w * 0.05) * 2.2;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    this.bufs[kind] = b;
    return b;
  }

  /** one shaped noise hit: colour → filter → envelope → panned bus with reverb send */
  private hit(o: { kind?: "white" | "pink" | "brown"; dur: number; type?: BiquadFilterType; f: number; f2?: number; q?: number; vol: number; pan?: number; wet?: number; delay?: number; attack?: number }) {
    const c = this.ensure();
    if (!c || this.muted) return;
    const t = c.currentTime + (o.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.nbuf(o.kind ?? "white");
    const f = c.createBiquadFilter();
    f.type = o.type ?? "bandpass";
    f.frequency.setValueAtTime(o.f, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = this.out(o.pan ?? 0, 0, o.wet ?? 0.3);
    const a = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g);
    const off = Math.random() * 1.5;
    src.start(t, off, o.dur + 0.05);
  }

  /** a low "thump": sine sweeping down, lightly driven */
  private thump(o: { f0: number; f1: number; dur: number; vol: number; pan?: number; delay?: number; wet?: number }) {
    const c = this.ensure();
    if (!c || this.muted) return;
    const t = c.currentTime + (o.delay ?? 0);
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(o.f0, t);
    osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const sh = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    sh.curve = curve;
    const g = this.out(o.pan ?? 0, 0, o.wet ?? 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(sh).connect(g);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  /** a tiny metallic tick (slides, bolts, mags) */
  private tick(freq: number, vol: number, delay = 0, pan = 0) {
    this.hit({ kind: "white", dur: 0.035, type: "bandpass", f: freq, q: 6, vol, pan, wet: 0.15, delay });
    this.tone(freq * 0.5, 0.03, "square", vol * 0.25, pan, undefined, delay, 0.1);
  }

  /**
   * A gunshot. `dist` in tiles (0 = yours), `pan` -1..1.
   * Distance pulls the crack out first (high end dies fast), then the body; the room tail stays.
   */
  shotAt(weapon: number, dist = 0, pan = 0) {
    const c = this.ensure();
    if (!c || this.muted) return;
    // a real gun: close is a sharp crack, far is a dull thud rolling off the walls
    const [smp, rate, gunLoud] = GUN_SAMPLE[weapon] ?? GUN_SAMPLE[0];
    if (this.has(smp)) {
      const far = Math.min(1, dist / 28);
      const jitter = 1 + (Math.random() - 0.5) * 0.06;
      this.play(smp, { vol: gunLoud * (1 - far * 0.7), pan, rate: rate * jitter * (1 - far * 0.08), wet: 0.12 + far * 0.6, lp: 9000 * Math.pow(1 - far, 2) + 700 }); // even close, no ear-splitting top end
      if (dist === 0 && weapon === 4) this.play("rack", { vol: 0.5, rate: 0.8, delay: 0.55, wet: 0.05 }); // work the bolt
      if (dist === 0 && weapon === 2) this.play("rack", { vol: 0.55, rate: 0.62, delay: 0.32, wet: 0.05 }); // rack the pump
      return;
    }
    // [crack freq, body freq, body len, thump f0, thump len, tail len, loudness]
    const P = [
      [3600, 1100, 0.07, 150, 0.12, 0.7, 0.8], // P92: dry snap
      [4200, 1500, 0.05, 130, 0.08, 0.5, 0.6], // UMP: tight, quick
      [2600, 520, 0.14, 95, 0.26, 1.2, 1.1], // S12K: big boom
      [3800, 900, 0.07, 120, 0.14, 0.9, 0.85], // M416: punchy crack
      [3000, 700, 0.12, 80, 0.32, 2.2, 1.25], // KAR98K: thunderclap that rolls away
    ][weapon] ?? [3600, 1100, 0.07, 150, 0.12, 0.7, 0.8];
    const [crack, body, blen, tf, tlen, tail, loud] = P;
    const far = Math.min(1, dist / 26);
    const v = loud * (1 - far * 0.75);
    const dull = 1 - far * 0.85; // high end fades with distance
    if (dist < 18) this.hit({ kind: "white", dur: 0.012, type: "highpass", f: crack * dull + 400, q: 0.7, vol: 0.9 * v * dull, pan, wet: 0.05 });
    this.hit({ kind: "pink", dur: blen, type: "bandpass", f: body * (0.6 + 0.4 * dull), q: 0.9, vol: 1.1 * v, pan, wet: 0.2 });
    this.thump({ f0: tf, f1: 38, dur: tlen, vol: 0.9 * v, pan, wet: 0.2 });
    // the Yard answers: long dark tail mostly in the reverb
    this.hit({ kind: "brown", dur: tail, type: "lowpass", f: 900 * (0.5 + 0.5 * dull), q: 0.5, vol: 0.55 * loud, pan, wet: 0.95, attack: 0.02 });
    if (weapon === 4 && dist < 30) {
      // the shot rolls across the containers
      this.hit({ kind: "brown", dur: 1.4, type: "lowpass", f: 500, q: 0.5, vol: 0.3 * loud, pan: -pan, wet: 1, delay: 0.28, attack: 0.05 });
    }
    if (dist === 0) {
      // your own gun's mechanism
      if (weapon === 0) this.tick(5200, 0.08, 0.05);
      if (weapon === 1 || weapon === 3) this.tick(6200, 0.05, 0.03);
      if (weapon === 2) {
        this.hit({ kind: "white", dur: 0.06, type: "bandpass", f: 1800, q: 2, vol: 0.18, wet: 0.1, delay: 0.32 });
        this.hit({ kind: "white", dur: 0.07, type: "bandpass", f: 1400, q: 2, vol: 0.2, wet: 0.1, delay: 0.45 });
      }
      if (weapon === 4) {
        this.tick(3200, 0.1, 0.55);
        this.tick(2600, 0.12, 0.72);
      }
    }
  }

  /** your own gun */
  shoot(weapon: number) {
    this.shotAt(weapon, 0, 0);
  }

  /** a round cracking past your head */
  whiz(pan = 0) {
    this.hit({ kind: "white", dur: 0.16, type: "bandpass", f: 5200, f2: 1600, q: 3, vol: 0.18, pan, wet: 0.05 });
  }

  /** a round hitting concrete or steel near you */
  ricochet(pan = 0) {
    this.hit({ kind: "white", dur: 0.05, type: "highpass", f: 2400, vol: 0.12, pan, wet: 0.2 });
    this.tone(2200 + Math.random() * 1600, 0.18, "sine", 0.03, pan, 900, 0.01, 0.4);
  }

  /** pin out, spoon flick, the arm swing */
  toss(kind = 1) {
    if (kind === 1 || kind === 3) {
      this.tick(3400, 0.06);
      this.tick(5200, 0.04, 0.05);
    }
    this.hit({ kind: "pink", dur: 0.22, type: "bandpass", f: 700, f2: 1800, q: 0.8, vol: 0.14, wet: 0.1, delay: 0.12, attack: 0.08 });
  }

  /** a can hitting concrete or a wall: metal clink over a dull knock */
  clink(vol = 1, pan = 0) {
    this.tone(1900 + Math.random() * 500, 0.09, "triangle", 0.05 * vol, pan, 1500, 0, 0.3);
    this.tone(3100 + Math.random() * 600, 0.06, "sine", 0.025 * vol, pan, undefined, 0.004, 0.3);
    this.hit({ kind: "brown", dur: 0.06, type: "lowpass", f: 500, vol: 0.25 * vol, pan, wet: 0.25 });
  }

  /** a rolling can: soft rattles that die away */
  roll(vol = 1, pan = 0) {
    for (let i = 0; i < 4; i++) this.tone(2300 + Math.random() * 400, 0.04, "triangle", 0.018 * vol * (1 - i / 4), pan, undefined, 0.07 * i + Math.random() * 0.03, 0.2);
  }

  /** the fuse in your hand while you cook the throw */
  fuse() {
    this.tick(1600, 0.035);
  }

  /** A sound from something you cannot see. angle/aim in 0..65535. */
  ping(kind: number, angle: number, dist: number, aim: number) {
    const rel = ((angle - aim + 65536 + 32768) % 65536) - 32768;
    const pan = Math.sin((rel / 65536) * Math.PI * 2);
    const behind = Math.abs(rel) > 16384;
    const vol = Math.max(0.1, 1 - dist / 26);
    if (kind === 1) this.step(pan, vol * (behind ? 0.8 : 1), false);
    else if (kind === 2) this.shotAt(0, Math.max(6, dist), pan);
    else if (kind === 3) {
      // someone opening a crate: latch + rummage
      this.tick(2800, 0.07 * vol, 0, pan);
      this.hit({ kind: "pink", dur: 0.25, type: "bandpass", f: 900, q: 1, vol: 0.12 * vol, pan, wet: 0.5, delay: 0.08 });
    } else if (kind === 4) {
      this.tick(3600, 0.07 * vol, 0, pan);
      this.tick(2400, 0.08 * vol, 0.18, pan);
    }
  }

  /** a boot on wet concrete (sneaking is near-silent, sprinting is heavy) */
  step(pan = 0, vol = 0.6, heavy = false) {
    this.hit({ kind: "brown", dur: heavy ? 0.12 : 0.09, type: "lowpass", f: heavy ? 380 : 300, q: 0.7, vol: 0.5 * vol, pan, wet: 0.35 });
    this.hit({ kind: "white", dur: 0.04, type: "bandpass", f: 2600, q: 1.5, vol: 0.05 * vol, pan, wet: 0.2, delay: 0.01 });
  }

  /** mag out, mag in, charge */
  /**
   * The reload, timed to the animation over `dur` seconds (the gun's real reload time):
   * mag guns: mag out, mag in, charging handle; the shotgun: shells one by one, then the pump;
   * the Kar98k: bolt open, rounds pushed in, bolt home.
   */
  reload(weapon = 0, dur = 2) {
    if (this.has("mag_out")) {
      if (weapon === 2) {
        for (let i = 0; i < 3; i++) this.play("shell_load", { vol: 0.5, delay: dur * (0.3 + i * 0.22), wet: 0.08, rate: 0.97 + Math.random() * 0.06 });
        this.play("rack", { vol: 0.7, rate: 0.62, delay: dur * 0.84, wet: 0.08 });
      } else if (weapon === 4) {
        this.play("bolt_load", { vol: 0.5, delay: dur * 0.06, wet: 0.08 });
        for (let i = 0; i < 3; i++) this.tick(3600 + Math.random() * 500, 0.05, dur * (0.38 + i * 0.13));
        this.play("rack", { vol: 0.6, rate: 0.8, delay: dur * 0.84, wet: 0.08 });
      } else {
        this.play("mag_out", { vol: 0.5, delay: dur * 0.12, wet: 0.08 });
        // fingers in the vest pouch
        this.hit({ kind: "pink", dur: 0.18, type: "bandpass", f: 1400, q: 0.9, vol: 0.06, wet: 0.05, delay: dur * 0.3 });
        this.play("mag_in", { vol: 0.55, delay: dur * 0.5, wet: 0.08 });
        this.play("rack", { vol: 0.5, delay: dur * 0.72, wet: 0.08, rate: weapon === 0 ? 1.05 : 0.95 });
      }
      return;
    }
    this.tick(2400, 0.1, 0);
    this.hit({ kind: "white", dur: 0.08, type: "bandpass", f: 1200, q: 2, vol: 0.1, wet: 0.1, delay: 0.05 });
    this.thump({ f0: 220, f1: 120, dur: 0.06, vol: 0.18, delay: dur * 0.5, wet: 0.1 });
    this.tick(3100, 0.12, dur * 0.72);
  }

  /** the trigger on an empty chamber */
  dryFire() {
    if (!this.play("dry_fire", { vol: 0.55, wet: 0.05, rate: 0.95 + Math.random() * 0.1 })) this.tick(2800, 0.12, 0);
  }

  /** an empty magazine hitting concrete: a dull plastic-and-steel clunk */
  magDrop(vol = 1, pan = 0) {
    this.thump({ f0: 320, f1: 160, dur: 0.07, vol: 0.22 * vol, pan, wet: 0.15 });
    this.tone(1250 + Math.random() * 200, 0.07, "triangle", 0.03 * vol, pan, 900, 0.01, 0.2);
    this.hit({ kind: "brown", dur: 0.05, type: "lowpass", f: 700, vol: 0.2 * vol, pan, wet: 0.2, delay: 0.09 });
  }

  /** slinging one gun and bringing up the other: strap rattle, then the new one seated */
  swap() {
    if (this.play("mag_out", { vol: 0.28, rate: 1.4, wet: 0.05 })) {
      this.play("rack", { vol: 0.32, rate: 1.15, delay: 0.26, wet: 0.05 });
      return;
    }
    this.tick(1800, 0.06);
    this.tick(2600, 0.07, 0.25);
  }

  /** you got hit: a dull body thud and a sharp intake */
  hurt() {
    this.thump({ f0: 160, f1: 50, dur: 0.18, vol: 0.55, wet: 0.1 });
    this.hit({ kind: "pink", dur: 0.12, type: "lowpass", f: 700, vol: 0.4, wet: 0.1 });
    this.hit({ kind: "white", dur: 0.25, type: "bandpass", f: 3000, f2: 1200, q: 2, vol: 0.05, wet: 0.2, delay: 0.05, attack: 0.05 });
  }

  /** your shot landed: a tight, dry tick */
  hitmark() {
    this.tick(5400, 0.09);
    this.thump({ f0: 300, f1: 160, dur: 0.05, vol: 0.12, wet: 0 });
  }

  /** you took someone out: a low, final hit and a rising sting */
  kill() {
    this.horror("mid", 0.4, { wet: 0.5, lp: 5000 });
    this.thump({ f0: 90, f1: 30, dur: 0.6, vol: 0.5, wet: 0.5 });
    this.tone(196, 0.9, "triangle", 0.07, 0, 392, 0.05, 0.8);
    this.tone(293, 0.9, "triangle", 0.05, 0, 587, 0.12, 0.8);
  }

  /** you're out: everything drops away */
  death() {
    if (this.horror("bass", 1, { wet: 0.6 })) {
      this.horror("high", 0.45, { wet: 0.8, delay: 0.25 });
      return;
    }
    this.thump({ f0: 70, f1: 25, dur: 2.2, vol: 0.6, wet: 0.7 });
    this.hit({ kind: "brown", dur: 2.4, type: "lowpass", f: 400, f2: 80, vol: 0.5, wet: 0.9, attack: 0.05 });
    this.tone(220, 2.6, "sine", 0.06, 0, 110, 0.2, 0.9);
  }

  /** a body hitting wet concrete, then the gun clattering after it */
  bodyFall(pan = 0, vol = 1) {
    this.thump({ f0: 90, f1: 40, dur: 0.35, vol: 0.45 * vol, pan, wet: 0.4 });
    this.hit({ kind: "brown", dur: 0.25, type: "lowpass", f: 600, f2: 200, vol: 0.4 * vol, pan, wet: 0.4 });
    this.hit({ kind: "white", dur: 0.12, type: "bandpass", f: 1800, q: 0.7, vol: 0.06 * vol, pan, wet: 0.3, delay: 0.02 });
    this.clink(0.8 * vol, pan);
    setTimeout(() => this.clink(0.4 * vol, pan), 130);
  }

  /** frag / flashbang */
  explosion(dist: number, flash = false) {
    const v = Math.max(0.2, 1 - dist / 30);
    const dull = 1 - Math.min(1, dist / 30) * 0.8;
    this.hit({ kind: "white", dur: 0.05, type: "highpass", f: 1500 * dull + 300, vol: 0.7 * v * dull, wet: 0.1 });
    this.thump({ f0: 90, f1: 22, dur: 1.1, vol: 1.2 * v, wet: 0.3 });
    this.hit({ kind: "brown", dur: 2.4, type: "lowpass", f: 900 * dull, f2: 120, vol: 0.9 * v, wet: 0.9, attack: 0.01 });
    // debris raining down
    for (let i = 0; i < 9; i++) this.tick(1500 + Math.random() * 3000, 0.03 * v, 0.25 + Math.random() * 1.1, Math.random() * 1.6 - 0.8);
    if (flash && dist < 8) this.tone(3400, 2.6, "sine", 0.08, 0, 3000, 0.05, 0.2);
  }

  boom() {
    if (this.horror("bass", 0.9, { wet: 0.5 })) return;
    this.thump({ f0: 70, f1: 24, dur: 1.6, vol: 0.8, wet: 0.7 });
    this.hit({ kind: "brown", dur: 2.2, type: "lowpass", f: 500, f2: 90, vol: 0.6, wet: 0.95, attack: 0.02 });
  }

  /** a recorded horror hit (deep, mid or high); false if it hasn't loaded yet */
  horror(kind: "bass" | "mid" | "high", vol = 0.8, o: { pan?: number; wet?: number; lp?: number; delay?: number } = {}) {
    const scale = kind === "high" ? 0.35 : kind === "mid" ? 0.5 : 0.6; // the high ones are piercing
    return this.play(pick(kind), { vol: vol * scale, wet: o.wet ?? 0.35, pan: o.pan, lp: Math.min(o.lp ?? 5000, kind === "high" ? 3500 : 5000), delay: o.delay });
  }

  /** someone just stepped into your light: a stab of strings + sub */
  stinger() {
    if (this.horror("mid", 0.7)) return;
    this.tone(466, 0.7, "sawtooth", 0.05, -0.3, 440, 0, 0.8);
    this.tone(494, 0.7, "sawtooth", 0.05, 0.3, 470, 0, 0.8);
    this.thump({ f0: 60, f1: 40, dur: 0.5, vol: 0.35, wet: 0.5 });
  }

  whisper(pan = 0) {
    for (let i = 0; i < 3; i++) setTimeout(() => this.burst(0.35 + Math.random() * 0.3, 2400 + Math.random() * 1600, 4, 0.08, pan, "bandpass", 0.9), i * 180);
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

  /** Distant wolf: formant-filtered saw with a rising-then-falling glide and wobble. */
  howl(pan = 0, vol = 0.5, delay = 0) {
    const c = this.ensure();
    if (!c || this.muted) return;
    // real wolves (NPS, Denali), far off across the Yard: muffled, from one side, into the reverb
    if (this.play("wolf", { vol: vol * 0.55, pan, delay, rate: 0.94 + Math.random() * 0.1, wet: 0.7, lp: 2600 })) return;
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
    // now and then something happens far off in the dark: a muffled horror sting from one side
    if (now > this.nextSting) {
      if (this.nextSting) this.horror(Math.random() < 0.5 ? "mid" : "high", 0.3 + Math.random() * 0.2, { pan: Math.random() * 1.6 - 0.8, wet: 0.9, lp: 1400 + Math.random() * 1400 });
      this.nextSting = now + 35000 + Math.random() * 40000;
    }
  }

}

// one engine per page, even across hot reloads (otherwise an old engine keeps playing unmuted)
const g = globalThis as any;
if (g.__boAudio?.ctx) g.__boAudio.ctx.close?.().catch?.(() => {});
export const audio: Audio = new Audio();
g.__boAudio = audio;
