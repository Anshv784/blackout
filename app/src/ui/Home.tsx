import { Wordmark } from "./Brand";
import { friendlyError } from "../game/errors";
import { lazy, Suspense, useEffect, useState } from "react";
import { client } from "../game/identity";
import { ALL_ROOMS, STAKED_ROOMS } from "../config";
import { ST_LOBBY, ST_LIVE, ST_COUNTDOWN, ST_STARTING, ST_REVEALED, ST_ENDED, type Room, type BoardEntry, type Daily } from "../chain/layout";
import { todayUtc } from "../chain/client";
import { go } from "../App";
import { useStore } from "../game/store";
import { audio } from "../game/audio";
import { TopBar } from "./TopBar";
import { requireRealWallet, requireWallet } from "../game/wallet";
import { codeToText, createRoom, ensureDaily, findByCode, myRoom, playedToday, stakeLabel, sweepRooms } from "../game/rooms";
import { StakeChoice } from "./StakeChoice";
import { AlreadyInRoom } from "./AlreadyInRoom";

const Backdrop = lazy(() => import("../scene/Backdrop").then((m) => ({ default: m.Backdrop })));
const HeroSoldier = lazy(() => import("../scene/HeroSoldier").then((m) => ({ default: m.HeroSoldier })));

const EMPTY = "11111111111111111111111111111111";
export const humansIn = (r: Room) => r.players.filter((p, i) => r.isBot[i] === 0 && p.toBase58() !== EMPTY).length;
/** Humans whose browser is still heart-beating (seats go stale after ~45 s of silence). */
export const liveHumans = (r: Room, slot: number) =>
  r.players.filter((p, i) => r.isBot[i] === 0 && p.toBase58() !== EMPTY && ((slot >>> 0) - r.lastSeen[i]) >>> 0 <= 4500).length;

function statusLine(r: Room, slot: number) {
  if (r.status === ST_LIVE) return `${r.aliveCount} alive · night ${r.matchNo}`;
  if (r.status === ST_COUNTDOWN || r.status === ST_STARTING) return "dropping in…";
  if (r.status === ST_ENDED || r.status === ST_REVEALED) return "lights on";
  const h = slot ? liveHumans(r, slot) : humansIn(r);
  return h ? `${h} waiting` : "empty";
}

const untilMidnight = () => {
  const ms = (todayUtc() + 1) * 86_400_000 - Date.now();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** Today's daily: one sealed night for everyone, one try each. Its own card, not one button in a row. */
function DailyCard({ daily, busy, onPlay, className = "" }: { daily: Daily | null; busy: boolean; onPlay: () => void; className?: string }) {
  const wallet = useStore((s) => s.wallet);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const today = daily && daily.day === todayUtc() ? daily.entries : [];
  const best = today[0];
  const mine = wallet ? today.find((e) => e.key.toBase58() === wallet) : undefined;
  const rank = mine ? today.indexOf(mine) + 1 : 0;
  const name = (e: { name: string; key: { toBase58(): string } }) => e.name || `${e.key.toBase58().slice(0, 4)}…`;
  return (
    <div className={`daily-card ${className}`}>
      <div className="dc-top">
        <span className="dc-badge">DAILY CHALLENGE</span>
        <span className="dc-timer">new night in {untilMidnight()}</span>
      </div>
      <h3>Today's Night</h3>
      <p>Same sealed map, loot and zone for everyone. You and three bots. One try per wallet.</p>
      <div className="dc-stats">
        <div>
          <b>{today.length}</b>
          <span>played</span>
        </div>
        <div>
          <b>{best ? best.score : "—"}</b>
          <span>{best ? `best · ${name(best)}` : "no score yet"}</span>
        </div>
        <div>
          <b>{mine ? `#${rank}` : "—"}</b>
          <span>{mine ? `you · ${mine.score}` : "your rank"}</span>
        </div>
      </div>
      {mine ? (
        <button className="btn dc-btn done" onClick={() => go("/board")}>
          PLAYED ✓ · SEE TODAY'S BOARD
        </button>
      ) : (
        <button className="btn primary dc-btn" onClick={onPlay} disabled={busy}>
          {busy ? "OPENING TODAY'S NIGHT…" : "PLAY TODAY'S NIGHT"}
        </button>
      )}
    </div>
  );
}

/** Line icons for the room tiles. */
function TileIcon({ name }: { name: "room" | "friends" | "stake" }) {
  return (
    <svg className="tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {name === "room" && (
        <>
          <path d="M3 10.5 12 4l9 6.5" />
          <path d="M5 9.5V20h14V9.5" />
          <path d="M12 13v5M9.5 15.5h5" />
        </>
      )}
      {name === "friends" && (
        <>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 19.5c.8-3.2 3.2-5 6-5s5.2 1.8 6 5" />
          <path d="M16 5.2a3 3 0 0 1 0 5.6M18.2 14.6c1.4.8 2.4 2.4 2.8 4.9" />
        </>
      )}
      {name === "stake" && (
        <>
          <ellipse cx="12" cy="6.5" rx="7" ry="2.8" />
          <path d="M5 6.5v5c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-5" />
          <path d="M5 11.5v5c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-5" />
        </>
      )}
    </svg>
  );
}

/** Line icons for the bottom bar (drawn here, no emoji). */
function BarIcon({ name }: { name: string }) {
  const p: Record<string, JSX.Element> = {
    lock: (
      <>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
    bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z" />,
    dice: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <circle cx="9" cy="9" r="1.2" fill="currentColor" />
        <circle cx="15" cy="15" r="1.2" fill="currentColor" />
        <circle cx="15" cy="9" r="1.2" fill="currentColor" />
        <circle cx="9" cy="15" r="1.2" fill="currentColor" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  };
  return (
    <svg className="gb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {p[name]}
    </svg>
  );
}

export function Home() {
  const [rooms, setRooms] = useState<Record<number, Room | null>>({});
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [slot, setSlot] = useState(0);
  const [daily, setDaily] = useState<Daily | null>(null);
  const toast = useStore((s) => s.toast);
  const myName = useStore((s) => s.name);

  // stakes and ticket rent waiting from earlier staked nights go back to their wallets on their own
  // (only runs if this browser ever bought a ticket)
  useEffect(() => {
    const k = window.setTimeout(() => void import("../game/session").then((m) => m.reclaimTickets()).catch(() => {}), 4000);
    return () => clearTimeout(k);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const out: Record<number, Room | null> = {};
      // every room, private ones too (never listed): they still need sweeping, and you may be seated in one
      await Promise.all(ALL_ROOMS.map(async (id) => (out[id] = await client.fetchRoom(id).catch(() => null))));
      const sl = await (await client.teeConn()).getSlot().catch(() => 0);
      if (alive) {
        setRooms(out);
        setSlot(sl);
        if (sl) sweepRooms(out, sl);
      }
    };
    load();
    client
      .fetchDaily()
      .then((d) => alive && setDaily(d))
      .catch(() => {});
    client
      .fetchBoard()
      .then((b) => alive && b && setBoard([...b.entries].filter((e) => e.wins > 0 || e.earned > 0n).sort((a, c) => c.wins - a.wins || Number(c.earned - a.earned) || c.kills - a.kills).slice(0, 3)))
      .catch(() => {});
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const [code, setCode] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [stakePick, setStakePick] = useState(false);
  /** One room at a time: anything that would put you in a different room asks first. */
  const guard = async (target: number | null, then: () => void) => {
    // the room list may not have loaded yet (devnet can take a few seconds): check fresh, don't guess
    let list = Object.entries(rooms).map(([id, r]) => [Number(id), r] as const);
    if (!list.length) {
      list = await Promise.all(ALL_ROOMS.map(async (id) => [id, await client.fetchRoom(id).catch(() => null)] as const));
      const fresh: Record<number, Room | null> = {};
      for (const [id, r] of list) fresh[id] = r;
      setRooms(fresh);
    }
    const m = myRoom(list);
    if (m !== null && m !== target) setBlocked(true);
    else then();
  };
  const joinCode = () =>
    requireWallet(async () => {
      setBusy("code");
      try {
        const hit = await findByCode(code);
        if (!hit) toast("No open room with that code. Check it with the host.");
        else if (mine !== null && mine !== hit.id) setBlocked(true);
        else go(`/r/${hit.id}?code=${codeToText(hit.code).replace("-", "")}`);
      } finally {
        setBusy(null);
      }
    });

  /** Today's daily: roll the seed if needed, open a private 4-seat room, start from there. */
  const playDaily = async () => {
    audio.unlock();
    setBusy("daily");
    try {
      const d = await ensureDaily();
      const w = useStore.getState().wallet;
      if (w && playedToday(d, w)) {
        toast("You've played today's daily. A new one opens at midnight UTC.");
        go("/board");
        return;
      }
      const { id, code } = await createRoom(4, true);
      go(`/r/${id}?daily=1&code=${codeToText(code).replace("-", "")}`);
    } catch (e: any) {
      toast(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  /** Play now: sit in the open room with the most people, so players meet; open one if none. */
  const playNow = () => {
    audio.unlock();
    const best = [...openRooms].sort(([, a], [, b]) => liveHumans(b, slot) - liveHumans(a, slot))[0];
    if (best) go(`/r/${best[0]}?quick=1`);
    else create(false);
  };

  const create = async (unlisted: boolean) => {
    audio.unlock();
    setBusy(unlisted ? "friends" : "create");
    try {
      // 4 seats by default: rooms fill with people instead of bots (the host can change it)
      const { id, code } = await createRoom(4, unlisted);
      go(`/r/${id}${code ? `?code=${codeToText(code).replace("-", "")}` : ""}`);
    } catch (e: any) {
      toast(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const entries = Object.entries(rooms).filter(([id, r]) => r && !STAKED_ROOMS.includes(Number(id))) as [string, Room][];
  const hostHere = (r: Room) => {
    const i = r.players.findIndex((p, k) => r.isBot[k] === 0 && p.toBase58() !== EMPTY && p.equals(r.host));
    return i >= 0 && ((slot >>> 0) - r.lastSeen[i]) >>> 0 <= 4500;
  };
  const openRooms = entries.filter(([, r]) => r.status === ST_LOBBY && !r.unlisted && slot > 0 && hostHere(r) && liveHumans(r, slot) < r.maxPlayers);
  const liveMatches = entries.filter(([, r]) => !r.unlisted && (r.status === ST_LIVE || r.status === ST_COUNTDOWN));
  const mine = myRoom(Object.entries(rooms).map(([id, r]) => [Number(id), r] as const));
  const live = Object.values(rooms).filter((r) => r && (r.status === ST_LIVE || r.status === ST_COUNTDOWN)).length;
  const players = Object.values(rooms).reduce((n, r) => n + (r ? (slot ? liveHumans(r, slot) : humansIn(r)) : 0), 0);

  return (
    <div className="gate">
      <Suspense fallback={<div className="backdrop" />}>
        <Backdrop focus="gate" />
      </Suspense>
      <div className="gate-shade" />
      <TopBar active="play" />

      <main className="gate-main">
        <section className="gate-hero">
          <div className="kicker">
            <span className="dot" /> THE WARDEN IS WATCHING ·{" "}
            {live > 0 ? `${live} ${live === 1 ? "night" : "nights"} in the dark` : openRooms.length ? `${openRooms.length} open ${openRooms.length === 1 ? "room" : "rooms"}` : "every room is free"}
          </div>
          <h1 className="gate-title">
            <Wordmark />
          </h1>
          <p className="gate-tag">
            A real-time battle royale where <b>nobody can see you</b> — not the other players, not the RPC, <b>not even the chain</b>.
          </p>
          <div className="gate-cta">
            {mine !== null ? (
              <button className="btn primary huge" onClick={() => go(`/r/${mine}`)}>
                BACK TO YOUR ROOM
                <small>you can only host one room at a time</small>
              </button>
            ) : (
              <button className="btn primary huge" onClick={() => guard(null, () => requireWallet(playNow))} disabled={!!busy}>
                {busy === "create" ? "OPENING A ROOM…" : "PLAY NOW"}
                <small>{openRooms.length ? "joins the busiest open room" : "opens a room · bots fill the empty seats"}</small>
              </button>
            )}
            <div className="gate-alt">
              <button className="alt-tile" onClick={() => guard(null, () => requireWallet(() => create(false)))} disabled={!!busy}>
                <TileIcon name="room" />
                <b>{busy === "create" ? "OPENING…" : "CREATE ROOM"}</b>
                <span>public · you host</span>
              </button>
              <button className="alt-tile" onClick={() => guard(null, () => requireWallet(() => create(true)))} disabled={!!busy}>
                <TileIcon name="friends" />
                <b>{busy === "friends" ? "OPENING…" : "WITH FRIENDS"}</b>
                <span>private · share a code</span>
              </button>
              <button className="alt-tile gold" onClick={() => setStakePick(true)}>
                <TileIcon name="stake" />
                <b>STAKED NIGHT</b>
                <span>{stakeLabel(rooms)} · winner takes all</span>
              </button>
            </div>
            <form
              className="code-bar"
              onSubmit={(e) => {
                e.preventDefault();
                joinCode();
              }}
            >
              <span className="cb-label">GOT A CODE?</span>
              <input aria-label="Room code" placeholder="ABC-123" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} />
              <button type="submit" disabled={!!busy || code.replace("-", "").length !== 6}>
                {busy === "code" ? "FINDING…" : "JOIN"} <span aria-hidden>→</span>
              </button>
            </form>
          </div>
        </section>

        <div className="hero-stage" aria-hidden>
          <Suspense fallback={null}>
            <HeroSoldier />
          </Suspense>
          <div className="hero-plate">
            <span>OPERATOR</span>
            <b>{myName || "SURVIVOR"}</b>
          </div>
        </div>
        <aside className="gate-side">
          <DailyCard daily={daily} busy={busy === "daily"} onPlay={() => guard(null, () => requireRealWallet(playDaily))} />
          <div className="side-card rooms-card">
            <label>OPEN ROOMS · JOIN SOMEONE</label>
            {openRooms.length === 0 && <div className="side-empty">No one is waiting right now. Create a room — friends can join from your link.</div>}
            {openRooms.map(([id, r]) => (
              <button key={id} className="room-row" onClick={() => guard(Number(id), () => requireWallet(() => go(`/r/${id}`)))}>
                <span className="pulse st-0" />
                <span className="rr-name">{r.names[r.players.findIndex((p) => p.equals(r.host))] || "Someone"}'s room</span>
                <span className="rr-seats">
                  {Array.from({ length: r.maxPlayers }, (_, i) => (
                    <i key={i} className={r.players[i].toBase58() !== EMPTY ? "on" : ""} />
                  ))}
                </span>
                <span className="rr-st">
                  {liveHumans(r, slot)}/{r.maxPlayers} · join
                </span>
              </button>
            ))}
            {liveMatches.length > 0 && (
              <div className="side-live">
                <span className="pulse st-3" /> {liveMatches.length} {liveMatches.length === 1 ? "night" : "nights"} in progress ·{" "}
                {liveMatches.reduce((n, [, r]) => n + r.aliveCount, 0)} alive in the dark
              </div>
            )}
          </div>
          {board.length > 0 && (
            <div className="side-card">
              <label>TOP STAKED WINNERS</label>
              {board.map((e, i) => (
                <div key={e.key.toBase58()} className="lb-row">
                  <span className="lb-rank">{["I", "II", "III"][i]}</span>
                  <code>{e.name || `${e.key.toBase58().slice(0, 4)}…${e.key.toBase58().slice(-4)}`}</code>
                  <span>
                    {e.wins}W · {(Number(e.earned) / 1e9).toFixed(2)} SOL
                  </span>
                </div>
              ))}
              <a className="side-link" onClick={() => go("/board")}>
                full leaderboard →
              </a>
            </div>
          )}
        </aside>
      </main>
      <footer className="gate-bar">
        {[
          ["lock", "Sealed positions", "only your view leaves the TEE"],
          ["bolt", "20 ticks a second", "on-chain, no game server"],
          ["dice", "VRF loot & zone", "nobody can rig the night"],
          ["eye", "Lights-on replay", "every move revealed after"],
        ].map(([icon, b, t]) => (
          <div key={icon} className="gb-item">
            <BarIcon name={icon} />
            <div>
              <b>{b}</b>
              <span>{t}</span>
            </div>
          </div>
        ))}
        <div className="gb-live">
          <span className={`pulse ${live > 0 ? "st-3" : "st-0"}`} />
          <div>
            <b>{live > 0 ? `${live} ${live === 1 ? "night" : "nights"} live` : openRooms.length ? `${openRooms.length} ${openRooms.length === 1 ? "room" : "rooms"} filling` : "The Yard is quiet"}</b>
            <span>{live > 0 ? `${players} ${players === 1 ? "player" : "players"} in the dark` : openRooms.length ? "players waiting in the lobby" : "be the first in tonight"}</span>
          </div>
        </div>
      </footer>
      {stakePick && (
        <StakeChoice
          rooms={rooms}
          onClose={() => setStakePick(false)}
          onPick={(id) => {
            setStakePick(false);
            guard(id, () => requireRealWallet(() => go(`/r/${id}`)));
          }}
        />
      )}
      {blocked && mine !== null && rooms[mine] && <AlreadyInRoom id={mine} room={rooms[mine]!} onClose={() => setBlocked(false)} onLeft={() => toast(`Left room ${mine}`)} />}
    </div>
  );
}
