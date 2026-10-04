import { lazy, Suspense, useEffect, useState } from "react";
import { client } from "../game/identity";
import { PUBLIC_ROOMS, PRIVATE_POOL, QUICK_ROOMS, STAKED_ROOMS } from "../config";
import { ST_LOBBY, ST_LIVE, ST_COUNTDOWN, ST_STARTING, ST_REVEALED, ST_ENDED, type Room, type BoardEntry } from "../chain/layout";
import { go } from "../App";
import { useStore } from "../game/store";
import { audio } from "../game/audio";
import { TopBar } from "./TopBar";
import { requireWallet } from "../game/wallet";
import { createRoom, myRoom } from "../game/rooms";

const Backdrop = lazy(() => import("../scene/Backdrop").then((m) => ({ default: m.Backdrop })));

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

export function Home() {
  const [rooms, setRooms] = useState<Record<number, Room | null>>({});
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [slot, setSlot] = useState(0);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const out: Record<number, Room | null> = {};
      await Promise.all([...PUBLIC_ROOMS, ...STAKED_ROOMS].map(async (id) => (out[id] = await client.fetchRoom(id).catch(() => null))));
      const sl = await (await client.teeConn()).getSlot().catch(() => 0);
      if (alive) {
        setRooms(out);
        setSlot(sl);
      }
    };
    load();
    client
      .fetchBoard()
      .then((b) => alive && b && setBoard([...b.entries].sort((a, c) => c.wins - a.wins || c.kills - a.kills).slice(0, 3)))
      .catch(() => {});
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const create = async (unlisted: boolean) => {
    audio.unlock();
    setBusy(unlisted ? "friends" : "create");
    try {
      const id = await createRoom(6, unlisted);
      go(`/r/${id}${unlisted ? "?invite=1" : ""}`);
    } catch (e: any) {
      toast(String(e?.message ?? e).replace(/\(.*\)$/, "").slice(0, 140));
    } finally {
      setBusy(null);
    }
  };

  const entries = Object.entries(rooms).filter(([id, r]) => r && !STAKED_ROOMS.includes(Number(id))) as [string, Room][];
  const openRooms = entries.filter(([, r]) => r.status === ST_LOBBY && !r.unlisted && slot > 0 && liveHumans(r, slot) > 0 && liveHumans(r, slot) < r.maxPlayers);
  const liveMatches = entries.filter(([, r]) => r.status === ST_LIVE || r.status === ST_COUNTDOWN);
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
            <span className="dot" /> THE WARDEN IS WATCHING · {live} {live === 1 ? "match" : "matches"} in the dark · {players} survivors
          </div>
          <h1 className="gate-title">BLACKOUT</h1>
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
              <button className="btn primary huge" onClick={() => requireWallet(() => create(false))} disabled={!!busy}>
                {busy === "create" ? "OPENING A ROOM…" : "CREATE A ROOM"}
                <small>you're the host · pick your seats · bots fill the rest</small>
              </button>
            )}
            <div className="gate-alt">
              <button className="btn" onClick={() => requireWallet(() => create(true))} disabled={!!busy || mine !== null}>
                {busy === "friends" ? "OPENING…" : "PRIVATE ROOM FOR FRIENDS"}
              </button>
              <button className="btn gold-outline" onClick={() => requireWallet(() => go(`/r/${STAKED_ROOMS[0]}`))}>
                STAKED NIGHT · 0.01 SOL
              </button>
            </div>
          </div>
          <div className="gate-facts">
            <span>🔒 positions sealed in a TEE</span>
            <span>⚡ 20 ticks/s · no server</span>
            <span>🎲 VRF-rolled loot &amp; zone</span>
            <span>💡 lights-on replay</span>
          </div>
        </section>

        <aside className="gate-side">
          <div className="side-card">
            <label>OPEN ROOMS · JOIN SOMEONE</label>
            {openRooms.length === 0 && <div className="side-empty">No one is waiting right now. Create a room — friends can join from your link.</div>}
            {openRooms.map(([id, r]) => (
              <button key={id} className="room-row" onClick={() => requireWallet(() => go(`/r/${id}`))}>
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
              <label>LAST ONES STANDING</label>
              {board.map((e, i) => (
                <div key={e.key.toBase58()} className="lb-row">
                  <span className="lb-rank">{["I", "II", "III"][i]}</span>
                  <code>
                    {e.key.toBase58().slice(0, 4)}…{e.key.toBase58().slice(-4)}
                  </code>
                  <span>
                    {e.wins}W · {e.kills}K
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
    </div>
  );
}
