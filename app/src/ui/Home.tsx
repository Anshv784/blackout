import { lazy, Suspense, useEffect, useState } from "react";
import { client } from "../game/identity";
import { PUBLIC_ROOMS, PRIVATE_POOL, QUICK_ROOMS, STAKED_ROOMS } from "../config";
import { ST_LOBBY, ST_LIVE, ST_COUNTDOWN, ST_STARTING, ST_REVEALED, ST_ENDED, type Room, type BoardEntry } from "../chain/layout";
import { go } from "../App";
import { useStore } from "../game/store";
import { audio } from "../game/audio";
import { TopBar } from "./TopBar";

const Backdrop = lazy(() => import("../scene/Backdrop").then((m) => ({ default: m.Backdrop })));

const EMPTY = "11111111111111111111111111111111";
export const humansIn = (r: Room) => r.players.filter((p, i) => r.isBot[i] === 0 && p.toBase58() !== EMPTY).length;
/** Humans whose browser is still heart-beating (seats go stale after ~45 s of silence). */
export const liveHumans = (r: Room, slot: number) =>
  r.players.filter((p, i) => r.isBot[i] === 0 && p.toBase58() !== EMPTY && ((slot >>> 0) - r.lastSeen[i]) >>> 0 <= 4500).length;

function statusLine(r: Room) {
  if (r.status === ST_LIVE) return `${r.aliveCount} alive · night ${r.matchNo}`;
  if (r.status === ST_COUNTDOWN || r.status === ST_STARTING) return "dropping in…";
  if (r.status === ST_ENDED || r.status === ST_REVEALED) return "lights on";
  const h = humansIn(r);
  return h ? `${h} waiting` : "empty";
}

export function Home() {
  const [rooms, setRooms] = useState<Record<number, Room | null>>({});
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const out: Record<number, Room | null> = {};
      await Promise.all([...PUBLIC_ROOMS, ...STAKED_ROOMS].map(async (id) => (out[id] = await client.fetchRoom(id).catch(() => null))));
      if (alive) setRooms(out);
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

  /** One click: an empty room, auto-seat, start against bots. */
  const quickPlay = async () => {
    audio.unlock();
    setBusy("quick");
    try {
      const fresh = await Promise.all(QUICK_ROOMS.map(async (id) => [id, await client.fetchRoom(id).catch(() => null)] as const));
      const slot = await (await client.teeConn()).getSlot().catch(() => 0);
      const empty = fresh.filter(([, r]) => r && r.status === ST_LOBBY && liveHumans(r, slot) === 0);
      const pick = empty[Math.floor(Math.random() * empty.length)] ?? fresh.find(([, r]) => r && r.status === ST_LOBBY);
      if (!pick) throw new Error("Every room is mid-match — try again in a minute");
      go(`/r/${pick[0]}?quick=1`);
    } catch (e: any) {
      toast(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const withFriends = async () => {
    audio.unlock();
    setBusy("friends");
    try {
      const all = await Promise.all(PRIVATE_POOL.map(async (id) => [id, await client.fetchRoom(id).catch(() => null)] as const));
      const slot = await (await client.teeConn()).getSlot().catch(() => 0);
      const free = all.filter(([, r]) => r && r.status === ST_LOBBY && liveHumans(r, slot) === 0);
      const pick = free[Math.floor(Math.random() * free.length)] ?? all.find(([, r]) => r && r.status === ST_LOBBY);
      if (!pick) throw new Error("All private rooms are busy — try a public room");
      go(`/r/${pick[0]}?invite=1`);
    } catch (e: any) {
      toast(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const live = Object.values(rooms).filter((r) => r && (r.status === ST_LIVE || r.status === ST_COUNTDOWN)).length;
  const players = Object.values(rooms).reduce((n, r) => n + (r ? humansIn(r) : 0), 0);

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
            <button className="btn primary huge" onClick={quickPlay} disabled={!!busy}>
              {busy === "quick" ? "OPENING THE GATE…" : "PLAY NOW"}
              <small>solo vs bots · drop in seconds · no wallet</small>
            </button>
            <div className="gate-alt">
              <button className="btn" onClick={withFriends} disabled={!!busy}>
                {busy === "friends" ? "FINDING A ROOM…" : "PLAY WITH FRIENDS"}
              </button>
              <button className="btn gold-outline" onClick={() => go(`/r/${STAKED_ROOMS[0]}`)}>
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
            <label>LIVE IN THE YARD</label>
            {PUBLIC_ROOMS.map((id) => {
              const r = rooms[id];
              const st = r?.status ?? -1;
              return (
                <button key={id} className="room-row" onClick={() => go(`/r/${id}`)}>
                  <span className={`pulse st-${st}`} />
                  <span className="rr-name">Room {id}</span>
                  <span className="rr-seats">
                    {Array.from({ length: 8 }, (_, i) => {
                      const on = r && (r.isBot[i] === 1 || r.players[i].toBase58() !== EMPTY);
                      return <i key={i} className={on ? (r!.isBot[i] ? "bot" : "on") : ""} />;
                    })}
                  </span>
                  <span className="rr-st">{r ? statusLine(r) : "waking…"}</span>
                </button>
              );
            })}
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
