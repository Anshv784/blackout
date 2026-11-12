// One live room: subscriptions, input sending, client prediction, interpolation,
// and the "anyone can push the room forward" duties (tick/seed/finish fallbacks).
import { setActiveMap } from "./maps";
import { TOUCH } from "./device";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { client } from "./identity";
import { ticketPda, TICKET_LEN } from "../chain/client";
import { useStore } from "./store";
import {
  decodeView,
  NO_SEAT,
  ST_COUNTDOWN,
  ST_ENDED,
  ST_LIVE,
  ST_LOBBY,
  ST_REVEALED,
  ST_STARTING,
  type Room,
  type View,
  type VisPlayer,
  WEAPON_NAME,
  FIRE_MODE,
  NIGHT_MOD,
  NIGHT_MOD_SUB,
  DOWNED,
} from "../chain/layout";
import { inputVelocity, moveBody, moveStep, SPEED, UNIT, COUNTDOWN_TICKS, blackoutTick, BLACKOUT_TICKS } from "./sim";
import { banner, feel } from "./feel";
import { ClockKeeper } from "./clock";
import { audio } from "./audio";
import { controls } from "./controls";

export interface Sample {
  t: number; // local ms when received
  tick: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  weapon: number;
  flags: number;
}

export interface Track {
  seat: number;
  samples: Sample[];
  lastSeen: number; // local ms
  visible: boolean;
  /** what was drawn last frame, and the offset still being eased out after a correction */
  shown?: { x: number; y: number; at: number; rx: number; ry: number; ox: number; oy: number };
}

export interface Fx {
  id: number;
  kind: "ping" | "shot" | "hit" | "flash" | "death" | "loot";
  at: number;
  x: number;
  y: number;
  angle?: number;
  sub?: number;
  dist?: number;
}

const DEFAULT_KEY = "11111111111111111111111111111111";
let fxId = 0;

const GADGET_TAG = 1 << 20;

export class Session {
  roomId: bigint;
  room: Room | null = null;
  view: View | null = null;
  viewAt = 0;
  mySeat: number | null = null;
  tracks = new Map<number, Track>();
  bullets: { x: number; y: number; vx: number; vy: number }[] = [];
  /** gadgets in the air: kind 1 frag … 5 sensor, ttl = ticks of flight left (18 at the throw) */
  nades: { x: number; y: number; vx: number; vy: number; kind: number; ttl: number }[] = [];
  bulletsAt = 0;
  fx: Fx[] = [];

  // prediction
  pred = { x: 0, y: 0 };
  private predPrev = { x: 0, y: 0 };
  predValid = false;
  private predAcc = 0;
  /** the server tick our predicted position corresponds to; it may only run a few ticks ahead of the
   *  last server tick we've seen, so a slow network or a slow rollup can't make us drift and snap back */
  private predTick = 0;
  private serverTick = 0;
  snaps = 0;
  private hudAt = 0;
  /** the move we predicted for each tick, to replay on top of each server state */
  private hist = new Map<number, [number, number, number]>();
  /** predicted stamina word (see sim.ts sprintStep) and whether you're sprinting right now */
  predMoved = 0;
  predSpeed = SPEED;
  /** night events: where the supply drop is (from its pings) and the kill leader's direction */
  drop: { x: number; y: number; at: number } | null = null;
  /** smoke clouds you can see from afar (from smoke pings), keyed by rounded position */
  smokes = new Map<string, { x: number; y: number; at: number }>();
  /** crates that were emptied: drawn open on the ground for a while */
  looted: { x: number; y: number; kind: number; at: number }[] = [];
  /** death crates this night: solid on foot (a jump clears them), mirrored from the program */
  crates: { x: number; y: number }[] = [];
  /** explosions to draw */
  booms: { x: number; y: number; at: number }[] = [];
  private announcedMod = -1;
  private wasDown = false;
  bounty: { angle: number; dist: number; at: number; seat: number } | null = null;
  private lastLeader = -1;
  private streak = 0;
  private lastKillAt = 0;
  sprinting = false;
  private lastFrame = performance.now();

  // input
  input = { dx: 0, dy: 0, aim: 0, buttons: 0 };
  private sent = { dx: 999, dy: 999, aim: -1, buttons: -1 };
  // starts from the clock (10 ms steps), so after a page reload mid-night our inputs are still
  // newer than the last one the program saw, which it now requires
  private seq = Math.floor((Date.now() - 1_790_000_000_000) / 10); // ~497 days of 10 ms steps from 2026-09
  private lastSendAt = 0;
  /** frames your movement waited for the server (a measure of how the link is coping) */
  holds = 0;
  /** the newest input the program has applied (echoed back in your view) */
  private ackSeq = 0;
  private sentAt = new Map<number, number>();
  rtt = 150;

  private pingHead = -1;
  private lastSeenAt = new Map<number, number>();
  private nearestHeard = { dist: 99, at: 0 };
  private lastHitTick = 0;
  private lastFeedHead = -1;
  private lastRoomTick = 0;
  private lastRoomTickAt = 0;
  private startingSince = 0;
  private endedSince = 0;
  private unsubs: (() => void)[] = [];
  private timers: number[] = [];
  private closed = false;
  private tickTimes: number[] = [];
  private txSent = 0;
  private viewsRecv = 0;
  revealLoaded = false;

  constructor(roomId: bigint) {
    this.roomId = roomId;
  }

  async start() {
    const room = await client.fetchRoom(this.roomId);
    if (room) this.onRoom(room);
    this.unsubs.push(await client.onRoom(this.roomId, (r) => this.onRoom(r)));
    // websockets can stall; a slow poll keeps the lobby honest
    this.timers.push(window.setInterval(() => this.poll(), 1000));
    this.timers.push(window.setInterval(() => this.duties(), 100));
    // the game clock: if MagicBlock's crank stops ticking, the players' browsers keep the night running
    this.timers.push(window.setInterval(() => this.keepClock(), 50));
    // websocket watchdog: if private view pushes stall mid-match, poll over HTTP and resubscribe
    this.timers.push(window.setInterval(() => this.viewWatchdog(), 150));
  }

  stop() {
    this.closed = true;
    audio.setHeartbeat(0);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.viewSub?.();
    this.viewSub = null;
    this.timers.forEach((t) => clearInterval(t));
  }

  private async poll() {
    if (this.closed) return;
    // during a night the websocket brings the room every tick; skip the extra HTTP read
    const st = this.room?.status;
    if ((st === ST_LIVE || st === ST_COUNTDOWN) && performance.now() - this.lastRoomAt < 1500) return;
    const r = await client.fetchRoom(this.roomId).catch(() => null);
    if (r) this.onRoom(r);
  }

  private polling = false;
  private lastResub = 0;

  private lastRoomAt = 0;
  private roomPolling = false;
  private lastRoomResub = 0;

  /** Room websocket watchdog: during a match the room should update every tick. */
  private async roomWatchdog() {
    const r = this.room;
    if (!r || this.closed || this.roomPolling) return;
    const live = r.status === ST_LIVE || r.status === ST_COUNTDOWN || r.status === ST_STARTING;
    const now = performance.now();
    if (!live || now - this.lastRoomAt < 1200) return;
    this.roomPolling = true;
    try {
      const fresh = await client.fetchRoom(this.roomId).catch(() => null);
      if (fresh) this.onRoom(fresh);
      // only resubscribe when the socket looks dead, not just slow (resubscribing costs a round trip)
      if (now - this.lastRoomAt > 4000 && now - this.lastRoomResub > 6000) {
        this.lastRoomResub = now;
        this.unsubs.forEach((u) => u());
        this.unsubs = [await client.onRoom(this.roomId, (x) => this.onRoom(x))];
      }
    } finally {
      this.roomPolling = false;
    }
  }

  private async viewWatchdog() {
    void this.roomWatchdog();
    const r = this.room;
    if (!r || this.mySeat === null || this.closed || this.polling) return;
    if (r.status !== ST_LIVE && r.status !== ST_COUNTDOWN) return;
    const now = performance.now();
    // updates normally land every 50 ms: after 400 ms of silence also ask over HTTP (every 150 ms
    // while it lasts), whichever path answers first wins
    if (now - this.viewAt < 400) return;
    this.polling = true;
    try {
      const v = await client.fetchView(this.roomId, this.mySeat).catch(() => null);
      if (v) this.onView(v);
      if (now - this.viewAt > 2500 && now - this.lastResub > 5000) {
        this.lastResub = now;
        const seat = this.mySeat;
        this.viewSubSeat = -2; // force a fresh subscription
        await this.ensureViewSub(seat);
      }
    } finally {
      this.polling = false;
    }
  }

  private viewSub: (() => void) | null = null;
  private viewSubSeat = -1;

  private async ensureViewSub(seat: number | null) {
    if (seat === this.viewSubSeat) return;
    this.viewSub?.();
    this.viewSub = null;
    this.viewSubSeat = seat ?? -1;
    if (seat === null) return;
    this.viewSub = await client.onView(this.roomId, seat, (d) => this.onView(decodeView(d)));
    const v = await client.fetchView(this.roomId, seat).catch(() => null);
    if (v) this.onView(v);
  }

  private onRoom(r: Room) {
    const prev = this.room;
    if (!prev || r.tick !== prev.tick || r.status !== prev.status) this.lastRoomAt = performance.now();
    this.room = r;
    setActiveMap(r.map);
    const me = client.publicKey;
    const seat = r.players.findIndex((p, i) => r.isBot[i] === 0 && p.equals(me));
    this.mySeat = seat >= 0 ? seat : null;
    void this.ensureViewSub(this.mySeat);

    if (r.tick !== this.lastRoomTick) {
      this.lastRoomTick = r.tick;
      this.lastRoomTickAt = performance.now();
      this.tickTimes.push(performance.now());
      if (this.tickTimes.length > 40) this.tickTimes.shift();
    }
    // kill feed → toasts + sounds
    if (this.lastFeedHead >= 0 && r.feedHead > this.lastFeedHead && r.status >= ST_LIVE) {
      for (let h = this.lastFeedHead; h < r.feedHead; h++) {
        const e = r.feed[h % 16];
        const killer = e.killer === NO_SEAT ? "THE DARK" : r.names[e.killer] || `#${e.killer}`;
        const victim = r.names[e.victim] || `#${e.victim}`;
        const mine = e.killer === this.mySeat || e.victim === this.mySeat;
        useStore.getState().toast(`${killer} ✕ ${victim}`, mine);
        // a death you were watching: burst where they fell
        const tr = this.tracks.get(e.victim);
        const last = tr?.samples[tr.samples.length - 1];
        if (tr && last && performance.now() - tr.lastSeen < 800) {
          this.addFx({ kind: "death", x: last.x, y: last.y, sub: e.victim });
          this.crates.push({ x: last.x, y: last.y });
        }
        if (h === 0 && e.killer !== NO_SEAT) banner("FIRST BLOOD", "kill", `${killer} ✕ ${victim}`);
        if (e.killer === this.mySeat && e.victim !== this.mySeat) {
          const now = performance.now();
          this.streak = now - this.lastKillAt < 12000 ? this.streak + 1 : 1;
          this.lastKillAt = now;
          feel.killAt = now;
          audio.kill();
          if (this.streak > 1) audio.streak(this.streak);
          const title = ["", "", "DOUBLE KILL", "TRIPLE KILL", "RAMPAGE", "UNSTOPPABLE"][Math.min(this.streak, 5)];
          const gun = WEAPON_NAME[e.weapon] ?? "";
          const total = r.kills[this.mySeat] ?? this.streak;
          banner(title || `YOU KILLED ${victim}`, "kill", `${title ? `${victim} · ` : ""}with ${gun} · ${total} ${total === 1 ? "kill" : "kills"}`);
        }
      }
    }
    this.lastFeedHead = r.feedHead;
    // match beats everyone feels
    if (prev && r.status === ST_LIVE && prev.status === ST_LIVE) {
      const t0 = Math.max(0, prev.tick - COUNTDOWN_TICKS);
      const t1 = Math.max(0, r.tick - COUNTDOWN_TICKS);
      const bo = blackoutTick(r.matchLen);
      const crossed = (at: number) => t0 < at && t1 >= at;
      if (this.announcedMod !== r.matchNo && t1 >= 20 && r.nightMod > 0) {
        this.announcedMod = r.matchNo;
        banner(NIGHT_MOD[r.nightMod], "event", NIGHT_MOD_SUB[r.nightMod]);
      }
      if (crossed(bo - 200)) banner("BLACKOUT IN 10s", "danger", "every flashlight in the Yard is about to die");
      if (crossed(bo)) {
        banner("BLACKOUT", "danger", "no lights for 10 seconds · hunt by sound");
        audio.powerDown(true);
      }
      if (crossed(bo + BLACKOUT_TICKS)) {
        banner("LIGHTS BACK", "event");
        audio.powerDown(false);
      }
      // kill leader (kills are public): announce when it changes
      let lead = -1;
      let best = 1;
      r.kills.forEach((k, i) => {
        if (r.alive[i] === 1 && k > best) {
          best = k;
          lead = i;
        }
      });
      if (lead !== this.lastLeader) {
        this.lastLeader = lead;
        if (lead >= 0)
          lead === this.mySeat
            ? banner("YOU ARE THE KILL LEADER", "kill", "everyone can hear where you are · +25 HP per kill")
            : banner(`KILL LEADER: ${r.names[lead]}`, "event", `${best} kills · the bounty ping shows where`);
      }
      if (r.zonePhase > prev.zonePhase) banner(r.zonePhase >= 3 ? "FINAL CIRCLE" : "THE ZONE IS MOVING", "danger", "get inside the dashed ring");
      if (prev.aliveCount > 3 && r.aliveCount === 3) banner("FINAL THREE", "event");
      else if (prev.aliveCount > 2 && r.aliveCount === 2) banner("LAST TWO STANDING", "event", "one of you walks out");
    }
    if (prev && prev.status !== r.status) {
      if (r.status === ST_STARTING || r.status === ST_COUNTDOWN) {
        this.crates = [];
        // new match: forget the previous one's view, hits and pings
        if (r.status === ST_STARTING) {
          this.view = null;
          this.looted = [];
          this.lastHitTick = 0;
          useStore.getState().set({ view: null });
        }
        this.predValid = false;
        this.tracks.clear();
        this.revealLoaded = false;
        useStore.getState().set({ reveal: null });
        if (r.status === ST_COUNTDOWN) audio.countdown();
      }
      if (r.status === ST_LIVE) audio.go();
      if (r.status === ST_ENDED) audio.end();
      if (r.status === ST_STARTING) this.startingSince = performance.now();
    }
    if (r.status === ST_STARTING && !this.startingSince) this.startingSince = performance.now();
    if (r.status !== ST_STARTING) this.startingSince = 0;
    if (r.status === ST_ENDED && !this.endedSince) this.endedSince = performance.now();
    if (r.status !== ST_ENDED) this.endedSince = 0;
    if (r.status === ST_REVEALED && !this.revealLoaded) void this.loadReveal();
    // ticks advanced over wall time, over a few seconds (arrival bursts don't inflate it)
    const now = performance.now();
    // over 5 s, so a burst of delayed updates arriving together doesn't read as a speed-up;
    // a new night (tick goes back) starts the measurement over
    if (this.tickLog.length && r.tick < this.tickLog[this.tickLog.length - 1][1]) this.tickLog = [];
    this.tickLog.push([now, r.tick]);
    while (this.tickLog.length > 2 && now - this.tickLog[0][0] > 5000) this.tickLog.shift();
    const [t0, k0] = this.tickLog[0];
    // the crank runs at 20 Hz; a reading above that is only arrival jitter
    const tps = now - t0 > 2000 ? Math.min(20, ((r.tick - k0) * 1000) / (now - t0)) : 0;
    useStore.getState().set({
      room: r,
      mySeat: this.mySeat,
      stats: { ...useStore.getState().stats, tick: r.tick, tps: Math.round(tps * 10) / 10, rtt: Math.round(this.rtt), txSent: this.txSent, viewsRecv: this.viewsRecv },
    });
  }

  async loadReveal() {
    this.revealLoaded = true;
    for (let i = 0; i < 6; i++) {
      const [world, rec] = await Promise.all([client.fetchWorld(this.roomId).catch(() => null), client.fetchRecording(this.roomId).catch(() => null)]);
      if (world && rec) {
        useStore.getState().set({ reveal: { world, rec } });
        return;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    this.revealLoaded = false;
  }

  /** local time a server tick happened, from the steadiest (earliest) arrivals seen */
  private clockOff: number | null = null;
  private lateness: number[] = [];
  /** how far behind "now" other players are drawn: the network's jitter, plus a margin */
  interpDelay = 110;
  private tickLog: [number, number][] = [];
  /** your own shots, drawn the moment you fire instead of a round trip later */
  localShots: { x: number; y: number; vx: number; vy: number; born: number; ttl: number; h: number; dead?: boolean }[] = [];
  fireLocal(weapon: number, x: number, y: number, aim: number, crouch = false) {
    const SPEED = [280, 300, 260, 340, 460]; // units per tick (mirror of WEAPONS)
    const TTL = [16, 14, 8, 20, 26];
    const pellets = weapon === 2 ? 5 : 1;
    const a0 = (aim / 65536) * Math.PI * 2;
    const now = performance.now();
    for (let i = 0; i < pellets; i++) {
      const a = a0 + (pellets > 1 ? ((i - 2) / 2) * 0.12 : 0);
      const c = Math.cos(a);
      const s = Math.sin(a);
      // starts at the barrel tip, not the body
      const f = ([0.4, 0.58, 0.78, 0.72, 1.02][weapon] ?? 0.6) * 256;
      this.localShots.push({ x: x + c * f, y: y + s * f, vx: c * SPEED[weapon], vy: s * SPEED[weapon], born: now, ttl: TTL[weapon] ?? 16, h: crouch ? 0.74 : 1.0 });
    }
    if (this.localShots.length > 40) this.localShots.splice(0, this.localShots.length - 40);
  }
  /** a bullet from the server that is one you already drew locally */
  private isMine(b: { x: number; y: number; vx: number; vy: number }) {
    const now = performance.now();
    const window = Math.max(600, this.rtt * 2 + 300);
    for (const s of this.localShots) {
      if (now - s.born > window + s.ttl * 50) continue;
      const sp = Math.hypot(s.vx, s.vy);
      const bs = Math.hypot(b.vx, b.vy);
      if (bs < 1) continue;
      // same direction, and on the same line
      if ((s.vx * b.vx + s.vy * b.vy) / (sp * bs) < 0.97) continue;
      const ox = b.x - s.x;
      const oy = b.y - s.y;
      const along = (ox * s.vx + oy * s.vy) / sp;
      const off = Math.abs(ox * s.vy - oy * s.vx) / sp;
      if (along > -200 && off < 160) return true;
    }
    return false;
  }
  private gaps: [number, number][] = [];
  /** worst gap between private-view updates in the last 4 s (ms) */
  get worstGap() {
    return this.gaps.reduce((m, g) => Math.max(m, g[1]), 0);
  }
  /** how long since the last update arrived (ms) */
  get stalledFor() {
    return this.viewAt ? performance.now() - this.viewAt : 0;
  }
  private tickTime(tick: number) {
    return tick * 50 + (this.clockOff ?? 0);
  }
  private trackClock(tick: number, now: number) {
    const off = now - tick * 50;
    if (this.clockOff === null || off < this.clockOff || off - this.clockOff > 3000) this.clockOff = off;
    else this.clockOff += (off - this.clockOff) * 0.01; // follow slow drift
    this.lateness.push(off - this.clockOff);
    if (this.lateness.length > 60) this.lateness.shift();
    // cover ~90% of late arrivals: steady wifi ≈ 100 ms, a bumpy hotspot ≈ 250-400 ms
    const sorted = [...this.lateness].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const want = Math.max(90, Math.min(400, p90 + 70));
    this.interpDelay += (want - this.interpDelay) * 0.05;
  }

  private onView(v: View) {
    const now = performance.now();
    if (v.status === ST_LIVE || v.status === ST_COUNTDOWN) this.trackClock(v.tick, now);
    // ignore reordered updates, but a big jump back means a new match on a reused seat
    if (this.view && v.tick < this.view.tick && this.view.tick - v.tick < 100) return;
    const prev = this.view;
    // the longest wait between updates over the last few seconds: the network's hiccups
    if (this.viewAt) {
      this.gaps.push([now, now - this.viewAt]);
      while (this.gaps.length && now - this.gaps[0][0] > 4000) this.gaps.shift();
    }
    this.view = v;
    this.viewAt = now;
    this.viewsRecv++;
    // rtt from input echo
    if (v.me.inSeq > this.ackSeq) this.ackSeq = v.me.inSeq;
    const sentAt = this.sentAt.get(v.me.inSeq);
    if (sentAt) {
      const sample = now - sentAt;
      this.rtt = this.rtt * 0.8 + sample * 0.2;
      this.sentAt.delete(v.me.inSeq);
    }
    // prediction reconcile
    if (v.me.alive && (v.status === ST_LIVE || v.status === ST_COUNTDOWN)) {
      if (!this.predValid) {
        // the camera's start view is set by the scene (behind your back, facing open ground)
        this.input.aim = v.me.aim;
        this.hist.clear(); // tick numbers restart each night: old moves must never replay
        this.pred = { x: v.me.x, y: v.me.y };
        this.predPrev = { ...this.pred };
        this.predMoved = v.me.moved;
        this.predValid = true;
        this.predTick = this.serverTick = v.tick;
      } else {
        this.serverTick = Math.max(this.serverTick, v.tick);
        if (this.predTick < v.tick) this.predTick = v.tick; // we paused (tab hidden, hitch): catch up
        // how far ahead of this server state our prediction really is
        const lagTicks = Math.max(0, Math.min(12, this.predTick - v.tick));
        // stamina follows the chain (it only gates sprint, so a little lag is harmless)
        // fatigue / winded follow the chain; crouch, jump and sprint bits stay local
        this.predMoved = (v.me.moved & 0xff04) | (this.predMoved & 0xfb);
        // where we should be: the server's position, plus the moves we've made since that tick
        const base = { x: v.me.x, y: v.me.y };
        if (v.status === ST_LIVE)
          for (let t = v.tick + 1; t <= v.tick + lagTicks; t++) {
            const h = this.hist.get(t);
            if (h) moveBody(base, h[0], h[1], h[2] ? [] : this.crates);
          }
        for (const t of this.hist.keys()) if (t <= v.tick) this.hist.delete(t);
        const tx = base.x;
        const ty = base.y;
        const ex = tx - this.pred.x;
        const ey = ty - this.pred.y;
        const e2 = ex * ex + ey * ey;
        // trust your own prediction; only nudge when we've clearly drifted, snap if way off
        if (e2 > (3 * UNIT) ** 2) {
          this.pred = { x: tx, y: ty };
          this.predPrev = { ...this.pred };
          this.snaps++;
        } else if (e2 > (0.3 * UNIT) ** 2) {
          // shift both ends of the interpolation so the correction never pops
          const cx = ex * 0.12;
          const cy = ey * 0.12;
          this.pred.x += cx;
          this.pred.y += cy;
          this.predPrev.x += cx;
          this.predPrev.y += cy;
        }
      }
    }
    // other players
    const seen = new Set<number>();
    for (const p of v.players) {
      seen.add(p.seat);
      this.pushSample(p, v.tick, now);
      if (p.flags & 4) this.addFx({ kind: "shot", x: p.x, y: p.y, angle: p.aim, sub: p.seat });
    }
    for (const [seat, tr] of this.tracks) if (!seen.has(seat)) tr.visible = false;
    // duos: you went down / got picked up; your partner went down
    const down = v.me.alive === DOWNED;
    if (down && !this.wasDown) banner("YOU'RE DOWN", "danger", "crawl to cover · your partner can pick you up");
    if (!down && this.wasDown && v.me.alive === 1) banner("BACK ON YOUR FEET", "event");
    this.wasDown = down;
    for (const p of v.players) {
      if (p.flags & 32 && p.flags & 16) {
        const was = prev?.players.find((q) => q.seat === p.seat);
        if (!was || !(was.flags & 16)) banner("PARTNER DOWN", "danger", "stand over them for 3 seconds to revive");
      }
    }
    if (prev && v.inv.nvg > prev.inv.nvg + 20) audio.nvgOn();
    // stinger: someone steps into your light who you haven't seen for a while
    for (const p of v.players) {
      const last = this.lastSeenAt.get(p.seat) ?? 0;
      if (now - last > 4000 && !(p.flags & 2)) audio.stinger();
      this.lastSeenAt.set(p.seat, now);
    }
    // the program tags a gadget in flight with 2^20 multiples in vx (kind) and vy (ticks left)
    this.bullets = [];
    this.nades = [];
    for (const b of v.bullets) {
      const kind = Math.round(b.vx / GADGET_TAG);
      if (kind > 0) {
        const ttl = Math.round(b.vy / GADGET_TAG);
        this.nades.push({ x: b.x, y: b.y, vx: b.vx - kind * GADGET_TAG, vy: b.vy - ttl * GADGET_TAG, kind, ttl });
      } else if (!this.isMine(b)) this.bullets.push(b);
    }
    this.bulletsAt = now;
    // pings (sounds you can't see)
    if (this.pingHead < 0) this.pingHead = v.pingHead;
    for (let h = this.pingHead; h < v.pingHead; h++) {
      const p = v.pings[h % 12];
      if (!p || v.tick - p.tick > 40) continue;
      if (p.kind === 5) {
        // supply drop: we know its bearing and distance, so we know where it is
        const a = (p.angle / 65536) * Math.PI * 2;
        const fresh = !this.drop || now - this.drop.at > 6000;
        this.drop = { x: v.me.x + Math.cos(a) * p.dist * UNIT, y: v.me.y + Math.sin(a) * p.dist * UNIT, at: now };
        if (fresh) {
          audio.airdrop();
          banner("SUPPLY DROP", "danger", `Talon · full vest · full health · ${p.dist}m away, follow the red smoke`);
        }
        continue;
      }
      if (p.kind === 7 || p.kind === 9) {
        const a = (p.angle / 65536) * Math.PI * 2;
        const x = v.me.x + Math.cos(a) * p.dist * UNIT;
        const y = v.me.y + Math.sin(a) * p.dist * UNIT;
        if (p.kind === 7) {
          const key = `${Math.round(x / 512)}:${Math.round(y / 512)}`;
          if (!this.smokes.has(key)) audio.smoke();
          this.smokes.set(key, { x, y, at: now });
        } else {
          this.booms.push({ x, y, at: now });
          if (this.booms.length > 8) this.booms.shift();
          audio.explosion(p.dist, v.inv.blind > 0);
          if (p.dist < 8) feel.shake = Math.min(1.6, feel.shake + (8 - p.dist) / 6);
        }
        continue;
      }
      if (p.kind === 8) {
        // your motion sensor tripped
        this.addFx({ kind: "ping", x: v.me.x, y: v.me.y, angle: p.angle, sub: 8, dist: p.dist });
        audio.sensor();
        continue;
      }
      if (p.kind === 6) {
        this.bounty = { angle: p.angle, dist: p.dist, at: now, seat: this.lastLeader };
        this.addFx({ kind: "ping", x: v.me.x, y: v.me.y, angle: p.angle, sub: 6, dist: p.dist });
        continue;
      }
      this.addFx({ kind: "ping", x: v.me.x, y: v.me.y, angle: p.angle, sub: p.kind, dist: p.dist });
      audio.ping(p.kind, p.angle, p.dist, this.input.aim);
      if (p.kind === 1 || p.kind === 2) this.nearestHeard = { dist: Math.min(p.dist, now - this.nearestHeard.at < 1500 ? this.nearestHeard.dist : 99), at: now };
    }
    // heartbeat: low health, enemies you can hear closing in, or one in your light
    if (v.status === ST_LIVE && v.me.alive) {
      const hpDanger = v.me.hp < 40 ? (40 - v.me.hp) / 40 : 0;
      const heard = now - this.nearestHeard.at < 2500 ? Math.max(0, 1 - this.nearestHeard.dist / 9) : 0;
      const seenDanger = v.players.length ? 0.55 : 0;
      audio.setHeartbeat(Math.max(hpDanger, heard, seenDanger));
    } else audio.setHeartbeat(0);
    this.pingHead = v.pingHead;
    // got hit
    if (v.me.hitTick && v.me.hitTick !== this.lastHitTick) {
      if (this.lastHitTick !== 0 || (prev && prev.me.hp > v.me.hp)) {
        this.addFx({ kind: "hit", x: v.me.x, y: v.me.y, angle: v.me.hitAngle });
        audio.hurt();
      }
      this.lastHitTick = v.me.hitTick;
    }
    if (prev && prev.me.alive && !v.me.alive) {
      this.addFx({ kind: "death", x: v.me.x, y: v.me.y });
      audio.death();
    }
    if (prev && v.me.flare > prev.me.flare + 50) audio.flare();
    // loot that vanished: next to you, you took it (the program picks up within 0.7 tiles);
    // anywhere else, someone did. Either way the empty crate stays open on the ground a while.
    let took = 0;
    if (prev && v.status === ST_LIVE && prev.status === ST_LIVE)
      for (const l of prev.loot) {
        if (v.loot.some((x) => x.id === l.id && x.kind === l.kind)) continue;
        const mine = Math.hypot(l.x - v.me.x, l.y - v.me.y) < 320 && v.me.alive === 1;
        this.looted.push({ x: l.x, y: l.y, kind: l.kind, at: now });
        if (this.looted.length > 12) this.looted.shift();
        if (mine && !took) {
          took = l.kind;
          feel.pickAt = now;
          feel.pickKind = l.kind;
          feel.pickFrom = { x: l.x, y: l.y };
          audio.pickup(l.kind);
        }
      }
    if (prev && v.status === ST_LIVE && prev.status === ST_LIVE && v.tick > prev.tick && v.inv.count > prev.inv.count && !took) {
      // a gadget you didn't see the crate of (it was under you): still a pickup
      feel.pickAt = now;
      feel.pickKind = 9;
      feel.pickFrom = { x: v.me.x, y: v.me.y };
      audio.pickup(9);
    }
    // pickups (only while playing: a new night "changes" your gun back to the pistol)
    if (prev && v.status === ST_LIVE && prev.status === ST_LIVE && v.tick > prev.tick && (v.me.weapon !== prev.me.weapon || v.me.hp > prev.me.hp + 10 || v.me.armor > prev.me.armor + 10 || v.me.flare > prev.me.flare + 50)) {
      if (!took) audio.pickup();
      const what = v.me.weapon !== prev.me.weapon ? 1 : v.me.flare > prev.me.flare + 50 ? 4 : v.me.armor > prev.me.armor + 10 ? 3 : 2;
      this.addFx({ kind: "loot", x: v.me.x, y: v.me.y, sub: what });
      banner(["", WEAPON_NAME[v.me.weapon] ?? "WEAPON", "+ HEALTH", "+ ARMOR", "FLARE: YOU SEE EVERYONE"][what], "event", what === 1 ? FIRE_MODE[v.me.weapon] : undefined);
    }
    if (prev && prev.me.reload === 0 && v.me.reload > 0) {
      // the animation and the sounds run over the gun's real reload time (ticks of 50 ms)
      feel.reloadAt = now;
      feel.reloadDur = v.me.reload * 50;
      audio.reload(v.me.weapon, feel.reloadDur / 1000);
    }
    // the HUD re-renders on every store change; phones get it 8 times a second instead of 20
    // (the 3D scene reads this.view directly every frame, so movement stays smooth)
    if (!TOUCH || now - this.hudAt > 120 || v.me.alive !== prev?.me.alive || v.status !== prev?.status) {
      this.hudAt = now;
      useStore.getState().set({ view: v });
    }
  }

  private pushSample(p: VisPlayer, tick: number, now: number) {
    let tr = this.tracks.get(p.seat);
    if (!tr) {
      tr = { seat: p.seat, samples: [], lastSeen: now, visible: true };
      this.tracks.set(p.seat, tr);
    }
    if (!tr.visible && now - tr.lastSeen > 300) tr.samples = [];
    tr.visible = true;
    tr.lastSeen = now;
    // stamp by the server's tick, not by arrival: on mobile data updates arrive in bursts,
    // and arrival times would bunch them up and make players lurch
    tr.samples.push({ t: this.tickTime(tick), tick, x: p.x, y: p.y, aim: p.aim, hp: p.hp, weapon: p.weapon, flags: p.flags });
    if (tr.samples.length > 12) tr.samples.shift();
  }

  addFx(f: Omit<Fx, "id" | "at">) {
    this.fx.push({ ...f, id: ++fxId, at: performance.now() });
    if (this.fx.length > 80) this.fx.splice(0, this.fx.length - 80);
  }

  /** Called every animation frame by the scene. */
  frame() {
    const now = performance.now();
    audio.ambientTick();
    const dt = Math.min(200, now - this.lastFrame);
    this.lastFrame = now;
    const v = this.view;
    const live = this.room?.status === ST_LIVE && v?.me.alive;
    if (live && this.predValid) {
      this.predAcc += dt;
      // allowed lead: about a one-way trip of ticks, at least 2, at most 8. (Tried a round trip:
      // when the TEE ticks slower than real time, a longer lead only turns short waits into
      // snap-backs. Measured: more snaps at 500 ms injected lag.)
      const lead = Math.max(2, Math.min(8, Math.round(this.rtt / 100) + 2));
      while (this.predAcc >= 50) {
        if (this.predTick >= this.serverTick + lead) {
          // the server hasn't caught up: hold here instead of running off and snapping back
          this.predAcc = Math.min(this.predAcc, 50);
          this.holds++;
          break;
        }
        this.predAcc -= 50;
        this.predTick++;
        this.predPrev = { ...this.pred };
        const down = v?.me.alive === DOWNED;
        const [speed, sp, word] = moveStep(this.predMoved, this.input.buttons, this.input.dx, this.input.dy, down);
        const [vx, vy] = inputVelocity(this.input.dx, this.input.dy, speed);
        const jumping = ((word >> 4) & 0xf) !== 0;
        this.hist.set(this.predTick, [vx, vy, jumping ? 1 : 0]);
        if (this.hist.size > 64) this.hist.delete(this.hist.keys().next().value!);
        const ox = this.pred.x;
        const oy = this.pred.y;
        moveBody(this.pred, vx, vy, jumping ? [] : this.crates);
        const m = ox !== this.pred.x || oy !== this.pred.y;
        this.predMoved = (m ? 1 : 0) | (sp && m ? word : word & ~2);
        this.predSpeed = speed;
        this.sprinting = sp;
      }
    } else {
      this.predAcc = 0;
      this.sprinting = false;
    }
    this.maybeSendInput(now);
  }

  setInput(dx: number, dy: number, aim: number, buttons: number) {
    this.input = { dx: Math.round(dx), dy: Math.round(dy), aim: aim & 0xffff, buttons };
  }

  private maybeSendInput(now: number) {
    if (this.mySeat === null || !this.room) return;
    const st = this.room.status;
    if (st !== ST_LIVE && st !== ST_COUNTDOWN) return;
    if (this.view && !this.view.me.alive) return;
    const i = this.input;
    const s = this.sent;
    const aimDelta = Math.min(Math.abs(i.aim - s.aim), 65536 - Math.abs(i.aim - s.aim));
    const changed = i.dx !== s.dx || i.dy !== s.dy || i.buttons !== s.buttons;
    // aim must track the crosshair closely, or shots land where you aimed a moment ago:
    // while firing every small correction goes out, otherwise anything over ~0.8°
    const firing = (i.buttons & 1) === 1;
    const aimChanged = firing ? aimDelta > 30 : aimDelta > 150;
    const since = now - this.lastSendAt;
    // on a slow link every transaction queues behind the last: send less often so they don't pile up
    const slow = this.rtt > 350;
    const gap = slow ? 90 : 40;
    // the last input never came back (lost on the way, or dropped): send the current state again
    // instead of waiting for the half-second heartbeat. A lost "stop" would otherwise keep you
    // walking on the server and snap you back.
    const unacked = this.seq > this.ackSeq && since >= Math.max(120, Math.min(600, this.rtt * 1.4));
    if ((changed && since >= gap) || (aimChanged && since >= (firing ? gap : gap + 10)) || unacked || since >= 500) {
      this.lastSendAt = now;
      this.sent = { ...i };
      const seq = ++this.seq;
      this.sentAt.set(seq, now);
      if (this.sentAt.size > 50) this.sentAt.delete(this.sentAt.keys().next().value!);
      this.txSent++;
      client
        .sendEr([client.inputIx(this.roomId, i.dx, i.dy, i.aim, i.buttons, seq)], { confirm: false })
        .then((sig) => (useStore.getState().stats.lastSig = sig))
        .catch(() => {});
    }
  }

  /**
   * Keep the night moving if MagicBlock's crank stops. One browser drives (the lowest seated
   * human); the others step in only if it goes quiet too. See clock.ts for why it waits.
   */
  private clockN = 0;
  private clock = new ClockKeeper(() => {
    // a different compute limit each time makes every tick a distinct transaction (no duplicate drops)
    const cu = 1_400_000 - (++this.clockN % 997);
    return client.sendEr([ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), client.tickIx(this.roomId)], { confirm: false });
  });
  private keepClock() {
    const r = this.room;
    if (!r || this.closed || this.mySeat === null) return;
    if (r.status !== ST_LIVE && r.status !== ST_COUNTDOWN) return this.clock.reset();
    let driver = this.mySeat;
    for (let i = 0; i < r.players.length; i++)
      if (r.isBot[i] === 0 && !r.players[i].equals(PublicKey.default)) {
        driver = i;
        break;
      }
    this.clock.step(performance.now(), performance.now() - this.lastRoomTickAt, r.tick, this.mySeat === driver);
  }

  /** Room upkeep any client may do: nothing here needs a server. */
  private lastBeat = 0;

  private duties() {
    const r = this.room;
    if (!r || this.closed || this.mySeat === null) return;
    const now = performance.now();
    // keep-alive even when the tab is in the background (rAF stops, timers don't):
    // the chain ends a night when no living human has sent input for 10 s
    if (r.status === ST_LIVE || r.status === ST_COUNTDOWN) this.maybeSendInput(now);
    // lobby presence (free, gasless)
    if ((r.status === ST_LOBBY || r.status === ST_REVEALED) && now - this.lastBeat > 8000) {
      this.lastBeat = now;
      client.sendEr([client.heartbeatIx(this.roomId)], { confirm: false }).catch(() => {});
    }
    // (crank fallback lives in keepClock, at 20 Hz)
    // VRF fallback after ~6 s
    if (r.status === ST_STARTING && this.startingSince && now - this.startingSince > 6500 && (now | 0) % 1000 < 110) {
      client.sendEr([client.fallbackSeedIx(this.roomId)], { confirm: false }).catch(() => {});
    }
    // a staked table has no host: when it's full, or its countdown has run out, the seated players'
    // games start it (staggered by seat; the program checks the timer, an early try just fails)
    if (r.status === ST_LOBBY && r.stake > 0n && now - this.lastAutoStart > 3000) {
      const due = stakedStartAt(r);
      if (due !== null && Date.now() / 1000 >= due + 1 + this.mySeat * 1.5) {
        this.lastAutoStart = now;
        client.sendEr([client.startIx(this.roomId, 0)], { confirm: false }).catch(() => {});
      }
    }
    // lights on: someone has to call finish — stagger by seat to avoid a stampede
    if (r.status === ST_ENDED && this.endedSince && now - this.endedSince > 600 + this.mySeat * 700 && (now | 0) % 1500 < 110) {
      const w = r.winner;
      const payout = w !== NO_SEAT && r.isBot[w] === 0 ? r.payout[w] : null;
      client.sendEr(client.withBudget(client.finishIx(this.roomId, payout, r.daily)), { confirm: false }).catch(() => {});
    }
  }

  // ------------------------------------------------------------ actions

  private lastAutoStart = 0;

  /** Staked rooms: the wallet funds the session key and buys a ticket in one base-layer tx. */
  async buyTicket(wallet: any): Promise<void> {
    const r = this.room ?? (await client.fetchRoom(this.roomId));
    if (!r) throw new Error("Room not found");
    const matchNo = r.matchNo + 1;
    // this match's ticket may already exist (you stood up, or a start was called off)
    const paid = await client.base.getAccountInfo(ticketPda(this.roomId, matchNo, client.publicKey));
    if (paid) {
      this.ticketMatch = matchNo;
      return;
    }
    const { Transaction, SystemProgram } = await import("@solana/web3.js");
    // An unused ticket at this stake (you left a lobby, or a night was called off) carries over:
    // move it to this table's next night instead of paying again. Stakes are never refunded.
    const spare = await reusableTicket(r.stake, this.roomId, matchNo);
    if (spare) {
      const [rent, minBalance, have] = await Promise.all([
        client.base.getMinimumBalanceForRentExemption(TICKET_LEN),
        client.base.getMinimumBalanceForRentExemption(0),
        client.base.getBalance(client.publicKey),
      ]);
      // the new ticket's rent is paid before the old one's comes back: top up only if short
      const short = Math.max(0, rent + minBalance + 20_000 - have);
      const tx = new Transaction();
      if (short) tx.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: client.publicKey, lamports: short }));
      tx.add(client.reuseTicketIx(spare, this.roomId, matchNo));
      tx.feePayer = short ? wallet.publicKey : client.publicKey;
      tx.recentBlockhash = (await client.base.getLatestBlockhash()).blockhash;
      tx.partialSign(client.keypair);
      const signed = short ? await wallet.signTransaction(tx) : tx;
      const sig = await client.base.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      const res = await client.base.confirmTransaction(sig, "confirmed");
      if (res.value.err) throw new Error("Moving your ticket to this table failed on Solana. Nothing was charged. Try again.");
      this.ticketMatch = matchNo;
      return;
    }
    // The session key pays the stake and the ticket's rent. It also keeps a small float for the
    // fees of refunds it sends later; Solana won't let it hold less than its rent minimum, so the
    // float is that minimum plus fees, topped up only when short (not added again on every ticket).
    const [rent, minBalance, have] = await Promise.all([
      client.base.getMinimumBalanceForRentExemption(TICKET_LEN),
      client.base.getMinimumBalanceForRentExemption(0),
      client.base.getBalance(client.publicKey),
    ]);
    const float = minBalance + 50_000;
    const lamports = Number(r.stake) + rent + Math.max(0, float - have);
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: client.publicKey, lamports }),
      client.buyTicketIx(this.roomId, matchNo, wallet.publicKey),
    );
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await client.base.getLatestBlockhash()).blockhash;
    tx.partialSign(client.keypair);
    const signed = await wallet.signTransaction(tx);
    const sig = await client.base.sendRawTransaction(signed.serialize(), { skipPreflight: true });
    // preflight is skipped, so a failure only shows here (the transfer and the ticket are one
    // transaction: if it failed, nothing was paid)
    const res = await client.base.confirmTransaction(sig, "confirmed");
    if (res.value.err) throw new Error("Buying the ticket failed on Solana (nothing was paid). Check your wallet has enough SOL.");
    this.ticketMatch = matchNo;
    try {
      localStorage.setItem(TICKETS_FLAG, "1"); // this browser holds tickets: refunds get collected later
    } catch {
      /* private mode: spent tickets are still tidied when you next take a staked seat */
    }
  }
  ticketMatch = 0;

  /** Hand back the rent of this browser's spent tickets (never the one just bought). */
  async reclaimTickets(): Promise<void> {
    await reclaimTickets(ticketPda(this.roomId, this.ticketMatch, client.publicKey), true);
  }

  async join(name: string, wallet: PublicKey | null, code = 0, preferSeat?: number) {
    const r = this.room ?? (await client.fetchRoom(this.roomId));
    if (!r) throw new Error("This room doesn't exist. Go back and pick another one.");
    if (r.status !== ST_LOBBY) throw new Error("A night is already running in this room. Wait for it to end, or pick another room.");
    const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => i < r.maxPlayers && r.players[i].toBase58() === DEFAULT_KEY && r.isBot[i] === 0);
    if (!free.length) throw new Error("This room is full. Try another room.");
    let lastErr: unknown = null;
    const order = preferSeat !== undefined && free.includes(preferSeat) ? [preferSeat, ...free.filter((x) => x !== preferSeat)] : free;
    for (const seat of order.slice(0, 3)) {
      try {
        const ticket = r.stake > 0n ? ticketPda(this.roomId, r.matchNo + 1, client.publicKey) : undefined;
        await client.sendEr([client.joinIx(this.roomId, seat, name, wallet, code, ticket)]);
        await this.poll();
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  async leave() {
    if (this.mySeat === null) return;
    await client.sendEr([client.leaveIx(this.roomId, this.mySeat)]);
    await this.poll();
  }

  async makeHost(seat: number) {
    await client.sendEr([client.makeHostIx(this.roomId, seat)]);
    await this.poll();
  }

  /** Host only. A private room gets a fresh code so the kicked player can't walk back in. */
  async kick(seat: number, newCode = 0) {
    await client.sendEr([client.kickIx(this.roomId, seat, newCode)]);
    await this.poll();
  }

  /** Host: end the night now, wait for the lights to come on, then close the room for everyone. */
  async endAndClose(onStep?: (s: string) => void) {
    onStep?.("ending the night…");
    await client.sendEr([client.endNowIx(this.roomId)]);
    const seat = this.mySeat;
    const t0 = performance.now();
    while (performance.now() - t0 < 30000) {
      await this.poll();
      if (this.room?.status === ST_REVEALED) break;
      if (this.room?.status === ST_ENDED) onStep?.("turning the lights on…");
      await new Promise((r) => setTimeout(r, 700));
    }
    onStep?.("closing the room…");
    if (seat !== null) await this.closeFromReveal(seat, true);
  }

  async setMode(duos: boolean, map = this.room?.map ?? 0) {
    await client.sendEr([client.setModeIx(this.roomId, duos, map)]);
    await this.poll();
  }

  async setBots(level: number) {
    await client.sendEr([client.setBotsIx(this.roomId, level)]);
    await this.poll();
  }

  async setSize(n: number) {
    await client.sendEr([client.setSizeIx(this.roomId, n)]);
    await this.poll();
  }

  async startMatch(fillTo: number) {
    await client.sendEr([client.startIx(this.roomId, fillTo)]);
    await this.poll();
  }

  /** Today's daily: you and three bots on the day's sealed seed. Your wallet signs: one try a day. */
  async startDaily(wallet: any) {
    const { PublicKey, ComputeBudgetProgram } = await import("@solana/web3.js");
    const pk = new PublicKey(wallet.publicKey.toString());
    await client.sendEr([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), client.startDailyIx(this.roomId, pk)], {
      cosign: (tx) => wallet.signTransaction(tx),
    });
    await this.poll();
  }

  /** From the verdict screen: put the room back in the lobby, then give up your seat.
   *  For the host that closes the room for everyone. */
  async closeFromReveal(seat: number, host: boolean) {
    if (this.room?.status === ST_REVEALED) {
      // a guest leaving doesn't end everyone else's replay: their seat just goes stale and is cleared at the next start
      if (!host) return;
      await client.sendEr(client.withBudget(client.resetIx(this.roomId))).catch(() => {});
    }
    useStore.getState().set({ reveal: null });
    for (let i = 0; i < 4; i++) {
      try {
        await client.sendEr([client.leaveIx(this.roomId, seat)]);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 900));
      }
    }
  }

  async reset() {
    await client.sendEr(client.withBudget(client.resetIx(this.roomId)));
    useStore.getState().set({ reveal: null });
    this.revealLoaded = false;
    await this.poll();
  }

  /** Where to draw another player now: interpolated ≈100 ms behind; if updates stall, carried on
   *  along their last heading for a moment instead of freezing; and any correction that causes is
   *  eased out over a few frames instead of popping. */
  sampleTrack(tr: Track, now: number): Sample | null {
    const raw = this.rawTrack(tr, now);
    if (!raw) return null;
    const sh = tr.shown;
    if (sh && sh.at === now) return { ...raw, x: sh.x, y: sh.y };
    if (!sh || now - sh.at > 400) {
      tr.shown = { x: raw.x, y: raw.y, at: now, rx: raw.x, ry: raw.y, ox: 0, oy: 0 };
      return raw;
    }
    const dt = Math.max(1, now - sh.at);
    const jx = raw.x - sh.rx;
    const jy = raw.y - sh.ry;
    const jump = Math.hypot(jx, jy);
    if (jump > 3 * UNIT) {
      // a teleport (respawn, revive): go straight there
      sh.ox = sh.oy = 0;
    } else if (jump > 2.4 * dt + 24) {
      // faster than anyone runs (sprint ≈ 1.7 units/ms): a correction, keep what's drawn and ease
      sh.ox = sh.x - raw.x;
      sh.oy = sh.y - raw.y;
    }
    const k = Math.exp(-dt / 90);
    sh.ox *= k;
    sh.oy *= k;
    sh.rx = raw.x;
    sh.ry = raw.y;
    sh.x = raw.x + sh.ox;
    sh.y = raw.y + sh.oy;
    sh.at = now;
    return { ...raw, x: sh.x, y: sh.y };
  }

  private rawTrack(tr: Track, now: number): Sample | null {
    const s = tr.samples;
    if (!s.length) return null;
    const renderT = now - this.interpDelay;
    if (s.length === 1 || renderT <= s[0].t) return s[0];
    const last = s[s.length - 1];
    if (renderT > last.t) {
      // updates are late: keep them moving the way they were going, briefly (≤ 220 ms)
      const prev = s[s.length - 2];
      const span = last.t - prev.t;
      if (span <= 0 || span > 400) return last;
      const ahead = Math.min(220, renderT - last.t);
      const k = ahead / span;
      return { ...last, x: last.x + (last.x - prev.x) * k, y: last.y + (last.y - prev.y) * k };
    }
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1];
      const b = s[i];
      if (renderT >= a.t) {
        const span = Math.max(1, b.t - a.t);
        const k = Math.min(1, (renderT - a.t) / span);
        let da = b.aim - a.aim;
        if (da > 32768) da -= 65536;
        if (da < -32768) da += 65536;
        return { ...b, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, aim: (a.aim + da * k + 65536) % 65536 };
      }
    }
    return s[s.length - 1];
  }

  myPos(): { x: number; y: number } | null {
    const v = this.view;
    if (!v) return null;
    if (this.predValid && v.me.alive) {
      const k = Math.min(1, this.predAcc / 50);
      return { x: this.predPrev.x + (this.pred.x - this.predPrev.x) * k, y: this.predPrev.y + (this.pred.y - this.predPrev.y) * k };
    }
    return { x: v.me.x, y: v.me.y };
  }
}

export const isEmptyKey = (k: PublicKey) => k.equals(PublicKey.default);

/** Stakers seated at a table (paid seats; the program counts these, not who's still heart-beating). */
export const stakersSeated = (r: Room) => r.players.filter((p, i) => r.isBot[i] === 0 && !p.equals(PublicKey.default)).length;

/** Mirror of the program's `staked_start_ok`: the unix second a staked table may start (now, if
 *  it's full), or null while fewer than two stakers are seated. In a staked lobby `startSlot`
 *  holds that time. */
export function stakedStartAt(r: Room): number | null {
  const n = stakersSeated(r);
  if (n < 2) return null;
  if (n >= r.maxPlayers) return 0;
  return r.startSlot > 0n ? Number(r.startSlot) : null;
}

/**
 * An unused ticket this browser holds at `stake` that may move to another night: not spent, not
 * already for `roomId`'s night `matchNo`, and its own night has settled without it or it expired.
 * (Mirror of the program's `reuse_ticket` rule; the program has the final say.)
 */
export async function reusableTicket(stake: bigint, roomId: bigint, matchNo: number) {
  const mine = await client.myTickets().catch(() => []);
  const candidates = mine.filter((t) => !t.consumed && t.amount === stake && !(t.roomId === roomId && t.matchNo === matchNo));
  if (!candidates.length) return null;
  const paid = await client.paidMatches([...new Set(candidates.map((t) => t.roomId))]).catch(() => new Map<bigint, number>());
  const now = Date.now() / 1000;
  return candidates.find((t) => (paid.has(t.roomId) && t.matchNo <= paid.get(t.roomId)!) || now > t.expiresAt + 30) ?? null;
}

/**
 * Close every spent ticket this browser's session key holds: each one's rent goes back to its own
 * payout wallet. Stakes are never refunded (an unused ticket carries over to a later night), so
 * only tickets a settled night used up are closed. Each close costs the session key one fee, so
 * tickets are only looked up when this browser has bought some.
 */
let reclaiming = false;
const TICKETS_FLAG = "bo-has-tickets";
export async function reclaimTickets(skip?: PublicKey, force = false): Promise<number> {
  let flagged = true;
  try {
    flagged = localStorage.getItem(TICKETS_FLAG) === "1";
  } catch {
    /* no storage: look anyway */
  }
  if (reclaiming || (!flagged && !force)) return 0;
  reclaiming = true;
  let closed = 0;
  try {
    const all = await client.myTickets().catch(() => null);
    if (all && !all.length) {
      try {
        localStorage.removeItem(TICKETS_FLAG); // nothing left to collect
      } catch {
        /* ignore */
      }
    }
    const tickets = (all ?? []).filter((t) => !(skip && t.pubkey.equals(skip)));
    if (!tickets.length) return 0;
    // only send what the program will accept (a failed transaction still costs its fee)
    for (const t of tickets) {
      if (!t.consumed) continue; // unused: it carries over to a later night, it's never refunded
      const ok = await client.sendBase([client.closeTicketIx(t.roomId, t.pubkey, t.payout)]).then(() => true).catch(() => false);
      if (ok) closed++;
    }
  } finally {
    reclaiming = false;
  }
  return closed;
}
export { ST_LOBBY, ST_STARTING, ST_COUNTDOWN, ST_LIVE, ST_ENDED, ST_REVEALED };
