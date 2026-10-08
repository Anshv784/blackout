// One live room: subscriptions, input sending, client prediction, interpolation,
// and the "anyone can push the room forward" duties (tick/seed/finish fallbacks).
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { client } from "./identity";
import { ticketPda } from "../chain/client";
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
  /** predicted stamina word (see sim.ts sprintStep) and whether you're sprinting right now */
  predMoved = 0;
  predSpeed = SPEED;
  /** night events: where the supply drop is (from its pings) and the kill leader's direction */
  drop: { x: number; y: number; at: number } | null = null;
  /** smoke clouds you can see from afar (from smoke pings), keyed by rounded position */
  smokes = new Map<string, { x: number; y: number; at: number }>();
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
  private seq = 0;
  private lastSendAt = 0;
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
    // websocket watchdog: if private view pushes stall mid-match, poll over HTTP and resubscribe
    this.timers.push(window.setInterval(() => this.viewWatchdog(), 150));
  }

  stop() {
    this.closed = true;
    audio.setHeartbeat(0);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.timers.forEach((t) => clearInterval(t));
  }

  private async poll() {
    if (this.closed) return;
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
    if (!live || now - this.lastRoomAt < 600) return;
    this.roomPolling = true;
    try {
      const fresh = await client.fetchRoom(this.roomId).catch(() => null);
      if (fresh) this.onRoom(fresh);
      if (now - this.lastRoomResub > 5000) {
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
    if (now - this.viewAt < 400) return;
    this.polling = true;
    try {
      const v = await client.fetchView(this.roomId, this.mySeat).catch(() => null);
      if (v) this.onView(v);
      if (now - this.lastResub > 5000) {
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
    const me = client.publicKey.toBase58();
    const seat = r.players.findIndex((p, i) => p.toBase58() === me && r.isBot[i] === 0);
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
        if (tr && last && performance.now() - tr.lastSeen < 800) this.addFx({ kind: "death", x: last.x, y: last.y, sub: e.victim });
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
        // new match: forget the previous one's view, hits and pings
        if (r.status === ST_STARTING) {
          this.view = null;
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
    const ticks = this.tickTimes;
    const tps = ticks.length > 5 ? ((ticks.length - 1) * 1000) / (ticks[ticks.length - 1] - ticks[0]) : 0;
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

  private onView(v: View) {
    const now = performance.now();
    // ignore reordered updates, but a big jump back means a new match on a reused seat
    if (this.view && v.tick < this.view.tick && this.view.tick - v.tick < 100) return;
    const prev = this.view;
    const now0 = performance.now();
    void now0;
    this.view = v;
    this.viewAt = now;
    this.viewsRecv++;
    // rtt from input echo
    const sentAt = this.sentAt.get(v.me.inSeq);
    if (sentAt) {
      const sample = now - sentAt;
      this.rtt = this.rtt * 0.8 + sample * 0.2;
      this.sentAt.delete(v.me.inSeq);
    }
    // prediction reconcile
    if (v.me.alive && (v.status === ST_LIVE || v.status === ST_COUNTDOWN)) {
      if (!this.predValid) {
        controls.camYaw = (v.me.aim / 65536) * Math.PI * 2; // camera starts behind your spawn facing
        controls.camPitch = 0.32;
        this.input.aim = v.me.aim;
        this.pred = { x: v.me.x, y: v.me.y };
        this.predPrev = { ...this.pred };
        this.predMoved = v.me.moved;
        this.predValid = true;
      } else {
        const lagTicks = Math.min(6, Math.max(1, Math.round(this.rtt / 2 / 50)));
        // stamina follows the chain (it only gates sprint, so a little lag is harmless)
        // fatigue / winded follow the chain; crouch, jump and sprint bits stay local
        this.predMoved = (v.me.moved & 0xff04) | (this.predMoved & 0xfb);
        const [vx, vy] = inputVelocity(this.input.dx, this.input.dy, this.predSpeed);
        const tx = v.me.x + (v.status === ST_LIVE ? vx * lagTicks : 0);
        const ty = v.me.y + (v.status === ST_LIVE ? vy * lagTicks : 0);
        const ex = tx - this.pred.x;
        const ey = ty - this.pred.y;
        const e2 = ex * ex + ey * ey;
        // trust your own prediction; only nudge when we've clearly drifted, snap if way off
        if (e2 > (2 * UNIT) ** 2) {
          this.pred = { x: v.me.x, y: v.me.y };
          this.predPrev = { ...this.pred };
        } else if (e2 > (0.45 * UNIT) ** 2) {
          // shift both ends of the interpolation so the correction never pops
          const cx = ex * 0.05;
          const cy = ey * 0.05;
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
      } else this.bullets.push(b);
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
          banner("SUPPLY DROP", "danger", `Kar98k · full vest · full health · ${p.dist}m away, follow the red smoke`);
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
    // pickups (only while playing: a new night "changes" your gun back to the pistol)
    if (prev && v.status === ST_LIVE && prev.status === ST_LIVE && v.tick > prev.tick && (v.me.weapon !== prev.me.weapon || v.me.hp > prev.me.hp + 10 || v.me.armor > prev.me.armor + 10 || v.me.flare > prev.me.flare + 50)) {
      audio.pickup();
      const what = v.me.weapon !== prev.me.weapon ? 1 : v.me.flare > prev.me.flare + 50 ? 4 : v.me.armor > prev.me.armor + 10 ? 3 : 2;
      this.addFx({ kind: "loot", x: v.me.x, y: v.me.y, sub: what });
      banner(["", WEAPON_NAME[v.me.weapon] ?? "WEAPON", "+ HEALTH", "+ ARMOR", "FLARE: YOU SEE EVERYONE"][what], "event", what === 1 ? FIRE_MODE[v.me.weapon] : undefined);
    }
    if (prev && prev.me.reload === 0 && v.me.reload > 0) audio.reload(v.me.weapon);
    useStore.getState().set({ view: v });
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
    tr.samples.push({ t: now, tick, x: p.x, y: p.y, aim: p.aim, hp: p.hp, weapon: p.weapon, flags: p.flags });
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
      while (this.predAcc >= 50) {
        this.predAcc -= 50;
        this.predPrev = { ...this.pred };
        const down = v?.me.alive === DOWNED;
        const [speed, sp, word] = moveStep(this.predMoved, this.input.buttons, this.input.dx, this.input.dy, down);
        const [vx, vy] = inputVelocity(this.input.dx, this.input.dy, speed);
        const ox = this.pred.x;
        const oy = this.pred.y;
        moveBody(this.pred, vx, vy);
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
    if ((changed && since >= 40) || (aimChanged && since >= (firing ? 40 : 50)) || since >= 500) {
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
    // crank fallback: if the 20 Hz crank stalls, clients tick (slot-gated on chain)
    if ((r.status === ST_LIVE || r.status === ST_COUNTDOWN) && now - this.lastRoomTickAt > 700) {
      // same compute budget as the crank: a live tick (vision for 8 seats) needs far more than the default
      client.sendEr([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), client.tickIx(this.roomId)], { confirm: false }).catch(() => {});
    }
    // VRF fallback after ~6 s
    if (r.status === ST_STARTING && this.startingSince && now - this.startingSince > 6500 && (now | 0) % 1000 < 110) {
      client.sendEr([client.fallbackSeedIx(this.roomId)], { confirm: false }).catch(() => {});
    }
    // lights on: someone has to call finish — stagger by seat to avoid a stampede
    if (r.status === ST_ENDED && this.endedSince && now - this.endedSince > 600 + this.mySeat * 700 && (now | 0) % 1500 < 110) {
      const w = r.winner;
      const payout = w !== NO_SEAT && r.isBot[w] === 0 ? r.payout[w] : null;
      client.sendEr([client.finishIx(this.roomId, payout)], { confirm: false }).catch(() => {});
    }
  }

  // ------------------------------------------------------------ actions

  /** Staked rooms: the wallet funds the session key and buys a ticket in one base-layer tx. */
  async buyTicket(wallet: any): Promise<void> {
    const r = this.room ?? (await client.fetchRoom(this.roomId));
    const base = await client.fetchRoomBase(this.roomId);
    if (!r || !base) throw new Error("Room not found");
    const matchNo = base.matchNo + 1;
    const { Transaction, SystemProgram } = await import("@solana/web3.js");
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: client.publicKey, lamports: Number(r.stake) + 3_000_000 }),
      client.buyTicketIx(this.roomId, matchNo, wallet.publicKey),
    );
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await client.base.getLatestBlockhash()).blockhash;
    tx.partialSign(client.keypair);
    const signed = await wallet.signTransaction(tx);
    const sig = await client.base.sendRawTransaction(signed.serialize(), { skipPreflight: true });
    await client.base.confirmTransaction(sig, "confirmed");
    this.ticketMatch = matchNo;
  }
  ticketMatch = 0;

  async join(name: string, wallet: PublicKey | null, code = 0, preferSeat?: number) {
    const r = this.room ?? (await client.fetchRoom(this.roomId));
    if (!r) throw new Error("Room not found");
    if (r.status !== ST_LOBBY) throw new Error("Match in progress — wait for the lobby");
    const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => i < r.maxPlayers && r.players[i].toBase58() === DEFAULT_KEY && r.isBot[i] === 0);
    if (!free.length) throw new Error("Room is full");
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

  async setMode(duos: boolean) {
    await client.sendEr([client.setModeIx(this.roomId, duos)]);
    await this.poll();
  }

  async setLength(level: number) {
    await client.sendEr([client.setLengthIx(this.roomId, level)]);
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

  /** From the verdict screen: put the room back in the lobby, then give up your seat.
   *  For the host that closes the room for everyone. */
  async closeFromReveal(seat: number, host: boolean) {
    if (this.room?.status === ST_REVEALED) {
      // a guest leaving doesn't end everyone else's replay: their seat just goes stale and is cleared at the next start
      if (!host) return;
      await client.sendEr([client.resetIx(this.roomId)]).catch(() => {});
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
    await client.sendEr([client.resetIx(this.roomId)]);
    useStore.getState().set({ reveal: null });
    this.revealLoaded = false;
    await this.poll();
  }

  /** Interpolated position of another player at render time (≈100 ms behind). */
  sampleTrack(tr: Track, now: number): Sample | null {
    const s = tr.samples;
    if (!s.length) return null;
    const renderT = now - 110;
    if (s.length === 1 || renderT <= s[0].t) return s[0];
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

export const isEmptyKey = (k: PublicKey) => k.toBase58() === DEFAULT_KEY;
export { ST_LOBBY, ST_STARTING, ST_COUNTDOWN, ST_LIVE, ST_ENDED, ST_REVEALED };
