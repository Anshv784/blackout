// One live room: subscriptions, input sending, client prediction, interpolation,
// and the "anyone can push the room forward" duties (tick/seed/finish fallbacks).
import { PublicKey } from "@solana/web3.js";
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
} from "../chain/layout";
import { inputVelocity, moveBody, UNIT } from "./sim";
import { audio } from "./audio";

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

export class Session {
  roomId: bigint;
  room: Room | null = null;
  view: View | null = null;
  viewAt = 0;
  mySeat: number | null = null;
  tracks = new Map<number, Track>();
  bullets: { x: number; y: number; vx: number; vy: number }[] = [];
  bulletsAt = 0;
  fx: Fx[] = [];

  // prediction
  pred = { x: 0, y: 0 };
  predValid = false;
  private predAcc = 0;
  private lastFrame = performance.now();

  // input
  input = { dx: 0, dy: 0, aim: 0, buttons: 0 };
  private sent = { dx: 999, dy: 999, aim: -1, buttons: -1 };
  private seq = 0;
  private lastSendAt = 0;
  private sentAt = new Map<number, number>();
  rtt = 150;

  private pingHead = -1;
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
        if (e.killer === this.mySeat) audio.kill();
      }
    }
    this.lastFeedHead = r.feedHead;
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
        this.pred = { x: v.me.x, y: v.me.y };
        this.predValid = true;
      } else {
        const lagTicks = Math.min(6, Math.max(1, Math.round(this.rtt / 2 / 50)));
        const [vx, vy] = inputVelocity(this.input.dx, this.input.dy);
        const tx = v.me.x + (v.status === ST_LIVE ? vx * lagTicks : 0);
        const ty = v.me.y + (v.status === ST_LIVE ? vy * lagTicks : 0);
        const ex = tx - this.pred.x;
        const ey = ty - this.pred.y;
        const e2 = ex * ex + ey * ey;
        // trust your own prediction; only nudge when we've clearly drifted, snap if way off
        if (e2 > (2 * UNIT) ** 2) this.pred = { x: v.me.x, y: v.me.y };
        else if (e2 > (0.45 * UNIT) ** 2) {
          this.pred.x += ex * 0.06;
          this.pred.y += ey * 0.06;
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
    this.bullets = v.bullets;
    this.bulletsAt = now;
    // pings (sounds you can't see)
    if (this.pingHead < 0) this.pingHead = v.pingHead;
    for (let h = this.pingHead; h < v.pingHead; h++) {
      const p = v.pings[h % 12];
      if (!p || v.tick - p.tick > 40) continue;
      this.addFx({ kind: "ping", x: v.me.x, y: v.me.y, angle: p.angle, sub: p.kind, dist: p.dist });
      audio.ping(p.kind, p.angle, p.dist, this.input.aim);
    }
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
    if (prev && (v.me.weapon !== prev.me.weapon || v.me.hp > prev.me.hp + 10 || v.me.armor > prev.me.armor + 10)) audio.pickup();
    if (prev && prev.me.reload === 0 && v.me.reload > 0) audio.reload();
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
    const dt = Math.min(200, now - this.lastFrame);
    this.lastFrame = now;
    const v = this.view;
    const live = this.room?.status === ST_LIVE && v?.me.alive;
    if (live && this.predValid) {
      this.predAcc += dt;
      while (this.predAcc >= 50) {
        this.predAcc -= 50;
        const [vx, vy] = inputVelocity(this.input.dx, this.input.dy);
        moveBody(this.pred, vx, vy);
      }
    } else this.predAcc = 0;
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
    const aimChanged = aimDelta > 450;
    const since = now - this.lastSendAt;
    if (changed || (aimChanged && since >= 60) || since >= 500) {
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
    // lobby presence (free, gasless)
    if ((r.status === ST_LOBBY || r.status === ST_REVEALED) && now - this.lastBeat > 8000) {
      this.lastBeat = now;
      client.sendEr([client.heartbeatIx(this.roomId)], { confirm: false }).catch(() => {});
    }
    // crank fallback: if the 20 Hz crank stalls, clients tick (slot-gated on chain)
    if ((r.status === ST_LIVE || r.status === ST_COUNTDOWN) && now - this.lastRoomTickAt > 700) {
      client.sendEr([client.tickIx(this.roomId)], { confirm: false }).catch(() => {});
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

  async join(name: string, wallet: PublicKey | null, code = 0) {
    const r = this.room ?? (await client.fetchRoom(this.roomId));
    if (!r) throw new Error("Room not found");
    if (r.status !== ST_LOBBY) throw new Error("Match in progress — wait for the lobby");
    const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => r.players[i].toBase58() === DEFAULT_KEY && r.isBot[i] === 0);
    if (!free.length) throw new Error("Room is full");
    let lastErr: unknown = null;
    for (const seat of free.slice(0, 3)) {
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

  async startMatch(fillTo: number) {
    await client.sendEr([client.startIx(this.roomId, fillTo)]);
    await this.poll();
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
    if (this.predValid && v.me.alive) return this.pred;
    return { x: v.me.x, y: v.me.y };
  }
}

export const isEmptyKey = (k: PublicKey) => k.toBase58() === DEFAULT_KEY;
export { ST_LOBBY, ST_STARTING, ST_COUNTDOWN, ST_LIVE, ST_ENDED, ST_REVEALED };
